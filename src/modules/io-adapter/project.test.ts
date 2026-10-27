// SPDX-License-Identifier: GPL-3.0-or-later
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlasmidDocument, SangerTraceData } from '../../types/schema';
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  ProjectVersionError,
  isProjectFile,
  parseBioFile,
  parseProjectFile,
  serializeProject,
} from './index';
import { PROJECT_MIGRATIONS, detectProjectVersion } from './migrations';

const FIXTURES = resolve(__dirname, 'migrations/fixtures');

const doc: PlasmidDocument = {
  id: 'doc-a',
  name: 'pTest',
  sequence: 'ATGCGTACGTTAGCATGCAAGCTTGGATCC',
  topology: 'circular',
  length: 30,
  createdAt: '2026-10-27T00:00:00.000Z',
  updatedAt: '2026-10-27T00:00:00.000Z',
  methylationProfile: { dam: true, dcm: false, cpg: false },
  features: [{ id: 'f', name: 'wrap', type: 'misc_feature', start: 25, end: 5, strand: -1, color: '#123456', notes: { label: ['x'] } }],
  primers: [],
  history: [{ id: 'h', operation: 'import', timestamp: '2026-10-27T00:00:00.000Z', description: 'Imported' }],
};

const trace: SangerTraceData = {
  id: 't',
  fileName: 'r.ab1',
  calledSequence: 'ACGT',
  qualityScores: [30, 30, 30, 30],
  baseLocations: [1, 2, 3, 4],
  trimRange: [0, 4],
  traces: { A: [1, 2], T: [3, 4], G: [5, 6], C: [7, 8] },
  alignment: { refStart: 0, refEnd: 4, strand: 1, identityPercent: 100, alignedRef: 'ACGT', alignedQuery: 'ACGT', mismatches: [] },
};

describe('native project format', () => {
  it('round-trips documents, raw traces and workspace', () => {
    const text = serializeProject({ documents: [doc], traces: { 'doc-a': [trace] }, workspace: { activeDocId: 'doc-a', view: 'sanger' }, appVersion: '0.1.0' });
    expect(isProjectFile('x.gatc', text)).toBe(true);
    expect(isProjectFile('x.json', text)).toBe(true);
    const { project, migratedFrom, warnings } = parseProjectFile(text);
    expect(migratedFrom).toBeNull();
    expect(warnings).toEqual([]);
    expect(project.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(project.documents).toEqual([doc]);
    expect(project.workspace).toEqual({ activeDocId: 'doc-a', view: 'sanger' });
    // Alignments are derived from the reference and recomputed on load.
    const { alignment: _a, ...raw } = trace;
    expect(project.traces).toEqual({ 'doc-a': [raw] });
  });

  it('never writes API keys or other secrets', () => {
    const leaky = { ...doc, apiKey: 'sk-live-123', notes: { config: { api_key: 'sk-live-456', baseUrl: 'https://x' } } } as unknown as PlasmidDocument;
    const text = serializeProject({ documents: [leaky], workspace: { activeDocId: null }, appVersion: '0.1.0' });
    expect(text).not.toMatch(/sk-live|apiKey|api_key/);
    expect(text).toContain('https://x');
  });

  it('refuses a project from a newer schema version without guessing', () => {
    const future = JSON.stringify({ format: 'gatc-project', schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION + 1, documents: [] });
    expect(() => parseProjectFile(future)).toThrow(ProjectVersionError);
    expect(() => parseProjectFile(future)).toThrow(/更新版本/);
  });

  it('reports corrupt or truncated files', () => {
    const text = serializeProject({ documents: [doc], workspace: { activeDocId: null }, appVersion: '0.1.0' });
    expect(() => parseProjectFile(text.slice(0, text.length / 2))).toThrow(/损坏|未完整写入/);
    expect(() => parseProjectFile('{"format":"gatc-project","schemaVersion":1}')).toThrow(/文档列表/);
    expect(() => parseProjectFile('{"format":"gatc-project","schemaVersion":"1","documents":[]}')).toThrow(/版本号无效/);
  });

  it('repairs an inconsistent length and orphan traces with a visible warning', () => {
    const text = JSON.stringify({
      format: 'gatc-project',
      schemaVersion: 1,
      documents: [{ ...doc, length: 999 }],
      traces: { 'doc-a': [], gone: [trace] },
      workspace: { activeDocId: 'gone' },
    });
    const { project, warnings } = parseProjectFile(text);
    expect(project.documents[0].length).toBe(30);
    expect(project.workspace.activeDocId).toBe('doc-a');
    expect(warnings).toHaveLength(2);
  });

  it('rejects duplicate document ids', () => {
    const text = JSON.stringify({ format: 'gatc-project', schemaVersion: 1, documents: [doc, doc] });
    expect(() => parseProjectFile(text)).toThrow(/重复/);
  });

  it('opens through parseBioFile as well', async () => {
    const text = serializeProject({ documents: [doc], workspace: { activeDocId: null }, appVersion: '0.1.0' });
    const docs = await parseBioFile('shared.json', text);
    expect(docs.map((d) => d.id)).toEqual(['doc-a']);
  });
});

describe('project migrations', () => {
  const fixtures = readdirSync(FIXTURES).sort();

  it('has a migration for every version below the current one, and a fixture for every version', () => {
    for (let v = 0; v < CURRENT_PROJECT_SCHEMA_VERSION; v++) expect(PROJECT_MIGRATIONS[v], `migration from v${v}`).toBeTypeOf('function');
    const versions = fixtures.map((f) => detectProjectVersion(JSON.parse(readFileSync(resolve(FIXTURES, f), 'utf8'))));
    for (let v = 0; v <= CURRENT_PROJECT_SCHEMA_VERSION; v++) expect(versions, `fixture for v${v}`).toContain(v);
  });

  it.each(fixtures)('%s upgrades to the current version and validates', (name) => {
    const text = readFileSync(resolve(FIXTURES, name), 'utf8');
    const version = detectProjectVersion(JSON.parse(text));
    const { project, migratedFrom } = parseProjectFile(text);
    expect(project.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(migratedFrom).toBe(version === CURRENT_PROJECT_SCHEMA_VERSION ? null : version);
    expect(project.documents.length).toBeGreaterThan(0);
    for (const d of project.documents) expect(d.length).toBe(d.sequence.length);
    // The upgraded result is itself a valid current-version file.
    const again = parseProjectFile(serializeProject({ ...project, appVersion: project.appVersion }));
    expect(again.project.documents).toEqual(project.documents);
  });

  it('migrations are pure', () => {
    const raw = JSON.parse(readFileSync(resolve(FIXTURES, 'v0-document-export.json'), 'utf8'));
    const before = JSON.stringify(raw);
    expect(PROJECT_MIGRATIONS[0](raw)).toEqual(PROJECT_MIGRATIONS[0](raw));
    expect(JSON.stringify(raw)).toBe(before);
  });
});
