// SPDX-License-Identifier: GPL-3.0-or-later
// Native .gatc project format: serialization, validation and version handling.
import type {
  PlasmidDocument,
  ProjectFile,
  ProjectWorkspace,
  SangerTraceData,
} from '../../types/schema';
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  detectProjectVersion,
  migrateProject,
} from './migrations';

export { CURRENT_PROJECT_SCHEMA_VERSION } from './migrations';

/** File extension of a GATC project; the contents are UTF-8 JSON. */
export const PROJECT_FILE_EXTENSION = '.gatc';
export const PROJECT_MIME_TYPE = 'application/vnd.gatc.project+json';

/** Raised for a project written by a newer GATC than this build understands. */
export class ProjectVersionError extends Error {
  constructor(
    readonly foundVersion: number,
    readonly supportedVersion: number,
  ) {
    super(
      `该项目文件使用格式 v${foundVersion}，由更新版本的 GATC 保存；当前版本只支持到 v${supportedVersion}。请升级 GATC 后再打开，文件未被修改。`,
    );
    this.name = 'ProjectVersionError';
  }
}

export interface ProjectInput {
  documents: PlasmidDocument[];
  traces?: Record<string, SangerTraceData[]>;
  workspace: ProjectWorkspace;
  appVersion: string;
  savedAt?: string;
}

export interface ProjectLoadResult {
  project: ProjectFile;
  /** Schema version the file was written in when it had to be upgraded, else null. */
  migratedFrom: number | null;
  /** Problems that were repaired while loading, shown to the user. */
  warnings: string[];
}

// Keys that must never reach a project file, whatever object they appear on.
const SECRET_KEY = /^(api[-_]?key|authorization|x-api-key|secret|token)$/i;

function stripSecrets(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!SECRET_KEY.test(k)) out[k] = v;
    return out;
  }
  return value;
}

/** Raw trace data only: alignments depend on the reference and are recomputed. */
function rawTrace(trace: SangerTraceData): Omit<SangerTraceData, 'alignment'> {
  const { alignment: _alignment, ...raw } = trace;
  return raw;
}

export function buildProject(input: ProjectInput): ProjectFile {
  const ids = new Set(input.documents.map((d) => d.id));
  const traces: ProjectFile['traces'] = {};
  for (const [docId, list] of Object.entries(input.traces ?? {})) {
    if (ids.has(docId) && list.length) traces[docId] = list.map(rawTrace);
  }
  return {
    format: 'gatc-project',
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    appVersion: input.appVersion,
    savedAt: input.savedAt ?? new Date().toISOString(),
    documents: input.documents,
    traces,
    workspace: {
      activeDocId: input.workspace.activeDocId && ids.has(input.workspace.activeDocId) ? input.workspace.activeDocId : null,
      ...(input.workspace.view ? { view: input.workspace.view } : {}),
    },
  };
}

/** Serialize a project to the text stored in a .gatc file. */
export function serializeProject(input: ProjectInput): string {
  return JSON.stringify(buildProject(input), stripSecrets);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateDocument(raw: unknown, index: number, warnings: string[]): PlasmidDocument {
  const where = `文档 #${index + 1}`;
  if (!isRecord(raw)) throw new Error(`${where} 不是对象`);
  if (typeof raw.id !== 'string' || !raw.id) throw new Error(`${where} 缺少 id`);
  if (typeof raw.sequence !== 'string') throw new Error(`${where} 缺少序列`);
  if (raw.topology !== 'circular' && raw.topology !== 'linear') throw new Error(`${where} 的拓扑无效`);
  for (const key of ['features', 'primers', 'history'] as const) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) throw new Error(`${where} 的 ${key} 不是数组`);
  }
  const name = typeof raw.name === 'string' && raw.name ? raw.name : raw.id;
  const doc = {
    ...raw,
    name,
    features: raw.features ?? [],
    primers: raw.primers ?? [],
    history: raw.history ?? [],
  } as PlasmidDocument;
  if (doc.length !== doc.sequence.length) {
    warnings.push(`${name}：记录长度 ${String(raw.length)} 与序列长度 ${doc.sequence.length} 不一致，已按序列修正`);
    doc.length = doc.sequence.length;
  }
  return doc;
}

function validateProject(raw: unknown): { project: ProjectFile; warnings: string[] } {
  if (!isRecord(raw) || raw.format !== 'gatc-project') throw new Error('不是 GATC 项目文件');
  if (!Array.isArray(raw.documents)) throw new Error('项目文件缺少文档列表');
  const warnings: string[] = [];
  const documents = raw.documents.map((d, i) => validateDocument(d, i, warnings));
  const ids = new Set<string>();
  for (const d of documents) {
    if (ids.has(d.id)) throw new Error(`项目中有重复的文档 id：${d.id}`);
    ids.add(d.id);
  }
  const traces: ProjectFile['traces'] = {};
  if (raw.traces !== undefined) {
    if (!isRecord(raw.traces)) throw new Error('项目文件的测序数据格式无效');
    for (const [docId, list] of Object.entries(raw.traces)) {
      if (!Array.isArray(list)) throw new Error(`文档 ${docId} 的测序数据不是数组`);
      if (!ids.has(docId)) {
        warnings.push(`忽略了 ${list.length} 条测序数据：所属文档 ${docId} 不在项目中`);
        continue;
      }
      traces[docId] = list as ProjectFile['traces'][string];
    }
  }
  const ws = isRecord(raw.workspace) ? raw.workspace : {};
  let activeDocId = typeof ws.activeDocId === 'string' ? ws.activeDocId : null;
  if (activeDocId && !ids.has(activeDocId)) activeDocId = null;
  return {
    project: {
      format: 'gatc-project',
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : 'unknown',
      savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
      documents,
      traces,
      workspace: { activeDocId: activeDocId ?? documents[0]?.id ?? null, ...(typeof ws.view === 'string' ? { view: ws.view } : {}) },
    },
    warnings,
  };
}

/** Load a project from parsed JSON, upgrading older schema versions. */
export function loadProject(raw: unknown): ProjectLoadResult {
  const version = detectProjectVersion(raw);
  if (version === null) throw new Error('不是 GATC 项目文件，或格式版本号无效');
  if (version > CURRENT_PROJECT_SCHEMA_VERSION) throw new ProjectVersionError(version, CURRENT_PROJECT_SCHEMA_VERSION);
  const { data } = migrateProject(raw, version);
  const { project, warnings } = validateProject(data);
  return { project, migratedFrom: version < CURRENT_PROJECT_SCHEMA_VERSION ? version : null, warnings };
}

/** Load a project from the text of a .gatc file. */
export function parseProjectFile(text: string): ProjectLoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('项目文件不是有效的 JSON，可能已损坏或未完整写入');
  }
  return loadProject(raw);
}

/** True for a .gatc file, or JSON text that declares the GATC project format. */
export function isProjectFile(fileName: string, text: string): boolean {
  if (fileName.toLowerCase().endsWith(PROJECT_FILE_EXTENSION)) return true;
  const head = text.slice(0, 200);
  return /^\s*\{/.test(head) && /"format"\s*:\s*"gatc-project"/.test(head);
}
