import type { EntityService } from '../services/entity.js';
import type { AuditLogger } from '../services/audit.js';
import type { JobService } from '../services/job.js';
import type { FileService } from '../services/file.js';
import type { ExecutionLoop } from '../execution-loop.js';
import type { PackService } from '../services/pack.js';
import type { PlatformServiceContext } from '../context.js';
import type { ServiceResult } from '@eurocomply/types';

export interface MCPToolDefinition {
  name: string;
  description: string;
}

export interface MCPToolRouter {
  listTools(): MCPToolDefinition[];
  callTool(name: string, input: Record<string, unknown>, ctx: PlatformServiceContext): Promise<ServiceResult<unknown>>;
}

export interface MCPToolRouterDeps {
  entityService: EntityService;
  audit: AuditLogger;
  jobService: JobService;
  fileService: FileService;
  executionLoop: ExecutionLoop;
  packService?: PackService;
}

export function createMCPToolRouter(deps: MCPToolRouterDeps): MCPToolRouter {
  const tools: Record<string, {
    definition: MCPToolDefinition;
    handler: (input: Record<string, unknown>, ctx: PlatformServiceContext) => Promise<ServiceResult<unknown>>;
  }> = {};

  // Entity tools
  tools['entity:define'] = {
    definition: { name: 'entity:define', description: 'Define an entity type with schema' },
    handler: (input, ctx) => deps.entityService.defineType(ctx, input as any),
  };
  tools['entity:create'] = {
    definition: { name: 'entity:create', description: 'Create an entity instance' },
    handler: (input, ctx) => deps.entityService.create(ctx, input as any),
  };
  tools['entity:get'] = {
    definition: { name: 'entity:get', description: 'Get an entity by ID' },
    handler: (input, ctx) => deps.entityService.get(ctx, input as any),
  };
  tools['entity:update'] = {
    definition: { name: 'entity:update', description: 'Update an entity' },
    handler: (input, ctx) => deps.entityService.update(ctx, input as any),
  };
  tools['entity:list'] = {
    definition: { name: 'entity:list', description: 'List entities of a type' },
    handler: (input, ctx) => deps.entityService.list(ctx, input as any),
  };

  // File tools
  tools['file:upload'] = {
    definition: { name: 'file:upload', description: 'Upload a file' },
    handler: async (input, ctx) => {
      const content = typeof input.content === 'string'
        ? Buffer.from(input.content, 'base64')
        : input.content as Buffer;
      return deps.fileService.upload(ctx, { ...input, content } as any);
    },
  };
  tools['file:get'] = {
    definition: { name: 'file:get', description: 'Get a file by ID' },
    handler: (input, ctx) => deps.fileService.get(ctx, input as any),
  };

  // Job tools
  tools['job:submit'] = {
    definition: { name: 'job:submit', description: 'Submit a background job' },
    handler: (input, ctx) => deps.jobService.submit(ctx, input as any),
  };
  tools['job:status'] = {
    definition: { name: 'job:status', description: 'Get job status' },
    handler: (input, ctx) => deps.jobService.status(ctx, input as any),
  };

  // Audit tools
  tools['audit:query'] = {
    definition: { name: 'audit:query', description: 'Query audit log entries' },
    handler: async (input, ctx) => {
      const entries = await deps.audit.query(ctx.tenant_id, input as any);
      return { success: true, data: entries };
    },
  };

  // Execution loop
  tools['evaluate'] = {
    definition: { name: 'evaluate', description: 'Evaluate a rule against an entity' },
    handler: (input, ctx) => deps.executionLoop.evaluate(ctx, input as any),
  };

  // Registry tools
  if (deps.packService) {
    tools['registry:install'] = {
      definition: { name: 'registry:install', description: 'Install a pack from manifest' },
      handler: (input, ctx) => deps.packService!.install(ctx, input as any),
    };
    tools['registry:list'] = {
      definition: { name: 'registry:list', description: 'List installed packs' },
      handler: (_input, ctx) => deps.packService!.list(ctx),
    };
    tools['registry:lock'] = {
      definition: { name: 'registry:lock', description: 'Get a compliance lock by ID' },
      handler: (input, ctx) => deps.packService!.getLock(ctx, (input as any).lock_id),
    };
    tools['registry:locks'] = {
      definition: { name: 'registry:locks', description: 'List compliance locks' },
      handler: (_input, ctx) => deps.packService!.listLocks(ctx),
    };
    tools['registry:save-lock'] = {
      definition: { name: 'registry:save-lock', description: 'Save a compliance lock' },
      handler: (input, ctx) => deps.packService!.saveLock(ctx, input as any),
    };
  }

  return {
    listTools(): MCPToolDefinition[] {
      return Object.values(tools).map(t => t.definition);
    },

    async callTool(
      name: string,
      input: Record<string, unknown>,
      ctx: PlatformServiceContext,
    ): Promise<ServiceResult<unknown>> {
      const tool = tools[name];
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }
      return tool.handler(input, ctx);
    },
  };
}
