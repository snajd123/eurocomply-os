import { v4 as uuid } from 'uuid';
import type { PostgresConnectionManager } from '../db/postgres.js';
import type { PlatformServiceContext } from '../context.js';
import type { ServiceResult } from '@eurocomply/types';

export interface JobSubmitInput {
  job_type: string;
  payload: Record<string, unknown>;
}

export interface JobSubmitOutput {
  job_id: string;
  status: string;
}

export interface JobStatusInput {
  job_id: string;
}

export interface JobStatusOutput {
  job_id: string;
  job_type: string;
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface JobCompleteInput {
  job_id: string;
  result?: Record<string, unknown>;
  error?: string;
}

export interface ClaimedJob {
  job_id: string;
  job_type: string;
  payload: Record<string, unknown>;
}

export class JobService {
  constructor(private db: PostgresConnectionManager) {}

  async submit(
    ctx: PlatformServiceContext,
    input: JobSubmitInput,
  ): Promise<ServiceResult<JobSubmitOutput>> {
    const db = ctx.tx ?? this.db;
    const jobId = uuid();

    await db.query(
      `INSERT INTO jobs (job_id, tenant_id, job_type, payload, submitted_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [jobId, ctx.tenant_id, input.job_type, JSON.stringify(input.payload), ctx.principal.id]
    );

    return {
      success: true,
      data: { job_id: jobId, status: 'pending' },
    };
  }

  async status(
    ctx: PlatformServiceContext,
    input: JobStatusInput,
  ): Promise<ServiceResult<JobStatusOutput>> {
    const db = ctx.tx ?? this.db;
    const result = await db.query(
      'SELECT * FROM jobs WHERE job_id = $1 AND tenant_id = $2',
      [input.job_id, ctx.tenant_id]
    );

    if (result.rows.length === 0) {
      return { success: false, data: { job_id: input.job_id, job_type: '', status: 'unknown', payload: {}, result: null, error: null, created_at: '', started_at: null, completed_at: null } };
    }

    const row = result.rows[0] as JobStatusOutput;
    return { success: true, data: row };
  }

  async claim(
    ctx: PlatformServiceContext,
    jobType: string,
  ): Promise<ClaimedJob | null> {
    const db = ctx.tx ?? this.db;
    const result = await db.query(
      `UPDATE jobs SET status = 'running', started_at = now()
       WHERE job_id = (
         SELECT job_id FROM jobs
         WHERE tenant_id = $1 AND job_type = $2 AND status = 'pending'
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING job_id, job_type, payload`,
      [ctx.tenant_id, jobType]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0] as ClaimedJob;
    return row;
  }

  async complete(
    ctx: PlatformServiceContext,
    input: JobCompleteInput,
  ): Promise<void> {
    const db = ctx.tx ?? this.db;
    const status = input.error ? 'failed' : 'completed';
    await db.query(
      `UPDATE jobs SET status = $1, result = $2, error = $3, completed_at = now()
       WHERE job_id = $4 AND tenant_id = $5`,
      [
        status,
        input.result ? JSON.stringify(input.result) : null,
        input.error ?? null,
        input.job_id, ctx.tenant_id,
      ]
    );
  }
}
