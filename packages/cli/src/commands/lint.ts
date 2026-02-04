import { loadPack } from '@eurocomply/registry-sdk';
import { validateAST, createDefaultRegistry } from '@eurocomply/kernel-vm';
import type { ASTValidationResult } from '@eurocomply/types';

export interface LintResult {
  valid: boolean;
  packName: string;
  errors: Array<{ path: string; error: string; suggestion?: string }>;
  handlersUsed: string[];
  complexity: number;
}

export async function lint(packDir: string): Promise<LintResult> {
  const pack = await loadPack(packDir);
  const registry = createDefaultRegistry();

  if (!pack.ruleAST) {
    return {
      valid: false,
      packName: pack.manifest.name,
      errors: [{ path: 'pack.json', error: 'No logic_root specified — nothing to lint' }],
      handlersUsed: [],
      complexity: 0,
    };
  }

  const result: ASTValidationResult = validateAST(pack.ruleAST, registry);

  return {
    valid: result.valid,
    packName: pack.manifest.name,
    errors: result.errors,
    handlersUsed: result.handlers_used,
    complexity: result.estimated_complexity,
  };
}
