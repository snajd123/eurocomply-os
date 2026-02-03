import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgresConnectionManager } from '../postgres.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

describe('PostgresConnectionManager', () => {
  let container: StartedPostgreSqlContainer;
  let manager: PostgresConnectionManager;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    manager = new PostgresConnectionManager({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
  }, 60_000);

  afterAll(async () => {
    await manager.close();
    await container.stop();
  });

  it('should execute a query', async () => {
    const result = await manager.query('SELECT 1 as value');
    expect(result.rows[0].value).toBe(1);
  });

  it('should run within a transaction', async () => {
    await manager.query('CREATE TABLE test_tx (id serial PRIMARY KEY, name text)');

    await manager.transaction(async (client) => {
      await client.query("INSERT INTO test_tx (name) VALUES ('alice')");
      await client.query("INSERT INTO test_tx (name) VALUES ('bob')");
    });

    const result = await manager.query('SELECT count(*)::int as cnt FROM test_tx');
    expect(result.rows[0].cnt).toBe(2);
  });

  it('should rollback on transaction error', async () => {
    await manager.query('CREATE TABLE test_rollback (id serial PRIMARY KEY, val int UNIQUE)');
    await manager.query('INSERT INTO test_rollback (val) VALUES (1)');

    await expect(
      manager.transaction(async (client) => {
        await client.query('INSERT INTO test_rollback (val) VALUES (2)');
        await client.query('INSERT INTO test_rollback (val) VALUES (1)'); // duplicate, will fail
      })
    ).rejects.toThrow();

    const result = await manager.query('SELECT count(*)::int as cnt FROM test_rollback');
    expect(result.rows[0].cnt).toBe(1); // rolled back
  });
});
