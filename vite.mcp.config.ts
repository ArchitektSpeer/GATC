// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Builds the MCP server (src/mcp/main.ts) into one self-contained Node script.
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'src/mcp/main.ts',
    outDir: 'dist-mcp',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      output: { entryFileNames: 'gatc-mcp.mjs', banner: '#!/usr/bin/env node', inlineDynamicImports: true },
    },
  },
  // Bundle the dependencies too, so the script runs without node_modules.
  ssr: { noExternal: true },
});
