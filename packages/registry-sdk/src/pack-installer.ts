import { Simulator } from '@eurocomply/kernel-vm';
import type { HandlerRegistry } from '@eurocomply/kernel-vm';
import type { ComplianceLock } from '@eurocomply/types';
import type { LoadedPack } from './pack-loader.js';
import { createHash } from 'crypto';

export interface PackInstallOptions {
  availablePacks: Record<string, LoadedPack>;
  registry: HandlerRegistry;
  handlerVmVersion: string;
  tenantId: string;
}

export interface SimulationResult {
  packName: string;
  total: number;
  passed: number;
  failed: number;
  allPassed: boolean;
  astValid: boolean;
}

export interface PackInstallPlan {
  valid: boolean;
  errors: string[];
  packsToInstall: LoadedPack[];
  simulationResults: SimulationResult[];
  lock: ComplianceLock;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function createInstallPlan(
  rootPack: LoadedPack,
  options: PackInstallOptions,
): Promise<PackInstallPlan> {
  const errors: string[] = [];
  const resolved: LoadedPack[] = [];
  const visited = new Set<string>();

  // Resolve dependency tree (BFS)
  function resolve(pack: LoadedPack): void {
    const key = `${pack.manifest.name}@${pack.manifest.version}`;
    if (visited.has(key)) return;
    visited.add(key);

    if (pack.manifest.dependencies) {
      for (const [depName, _versionRange] of Object.entries(pack.manifest.dependencies)) {
        const depPack = options.availablePacks[depName];
        if (!depPack) {
          errors.push(`Missing dependency: ${depName} required by ${pack.manifest.name}`);
          continue;
        }
        resolve(depPack);
      }
    }
    resolved.push(pack);
  }

  resolve(rootPack);

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      packsToInstall: [],
      simulationResults: [],
      lock: createEmptyLock(rootPack, options),
    };
  }

  // Run Simulator on each pack with a validation suite
  const simulator = new Simulator(options.registry);
  const simulationResults: SimulationResult[] = [];

  for (const pack of resolved) {
    if (pack.ruleAST && pack.validationSuite) {
      const report = simulator.run(pack.ruleAST, pack.validationSuite);
      const result: SimulationResult = {
        packName: pack.manifest.name,
        total: report.total,
        passed: report.passed,
        failed: report.failed,
        allPassed: report.ast_valid && report.failed === 0,
        astValid: report.ast_valid,
      };
      simulationResults.push(result);

      if (!result.allPassed) {
        errors.push(`Simulation failed for ${pack.manifest.name}: ${report.failed}/${report.total} tests failed`);
      }
    } else {
      // Non-logic packs don't require simulation
      simulationResults.push({
        packName: pack.manifest.name,
        total: 0, passed: 0, failed: 0,
        allPassed: true,
        astValid: true,
      });
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      packsToInstall: resolved,
      simulationResults,
      lock: createEmptyLock(rootPack, options),
    };
  }

  // Generate ComplianceLock
  const packs: ComplianceLock['packs'] = {};
  for (const pack of resolved) {
    const key = `${pack.manifest.name}@${pack.manifest.version}`;
    const manifestStr = JSON.stringify(pack.manifest);
    packs[key] = {
      version: pack.manifest.version,
      cid: hashContent(manifestStr),
      trust_tier: pack.manifest.trust_tier,
      publisher_did: pack.manifest.author?.did,
    };
  }

  const lock: ComplianceLock = {
    lock_id: `lock_${Date.now()}`,
    tenant_id: options.tenantId,
    timestamp: new Date().toISOString(),
    handler_vm_exact: options.handlerVmVersion,
    root_pack: {
      name: rootPack.manifest.name,
      version: rootPack.manifest.version,
      cid: hashContent(JSON.stringify(rootPack.manifest)),
    },
    packs,
    status: 'active',
  };

  return {
    valid: true,
    errors: [],
    packsToInstall: resolved,
    simulationResults,
    lock,
  };
}

function createEmptyLock(rootPack: LoadedPack, options: PackInstallOptions): ComplianceLock {
  return {
    lock_id: `lock_${Date.now()}`,
    tenant_id: options.tenantId,
    timestamp: new Date().toISOString(),
    handler_vm_exact: options.handlerVmVersion,
    root_pack: {
      name: rootPack.manifest.name,
      version: rootPack.manifest.version,
      cid: '',
    },
    packs: {},
  };
}
