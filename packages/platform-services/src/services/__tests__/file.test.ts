import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FileService, type StorageBackend } from '../file.js';
import { AuditLogger } from '../audit.js';
import { PostgresConnectionManager } from '../../db/postgres.js';
import { runMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ServiceContext } from '@eurocomply/types';

// In-memory storage backend for tests
class MemoryStorageBackend implements StorageBackend {
  private store = new Map<string, Buffer>();

  async put(key: string, data: Buffer): Promise<void> {
    this.store.set(key, data);
  }

  async get(key: string): Promise<Buffer | null> {
    return this.store.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

describe('FileService', () => {
  let container: StartedPostgreSqlContainer;
  let db: PostgresConnectionManager;
  let audit: AuditLogger;
  let files: FileService;

  const ctx: ServiceContext = {
    tenant_id: 'tenant_1',
    principal: { type: 'user', id: 'user_1' },
    correlation_id: 'corr_1',
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    db = new PostgresConnectionManager({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await runMigrations(db);

    // Insert entity type and entity needed for FK constraint in attachment test
    await db.query(
      `INSERT INTO entity_types (entity_type, tenant_id, schema) VALUES ($1, $2, $3)`,
      ['product', 'tenant_1', JSON.stringify({ fields: [] })]
    );
    await db.query(
      `INSERT INTO entities (entity_id, entity_type, tenant_id, data, version) VALUES ($1, $2, $3, $4, $5)`,
      ['prod_1', 'product', 'tenant_1', JSON.stringify({ name: 'Test Product' }), 1]
    );

    audit = new AuditLogger(db);
    files = new FileService(db, audit, new MemoryStorageBackend());
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should upload a file', async () => {
    const result = await files.upload(ctx, {
      filename: 'safety-data-sheet.pdf',
      content_type: 'application/pdf',
      content: Buffer.from('fake pdf content'),
    });

    expect(result.success).toBe(true);
    expect(result.data.file_id).toBeDefined();
    expect(result.data.filename).toBe('safety-data-sheet.pdf');
    expect(result.data.size_bytes).toBeGreaterThan(0);
  });

  it('should get a file', async () => {
    const uploaded = await files.upload(ctx, {
      filename: 'report.txt',
      content_type: 'text/plain',
      content: Buffer.from('test content'),
    });

    const result = await files.get(ctx, {
      file_id: uploaded.data.file_id,
    });

    expect(result.success).toBe(true);
    expect(result.data.metadata.filename).toBe('report.txt');
    expect(result.data.content.toString()).toBe('test content');
  });

  it('should upload with entity attachment', async () => {
    const result = await files.upload(ctx, {
      filename: 'coa.pdf',
      content_type: 'application/pdf',
      content: Buffer.from('certificate'),
      entity_id: 'prod_1',
      entity_type: 'product',
    });

    expect(result.success).toBe(true);
    expect(result.audit_entry).toBeDefined();
  });
});
