import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      '@eurocomply/platform-services': path.resolve(__dirname, '../../packages/platform-services/src/index.ts'),
      '@eurocomply/kernel-vm': path.resolve(__dirname, '../../packages/kernel-vm/src/index.ts'),
      '@eurocomply/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
      '@eurocomply/hub-control-plane': path.resolve(__dirname, '../../apps/hub-control-plane/src/index.ts'),
      '@eurocomply/registry-sdk': path.resolve(__dirname, '../../packages/registry-sdk/src/index.ts'),
      '@eurocomply/network-protocol': path.resolve(__dirname, '../../packages/network-protocol/src/index.ts'),
    },
  },
});
