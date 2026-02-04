import { describe, it, expect } from 'vitest';
import {
  EntityDefineInputSchema,
  EntityCreateInputSchema,
  EntityGetInputSchema,
  EntityUpdateInputSchema,
  EntityListInputSchema,
  FileUploadInputSchema,
  FileGetInputSchema,
  JobSubmitInputSchema,
  JobStatusInputSchema,
  AuditQueryInputSchema,
  EvaluateInputSchema,
  RegistryInstallInputSchema,
  RegistryListInputSchema,
  RegistryLockInputSchema,
  RegistryLocksInputSchema,
  RegistrySaveLockInputSchema,
} from './schemas.js';

describe('MCP tool input schemas', () => {
  describe('entity:define', () => {
    it('accepts valid input', () => {
      const result = EntityDefineInputSchema.safeParse({
        entity_type: 'product',
        schema: { name: { type: 'string' } },
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing entity_type', () => {
      const result = EntityDefineInputSchema.safeParse({
        schema: { name: { type: 'string' } },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('entity:create', () => {
    it('accepts valid input', () => {
      const result = EntityCreateInputSchema.safeParse({
        entity_type: 'product',
        data: { name: 'Widget' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing data', () => {
      const result = EntityCreateInputSchema.safeParse({
        entity_type: 'product',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('entity:get', () => {
    it('accepts valid input', () => {
      const result = EntityGetInputSchema.safeParse({
        entity_type: 'product',
        entity_id: 'p-123',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing entity_id', () => {
      const result = EntityGetInputSchema.safeParse({
        entity_type: 'product',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('entity:update', () => {
    it('accepts valid input', () => {
      const result = EntityUpdateInputSchema.safeParse({
        entity_type: 'product',
        entity_id: 'p-123',
        data: { name: 'Updated Widget' },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('entity:list', () => {
    it('accepts valid input', () => {
      const result = EntityListInputSchema.safeParse({
        entity_type: 'product',
      });
      expect(result.success).toBe(true);
    });

    it('accepts optional limit/offset', () => {
      const result = EntityListInputSchema.safeParse({
        entity_type: 'product',
        limit: 10,
        offset: 0,
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty entity_type string', () => {
      const result = EntityListInputSchema.safeParse({ entity_type: '' });
      expect(result.success).toBe(false);
    });

    it('rejects negative limit', () => {
      const result = EntityListInputSchema.safeParse({ entity_type: 'product', limit: -5 });
      expect(result.success).toBe(false);
    });

    it('rejects negative offset', () => {
      const result = EntityListInputSchema.safeParse({ entity_type: 'product', offset: -1 });
      expect(result.success).toBe(false);
    });
  });

  describe('file:upload', () => {
    it('accepts valid input', () => {
      const result = FileUploadInputSchema.safeParse({
        filename: 'test.pdf',
        content_type: 'application/pdf',
        content: 'base64data',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing filename', () => {
      const result = FileUploadInputSchema.safeParse({
        content_type: 'application/pdf',
        content: 'base64data',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('file:get', () => {
    it('accepts valid input', () => {
      const result = FileGetInputSchema.safeParse({ file_id: 'f-123' });
      expect(result.success).toBe(true);
    });
  });

  describe('job:submit', () => {
    it('accepts valid input', () => {
      const result = JobSubmitInputSchema.safeParse({
        job_type: 'evaluation',
        payload: { entity_id: 'p-1' },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('job:status', () => {
    it('accepts valid input', () => {
      const result = JobStatusInputSchema.safeParse({ job_id: 'j-123' });
      expect(result.success).toBe(true);
    });
  });

  describe('audit:query', () => {
    it('accepts valid input', () => {
      const result = AuditQueryInputSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts optional filters', () => {
      const result = AuditQueryInputSchema.safeParse({
        action: 'evaluate',
        resource_entity_id: 'p-1',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('evaluate', () => {
    it('accepts valid input', () => {
      const result = EvaluateInputSchema.safeParse({
        entity_type: 'product',
        entity_id: 'p-1',
        rule: { handler: 'core:threshold_check', config: { value: 10, operator: 'lt', threshold: 100 } },
        compliance_lock_id: 'lock-1',
        vertical_id: 'cosmetics',
        market: 'EU',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing rule', () => {
      const result = EvaluateInputSchema.safeParse({
        entity_type: 'product',
        entity_id: 'p-1',
        compliance_lock_id: 'lock-1',
        vertical_id: 'cosmetics',
        market: 'EU',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('registry:install', () => {
    it('accepts valid pack manifest', () => {
      const result = RegistryInstallInputSchema.safeParse({
        name: 'eu-clp',
        version: '1.0.0',
        type: 'logic',
      });
      expect(result.success).toBe(true);
    });

    it('accepts known optional fields', () => {
      const result = RegistryInstallInputSchema.safeParse({
        name: 'eu-clp',
        version: '1.0.0',
        type: 'logic',
        author: 'ACME Corp',
        description: 'EU CLP regulation pack',
        dependencies: { '@eurocomply/base': '1.0.0' },
      });
      expect(result.success).toBe(true);
    });

    it('strips unknown fields', () => {
      const result = RegistryInstallInputSchema.safeParse({
        name: 'eu-clp',
        version: '1.0.0',
        type: 'logic',
        __proto__: 'attack',
        malicious_field: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as any).malicious_field).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(result.data, '__proto__')).toBe(false);
      }
    });
  });

  describe('registry:list', () => {
    it('accepts empty input', () => {
      const result = RegistryListInputSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('registry:lock', () => {
    it('accepts lock_id', () => {
      const result = RegistryLockInputSchema.safeParse({ lock_id: 'lock-1' });
      expect(result.success).toBe(true);
    });
  });

  describe('registry:locks', () => {
    it('accepts empty input', () => {
      const result = RegistryLocksInputSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('registry:save-lock', () => {
    it('accepts lock object', () => {
      const result = RegistrySaveLockInputSchema.safeParse({
        lock_id: 'lock-1',
        packs: [],
        handler_vm_version: '1.0.0',
        created_at: '2026-01-01T00:00:00Z',
      });
      expect(result.success).toBe(true);
    });
  });
});
