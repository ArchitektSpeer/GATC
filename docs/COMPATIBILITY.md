# File format compatibility

What GATC reads and writes for each format, and what is backed by evidence. "Verified" links to
a reproducible check; everything else is implemented but not independently verified. This page
is the phase-A version of the matrix in design.md §6.1; the per-field matrix for every exchange
format is phase-B work.

Status terms: **verified** = reproducible evidence linked; **implemented** = code path exists,
no independent check yet; **not supported** = no implementation.

## Native project format (`.gatc`)

| Item | Value |
|---|---|
| Extension | `.gatc` (UTF-8 JSON). A `.json` file whose first field is `"format": "gatc-project"` is also opened as a project. |
| MIME type | `application/vnd.gatc.project+json` |
| Current schema version | 1 (`CURRENT_PROJECT_SCHEMA_VERSION`, `src/modules/io-adapter/migrations/index.ts`) |
| Older versions read | v0 = the per-document JSON written by "Export JSON" before projects existed; upgraded on load |
| Newer versions | Refused with a message asking to upgrade GATC; the file is not modified and nothing is guessed |
| Contract | `ProjectFile` in `src/types/schema.ts` |

Contents:

| Saved | Not saved (recomputed or excluded) |
|---|---|
| All open DNA documents in tab order, complete `PlasmidDocument` (sequence, topology, features, primers, history, methylation, linear ends, description) | Cut sites, ORFs, translations |
| Raw Sanger / FASTQ trace data per document (bases, qualities, peak positions, channels, trim range) | Trace alignments (recomputed against the saved sequence on load) |
| Active document and main view | Gel lanes and settings, selection, theme, enzyme set choice |
| `appVersion`, `savedAt` | API keys and any field named like a secret (stripped on write, asserted by test) |
| | Protein documents (not yet part of the project format) |

On load, `length` is corrected to the sequence length and traces that belong to no document are
dropped; both are reported to the user. Duplicate document ids and malformed or truncated files
are rejected.

Evidence: `src/modules/io-adapter/project.test.ts` (round trip, secret stripping, newer-version
refusal, damaged files, one fixture per schema version upgraded to the current one) and
`scripts/session-check.mjs` (browser: save, reopen, content identical).

Versioning: a format change adds a migration in `migrations/index.ts` that upgrades exactly one
version, a fixture for the new version in `migrations/fixtures/`, and bumps
`CURRENT_PROJECT_SCHEMA_VERSION`. The fixture test fails if either is missing.

## Exchange formats

| Format | Read | Write | Counts as "saved"¹ | Evidence |
|---|---|---|---|---|
| SnapGene `.dna` | sequence, topology, features, primers, notes, history tree, methylation | same packets | yes | **verified** on 15 SnapGene-written files, read and write, against Biopython ([CROSSCHECK.md](CROSSCHECK.md)). Opening GATC output in SnapGene itself: not yet verified |
| GenBank `.gb` `.gbk` `.ape` | sequence, features, qualifiers, ApE colors | features, ApE colors | no — primers are written through the GenBank primer mapping and history only as COMMENT text, so neither round-trips as GATC objects (not yet measured field by field) | implemented |
| FASTA | sequence and name | sequence and name | no — annotations are lost | implemented |
| JSON (single document) | full `PlasmidDocument` | full `PlasmidDocument` | yes | implemented; also readable as a v0 project |
| EMBL, GFF, Geneious, SBOL, Xdna, CM5 | import paths via `@teselagen/bio-parsers` and own parsers | — | — | implemented |
| AB1 / ABI | traces, bases, qualities, peak positions | — | via `.gatc` | implemented |
| FASTQ | reads with qualities | — | via `.gatc` | implemented |
| SCF | — | — | — | **not supported**: not offered in the file picker; a dropped `.scf` file goes to the AB1 parser and is rejected with an error |

¹ Exporting in a format that "counts as saved" clears the unsaved marker of that document. The
others leave it set because they drop information. Where the browser offers a save dialog (File
System Access API, e.g. Chrome/Edge) the write is confirmed; elsewhere the file is a download that
cannot be confirmed, so the marker is cleared but the recovery snapshot is kept until the session
ends normally (see below).

## Recovery snapshots

Not a file format for users, listed because it holds user data. While a document has unsaved
changes (to the document itself or to the sequencing reads attached to it), or was last saved
through a download that could not be confirmed, the workspace is written as a `.gatc` project
inside a snapshot record:

- Web: IndexedDB database `gatc-autosave`, one record per browser tab. A tab holds a Web Lock
  for its session so that another tab does not offer to recover it while it is still open. A tab
  that closes with nothing unsaved leaves a marker in localStorage (`gatc.cleanExit.<session>`),
  written synchronously, so its snapshot is discarded on the next start even if the asynchronous
  delete did not finish.
- Desktop: one set of files per session in the app data directory, `autosave-<session>.json`,
  written to a temporary file, synced, renamed, and the directory synced; up to 5 rotating
  backups per session (`autosave-<session>.1.json` … `.5.json`, at most one new backup per 10
  minutes). A new session never overwrites the snapshot of one that has not been recovered. A
  snapshot that is damaged, or whose project does not load, falls back to the newest backup that
  does.
- Recovering opens the snapshot and removes the old record only after this session's own
  snapshot, which now holds the recovered work, was written.

Evidence: `src/app/autosave.test.ts`, `src-tauri/src/autosave.rs` (unit test), and
`scripts/session-check.mjs`. The desktop close prompt and app-data paths have not yet been run
on each target platform.
