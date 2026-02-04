import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { boot } from './boot.js';

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(`Booting spoke (tenant: ${config.tenantId})...`);

  const spoke = await boot(config);
  console.log('Spoke booted successfully.');

  const server = serve({
    fetch: spoke.app.fetch,
    port: config.port,
  }, (info) => {
    console.log(`Spoke MCP server listening on port ${info.port}`);
  });

  const shutdown = async () => {
    console.log('Shutting down...');
    server.close();
    await spoke.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  console.error('Failed to boot spoke:', err);
  process.exit(1);
});
