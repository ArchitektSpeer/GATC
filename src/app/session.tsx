// SPDX-License-Identifier: GPL-3.0-or-later
// Session lifecycle: autosave, crash recovery, unsaved-change prompts (design.md A4/A5).
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, History } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import {
  Autosaver,
  IndexedDbSnapshotStore,
  TauriSnapshotStore,
  holdSessionLock,
  newSessionId,
  planRestore,
  type SnapshotRecord,
  type SnapshotStore,
} from './autosave';
import { canConfirmSave, saveProject } from './files';
import { selectDirtyIds, useWorkbench } from './store';
import { Button, Dialog } from './ui';
import { t as translate, useT } from '../lib/i18n';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function createStore(): Promise<SnapshotStore> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return new TauriSnapshotStore(invoke);
  }
  return new IndexedDbSnapshotStore();
}

let autosaver: Autosaver | null = null;
// Set when the page is going away normally: saves that could not be confirmed no
// longer keep the snapshot alive, since the user has had the chance to check them.
let cleanExit = false;
let currentSession: string | null = null;

// A session that ended with nothing unsaved leaves this marker. It is written
// synchronously, because the asynchronous removal of its snapshot may not finish
// before the page is gone; the next start then discards that snapshot unasked.
const CLEAN_EXIT_PREFIX = 'gatc.cleanExit.';

function markCleanExit(on: boolean) {
  if (!currentSession) return;
  try {
    if (on) globalThis.localStorage?.setItem(CLEAN_EXIT_PREFIX + currentSession, '1');
    else globalThis.localStorage?.removeItem(CLEAN_EXIT_PREFIX + currentSession);
  } catch {
    // Without storage the snapshot is simply offered for recovery once more.
  }
}

/** Split snapshots into those that ended cleanly (to discard) and real orphans; clears stale markers. */
export function sortOutCleanExits(records: SnapshotRecord[], storage: Storage | undefined = globalThis.localStorage): { clean: SnapshotRecord[]; orphans: SnapshotRecord[] } {
  const clean: SnapshotRecord[] = [];
  const orphans: SnapshotRecord[] = [];
  try {
    for (const r of records) (storage?.getItem(CLEAN_EXIT_PREFIX + r.sessionId) ? clean : orphans).push(r);
    const live = new Set(records.map((r) => CLEAN_EXIT_PREFIX + r.sessionId));
    for (let i = (storage?.length ?? 0) - 1; i >= 0; i--) {
      const key = storage!.key(i);
      if (key?.startsWith(CLEAN_EXIT_PREFIX) && (!live.has(key) || clean.some((r) => CLEAN_EXIT_PREFIX + r.sessionId === key))) storage!.removeItem(key);
    }
  } catch {
    return { clean: [], orphans: records };
  }
  return { clean, orphans };
}

/** Write the recovery snapshot now; used before the window closes. */
export function flushAutosave(): Promise<boolean> {
  return autosaver?.flush() ?? Promise.resolve(true);
}

/** Documents the snapshot must keep: unsaved ones, plus saves the browser could not confirm. */
function idsToKeep(): string[] {
  const s = useWorkbench.getState();
  const dirty = selectDirtyIds(s);
  if (cleanExit) return dirty;
  const unconfirmed = s.docs.filter((d) => s.unconfirmedSaves[d.id] && !dirty.includes(d.id)).map((d) => d.id);
  return [...dirty, ...unconfirmed];
}

/** Close a document tab, asking first when it has unsaved changes. */
export function requestCloseDoc(id: string): void {
  const st = useWorkbench.getState();
  if (selectDirtyIds(st).includes(id)) st.setClosePrompt({ kind: 'doc', id });
  else st.closeDoc(id);
}

/**
 * Open a recovered snapshot and retire it. The old record is removed only once
 * this session's own snapshot (which now holds the recovered work) was written;
 * otherwise it stays in storage so a second crash cannot lose the work.
 * Throws, leaving everything as it was, when the snapshot cannot be read.
 */
