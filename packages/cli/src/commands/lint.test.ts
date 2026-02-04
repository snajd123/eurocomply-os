import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { lint } from './lint.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('eurocomply lint', () => {
  const validDir = join(tmpdir(), `lint-valid-${Date.now()}`);
  const invalidDir = join(tmpdir(), `lint-invalid-${Date.now()}`);

  beforeAll(() => {
    // Valid pack
    mkdirSync(join(validDir, 'rules'), { recursive: true });
    writeFileSync(join(validDir, 'pack.json'), JSON.stringify({
      name: '@test/valid-pack',
      version: '1.0.0',
      type: 'logic',
      logic_root: 'rules/main.ast.json',
    }));
    writeFileSync(join(validDir, 'rules', 'main.ast.json'), JSON.stringify({
      handler: 'core:threshold_check',
      config: { value: { field: 'x' }, operator: 'lt', threshold: 10 },
    }));

    // Invalid pack — unknown handler
    mkdirSync(join(invalidDir, 'rules'), { recursive: true });
    writeFileSync(join(invalidDir, 'pack.json'), JSON.stringify({
      name: '@test/bad-pack',
      version: '1.0.0',
      type: 'logic',
      logic_root: 'rules/main.ast.json',
    }));
    writeFileSync(join(invalidDir, 'rules', 'main.ast.json'), JSON.stringify({
      handler: 'core:nonexistent_handler',
      config: {},
    }));
  });

  afterAll(() => {
    rmSync(validDir, { recursive: true, force: true });
    rmSync(invalidDir, { recursive: true, force: true });
  });

  it('should return success for a valid pack', async () => {
    const result = await lint(validDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should return errors for unknown handler', async () => {
    const result = await lint(invalidDir);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].error).toContain('Unknown handler');
  });
});
