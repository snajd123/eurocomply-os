import { describe, it, expect, beforeEach } from 'vitest';
import { createRegistryAPI } from './registry-api.js';
import { RegistryStore } from './registry-store.js';

function makeManifest(overrides: Record<string, unknown> = {}) {
  return {
    name: '@test/my-pack',
    version: '1.0.0',
    type: 'logic',
    ...overrides,
  };
}

describe('Registry API', () => {
  let store: RegistryStore;
  let app: ReturnType<typeof createRegistryAPI>;

  beforeEach(() => {
    store = new RegistryStore();
    app = createRegistryAPI(store);
  });

  it('should publish a pack', async () => {
    const res = await app.request('/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: makeManifest() }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('@test/my-pack');
    expect(body.version).toBe('1.0.0');
    expect(body.cid).toBeDefined();
    expect(body.publishedAt).toBeDefined();
  });

  it('should reject invalid manifest', async () => {
    const res = await app.request('/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: { name: 'invalid' } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid manifest');
  });

  it('should search packs', async () => {
    // Publish two packs with different types
    await app.request('/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: makeManifest({ name: '@test/logic-pack', type: 'logic' }) }),
    });
    await app.request('/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: makeManifest({ name: '@test/env-pack', type: 'environment' }) }),
    });

    const res = await app.request('/packs?type=logic');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.packs).toHaveLength(1);
    expect(body.packs[0].name).toBe('@test/logic-pack');
  });

  it('should get a specific pack version', async () => {
    await app.request('/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: makeManifest() }),
    });

    const res = await app.request('/packs/@test/my-pack/1.0.0');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.manifest.name).toBe('@test/my-pack');
    expect(body.manifest.version).toBe('1.0.0');
    expect(body.cid).toBeDefined();
  });

  it('should list versions', async () => {
    await app.request('/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: makeManifest({ version: '1.0.0' }) }),
    });
    await app.request('/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: makeManifest({ version: '2.0.0' }) }),
    });

    const res = await app.request('/packs/@test/my-pack/versions');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('@test/my-pack');
    expect(body.versions).toHaveLength(2);
    expect(body.versions).toContain('1.0.0');
    expect(body.versions).toContain('2.0.0');
  });

  it('should return 404 for unknown pack', async () => {
    const res = await app.request('/packs/@test/nonexistent/1.0.0');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Pack not found');
  });
});
