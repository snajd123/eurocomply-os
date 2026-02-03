import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PostgresConnectionManager } from './postgres.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(db: PostgresConnectionManager): Promise<number> {
  // Ensure migration tracking table exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Get already applied migrations
  const applied = await db.query('SELECT version FROM schema_migrations ORDER BY version');
  const appliedVersions = new Set(applied.rows.map((r: { version: number }) => r.version));

  // Read migration files
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    const match = file.match(/^(\d+)-/);
    if (!match) continue;
    const version = parseInt(match[1], 10);

    if (appliedVersions.has(version)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    await db.transaction(async (client) => {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
        [version, file]
      );
    });

    count++;
  }

  return count;
}
