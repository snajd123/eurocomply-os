import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createInstallPlan } from './pack-installer.js';
import { loadPack } from './pack-loader.js';
import { createDefaultRegistry } from '@eurocomply/kernel-vm';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { LoadedPack } from './pack-loader.js';

describe('PackInstaller', () => {
  const baseDir = join(tmpdir(), `pack-installer-test-${Date.now()}`);
  const depDir = join(baseDir, 'dep-pack');
  const mainDir = join(baseDir, 'main-pack');

  let depPack: LoadedPack;
  let mainPack: LoadedPack;

  beforeAll(async () => {
    // Create dep pack directory
    mkdirSync(join(depDir, 'rules'), { recursive: true });
    mkdirSync(join(depDir, 'tests'), { recursive: true });

    writeFileSync(join(depDir, 'pack.json'), JSON.stringify({
      name: '@test/dep-pack',
      version: '1.0.0',
      type: 'logic',
      scope: { verticals: ['cosmetics'], markets: ['EU'] },
      logic_root: 'rules/main.ast.json',
      validation_suite: 'tests/validation_suite.json',
      author: { name: 'Test Author', did: 'did:test:dep' },
      trust_tier: 'community',
    }));

    writeFileSync(join(depDir, 'rules', 'main.ast.json'), JSON.stringify({
      handler: 'core:threshold_check',
      config: {
        value: { field: 'lead_ppm' },
        operator: 'lt',
        threshold: 10,
      },
      label: 'Lead below 10 ppm',
    }));

    writeFileSync(join(depDir, 'tests', 'validation_suite.json'), JSON.stringify({
      vertical_id: 'cosmetics',
      test_cases: [
        {
          id: 'dep-lead-compliant',
          description: 'Product with low lead passes',
          entity_data: { name: 'Safe Product', lead_ppm: 0.5 },
          expected_status: 'compliant',
        },
      ],
    }));

    // Create main pack directory
    mkdirSync(join(mainDir, 'rules'), { recursive: true });
    mkdirSync(join(mainDir, 'tests'), { recursive: true });

    writeFileSync(join(mainDir, 'pack.json'), JSON.stringify({
      name: '@test/main-pack',
      version: '2.0.0',
      type: 'logic',
      scope: { verticals: ['cosmetics'], markets: ['EU'] },
      logic_root: 'rules/main.ast.json',
      validation_suite: 'tests/validation_suite.json',
      dependencies: { '@test/dep-pack': '^1.0.0' },
      author: { name: 'Test Author', did: 'did:test:main' },
      trust_tier: 'verified',
    }));

    writeFileSync(join(mainDir, 'rules', 'main.ast.json'), JSON.stringify({
      handler: 'core:threshold_check',
      config: {
        value: { field: 'mercury_ppm' },
        operator: 'lt',
        threshold: 1,
      },
      label: 'Mercury below 1 ppm',
    }));

    writeFileSync(join(mainDir, 'tests', 'validation_suite.json'), JSON.stringify({
      vertical_id: 'cosmetics',
      test_cases: [
        {
          id: 'main-mercury-compliant',
          description: 'Product with low mercury passes',
          entity_data: { name: 'Safe Product', mercury_ppm: 0.01 },
          expected_status: 'compliant',
        },
      ],
    }));

    // Load the packs
    depPack = await loadPack(depDir);
    mainPack = await loadPack(mainDir);
  });

  afterAll(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('should create an install plan with resolved dependencies', async () => {
    const registry = createDefaultRegistry();
    const plan = await createInstallPlan(mainPack, {
      availablePacks: { '@test/dep-pack': depPack },
      registry,
      handlerVmVersion: '1.0.0',
      tenantId: 'tenant_test',
    });

    expect(plan.valid).toBe(true);
    expect(plan.errors).toHaveLength(0);
    expect(plan.packsToInstall).toHaveLength(2);

    // Dep pack should be resolved before main pack
    expect(plan.packsToInstall[0].manifest.name).toBe('@test/dep-pack');
    expect(plan.packsToInstall[1].manifest.name).toBe('@test/main-pack');

    // Lock should contain both packs
    const lockKeys = Object.keys(plan.lock.packs);
    expect(lockKeys).toHaveLength(2);
    expect(lockKeys).toContain('@test/dep-pack@1.0.0');
    expect(lockKeys).toContain('@test/main-pack@2.0.0');

    // Lock metadata
    expect(plan.lock.tenant_id).toBe('tenant_test');
    expect(plan.lock.handler_vm_exact).toBe('1.0.0');
    expect(plan.lock.root_pack.name).toBe('@test/main-pack');
    expect(plan.lock.root_pack.version).toBe('2.0.0');
    expect(plan.lock.root_pack.cid).toBeTruthy();
    expect(plan.lock.status).toBe('active');
  });

  it('should fail if dependency is missing', async () => {
    const registry = createDefaultRegistry();
    const plan = await createInstallPlan(mainPack, {
      availablePacks: {},
      registry,
      handlerVmVersion: '1.0.0',
      tenantId: 'tenant_test',
    });

    expect(plan.valid).toBe(false);
    expect(plan.errors.length).toBeGreaterThan(0);
    expect(plan.errors[0]).toContain('@test/dep-pack');
    expect(plan.packsToInstall).toHaveLength(0);
  });

  it('should validate all packs via Simulator', async () => {
    const registry = createDefaultRegistry();
    const plan = await createInstallPlan(mainPack, {
      availablePacks: { '@test/dep-pack': depPack },
      registry,
      handlerVmVersion: '1.0.0',
      tenantId: 'tenant_test',
    });

    expect(plan.simulationResults).toHaveLength(2);

    const depResult = plan.simulationResults.find(r => r.packName === '@test/dep-pack');
    expect(depResult).toBeDefined();
    expect(depResult!.allPassed).toBe(true);
    expect(depResult!.astValid).toBe(true);
    expect(depResult!.total).toBe(1);
    expect(depResult!.passed).toBe(1);
    expect(depResult!.failed).toBe(0);

    const mainResult = plan.simulationResults.find(r => r.packName === '@test/main-pack');
    expect(mainResult).toBeDefined();
    expect(mainResult!.allPassed).toBe(true);
    expect(mainResult!.astValid).toBe(true);
    expect(mainResult!.total).toBe(1);
    expect(mainResult!.passed).toBe(1);
    expect(mainResult!.failed).toBe(0);
  });
});
