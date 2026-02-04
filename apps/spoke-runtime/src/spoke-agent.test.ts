import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SpokeAgent } from './spoke-agent.js';
import { HubClient } from './hub-client.js';
import { createServer, type Server } from 'http';
import type { HeartbeatRequest, HeartbeatResponse } from '@eurocomply/types';

describe('SpokeAgent', () => {
  let server: Server;
  let hubUrl: string;
  let receivedHeartbeats: HeartbeatRequest[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/hub/api/v1/heartbeat') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          receivedHeartbeats.push(JSON.parse(body));
          const response: HeartbeatResponse = {
            acknowledged: true,
            license_valid: true,
            signals: {
              os_update_available: null,
              pack_updates_available: 0,
              registry_sync_recommended: false,
              message: null,
            },
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    hubUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('should send a heartbeat to the Hub', async () => {
    const client = new HubClient(hubUrl, 'test-api-key');
    const agent = new SpokeAgent(client, {
      spokeId: 'spoke-test-1',
      osVersion: '2.0.0',
      intervalMs: 100, // fast for testing
    });

    agent.start();

    // Wait for at least one heartbeat
    await new Promise(resolve => setTimeout(resolve, 250));
    agent.stop();

    expect(receivedHeartbeats.length).toBeGreaterThanOrEqual(1);
    expect(receivedHeartbeats[0].spoke_id).toBe('spoke-test-1');
    expect(receivedHeartbeats[0].os_version).toBe('2.0.0');
    expect(receivedHeartbeats[0].status).toBe('healthy');
  });

  it('should stop cleanly', async () => {
    const client = new HubClient(hubUrl, 'test-api-key');
    const agent = new SpokeAgent(client, {
      spokeId: 'spoke-test-2',
      osVersion: '2.0.0',
      intervalMs: 50,
    });

    agent.start();
    await new Promise(resolve => setTimeout(resolve, 100));

    const countBefore = receivedHeartbeats.length;
    agent.stop();

    await new Promise(resolve => setTimeout(resolve, 200));
    // No more heartbeats after stop
    expect(receivedHeartbeats.length - countBefore).toBeLessThanOrEqual(2);
  });
});
