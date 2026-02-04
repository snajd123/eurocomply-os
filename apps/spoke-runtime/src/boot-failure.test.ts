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
