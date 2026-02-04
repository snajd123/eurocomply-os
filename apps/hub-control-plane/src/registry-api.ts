import { Hono } from 'hono';
import { PackManifestSchema } from '@eurocomply/types';
import { RegistryStore } from './registry-store.js';
import { createHash } from 'crypto';

export function createRegistryAPI(store: RegistryStore) {
  const app = new Hono();

  // Publish a pack
  app.post('/packs', async (c) => {
    const body = await c.req.json() as { manifest: unknown; content?: Record<string, unknown> };
    const parsed = PackManifestSchema.safeParse(body.manifest);
    if (!parsed.success) {
      return c.json({ error: 'Invalid manifest', details: parsed.error.issues }, 400);
    }
    const manifest = parsed.data;
    const cid = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    const published = store.publish(manifest, body.content ?? {}, cid);
    return c.json({
      name: manifest.name,
      version: manifest.version,
      cid,
      publishedAt: published.publishedAt,
    }, 201);
  });

  // Search packs
  app.get('/packs', (c) => {
    const type = c.req.query('type');
    const vertical = c.req.query('vertical');
    const results = store.search({ type: type ?? undefined, vertical: vertical ?? undefined });
    return c.json({
      packs: results.map(p => ({
        name: p.manifest.name,
        version: p.manifest.version,
        type: p.manifest.type,
        cid: p.cid,
        publishedAt: p.publishedAt,
      })),
    });
  });

  // List versions (must be before get-specific to avoid conflict)
  app.get('/packs/:name{.+}/versions', (c) => {
    const name = c.req.param('name');
    const versions = store.listVersions(name);
    return c.json({ name, versions });
  });

  // Get specific version
  app.get('/packs/:name{.+}/:version', (c) => {
    const version = c.req.param('version');
    // The greedy .+ in :name captures everything including the version segment,
    // so we strip the trailing /version from the captured name.
    const rawName = c.req.param('name');
    const name = rawName.endsWith('/' + version)
      ? rawName.slice(0, -(version.length + 1))
      : rawName;
    const pack = store.get(name, version);
    if (!pack) return c.json({ error: 'Pack not found' }, 404);
    return c.json({ manifest: pack.manifest, cid: pack.cid, publishedAt: pack.publishedAt });
  });

  app.get('/health', (c) => c.json({ status: 'ok' }));

  return app;
}
