// SPDX-License-Identifier: GPL-3.0-or-later
// Crash-recovery snapshots of the workspace (design.md appendix A4).
//
// While any document has unsaved changes, the whole workspace is written as a
// .gatc project to a recovery store a few seconds after the last change. On the
// next start, a snapshot left by a session that is no longer running is offered
// for recovery. Snapshots are never applied without the user choosing to.
import type { PlasmidDocument, SangerTraceData } from '../types/schema';
import { parseProjectFile, serializeProject } from '../modules/io-adapter';
import { version as APP_VERSION } from '../../package.json';
import { remapDocIds } from './doc-ids';

export { APP_VERSION };

export interface SnapshotRecord {
  sessionId: string;
  savedAt: string;
  /** Documents that had unsaved changes when the snapshot was taken. */
  dirtyIds: string[];
  names: string[];
  /** The workspace as .gatc project text. */
  project: string;
}

export interface SnapshotStore {
  /** Snapshots left by sessions other than `sessionId` that are no longer running. */
  orphans(sessionId: string): Promise<SnapshotRecord[]>;
  write(record: SnapshotRecord): Promise<void>;
  remove(sessionId: string): Promise<void>;
}

function isRecord(value: unknown): value is SnapshotRecord {
  const r = value as SnapshotRecord;
  return !!r && typeof r.sessionId === 'string' && typeof r.project === 'string' && Array.isArray(r.dirtyIds);
}

/* ---------------------------------- Web ---------------------------------- */

const DB_NAME = 'gatc-autosave';
const STORE = 'snapshots';
const LOCK_PREFIX = 'gatc-session-';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Snapshots in IndexedDB, one per browser tab. A tab holds a Web Lock named
 * after its session for as long as it is open, which tells a new tab which
 * snapshots belong to tabs that are still running.
 */
export class IndexedDbSnapshotStore implements SnapshotStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = globalThis.indexedDB) {}

  private open(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new Error('此浏览器不支持 IndexedDB，无法自动保存'));
    this.db ??= new Promise((resolve, reject) => {
      const req = this.factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'sessionId' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('无法打开自动保存数据库'));
      req.onblocked = () => reject(new Error('自动保存数据库被其他标签页占用'));
    });
    this.db.catch(() => (this.db = null));
    return this.db;
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    const tx = db.transaction(STORE, mode);
    const result = request(fn(tx.objectStore(STORE)));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('自动保存事务失败'));
    });
    return result;
  }

  async orphans(sessionId: string): Promise<SnapshotRecord[]> {
    const all = (await this.tx('readonly', (s) => s.getAll())).filter(isRecoverable);
    const live = await liveSessions();
    return all.filter((r) => r.sessionId !== sessionId && !live.has(r.sessionId));
  }

  async write(record: SnapshotRecord): Promise<void> {
    await this.tx('readwrite', (s) => s.put(record));
  }

  async remove(sessionId: string): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(sessionId));
  }
}

async function liveSessions(): Promise<Set<string>> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks) return new Set();
  const { held = [] } = await locks.query();
  return new Set(held.map((l) => l.name ?? '').filter((n) => n.startsWith(LOCK_PREFIX)).map((n) => n.slice(LOCK_PREFIX.length)));
}

/** Hold this tab's session lock until the page goes away. */
export function holdSessionLock(sessionId: string): void {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  void locks?.request(LOCK_PREFIX + sessionId, () => new Promise<never>(() => {})).catch(() => {});
}

/* -------------------------------- Desktop -------------------------------- */

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

const BACKUP_SLOTS = 5;

/** A record whose project text actually loads; anything else cannot be recovered from. */
function isRecoverable(value: unknown): value is SnapshotRecord {
  if (!isRecord(value)) return false;
  try {
    parseProjectFile(value.project);
    return true;
  } catch {
    return false;
  }
}

/**
 * Snapshots in the desktop app data directory, one set of files per session so a
 * new session never overwrites one that has not been recovered. The Rust side
 * writes atomically and keeps rotating backups; a snapshot that is damaged, or
 * whose project does not load, falls back to the newest backup that does.
 */
export class TauriSnapshotStore implements SnapshotStore {
  constructor(private readonly invoke: Invoke) {}

  private async read(session: string): Promise<SnapshotRecord | null> {
    for (let slot = 0; slot <= BACKUP_SLOTS; slot++) {
      const text = await this.invoke<string | null>('autosave_read', { session, slot });
      if (text === null) continue;
      try {
        const parsed: unknown = JSON.parse(text);
        if (isRecoverable(parsed)) return parsed;
      } catch {
        // Damaged; try the next backup.
      }
    }
    return null;
  }

  async orphans(sessionId: string): Promise<SnapshotRecord[]> {
    const sessions = await this.invoke<string[]>('autosave_sessions');
    const records = await Promise.all(sessions.filter((s) => s !== sessionId).map((s) => this.read(s)));
    return records.filter((r): r is SnapshotRecord => !!r);
  }

  async write(record: SnapshotRecord): Promise<void> {
    await this.invoke('autosave_write', { session: record.sessionId, contents: JSON.stringify(record) });
  }

  async remove(sessionId: string): Promise<void> {
    await this.invoke('autosave_clear', { session: sessionId });
  }
}

/* ------------------------------- In memory ------------------------------- */

/** For tests and for environments without persistent storage. */
export class MemorySnapshotStore implements SnapshotStore {
  readonly records = new Map<string, SnapshotRecord>();
  async orphans(sessionId: string) {
    return [...this.records.values()].filter((r) => r.sessionId !== sessionId);
  }
  async write(record: SnapshotRecord) {
    this.records.set(record.sessionId, structuredClone(record));
  }
  async remove(sessionId: string) {
    this.records.delete(sessionId);
  }
}

