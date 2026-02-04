import pg from 'pg';

const { Pool } = pg;
type PoolClient = pg.PoolClient;
type QueryResult = pg.QueryResult;

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
}

export class UnitOfWork implements Queryable {
  private finished = false;

  constructor(private client: PoolClient) {}

  async query(text: string, params?: unknown[]): Promise<QueryResult> {
    if (this.finished) throw new Error('UnitOfWork already finished');
    return this.client.query(text, params);
  }

  async commit(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    try {
      await this.client.query('COMMIT');
    } finally {
      this.client.release();
    }
  }

  async rollback(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    try {
      await this.client.query('ROLLBACK');
    } finally {
      this.client.release();
    }
  }
}

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max?: number;
}

export class PostgresConnectionManager implements Queryable {
  private pool: pg.Pool;

  constructor(config: PostgresConfig) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.max ?? 10,
    });
  }

  async query(text: string, params?: unknown[]): Promise<QueryResult> {
    return this.pool.query(text, params);
  }

  async beginTransaction(): Promise<UnitOfWork> {
    const client = await this.pool.connect();
    await client.query('BEGIN');
    return new UnitOfWork(client);
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
