// SPDX-License-Identifier: GPL-3.0-or-later
// Version migrations for the native .gatc project format.
//
// Each migration upgrades exactly one version (v0 -> v1, v1 -> v2, ...) and is a
// pure function of its input. Add a fixture for every version in ./fixtures so
// the tests can prove that each historical file still reaches the latest version.

/** Newest project schema version this build can read and the one it writes. */
export const CURRENT_PROJECT_SCHEMA_VERSION = 1;

type Migration = (raw: unknown) => unknown;

/**
 * v0 is the per-document JSON written by "Export JSON" before the project
 * format existed: a bare PlasmidDocument, an array of them, or `{ document }`.
 */
function v0ToV1(raw: unknown): unknown {
  const documents = Array.isArray(raw)
    ? raw
    : isRecord(raw) && 'document' in raw
      ? [raw.document]
      : [raw];
  const first = documents.find(isRecord);
  return {
    format: 'gatc-project',
    schemaVersion: 1,
    appVersion: 'unknown',
    savedAt: first && typeof first.updatedAt === 'string' ? first.updatedAt : '',
    documents,
    traces: {},
    workspace: { activeDocId: first && typeof first.id === 'string' ? first.id : null },
  };
}

/** Keyed by the version a migration upgrades from. */
export const PROJECT_MIGRATIONS: Readonly<Record<number, Migration>> = {
  0: v0ToV1,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function looksLikeLegacyDocument(value: unknown): boolean {
  return isRecord(value) && typeof value.sequence === 'string' && Array.isArray(value.features);
}

/**
 * Schema version of a parsed project file, or null when the data is neither a
 * project nor a legacy GATC document export.
 */
export function detectProjectVersion(raw: unknown): number | null {
  if (isRecord(raw) && raw.format === 'gatc-project') {
    const v = raw.schemaVersion;
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null;
  }
  if (Array.isArray(raw)) return raw.length > 0 && raw.every(looksLikeLegacyDocument) ? 0 : null;
  if (isRecord(raw) && 'document' in raw) return looksLikeLegacyDocument(raw.document) ? 0 : null;
  return looksLikeLegacyDocument(raw) ? 0 : null;
}

export interface MigrationResult {
  data: unknown;
  fromVersion: number;
  toVersion: number;
}

/**
 * Upgrade `raw` (already at `fromVersion`) step by step to the current version.
 * Versions newer than this build are refused by the caller before this runs.
 */
export function migrateProject(raw: unknown, fromVersion: number): MigrationResult {
  let data = raw;
  let version = fromVersion;
  while (version < CURRENT_PROJECT_SCHEMA_VERSION) {
    const step = PROJECT_MIGRATIONS[version];
    if (!step) throw new Error(`No migration registered from project schema v${version}`);
    data = step(data);
    version += 1;
  }
  return { data, fromVersion, toVersion: version };
}
