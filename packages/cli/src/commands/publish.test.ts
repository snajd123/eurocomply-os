import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { publish } from './publish.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createServer, type Server } from 'http';
import { createHash } from 'crypto';

describe('eurocomply publish', () => {
  const validDir = join(tmpdir(), `publish-valid-${Date.now()}`);
  const invalidDir = join(tmpdir(), `publish-invalid-${Date.now()}`);

  beforeAll(() => {
    // Valid pack with threshold_check AST + 1 test case
    mkdirSync(join(validDir, 'rules'), { recursive: true });
    mkdirSync(join(validDir, 'tests'), { recursive: true });
    writeFileSync(join(validDir, 'pack.json'), JSON.stringify({
      name: '@test/publishable-pack',
      version: '1.0.0',
      type: 'logic',
      logic_root: 'rules/main.ast.json',
      validation_suite: 'tests/validation_suite.json',
    }));
    writeFileSync(join(validDir, 'rules', 'main.ast.json'), JSON.stringify({
      handler: 'core:threshold_check',
      config: {
        value: { field: 'concentration' },
        operator: 'lt',
        threshold: 0.1,
      },
      label: 'Concentration below 0.1%',
    }));
    writeFileSync(join(validDir, 'tests', 'validation_suite.json'), JSON.stringify({
      vertical_id: 'cosmetics',
      test_cases: [
        {
          id: 'below-limit',
          description: 'Concentration below limit passes',
          entity_data: { name: 'Safe', concentration: 0.05 },
          expected_status: 'compliant',
        },
      ],
    }));

    // Invalid pack — unknown handler
    mkdirSync(join(invalidDir, 'rules'), { recursive: true });
    writeFileSync(join(invalidDir, 'pack.json'), JSON.stringify({
      name: '@test/bad-publish-pack',
      version: '1.0.0',
      type: 'logic',
      logic_root: 'rules/main.ast.json',
    }));
    writeFileSync(join(invalidDir, 'rules', 'main.ast.json'), JSON.stringify({
      handler: 'core:nonexistent',
      config: {},
    }));
  });

  afterAll(() => {
    rmSync(validDir, { recursive: true, force: true });
    rmSync(invalidDir, { recursive: true, force: true });
  });

  it('should validate pack before publishing', async () => {
    const result = await publish(validDir, { registryUrl: 'http://localhost:0', dryRun: true });
    expect(result.validated).toBe(true);
    expect(result.lintResult.valid).toBe(true);
    expect(result.testResult.allPassed).toBe(true);
    expect(result.published).toBe(false);
    expect(result.packName).toBe('@test/publishable-pack');
    expect(result.version).toBe('1.0.0');
  });

  it('should fail publish if lint fails', async () => {
    const result = await publish(invalidDir, { registryUrl: 'http://localhost:0', dryRun: true });
    expect(result.validated).toBe(false);
    expect(result.lintResult.valid).toBe(false);
    expect(result.published).toBe(false);
    expect(result.error).toContain('Lint failed');
  });

  describe('with real registry server', () => {
    let server: Server;
    let registryUrl: string;
    let receivedBody: any;

    beforeAll(async () => {
      server = createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/packs') {
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', () => {
            receivedBody = JSON.parse(body);
            const cid = createHash('sha256').update(JSON.stringify(receivedBody.manifest)).digest('hex');
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ cid }));
          });
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });
      const addr = server.address() as { port: number };
      registryUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('should publish to registry via HTTP POST', async () => {
      const result = await publish(validDir, { registryUrl, dryRun: false });
      expect(result.validated).toBe(true);
      expect(result.published).toBe(true);
      expect(result.cid).toMatch(/^[a-f0-9]{64}$/);
      expect(result.packName).toBe('@test/publishable-pack');

      // Verify the server received the pack content
      expect(receivedBody.manifest.name).toBe('@test/publishable-pack');
      expect(receivedBody.content.ruleAST).toBeDefined();
      expect(receivedBody.content.ruleAST.handler).toBe('core:threshold_check');
    });

    it('should handle registry error response', async () => {
      // Use a URL that returns 404
      const result = await publish(validDir, { registryUrl: registryUrl + '/wrong', dryRun: false });
      // The publish function posts to ${registryUrl}/packs, so wrong base URL = wrong endpoint
      // Actually, the URL is constructed as `${options.registryUrl}/packs`
      // With registryUrl = "http://host/wrong", it posts to "http://host/wrong/packs" which is 404
      expect(result.validated).toBe(true);
      expect(result.published).toBe(false);
      expect(result.error).toContain('404');
    });
  });
});
