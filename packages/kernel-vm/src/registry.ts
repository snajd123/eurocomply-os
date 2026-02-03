import type { HandlerDefinition } from './handler.js';
import type { HandlerMetadata } from '@eurocomply/types';

export class HandlerRegistry {
  // Map<id, Map<version, HandlerDefinition>>
  private handlers = new Map<string, Map<string, HandlerDefinition>>();

  register(handler: HandlerDefinition): void {
    let versions = this.handlers.get(handler.id);
    if (!versions) {
      versions = new Map();
      this.handlers.set(handler.id, versions);
    }
    if (versions.has(handler.version)) {
      throw new Error(
        `Handler ${handler.id}@${handler.version} is already registered`
      );
    }
    versions.set(handler.version, handler);
  }

  /** Get the latest version of a handler by id. */
  get(id: string): HandlerDefinition | undefined {
    const versions = this.handlers.get(id);
    if (!versions || versions.size === 0) return undefined;
    return this.latestVersion(versions);
  }

  /**
   * Resolve a handler by id and optional exact version.
   * If version is omitted, returns the latest registered version.
   */
  resolve(id: string, version?: string): HandlerDefinition | undefined {
    const versions = this.handlers.get(id);
    if (!versions || versions.size === 0) return undefined;
    if (version) return versions.get(version);
    return this.latestVersion(versions);
  }

  has(id: string): boolean {
    return this.handlers.has(id);
  }

  list(): HandlerMetadata[] {
    const result: HandlerMetadata[] = [];
    for (const [_id, versions] of this.handlers) {
      const latest = this.latestVersion(versions);
      if (latest) {
        result.push({
          id: latest.id,
          version: latest.version,
          category: latest.category,
          description: latest.description,
        });
      }
    }
    return result;
  }

  private latestVersion(
    versions: Map<string, HandlerDefinition>
  ): HandlerDefinition | undefined {
    let latest: HandlerDefinition | undefined;
    let latestParts: number[] = [];
    for (const handler of versions.values()) {
      const parts = handler.version.split('.').map(Number);
      if (!latest || this.compareVersions(parts, latestParts) > 0) {
        latest = handler;
        latestParts = parts;
      }
    }
    return latest;
  }

  private compareVersions(a: number[], b: number[]): number {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const av = a[i] ?? 0;
      const bv = b[i] ?? 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  }
}
