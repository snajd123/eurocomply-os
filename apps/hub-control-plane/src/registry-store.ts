import type { PackManifest } from '@eurocomply/types';

export interface PublishedPack {
  manifest: PackManifest;
  content: Record<string, unknown>;
  publishedAt: string;
  cid: string;
}

export class RegistryStore {
  private packs = new Map<string, Map<string, PublishedPack>>();

  publish(manifest: PackManifest, content: Record<string, unknown>, cid: string): PublishedPack {
    if (!this.packs.has(manifest.name)) {
      this.packs.set(manifest.name, new Map());
    }
    const published: PublishedPack = {
      manifest,
      content,
      publishedAt: new Date().toISOString(),
      cid,
    };
    this.packs.get(manifest.name)!.set(manifest.version, published);
    return published;
  }

  get(name: string, version: string): PublishedPack | null {
    return this.packs.get(name)?.get(version) ?? null;
  }

  getLatest(name: string): PublishedPack | null {
    const versions = this.packs.get(name);
    if (!versions || versions.size === 0) return null;
    const sorted = Array.from(versions.keys()).sort().reverse();
    return versions.get(sorted[0]) ?? null;
  }

  listVersions(name: string): string[] {
    const versions = this.packs.get(name);
    if (!versions) return [];
    return Array.from(versions.keys()).sort().reverse();
  }

  search(query?: { type?: string; vertical?: string }): PublishedPack[] {
    const results: PublishedPack[] = [];
    for (const versions of this.packs.values()) {
      for (const pack of versions.values()) {
        if (query?.type && pack.manifest.type !== query.type) continue;
        if (query?.vertical && !pack.manifest.scope?.verticals?.includes(query.vertical)) continue;
        results.push(pack);
      }
    }
    return results;
  }
}
