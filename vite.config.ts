// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'GATC — Gene Assembly & Toolkit for Cloning',
        short_name: 'GATC',
        description: 'Open-source molecular cloning workbench',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        // The Python runtime is tens of megabytes and most sessions never need it,
        // so it is left out of the precache and kept only once it has been asked
        // for; after that first use it is available offline like everything else.
        globIgnores: ['**/pyodide/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) => url.pathname.includes('/pyodide/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'gatc-python',
              expiration: { maxEntries: 32 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test-setup.ts'],
    testTimeout: 30000,
    // Several suites assert wall-clock budgets (e.g. 100 kb annotation < 30 ms); running files
    // one at a time keeps those measurements free of CPU contention. The full run takes ~15 s.
    fileParallelism: false,
    env: { AB1_SAMPLE: 'test-data/example1.ab1' },
  },
});
