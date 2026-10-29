// SPDX-License-Identifier: GPL-3.0-or-later
// Autosave, crash recovery and unsaved-change tracking (design.md appendix A4/A5).
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlasmidDocument, SangerTraceData } from '../types/schema';
import { newDocument } from './actions';
import {
  Autosaver,
  IndexedDbSnapshotStore,
  MemorySnapshotStore,
  TauriSnapshotStore,
  buildSnapshot,
  planRestore,
  type AutosaveReport,
  type SnapshotRecord,
  type SnapshotStore,
  type WorkspaceCapture,
} from './autosave';
import { isDirty, selectDirtyIds, useWorkbench } from './store';

const st = () => useWorkbench.getState();
const resetStore = () => useWorkbench.setState({ docs: [], savedDocs: {}, activeId: null, traces: {}, traceAlignedTo: {}, cutSites: {} });

const trace: SangerTraceData = {
  id: 't1',
  fileName: 'r.ab1',
  calledSequence: 'GAATTC',
  qualityScores: [40, 40, 40, 40, 40, 40],
  baseLocations: [1, 2, 3, 4, 5, 6],
  trimRange: [0, 6],
  traces: { A: [1], T: [2], G: [3], C: [4] },
};

function capture(): WorkspaceCapture {
  const s = st();
  return { docs: s.docs, dirtyIds: selectDirtyIds(s), traces: s.traces, activeId: s.activeId, view: s.view };
}

function saverFor(store: SnapshotStore, sessionId: string, reports: AutosaveReport[] = []) {
  return new Autosaver(store, sessionId, capture, (r) => reports.push(r), () => 3000);
}

/** Open the recovered workspace the way SessionManager does. */
function applyPlan(record: SnapshotRecord) {
  const plan = planRestore(record, st());
  st().openDocs(plan.openSaved, false, { saved: true });
  st().openDocs(plan.openDirty, false);
  plan.replace.forEach((d) => st().replaceDoc(d));
  Object.entries(plan.traces).forEach(([id, t]) => st().setTraces(id, t));
  return plan;
}

let fileDoc: PlasmidDocument;

beforeEach(() => {
  resetStore();
  fileDoc = newDocument('pFile', 'GAATTCAAAAGGATCC', 'circular');
  st().openDocs([fileDoc], true, { saved: true });
});

afterEach(() => vi.useRealTimers());

describe('unsaved-change tracking', () => {
  it('marks a document after an edit and clears the mark after saving', () => {
    expect(isDirty(st(), fileDoc)).toBe(false);
    st().replaceDoc({ ...fileDoc, sequence: 'GAATTC', length: 6 });
    expect(selectDirtyIds(st())).toEqual([fileDoc.id]);
    st().markSaved([fileDoc.id]);
    expect(selectDirtyIds(st())).toEqual([]);
  });

  it('treats an edit undone back to the saved version as saved', () => {
    useWorkbench.temporal.getState().clear();
    st().replaceDoc({ ...fileDoc, name: 'renamed' });
    expect(selectDirtyIds(st())).toHaveLength(1);
    useWorkbench.temporal.getState().undo();
    expect(selectDirtyIds(st())).toEqual([]);
  });

  it('counts documents that never came from a file as unsaved', () => {
    st().openDocs([newDocument('product', 'ACGT', 'linear')]);
    expect(selectDirtyIds(st())).toHaveLength(1);
  });
});

