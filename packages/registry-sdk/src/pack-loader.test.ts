import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadPack } from './pack-loader.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('PackLoader', () => {
  const testDir = join(tmpdir(), `pack-loader-test-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(join(testDir, 'rules'), { recursive: true });
    mkdirSync(join(testDir, 'tests'), { recursive: true });

    writeFileSync(join(testDir, 'pack.json'), JSON.stringify({
      name: '@test/sample-pack',
      version: '1.0.0',
      type: 'logic',
      scope: { verticals: ['cosmetics'], markets: ['EU'] },
      logic_root: 'rules/main.ast.json',
      validation_suite: 'tests/validation_suite.json',
    }));

    writeFileSync(join(testDir, 'rules', 'main.ast.json'), JSON.stringify({
      handler: 'core:threshold_check',
      config: {
        value: { field: 'lead_ppm' },
        operator: 'lt',
        threshold: 10,
      },
      label: 'Lead below 10 ppm',
    }));

    writeFileSync(join(testDir, 'tests', 'validation_suite.json'), JSON.stringify({
      vertical_id: 'cosmetics',
      test_cases: [
        {
          id: 'lead-compliant',
          description: 'Product with low lead passes',
          entity_data: { name: 'Safe Product', lead_ppm: 0.5 },
          expected_status: 'compliant',
        },
        {
          id: 'lead-non-compliant',
          description: 'Product with high lead fails',
          entity_data: { name: 'Unsafe Product', lead_ppm: 15 },
          expected_status: 'non_compliant',
        },
      ],
    }));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should load a valid pack from directory', async () => {
    const pack = await loadPack(testDir);
    expect(pack.manifest.name).toBe('@test/sample-pack');
    expect(pack.manifest.version).toBe('1.0.0');
    expect(pack.manifest.type).toBe('logic');
  });

  it('should load the rule AST', async () => {
    const pack = await loadPack(testDir);
    expect(pack.ruleAST).toBeDefined();
    expect(pack.ruleAST!.handler).toBe('core:threshold_check');
  });

  it('should load the validation suite', async () => {
    const pack = await loadPack(testDir);
    expect(pack.validationSuite).toBeDefined();
    expect(pack.validationSuite!.test_cases).toHaveLength(2);
  });

  it('should reject invalid manifest', async () => {
    const badDir = join(tmpdir(), `bad-pack-${Date.now()}`);
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, 'pack.json'), JSON.stringify({ name: 'invalid' }));
    await expect(loadPack(badDir)).rejects.toThrow();
    rmSync(badDir, { recursive: true, force: true });
  });
});
