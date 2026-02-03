import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JobService } from '../job.js';
import { PostgresConnectionManager } from '../../db/postgres.js';
import { runMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ServiceContext } from '@eurocomply/types';

describe('JobService', () => {
  let container: StartedPostgreSqlContainer;
  let db: PostgresConnectionManager;
  let jobs: JobService;

  const ctx: ServiceContext = {
    tenant_id: 'tenant_1',
    principal: { type: 'user', id: 'user_1' },
    correlation_id: 'corr_1',
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    db = new PostgresConnectionManager({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await runMigrations(db);
    jobs = new JobService(db);
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should submit a job', async () => {
    const result = await jobs.submit(ctx, {
      job_type: 'compliance_evaluation',
      payload: { entity_id: 'prod_1', rule_id: 'reach_svhc' },
    });

    expect(result.success).toBe(true);
    expect(result.data.job_id).toBeDefined();
    expect(result.data.status).toBe('pending');
  });

  it('should get job status', async () => {
    const submitted = await jobs.submit(ctx, {
      job_type: 'report_generation',
      payload: { report_type: 'sds' },
    });

    const result = await jobs.status(ctx, {
      job_id: submitted.data.job_id,
    });

    expect(result.success).toBe(true);
    expect(result.data.status).toBe('pending');
    expect(result.data.job_type).toBe('report_generation');
  });

  it('should claim and complete a job', async () => {
    const submitted = await jobs.submit(ctx, {
      job_type: 'test_job',
      payload: { value: 42 },
    });

    const claimed = await jobs.claim(ctx, 'test_job');
    expect(claimed).not.toBeNull();
    expect(claimed!.job_id).toBe(submitted.data.job_id);

    await jobs.complete(ctx, {
      job_id: submitted.data.job_id,
      result: { output: 'done' },
    });

    const status = await jobs.status(ctx, { job_id: submitted.data.job_id });
    expect(status.data.status).toBe('completed');
    expect(status.data.result).toEqual({ output: 'done' });
  });
});
