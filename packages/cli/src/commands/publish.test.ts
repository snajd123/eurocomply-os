import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { publish } from './publish.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('eurocomply publish', () => {
  const validDir = join(tmpdir(), `publish-valid-${Date.now()}`);
  const invalidDir = join(tmpdir(), `publish-invalid-${Date.now()}`);

  beforeAll(() => {
    // Valid pack with threshold_check AST + 1 test case
    mkdirSync(join(validDir, 'rules'), { recursive: true });
    mkdirSync(join(validDir, 'tests'), { recursive: true });
    writeFileSync(join(validDir, 'pack.json'), JSON.stringify({
      name: '@test/publishable-pack',
      version: '1.0.0',
      type: 'logic',
      logic_root: 'rules/main.ast.json',
      validation_suite: 'tests/validation_suite.json',
    }));
    writeFileSync(join(validDir, 'rules', 'main.ast.json'), JSON.stringify({
      handler: 'core:threshold_check',
      config: {
        value: { field: 'concentration' },
        operator: 'lt',
        threshold: 0.1,
      },
      label: 'Concentration below 0.1%',
    }));
    writeFileSync(join(validDir, 'tests', 'validation_suite.json'), JSON.stringify({
      vertical_id: 'cosmetics',
      test_cases: [
        {
          id: 'below-limit',
          description: 'Concentration below limit passes',
          entity_data: { name: 'Safe', concentration: 0.05 },
          expected_status: 'compliant',
        },
      ],
    }));

    // Invalid pack — unknown handler
    mkdirSync(join(invalidDir, 'rules'), { recursive: true });
    writeFileSync(join(invalidDir, 'pack.json'), JSON.stringify({
      name: '@test/bad-publish-pack',
      version: '1.0.0',
      type: 'logic',
      logic_root: 'rules/main.ast.json',
    }));
    writeFileSync(join(invalidDir, 'rules', 'main.ast.json'), JSON.stringify({
      handler: 'core:nonexistent',
      config: {},
    }));
  });

  afterAll(() => {
    rmSync(validDir, { recursive: true, force: true });
    rmSync(invalidDir, { recursive: true, force: true });
  });

  it('should validate pack before publishing', async () => {
    const result = await publish(validDir, { registryUrl: 'http://localhost:0', dryRun: true });
    expect(result.validated).toBe(true);
    expect(result.lintResult.valid).toBe(true);
    expect(result.testResult.allPassed).toBe(true);
    expect(result.published).toBe(false);
    expect(result.packName).toBe('@test/publishable-pack');
    expect(result.version).toBe('1.0.0');
  });

  it('should fail publish if lint fails', async () => {
    const result = await publish(invalidDir, { registryUrl: 'http://localhost:0', dryRun: true });
    expect(result.validated).toBe(false);
    expect(result.lintResult.valid).toBe(false);
    expect(result.published).toBe(false);
    expect(result.error).toContain('Lint failed');
  });
});
