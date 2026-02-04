import { loadPack } from '@eurocomply/registry-sdk';
import { lint, type LintResult } from './lint.js';
import { test as testCmd, type TestResult } from './test.js';

export interface PublishOptions {
  registryUrl: string;
  dryRun?: boolean;
}

export interface PublishResult {
  packName: string;
  version: string;
  validated: boolean;
  lintResult: LintResult;
  testResult: TestResult;
  published: boolean;
  cid?: string;
  error?: string;
}

export async function publish(packDir: string, options: PublishOptions): Promise<PublishResult> {
  const pack = await loadPack(packDir);

  // Validate: lint
  const lintResult = await lint(packDir);
  if (!lintResult.valid) {
    return {
      packName: pack.manifest.name,
      version: pack.manifest.version,
      validated: false,
      lintResult,
      testResult: { packName: pack.manifest.name, total: 0, passed: 0, failed: 0, allPassed: false, astValid: false, results: [] },
      published: false,
      error: `Lint failed: ${lintResult.errors.length} error(s)`,
    };
  }

  // Validate: test
  const testResult = await testCmd(packDir);
  if (!testResult.allPassed) {
    return {
      packName: pack.manifest.name,
      version: pack.manifest.version,
      validated: false,
      lintResult,
      testResult,
      published: false,
      error: `Tests failed: ${testResult.failed}/${testResult.total}`,
    };
  }

  if (options.dryRun) {
    return {
      packName: pack.manifest.name,
      version: pack.manifest.version,
      validated: true,
      lintResult,
      testResult,
      published: false,
    };
  }

  // Publish to registry
  try {
    const response = await fetch(`${options.registryUrl}/packs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: pack.manifest,
        content: {
          ruleAST: pack.ruleAST,
          validationSuite: pack.validationSuite,
        },
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      return {
        packName: pack.manifest.name,
        version: pack.manifest.version,
        validated: true,
        lintResult,
        testResult,
        published: false,
        error: `Registry returned ${response.status}: ${JSON.stringify(errBody)}`,
      };
    }

    const result = await response.json() as { cid: string };
    return {
      packName: pack.manifest.name,
      version: pack.manifest.version,
      validated: true,
      lintResult,
      testResult,
      published: true,
      cid: result.cid,
    };
  } catch (err) {
    return {
      packName: pack.manifest.name,
      version: pack.manifest.version,
      validated: true,
      lintResult,
      testResult,
      published: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
