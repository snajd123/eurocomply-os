import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FleetService } from '../fleet.js';
import { HubDb } from '../../db/connection.js';
import { runHubMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { HeartbeatRequest } from '@eurocomply/types';

describe('FleetService', () => {
  let container: StartedPostgreSqlContainer;
  let db: HubDb;
  let fleet: FleetService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    db = new HubDb({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await runHubMigrations(db);
    fleet = new FleetService(db);

    // Seed a spoke
    await db.query(`INSERT INTO organizations (org_id, name, email) VALUES ('org-fleet', 'Fleet Test', 'f@t.com')`);
    await db.query(`INSERT INTO products (product_id, name, version, manifest) VALUES ('prod-1', 'Test', '1.0.0', '{}')`);
    await db.query(
      `INSERT INTO spokes (spoke_id, org_id, product_id, plan, region, status, api_key_hash)
       VALUES ('spoke-fleet-1', 'org-fleet', 'prod-1', 'starter', 'eu-west', 'active', 'hash123')`,
    );
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should process a heartbeat and return signals', async () => {
    const hb: HeartbeatRequest = {
      spoke_id: 'spoke-fleet-1',
      os_version: '2.0.3',
      status: 'healthy',
      uptime_seconds: 3600,
      usage: { product_count: 10, user_count: 2, evaluation_count_24h: 50 },
    };

    const result = await fleet.processHeartbeat(hb);
    expect(result.success).toBe(true);
    expect(result.data.acknowledged).toBe(true);
    expect(result.data.license_valid).toBe(true);

    // Verify spoke health was updated
    const spoke = await db.query(`SELECT * FROM spokes WHERE spoke_id = 'spoke-fleet-1'`);
    expect(spoke.rows[0].last_heartbeat).not.toBeNull();
    expect(spoke.rows[0].os_version).toBe('2.0.3');
  });

  it('should reject heartbeat from unknown spoke', async () => {
    const hb: HeartbeatRequest = {
      spoke_id: 'unknown-spoke',
      os_version: '1.0.0',
      status: 'healthy',
      uptime_seconds: 100,
      usage: { product_count: 0, user_count: 0, evaluation_count_24h: 0 },
    };
    const result = await fleet.processHeartbeat(hb);
    expect(result.success).toBe(false);
  });

  it('should list spokes with health info', async () => {
    const result = await fleet.listSpokes();
    expect(result.success).toBe(true);
    expect(result.data.total).toBe(1);
    expect(result.data.items[0].spoke_id).toBe('spoke-fleet-1');
  });

  it('should detect stale spokes', async () => {
    // Set last_heartbeat to 10 minutes ago
    await db.query(
      `UPDATE spokes SET last_heartbeat = now() - interval '10 minutes' WHERE spoke_id = 'spoke-fleet-1'`,
    );
    const stale = await fleet.getStaleSpokes(5);
    expect(stale.data.length).toBe(1);
    expect(stale.data[0].spoke_id).toBe('spoke-fleet-1');
  });
});
