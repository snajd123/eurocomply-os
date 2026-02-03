import type { ASTNode, ASTValidationError, ExecutionTrace } from '@eurocomply/types';
import type { HandlerRegistry } from './registry.js';
import { validateAST } from './validator.js';
import { evaluate } from './evaluator.js';

export interface TestCase {
  id: string;
  description: string;
  entity_data: Record<string, unknown>;
  context_data?: Record<string, unknown>;
  expected_status: 'compliant' | 'non_compliant';
}

export interface ValidationSuite {
  vertical_id: string;
  test_cases: TestCase[];
}

export interface TestCaseResult {
  test_case_id: string;
  description: string;
  expected_status: 'compliant' | 'non_compliant';
  actual_status: 'compliant' | 'non_compliant';
  match: boolean;
  trace: ExecutionTrace;
  explanation: string;
}

export interface SimulatorReport {
  ast_valid: boolean;
  ast_errors: ASTValidationError[];
  total: number;
  passed: number;
  failed: number;
  results: TestCaseResult[];
}

export class Simulator {
  constructor(private registry: HandlerRegistry) {}

  run(ast: ASTNode, suite: ValidationSuite): SimulatorReport {
    const v = validateAST(ast, this.registry);
    if (!v.valid) {
      return {
        ast_valid: false,
        ast_errors: v.errors,
        total: 0,
        passed: 0,
        failed: 0,
        results: [],
      };
    }

    const results: TestCaseResult[] = suite.test_cases.map(tc => {
      const ctx = {
        entity_type: 'test',
        entity_id: tc.id,
        entity_data: tc.entity_data,
        data: tc.context_data ?? {},
        compliance_lock_id: 'simulator',
        vertical_id: suite.vertical_id,
        market: 'test',
        timestamp: new Date().toISOString(),
      };
      const r = evaluate(ast, ctx, this.registry);
      const actual = r.success ? 'compliant' as const : 'non_compliant' as const;
      return {
        test_case_id: tc.id,
        description: tc.description,
        expected_status: tc.expected_status,
        actual_status: actual,
        match: actual === tc.expected_status,
        trace: r.trace,
        explanation: r.explanation.summary,
      };
    });

    return {
      ast_valid: true,
      ast_errors: [],
      total: results.length,
      passed: results.filter(r => r.match).length,
      failed: results.filter(r => !r.match).length,
      results,
    };
  }
}
