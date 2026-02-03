import { v4 as uuid } from 'uuid';
import type { PostgresConnectionManager } from '../db/postgres.js';
import type { AuditLogger } from './audit.js';
import type { ServiceContext, ServiceResult } from '@eurocomply/types';

export interface StorageBackend {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export interface FileUploadInput {
  filename: string;
  content_type: string;
  content: Buffer;
  entity_id?: string;
  entity_type?: string;
}

export interface FileUploadOutput {
  file_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
}

export interface FileGetInput {
  file_id: string;
}

export interface FileGetOutput {
  metadata: {
    file_id: string;
    filename: string;
    content_type: string;
    size_bytes: number;
    entity_id: string | null;
    entity_type: string | null;
    created_at: string;
  };
  content: Buffer;
}

export class FileService {
  constructor(
    private db: PostgresConnectionManager,
    private audit: AuditLogger,
    private storage: StorageBackend,
  ) {}

  async upload(
    ctx: ServiceContext,
    input: FileUploadInput,
  ): Promise<ServiceResult<FileUploadOutput>> {
    const fileId = uuid();
    const storageKey = `${ctx.tenant_id}/${fileId}/${input.filename}`;

    await this.storage.put(storageKey, input.content);

    await this.db.query(
      `INSERT INTO files (file_id, tenant_id, filename, content_type, size_bytes, storage_key, entity_id, entity_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        fileId, ctx.tenant_id, input.filename, input.content_type,
        input.content.length, storageKey,
        input.entity_id ?? null, input.entity_type ?? null,
        ctx.principal.id,
      ]
    );

    const auditEntry = await this.audit.log(ctx, {
      action: 'upload',
      resource: {
        entity_type: input.entity_type ?? 'file',
        entity_id: input.entity_id ?? fileId,
      },
      changes: {
        fields_changed: ['file'],
        after: { file_id: fileId, filename: input.filename },
      },
      success: true,
    });

    return {
      success: true,
      data: {
        file_id: fileId,
        filename: input.filename,
        content_type: input.content_type,
        size_bytes: input.content.length,
        storage_key: storageKey,
      },
      audit_entry: auditEntry as any,
    };
  }

  async get(
    ctx: ServiceContext,
    input: FileGetInput,
  ): Promise<ServiceResult<FileGetOutput>> {
    const result = await this.db.query(
      'SELECT * FROM files WHERE file_id = $1 AND tenant_id = $2',
      [input.file_id, ctx.tenant_id]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        data: {
          metadata: {
            file_id: input.file_id,
            filename: '',
            content_type: '',
            size_bytes: 0,
            entity_id: null,
            entity_type: null,
            created_at: '',
          },
          content: Buffer.alloc(0),
        },
      };
    }

    const row = result.rows[0] as {
      file_id: string; filename: string; content_type: string;
      size_bytes: number; storage_key: string; entity_id: string | null;
      entity_type: string | null; created_at: string;
    };

    const content = await this.storage.get(row.storage_key);
    if (!content) {
      return {
        success: false,
        data: {
          metadata: {
            file_id: row.file_id,
            filename: row.filename,
            content_type: row.content_type,
            size_bytes: Number(row.size_bytes),
            entity_id: row.entity_id,
            entity_type: row.entity_type,
            created_at: row.created_at,
          },
          content: Buffer.alloc(0),
        },
      };
    }

    return {
      success: true,
      data: {
        metadata: {
          file_id: row.file_id,
          filename: row.filename,
          content_type: row.content_type,
          size_bytes: Number(row.size_bytes),
          entity_id: row.entity_id,
          entity_type: row.entity_type,
          created_at: row.created_at,
        },
        content,
      },
    };
  }
}
