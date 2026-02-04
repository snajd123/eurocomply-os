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
    },
  },
});