describe('Autosaver', () => {
  it('debounces writes and only writes while something is unsaved', async () => {
    vi.useFakeTimers();
    const store = new MemorySnapshotStore();
    const write = vi.spyOn(store, 'write');
    const remove = vi.spyOn(store, 'remove');
    const saver = saverFor(store, 'sess-a');
    st().replaceDoc({ ...fileDoc, sequence: 'AAAA', length: 4 });
    saver.schedule();
    saver.schedule();
    await vi.advanceTimersByTimeAsync(2999);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(store.records.get('sess-a')?.dirtyIds).toEqual([fileDoc.id]);

    st().markSaved();
    await saver.flush();
    expect(remove).toHaveBeenCalledWith('sess-a');
    expect(store.records.size).toBe(0);
  });

  it('reports a full quota and a permission error instead of failing silently', async () => {
    const reports: AutosaveReport[] = [];
    const store = new MemorySnapshotStore();
    st().replaceDoc({ ...fileDoc, name: 'edited' });
    const saver = saverFor(store, 'sess-a', reports);
    await saver.flush();
    const good = structuredClone(store.records.get('sess-a'));

    vi.spyOn(store, 'write').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    expect(await saver.flush()).toBe(false);
    vi.spyOn(store, 'write').mockRejectedValueOnce(new Error('Permission denied (os error 13)'));
    expect(await saver.flush()).toBe(false);
    expect(reports.map((r) => r.ok)).toEqual([true, false, false]);
    expect(reports[1]).toMatchObject({ ok: false, error: expect.stringMatching(/存储空间不足/) });
    expect(reports[2]).toMatchObject({ ok: false, error: expect.stringMatching(/没有写入权限/) });
    // The last good snapshot is still there to recover from.
    expect(store.records.get('sess-a')).toEqual(good);
  });
});

describe('crash recovery', () => {
  it('restores the same content after a refresh or forced close', async () => {
    const store = new MemorySnapshotStore();
    const edited = { ...fileDoc, sequence: 'GAATTCTTTTGGATCC', features: [{ id: 'f', name: 'x', type: 'misc_feature' as const, start: 14, end: 2, strand: 1 as const, color: '#000' }] };
    st().replaceDoc(edited);
    const product = newDocument('product', 'ACGTACGT', 'linear');
    st().openDocs([product]);
    st().setTraces(product.id, [trace]);
    await saverFor(store, 'crashed').flush();
    const before = st().docs;

    // Process dies; a new session starts with nothing open.
    resetStore();
    const [record] = await store.orphans('fresh');
    expect(record.names.sort()).toEqual(['pFile', 'product']);
    applyPlan(record);
    expect(st().docs).toEqual(before);
    expect(st().traces[product.id]).toEqual([trace]);
    expect(selectDirtyIds(st()).sort()).toEqual([fileDoc.id, product.id].sort());
  });

  it('never overwrites an open document that has its own unsaved changes', () => {
    st().replaceDoc({ ...fileDoc, name: 'in snapshot' });
    const record = buildSnapshot('old', capture());
    resetStore();
    st().openDocs([fileDoc], true, { saved: true });
    st().replaceDoc({ ...fileDoc, name: 'edited now' });

    const plan = applyPlan(record);
    expect(plan.replace).toEqual([]);
    expect(st().docs.map((d) => d.name).sort()).toEqual(['edited now', 'in snapshot（恢复）']);
  });

  it('replaces an open, unchanged copy of a recovered document', () => {
    st().replaceDoc({ ...fileDoc, name: 'recovered' });
    const record = buildSnapshot('old', capture());
    resetStore();
    st().openDocs([fileDoc], true, { saved: true });
    applyPlan(record);
    expect(st().docs.map((d) => d.name)).toEqual(['recovered']);
    expect(selectDirtyIds(st())).toEqual([fileDoc.id]);
  });

  it('rejects a damaged snapshot with an error instead of opening partial data', () => {
    st().replaceDoc({ ...fileDoc, name: 'x' });
    const record = buildSnapshot('old', capture());
    expect(() => planRestore({ ...record, project: record.project.slice(0, 40) }, st())).toThrow();
  });
});

