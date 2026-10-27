# GATC MCP server

GATC's sequence tools as a [Model Context Protocol](https://modelcontextprotocol.io) server, so
other agents and harnesses (Claude Code, Codex, OpenCode, Claude Desktop, any MCP client) can
read plasmid files, find sites, design primers, simulate cloning and check Sanger reads with the
same code the workbench uses. The server is a local process over stdio; nothing is sent anywhere.

## Build and run

```bash
npm install
npm run mcp:build                         # -> dist-mcp/gatc-mcp.mjs (self-contained, Node >= 20)
node dist-mcp/gatc-mcp.mjs --root ~/plasmids --root ~/sequencing
```

`--root` (repeatable) limits which directories the server may read and write; the default is the
current directory. Relative paths resolve against the first root. Symlinks are followed and
refused if they lead outside every root, and the server never writes through a symlink.

## Connect a client

Claude Code:

```bash
claude mcp add gatc -- node /path/to/GATC/dist-mcp/gatc-mcp.mjs --root /path/to/plasmids
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.gatc]
command = "node"
args = ["/path/to/GATC/dist-mcp/gatc-mcp.mjs", "--root", "/path/to/plasmids"]
```

Clients that use a JSON `mcpServers` map (Claude Desktop, OpenCode and others):

```json
{
  "mcpServers": {
    "gatc": {
      "command": "node",
      "args": ["/path/to/GATC/dist-mcp/gatc-mcp.mjs", "--root", "/path/to/plasmids"]
    }
  }
}
```

## Conventions

- **Coordinates** are 0-based and half-open `[start, end)`. On a circular molecule `start > end`
  crosses the origin. Results also carry `location`, the same range as 1-based GenBank text
  (`"101..250"`, `"901..1000,1..50"`).
- **DNA input** (`doc`, `template`, `fragments[]`, `parts[]`, `reference`) is one of
  `{ "path": "pUC19.dna", "index": 0 }`, `{ "sequence": "ACGT…", "topology": "circular" }`, or
  `{ "document": … }` with a document returned by another tool. Product tools return
  `document`, so steps chain: `simulate_pcr` → `simulate_gibson` → `write_sequence_file`.
- Units: temperatures °C, free energies kcal/mol, concentrations as named (`naMm`, `oligoNm`).
- Model outputs are predictions: a Golden Gate `fidelityScore` is not a measured success rate, and
  mixed peaks in a read are flagged, not called as genotypes.

## Tools

| Tool | Changes files | What it does |
|---|---|---|
| `read_sequence_file` | no | Documents in a .dna / GenBank / FASTA / EMBL / GFF / Geneious / SBOL / .gatc file |
| `find_restriction_sites` | no | Sites on both strands, cut positions, overhangs, methylation blocking |
| `digest` | no | Fragments and their ends after cutting with one or more enzymes |
| `design_primers` | no | Primer pair for a region, with optional tails or restriction sites |
| `oligo_thermodynamics` | no | Tm, ΔH, ΔS, ΔG, hairpin and self-dimer of one oligo |
| `simulate_pcr` | no | PCR product from a template and two primers |
| `simulate_gibson` | no | Gibson / In-Fusion product and junctions |
| `simulate_golden_gate` | no | Golden Gate product, overhangs, leftover sites |
| `design_mutagenesis_primers` | no | Substitution, insertion or deletion primers and the mutated document |
| `find_orfs` | no | Six-frame ORFs with protein, MW and pI |
| `annotate_features` | no | Common elements found by the built-in feature library |
| `search_motif` | no | IUPAC DNA or protein motif hits |
| `translate` | no | Protein of a range, either strand |
| `align_sanger_trace` | no | AB1 read aligned to a reference, with differences and CDS effects |
| `write_sequence_file` | **yes** | Write GenBank / .dna / FASTA / JSON / .gatc; refuses to replace a file unless `overwrite: true` |

Only `write_sequence_file` is annotated `readOnlyHint: false`, so clients that ask before
side effects ask for it alone. It writes to a temporary file and renames it into place.

## Verification

- `src/mcp/server.test.ts` (part of `npm test`): tool results equal direct calls of the modules;
  chaining; ranges across the origin; input errors; path, symlink and overwrite protection.
- `node scripts/mcp-check.mjs`: starts the built server over stdio as a client would and calls
  the main tools on the files in `test-data/`.
