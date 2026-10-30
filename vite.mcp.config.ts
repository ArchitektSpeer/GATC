// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Builds the MCP server (src/mcp/main.ts) into one self-contained Node script.
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

// The browser fetches src/lib/wasm/thal.wasm as a separate file, which is what
// `?url` is for; a Node script has nowhere to fetch it from, and the point of
// this build is one file that runs on its own. So for this build only, the same
// import becomes a data: URL, which `fetch` accepts in Node as well.
function wasmAsDataUrl(): Plugin {
  const MARK = '?gatc-inline-wasm';
  return {
    name: 'gatc:wasm-as-data-url',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith('.wasm?url')) return null;
      const found = await this.resolve(source.slice(0, -'?url'.length), importer, {
        skipSelf: true,
      });
      return found ? `${found.id}${MARK}` : null;
    },
    load(id) {
      if (!id.endsWith(MARK)) return null;
      const bytes = readFileSync(id.slice(0, -MARK.length));
      return `export default 'data:application/wasm;base64,${bytes.toString('base64')}';`;
    },
  };
}

export default defineConfig({
  plugins: [wasmAsDataUrl()],
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
