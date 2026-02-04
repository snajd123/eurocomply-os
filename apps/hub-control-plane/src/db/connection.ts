import pg from 'pg';

export interface HubDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export class HubDb {
  private pool: pg.Pool;

  constructor(config: HubDbConfig) {
    this.pool = new pg.Pool(config);
  }

  async query(text: string, params?: unknown[]): Promise<pg.QueryResult> {
    return this.pool.query(text, params);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