export async function recoverRecord(record: SnapshotRecord, store: SnapshotStore, flush: () => Promise<boolean>): Promise<'retired' | 'kept'> {
  const st = useWorkbench.getState();
  const plan = planRestore(record, st);
  st.openDocs(plan.openSaved, false, { saved: true });
  st.openDocs(plan.openDirty, false);
  plan.replace.forEach((d) => st.replaceDoc(d));
  Object.entries(plan.traces).forEach(([id, t]) => st.setTraces(id, t));
  if (plan.activeDocId) st.setActive(plan.activeDocId);
  const count = plan.openSaved.length + plan.openDirty.length + plan.replace.length;
  if (!(await flush())) {
    st.notify(translate('已恢复到界面，但无法写入新的自动保存，原恢复数据已保留。请尽快用 Ctrl+S 保存项目'));
    return 'kept';
  }
  await store.remove(record.sessionId);
  st.notify(
    [translate('已恢复 {n} 个文档（{time} 的自动保存）', { n: count, time: new Date(record.savedAt).toLocaleString() }), ...plan.warnings].join('；'),
  );
  return 'retired';
}

function useAutosave(onOrphans: (records: SnapshotRecord[], store: SnapshotStore) => void) {
  useEffect(() => {
    let disposed = false;
    let unsubscribe = () => {};
    const sessionId = newSessionId();
    currentSession = sessionId;
    createStore().then((store) => {
      if (disposed) return;
      if (!isTauri()) holdSessionLock(sessionId);
      const saver = new Autosaver(
        store,
        sessionId,
        () => {
          const s = useWorkbench.getState();
          return { docs: s.docs, dirtyIds: idsToKeep(), traces: s.traces, activeId: s.activeId, view: s.view };
        },
        (r) => {
          const st = useWorkbench.getState();
          const failedBefore = st.autosave.state === 'error';
          if (r.ok) st.setAutosave(r.wrote ? { state: 'saved', at: r.at } : { state: 'idle' });
          else {
            st.setAutosave({ state: 'error', error: r.error });
            if (!failedBefore) st.notify(r.error);
          }
        },
        () => useWorkbench.getState().settings.autosaveDelayMs,
      );
      autosaver = saver;
      unsubscribe = useWorkbench.subscribe((s, prev) => {
        if (
          s.docs !== prev.docs ||
          s.savedDocs !== prev.savedDocs ||
          s.unsavedTraces !== prev.unsavedTraces ||
          s.unconfirmedSaves !== prev.unconfirmedSaves ||
          s.traces !== prev.traces ||
          s.activeId !== prev.activeId
        )
          saver.schedule();
      });
      store
        .orphans(sessionId)
        .then((records) => {
          const { clean, orphans } = sortOutCleanExits(records);
          clean.forEach((r) => void store.remove(r.sessionId).catch(() => {}));
          if (!disposed && orphans.length) onOrphans(orphans, store);
        })
        .catch((e) => useWorkbench.getState().notify(translate('无法读取自动保存的恢复数据：{v0}', { v0: e instanceof Error ? e.message : String(e) })));
    });
    return () => {
      disposed = true;
      unsubscribe();
      autosaver?.cancel();
      autosaver = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

function useCloseGuards() {
  // Web: the browser shows its own confirmation when the page has unsaved changes.
  useEffect(() => {
    if (isTauri()) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      void flushAutosave();
      if (!selectDirtyIds(useWorkbench.getState()).length) return;
      e.preventDefault();
      e.returnValue = '';
    };
    const onPageHide = () => {
      cleanExit = true;
      if (!selectDirtyIds(useWorkbench.getState()).length) markCleanExit(true);
      void flushAutosave();
    };
    // Coming back from the back/forward cache: the session continues.
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      cleanExit = false;
      markCleanExit(false);
      void flushAutosave();
    };
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  // Desktop: intercept the window close and ask in-app.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const off = await getCurrentWindow().onCloseRequested(async (event) => {
        await flushAutosave();
        if (!selectDirtyIds(useWorkbench.getState()).length) return;
        event.preventDefault();
        useWorkbench.getState().setClosePrompt({ kind: 'window' });
      });
      if (disposed) off();
      else unlisten = off;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

async function closeWindowNow() {
  await flushAutosave();
  if (isTauri()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().destroy();
  } else {
    window.close();
  }
}

/** Recovery banner, close prompts and autosave wiring. Render once in the app. */
export function SessionManager() {
  const t = useT();
  const [orphans, setOrphans] = useState<{ records: SnapshotRecord[]; store: SnapshotStore } | null>(null);
  useAutosave((records, store) => {
    // A record without unsaved documents has nothing to recover.
    records.filter((r) => !r.dirtyIds.length).forEach((r) => void store.remove(r.sessionId).catch(() => {}));
    setOrphans({ records: records.filter((r) => r.dirtyIds.length), store });
  });
  useCloseGuards();
  const prompt = useWorkbench((s) => s.closePrompt);
  const docs = useWorkbench((s) => s.docs);
  const dirtyIds = useWorkbench(useShallow(selectDirtyIds));
  const busy = useRef(false);

  const dismiss = async (record: SnapshotRecord, restore: boolean) => {
    if (!orphans || busy.current) return;
    busy.current = true;
    try {
      await (restore ? recoverRecord(record, orphans.store, flushAutosave) : orphans.store.remove(record.sessionId));
      setOrphans((o) => (o ? { ...o, records: o.records.filter((r) => r !== record) } : o));
    } catch (e) {
      useWorkbench.getState().notify(translate('恢复失败：{v0}。恢复数据已保留，可稍后重试。', { v0: e instanceof Error ? e.message : String(e) }));
    } finally {
      busy.current = false;
    }
  };

  const target = prompt?.kind === 'doc' ? docs.find((d) => d.id === prompt.id) : null;
  const dirtyNames = prompt?.kind === 'window' ? docs.filter((d) => dirtyIds.includes(d.id)).map((d) => d.name) : [];
  const closePrompt = () => useWorkbench.getState().setClosePrompt(null);
  const finish = () => {
    const st = useWorkbench.getState();
    closePrompt();
    if (prompt?.kind === 'doc') st.closeDoc(prompt.id);
    else void closeWindowNow();
  };

  return (
    <>
      {orphans?.records.map((r) => (
        <div
          key={r.sessionId}
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
        >
          <History size={14} />
          <span className="min-w-0 flex-1">
            {t('发现上次未正常关闭时留下的未保存工作（{v0}）：{v1}', { v0: new Date(r.savedAt).toLocaleString(), v1: r.names.join('、') })}
          </span>
          <Button size="sm" variant="primary" onClick={() => dismiss(r, true)}>
            恢复
          </Button>
          <Button size="sm" variant="ghost" onClick={() => dismiss(r, false)}>
            丢弃
          </Button>
        </div>
      ))}
      <Dialog open={!!prompt && (prompt.kind === 'window' || !!target)} onClose={closePrompt} title={translate('有未保存的修改')} width={460}>
        <div className="flex items-start gap-3 text-sm">
          <AlertTriangle className="mt-0.5 shrink-0 text-amber-500" size={18} />
          <div>
            {target ? <>「{target.name}」的修改尚未保存到文件。</> : <>以下文档的修改尚未保存到文件：{dirtyNames.join('、')}。</>}
            <div className="mt-1 text-xs text-[var(--muted)]">
              {target ? t('不保存直接关闭后，可用撤销（Ctrl+Z）重新打开。') : t('不保存直接关闭后，修改只留在本机的自动恢复数据中，下次启动时可以恢复。')}
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={closePrompt}>{translate('取消')}</Button>
          <Button variant="danger" onClick={finish}>
            {t('不保存，关闭')}
          </Button>
          {/* Close only after a save that is known to have been written; a plain
              download cannot be confirmed, so then the user checks the file and closes again. */}
          <Button
            variant="primary"
            onClick={async () => {
              const outcome = await saveProject(target ? [target.id] : undefined);
              if (outcome === 'confirmed') finish();
              else closePrompt();
            }}
          >
            {canConfirmSave() ? t('保存项目并关闭') : t('保存项目（下载）')}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
