import neo4j, { type Driver, type Session, type Result } from 'neo4j-driver';

export interface Neo4jConfig {
  uri: string;
  username: string;
  password: string;
}

export class Neo4jConnectionManager {
  private driver: Driver;

  constructor(config: Neo4jConfig) {
    this.driver = neo4j.driver(
      config.uri,
      neo4j.auth.basic(config.username, config.password),
    );
  }

  session(): Session {
    return this.driver.session();
  }

  async run(cypher: string, params?: Record<string, unknown>): Promise<Result> {
    const session = this.session();
    try {
      return await session.run(cypher, params);
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}