/* ------------------------------- Autosaver ------------------------------- */

export interface WorkspaceCapture {
  docs: PlasmidDocument[];
  dirtyIds: string[];
  traces: Record<string, SangerTraceData[]>;
  activeId: string | null;
  view?: string;
}

export function buildSnapshot(sessionId: string, w: WorkspaceCapture, savedAt = new Date().toISOString()): SnapshotRecord {
  return {
    sessionId,
    savedAt,
    dirtyIds: w.dirtyIds,
    names: w.docs.filter((d) => w.dirtyIds.includes(d.id)).map((d) => d.name),
    project: serializeProject({
      documents: w.docs,
      traces: w.traces,
      workspace: { activeDocId: w.activeId, view: w.view },
      appVersion: APP_VERSION,
      savedAt,
    }),
  };
}

export type AutosaveReport = { ok: true; wrote: boolean; at: string } | { ok: false; error: string };

export function describeStorageError(e: unknown): string {
  const name = e instanceof DOMException || e instanceof Error ? e.name : '';
  const msg = e instanceof Error ? e.message : String(e);
  if (name === 'QuotaExceededError' || /quota|disk full|no space/i.test(msg)) return '存储空间不足，自动保存未完成。请导出项目文件（Ctrl+S）以免丢失修改。';
  if (name === 'SecurityError' || /permission|denied|access/i.test(msg)) return '没有写入权限，自动保存未完成。请导出项目文件（Ctrl+S）以免丢失修改。';
  return `自动保存失败：${msg}。请导出项目文件（Ctrl+S）以免丢失修改。`;
}

/**
 * Debounced writer. `capture` returns the workspace, or null when nothing has
 * unsaved changes, in which case this session's snapshot is removed. Writes are
 * serialized; every outcome is reported, failures included.
 */
export class Autosaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: SnapshotStore,
    readonly sessionId: string,
    private readonly capture: () => WorkspaceCapture | null,
    private readonly report: (r: AutosaveReport) => void,
    private readonly delayMs: () => number,
  ) {}

  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs());
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Write now (skipping the debounce). Resolves to whether the write succeeded. */
  flush(): Promise<boolean> {
    this.cancel();
    const run = async () => {
      const at = new Date().toISOString();
      try {
        const w = this.capture();
        if (w && w.dirtyIds.length) await this.store.write(buildSnapshot(this.sessionId, w, at));
        else await this.store.remove(this.sessionId);
        this.report({ ok: true, wrote: !!w && w.dirtyIds.length > 0, at });
        return true;
      } catch (e) {
        this.report({ ok: false, error: describeStorageError(e) });
        return false;
      }
    };
    const next = this.chain.then(run, run);
    this.chain = next;
    return next;
  }
}

/* -------------------------------- Restore -------------------------------- */

export interface RestorePlan {
  /** Documents to open as they were saved to a file. */
  openSaved: PlasmidDocument[];
  /** Documents to open with unsaved changes. */
  openDirty: PlasmidDocument[];
  /** Open documents without unsaved changes, replaced by their recovered version. */
  replace: PlasmidDocument[];
  traces: Record<string, SangerTraceData[]>;
  activeDocId: string | null;
  view?: string;
  warnings: string[];
}

/**
 * Decide how to bring a snapshot back next to what is open now, without ever
 * discarding an open document's own unsaved changes: a recovered document
 * whose id is open with unsaved changes is opened as a separate copy.
 */
export function planRestore(
  record: SnapshotRecord,
  state: { docs: PlasmidDocument[]; savedDocs: Record<string, PlasmidDocument>; unsavedTraces?: Record<string, true> },
): RestorePlan {
  const { project, warnings } = parseProjectFile(record.project);
  const plan: RestorePlan = { openSaved: [], openDirty: [], replace: [], traces: {}, activeDocId: null, view: project.workspace.view, warnings };
  const isDirtyIn = (d: PlasmidDocument) => state.savedDocs[d.id] !== d || !!state.unsavedTraces?.[d.id];
  // A recovered document whose id is open with its own unsaved changes becomes a copy.
  const { docs, idMap } = remapDocIds(
    project.documents,
    (id) => record.dirtyIds.includes(id) && state.docs.some((d) => d.id === id && isDirtyIn(d)),
    (d) => `${d.id}-recovered-${record.sessionId.slice(0, 6)}`,
  );
  docs.forEach((doc, i) => {
    const originalId = project.documents[i].id;
    const open = state.docs.find((d) => d.id === doc.id);
    if (!record.dirtyIds.includes(originalId)) {
      if (!open) plan.openSaved.push(doc);
    } else if (doc.id !== originalId) {
      plan.openDirty.push({ ...doc, name: `${doc.name}（恢复）` });
    } else if (!open) {
      plan.openDirty.push(doc);
    } else {
      plan.replace.push(doc);
    }
  });
  for (const [docId, list] of Object.entries(project.traces)) {
    const target = idMap.get(docId);
    if (target && (plan.openSaved.concat(plan.openDirty, plan.replace).some((d) => d.id === target))) plan.traces[target] = list;
  }
  plan.activeDocId = project.workspace.activeDocId ? idMap.get(project.workspace.activeDocId) ?? null : null;
  return plan;
}

export function newSessionId(): string {
  const c = globalThis.crypto;
  return c?.randomUUID ? c.randomUUID() : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
