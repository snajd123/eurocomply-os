import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { test as testCmd } from './test.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('eurocomply test', () => {
  const packDir = join(tmpdir(), `test-cmd-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(join(packDir, 'rules'), { recursive: true });
    mkdirSync(join(packDir, 'tests'), { recursive: true });

    writeFileSync(join(packDir, 'pack.json'), JSON.stringify({
      name: '@test/testable-pack',
      version: '1.0.0',
      type: 'logic',
      logic_root: 'rules/main.ast.json',
      validation_suite: 'tests/validation_suite.json',
    }));

    writeFileSync(join(packDir, 'rules', 'main.ast.json'), JSON.stringify({
      handler: 'core:threshold_check',
      config: {
        value: { field: 'concentration' },
        operator: 'lt',
        threshold: 0.1,
      },
      label: 'Concentration below 0.1%',
    }));

    writeFileSync(join(packDir, 'tests', 'validation_suite.json'), JSON.stringify({
      vertical_id: 'cosmetics',
      test_cases: [
        {
          id: 'below-limit',
          description: 'Concentration below limit passes',
          entity_data: { name: 'Safe', concentration: 0.05 },
          expected_status: 'compliant',
        },
        {
          id: 'above-limit',
          description: 'Concentration above limit fails',
          entity_data: { name: 'Unsafe', concentration: 0.5 },
          expected_status: 'non_compliant',
        },
      ],
    }));
  });

  afterAll(() => {
    rmSync(packDir, { recursive: true, force: true });
  });

  it('should run all test cases and report results', async () => {
    const result = await testCmd(packDir);
    expect(result.total).toBe(2);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.allPassed).toBe(true);
  });

  it('should detect mismatched expected status', async () => {
    const badDir = join(tmpdir(), `test-bad-${Date.now()}`);
    mkdirSync(join(badDir, 'rules'), { recursive: true });
    mkdirSync(join(badDir, 'tests'), { recursive: true });

    writeFileSync(join(badDir, 'pack.json'), JSON.stringify({
      name: '@test/bad-test-pack',
      version: '1.0.0',
      type: 'logic',
      logic_root: 'rules/main.ast.json',
      validation_suite: 'tests/validation_suite.json',
    }));

    writeFileSync(join(badDir, 'rules', 'main.ast.json'), JSON.stringify({
      handler: 'core:threshold_check',
      config: { value: { field: 'x' }, operator: 'lt', threshold: 10 },
    }));

    // Expect non_compliant but value 5 < 10 = compliant
    writeFileSync(join(badDir, 'tests', 'validation_suite.json'), JSON.stringify({
      vertical_id: 'test',
      test_cases: [
        { id: 'wrong', description: 'Mismatch', entity_data: { x: 5 }, expected_status: 'non_compliant' },
      ],
    }));

    const result = await testCmd(badDir);
    expect(result.failed).toBe(1);
    expect(result.allPassed).toBe(false);

    rmSync(badDir, { recursive: true, force: true });
  });
});
