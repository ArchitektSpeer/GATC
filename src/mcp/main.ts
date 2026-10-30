// SPDX-License-Identifier: GPL-3.0-or-later
// Command-line entry of the GATC MCP server (stdio transport).
//
//   gatc-mcp [--root <dir>]...
//
// Files are read and written only inside the given directories (default: the
// current directory). Diagnostics go to stderr; stdout carries the protocol.
import { initPython } from '../lib/python';
import { initThal } from '../lib/wasm/thal';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createGatcServer } from './server';

function parseArgs(argv: string[]): { roots: string[] } {
  const roots: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root' && argv[i + 1]) roots.push(argv[++i]);
    else if (arg.startsWith('--root=')) roots.push(arg.slice('--root='.length));
    else if (arg === '--help' || arg === '-h') {
      process.stderr.write('Usage: gatc-mcp [--root <dir>]...\nServes GATC sequence tools over MCP (stdio). Files are limited to the given directories (default: current directory).\n');
      process.exit(0);
    } else {
      process.stderr.write(`gatc-mcp: unknown argument ${arg}\n`);
      process.exit(2);
    }
  }
  return { roots: roots.length ? roots : [process.cwd()] };
}

const { roots } = parseArgs(process.argv.slice(2));
const server = createGatcServer({ roots });
// Bio.Restriction answers the enzyme tools, so the interpreter has to be up
// before the first request rather than during it.
await initPython();
await initThal();
await server.connect(new StdioServerTransport());
process.stderr.write(`gatc-mcp ready; files limited to: ${roots.join(', ')}\n`);
