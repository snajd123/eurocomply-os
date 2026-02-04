import { Hono } from 'hono';
import type { MCPToolRouter } from './tools.js';
import type { PlatformServiceContext } from '../context.js';

export function createMCPServer(router: MCPToolRouter) {
  const app = new Hono();

  app.get('/mcp/tools', (c) => {
    return c.json(router.listTools());
  });

  app.post('/mcp/call', async (c) => {
    const body = await c.req.json() as {
      tool: string;
      input: Record<string, unknown>;
      context?: Partial<PlatformServiceContext>;
    };

    const ctx: PlatformServiceContext = {
      tenant_id: body.context?.tenant_id ?? 'default',
      principal: body.context?.principal ?? { type: 'system', id: 'mcp-server' },
      correlation_id: body.context?.correlation_id ?? crypto.randomUUID(),
    };

    try {
      const result = await router.callTool(body.tool, body.input, ctx);
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ success: false, data: null, error: message }, 400);
    }
  });

  app.get('/health', (c) => c.json({ status: 'ok' }));

  return app;
}
