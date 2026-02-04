import { loadPack } from '@eurocomply/registry-sdk';
import { Simulator, createDefaultRegistry } from '@eurocomply/kernel-vm';
import type { TestCaseResult } from '@eurocomply/kernel-vm';

export interface TestResult {
  packName: string;
  total: number;
  passed: number;
  failed: number;
  allPassed: boolean;
  astValid: boolean;
  results: TestCaseResult[];
}

export async function test(packDir: string): Promise<TestResult> {
  const pack = await loadPack(packDir);
  const registry = createDefaultRegistry();
  const simulator = new Simulator(registry);

  if (!pack.ruleAST) {
    return {
      packName: pack.manifest.name,
      total: 0, passed: 0, failed: 0,
      allPassed: false,
      astValid: false,
      results: [],
    };
  }

  if (!pack.validationSuite) {
    return {
      packName: pack.manifest.name,
      total: 0, passed: 0, failed: 0,
      allPassed: false,
      astValid: true,
      results: [],
    };
  }

  const report = simulator.run(pack.ruleAST, pack.validationSuite);

  return {
    packName: pack.manifest.name,
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    allPassed: report.ast_valid && report.failed === 0,
    astValid: report.ast_valid,
    results: report.results,
  };
}
