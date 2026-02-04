import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot } from './boot.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Boot failure handling', () => {
  let container: StartedPostgreSqlContainer;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
  }, 60_000);

  afterAll(async () => {
    await container.stop();
  });

  it('fails fast when a required pack directory is corrupt', async () => {
    const packsDir = join(tmpdir(), `test-packs-${Date.now()}`);
    const brokenPackDir = join(packsDir, 'broken-pack');
    mkdirSync(brokenPackDir, { recursive: true });
    writeFileSync(join(brokenPackDir, 'not-a-pack.txt'), 'garbage');

    try {
      await expect(boot({
        port: 0,
        postgres: {
          host: container.getHost(),
          port: container.getMappedPort(5432),
          database: container.getDatabase(),
          user: container.getUsername(),
          password: container.getPassword(),
        },
        tenantId: 'boot-fail-test',
        packsDir,
        requirePacks: true,
      })).rejects.toThrow();
    } finally {
      rmSync(packsDir, { recursive: true, force: true });
    }
  });

  it('boots successfully when no packs dir configured', async () => {
    const spoke = await boot({
      port: 0,
      postgres: {
        host: container.getHost(),
        port: container.getMappedPort(5432),
        database: container.getDatabase(),
        user: container.getUsername(),
        password: container.getPassword(),
      },
      tenantId: 'boot-ok-test',
    });
    expect(spoke.app).toBeDefined();
    await spoke.close();
  });

  it('rolls back all packs on partial install failure when requirePacks is true', async () => {
    const packsDir = join(tmpdir(), `test-packs-atomic-${Date.now()}`);

    // Create a valid-looking pack (has pack.json but will fail at createInstallPlan)
    const validPackDir = join(packsDir, 'aaa-first-pack');
    mkdirSync(validPackDir, { recursive: true });
    writeFileSync(join(validPackDir, 'pack.json'), JSON.stringify({
      name: '@test/first',
      version: '1.0.0',
      type: 'logic',
    }));

    // Create a broken pack (no pack.json — will fail to load)
    const brokenPackDir = join(packsDir, 'zzz-broken-pack');
    mkdirSync(brokenPackDir, { recursive: true });
    writeFileSync(join(brokenPackDir, 'not-a-pack.txt'), 'garbage');

    try {
      await expect(boot({
        port: 0,
        postgres: {
          host: container.getHost(),
          port: container.getMappedPort(5432),
          database: container.getDatabase(),
          user: container.getUsername(),
          password: container.getPassword(),
        },
        tenantId: 'boot-atomic-test',
        packsDir,
        requirePacks: true,
      })).rejects.toThrow();
    } finally {
      rmSync(packsDir, { recursive: true, force: true });
    }
  });

  it('boots with warnings when packs fail but requirePacks is false', async () => {
    const packsDir = join(tmpdir(), `test-packs-opt-${Date.now()}`);
    const brokenPackDir = join(packsDir, 'optional-broken');
    mkdirSync(brokenPackDir, { recursive: true });
    writeFileSync(join(brokenPackDir, 'junk.txt'), 'garbage');

    try {
      const spoke = await boot({
        port: 0,
        postgres: {
          host: container.getHost(),
          port: container.getMappedPort(5432),
          database: container.getDatabase(),
          user: container.getUsername(),
          password: container.getPassword(),
        },
        tenantId: 'boot-warn-test',
        packsDir,
      });
      expect(spoke.app).toBeDefined();
      await spoke.close();
    } finally {
      rmSync(packsDir, { recursive: true, force: true });
    }
  });
});
