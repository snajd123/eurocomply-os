export interface SpokeConfig {
  port: number;
  postgres: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  neo4j?: {
    uri: string;
    username: string;
    password: string;
  };
  tenantId: string;
  packsDir?: string;
  seedFile?: string;
}

export function loadConfig(): SpokeConfig {
  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    postgres: {
      host: process.env.PGHOST ?? 'localhost',
      port: parseInt(process.env.PGPORT ?? '5432', 10),
      database: process.env.PGDATABASE ?? 'eurocomply',
      user: process.env.PGUSER ?? 'eurocomply',
      password: process.env.PGPASSWORD ?? 'eurocomply',
    },
    neo4j: process.env.NEO4J_URI ? {
      uri: process.env.NEO4J_URI,
      username: process.env.NEO4J_USERNAME ?? 'neo4j',
      password: process.env.NEO4J_PASSWORD ?? 'neo4j',
    } : undefined,
    tenantId: process.env.TENANT_ID ?? 'default',
    packsDir: process.env.PACKS_DIR,
    seedFile: process.env.SEED_FILE,
  };
}
