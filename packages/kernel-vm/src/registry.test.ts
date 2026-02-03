import { describe, it, expect } from 'vitest';
import { HandlerRegistry } from './registry.js';
import type { HandlerDefinition } from './handler.js';
import type { ExecutionContext, HandlerResult } from '@eurocomply/types';

function makeStubHandler(id: string, version: string): HandlerDefinition {
  return {
    id,
    version,
    category: 'validation',
    description: `Stub ${id}`,
    execute: (_config, _input, _ctx, _evaluate) => ({
      success: true,
      value: null,
      explanation: { summary: 'stub', steps: [] },
      trace: {
        handler_id: id,
        handler_version: version,
        duration_ms: 0,
        input: null,
        output: null,
        execution_path: id,
        status: 'success' as const,
      },
    }),
  };
}

describe('HandlerRegistry', () => {
  it('registers and retrieves a handler by id', () => {
    const registry = new HandlerRegistry();
    const handler = makeStubHandler('core:threshold_check', '1.0.0');
    registry.register(handler);
    expect(registry.get('core:threshold_check')).toBe(handler);
  });

  it('returns undefined for unknown handler', () => {
    const registry = new HandlerRegistry();
    expect(registry.get('core:unknown')).toBeUndefined();
  });

  it('resolves handler by id and compatible version', () => {
    const registry = new HandlerRegistry();
    const v1 = makeStubHandler('core:threshold_check', '1.0.0');
    const v2 = makeStubHandler('core:threshold_check', '2.0.0');
    registry.register(v1);
    registry.register(v2);
    expect(registry.resolve('core:threshold_check', '1.0.0')).toBe(v1);
    expect(registry.resolve('core:threshold_check', '2.0.0')).toBe(v2);
  });

  it('resolve returns latest version when no version specified', () => {
    const registry = new HandlerRegistry();
    registry.register(makeStubHandler('core:test', '1.0.0'));
    const latest = makeStubHandler('core:test', '1.1.0');
    registry.register(latest);
    expect(registry.resolve('core:test')).toBe(latest);
  });

  it('resolve returns undefined for non-existent version', () => {
    const registry = new HandlerRegistry();
    registry.register(makeStubHandler('core:test', '1.0.0'));
    expect(registry.resolve('core:test', '3.0.0')).toBeUndefined();
  });

  it('has() checks handler existence', () => {
    const registry = new HandlerRegistry();
    registry.register(makeStubHandler('core:test', '1.0.0'));
    expect(registry.has('core:test')).toBe(true);
    expect(registry.has('core:missing')).toBe(false);
  });

  it('list() returns all handler metadata', () => {
    const registry = new HandlerRegistry();
    registry.register(makeStubHandler('core:a', '1.0.0'));
    registry.register(makeStubHandler('core:b', '1.0.0'));
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map(h => h.id)).toEqual(['core:a', 'core:b']);
  });

  it('throws on duplicate id+version registration', () => {
    const registry = new HandlerRegistry();
    registry.register(makeStubHandler('core:test', '1.0.0'));
    expect(() => registry.register(makeStubHandler('core:test', '1.0.0'))).toThrow();
  });
});
