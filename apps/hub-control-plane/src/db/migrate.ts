import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { HubDb } from './connection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runHubMigrations(db: HubDb): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS hub_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  const migrationsDir = join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    const applied = await db.query('SELECT 1 FROM hub_migrations WHERE name = $1', [file]);
    if (applied.rows.length > 0) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    await db.query(sql);
    await db.query('INSERT INTO hub_migrations (name) VALUES ($1)', [file]);
  }
}