/** How many chunk records the autosave database holds. */
async function countChunks(factory: IDBFactory): Promise<number> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open('gatc-autosave');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (!db.objectStoreNames.contains('chunks')) return 0;
  const count = await new Promise<number>((resolve, reject) => {
    const req = db.transaction('chunks', 'readonly').objectStore('chunks').count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return count;
}

describe('IndexedDbSnapshotStore', () => {
  it('stores one snapshot per session and lists only other sessions', async () => {
    const store = new IndexedDbSnapshotStore(new IDBFactory());
    st().replaceDoc({ ...fileDoc, name: 'x' });
    await store.write(buildSnapshot('tab-1', capture()));
    await store.write(buildSnapshot('tab-2', capture()));
    expect((await store.orphans('tab-1')).map((r) => r.sessionId)).toEqual(['tab-2']);
    await store.remove('tab-2');
    expect(await store.orphans('tab-1')).toEqual([]);
  });

  it('rewrites only the chunks that changed, and recovers the whole project', async () => {
    const factory = new IDBFactory();
    const store = new IndexedDbSnapshotStore(factory);
    // Big enough to span several 64 kB chunks.
    const long = 'ACGT'.repeat(60_000);
    st().replaceDoc({ ...fileDoc, name: 'big', sequence: long, length: long.length });
    await store.write(buildSnapshot('tab-1', capture()));
    const first = await countChunks(factory);
    expect(first).toBeGreaterThan(2);

    // One base changed at the very end: only the last chunk's contents differ.
    const edited = `${long.slice(0, -1)}C`;
    st().replaceDoc({ ...fileDoc, name: 'big', sequence: edited, length: edited.length });
    await store.write(buildSnapshot('tab-1', capture()));
    expect(await countChunks(factory)).toBe(first);

    const [recovered] = await store.orphans('other-tab');
    expect(recovered.project).toContain(edited.slice(-80));
    await store.remove('tab-1');
    expect(await countChunks(factory)).toBe(0);
  });

  it('skips sessions whose tab still holds its lock', async () => {
    const store = new IndexedDbSnapshotStore(new IDBFactory());
    await store.write(buildSnapshot('live-tab', capture()));
    const locks = { query: async () => ({ held: [{ name: 'gatc-session-live-tab' }] }) };
    vi.stubGlobal('navigator', { locks });
    try {
      expect(await store.orphans('me')).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('TauriSnapshotStore', () => {
  /** In-memory stand-in for the Rust commands: per-session snapshot plus backup slots. */
  function fakeBackend(files: Record<string, Array<string | null>> = {}) {
    const calls: string[] = [];
    const invoke = async <T,>(cmd: string, args: Record<string, unknown> = {}): Promise<T> => {
      calls.push(cmd);
      const session = args.session as string;
      if (cmd === 'autosave_sessions') return Object.keys(files).filter((k) => files[k].some((x) => x !== null)) as T;
      if (cmd === 'autosave_read') return (files[session]?.[args.slot as number] ?? null) as T;
      if (cmd === 'autosave_write') (files[session] ??= [])[0] = args.contents as string;
      if (cmd === 'autosave_clear') delete files[session];
      return undefined as T;
    };
    return { invoke, calls, files };
  }

  it('falls back to the newest backup whose project loads', async () => {
    st().replaceDoc({ ...fileDoc, name: 'x' });
    const good = buildSnapshot('old', capture());
    // Outer JSON intact but the project inside is truncated: not recoverable.
    const brokenInside = JSON.stringify({ ...good, project: good.project.slice(0, 30) });
    const { invoke } = fakeBackend({ old: ['{"truncated', brokenInside, JSON.stringify(good)] });
    const [record] = await new TauriSnapshotStore(invoke).orphans('now');
    expect(record.project).toBe(good.project);
  });

  it('keeps an unrecovered snapshot when a new session saves', async () => {
    st().replaceDoc({ ...fileDoc, name: 'crashed work' });
    const backend = fakeBackend({ old: [JSON.stringify(buildSnapshot('old', capture()))] });
    const store = new TauriSnapshotStore(backend.invoke);
    st().replaceDoc({ ...fileDoc, name: 'new session work' });
    await store.write(buildSnapshot('new', capture()));
    const orphans = await store.orphans('new');
    expect(orphans.map((r) => r.sessionId)).toEqual(['old']);
    expect(orphans[0].names).toEqual(['crashed work']);
  });

  it('removes only the given session', async () => {
    st().replaceDoc({ ...fileDoc, name: 'x' });
    const backend = fakeBackend({ a: [JSON.stringify(buildSnapshot('a', capture()))], b: [JSON.stringify(buildSnapshot('b', capture()))] });
    await new TauriSnapshotStore(backend.invoke).remove('a');
    expect(Object.keys(backend.files)).toEqual(['b']);
  });
});
