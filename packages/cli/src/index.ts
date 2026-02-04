#!/usr/bin/env node

import { lint } from './commands/lint.js';

const [command, ...args] = process.argv.slice(2);

async function main(): Promise<void> {
  switch (command) {
    case 'lint': {
      const packDir = args[0];
      if (!packDir) {
        console.error('Usage: eurocomply lint <pack-directory>');
        process.exit(1);
      }
      const result = await lint(packDir);
      if (result.valid) {
        console.log(`\u2713 ${result.packName} \u2014 valid`);
        console.log(`  Handlers: ${result.handlersUsed.join(', ')}`);
        console.log(`  Complexity: ${result.complexity}`);
      } else {
        console.error(`\u2717 ${result.packName} \u2014 ${result.errors.length} error(s)`);
        for (const err of result.errors) {
          console.error(`  ${err.path}: ${err.error}`);
        }
        process.exit(1);
      }
      break;
    }

    case 'test': {
      const packDir = args[0];
      if (!packDir) {
        console.error('Usage: eurocomply test <pack-directory>');
        process.exit(1);
      }
      // Dynamically import to avoid loading test deps for lint
      const { test } = await import('./commands/test.js');
      const result = await test(packDir);
      if (result.allPassed) {
        console.log(`\u2713 ${result.packName} \u2014 ${result.passed}/${result.total} tests passed`);
      } else {
        console.error(`\u2717 ${result.packName} \u2014 ${result.failed}/${result.total} tests failed`);
        for (const r of result.results.filter((r: any) => !r.match)) {
          console.error(`  FAIL: ${r.description} (expected ${r.expected_status}, got ${r.actual_status})`);
        }
        process.exit(1);
      }
      break;
    }

    case 'publish': {
      const packDir = args[0];
      if (!packDir) {
        console.error('Usage: eurocomply publish <pack-directory> [--registry <url>] [--dry-run]');
        process.exit(1);
      }
      const { publish } = await import('./commands/publish.js');
      const registryUrl = args.includes('--registry') ? args[args.indexOf('--registry') + 1] : 'http://localhost:3001';
      const dryRun = args.includes('--dry-run');
      const result = await publish(packDir, { registryUrl, dryRun });

      if (!result.validated) {
        console.error(`\u2717 ${result.packName}@${result.version} \u2014 validation failed`);
        console.error(`  ${result.error}`);
        process.exit(1);
      }
      if (dryRun) {
        console.log(`\u2713 ${result.packName}@${result.version} \u2014 validation passed (dry run, not published)`);
      } else if (result.published) {
        console.log(`\u2713 ${result.packName}@${result.version} \u2014 published (CID: ${result.cid})`);
      } else {
        console.error(`\u2717 ${result.packName}@${result.version} \u2014 publish failed: ${result.error}`);
        process.exit(1);
      }
      break;
    }

    default:
      console.log('Usage: eurocomply <command> [args]');
      console.log('');
      console.log('Commands:');
      console.log('  lint <pack-dir>                Validate a pack\'s manifest and rule AST');
      console.log('  test <pack-dir>                Run a pack\'s validation suite');
      console.log('  publish <pack-dir> [options]   Lint, test, and publish a pack to the registry');
      console.log('');
      console.log('Publish options:');
      console.log('  --registry <url>   Registry URL (default: http://localhost:3001)');
      console.log('  --dry-run          Validate only, do not publish');
      process.exit(command ? 1 : 0);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
