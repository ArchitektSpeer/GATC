// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Promise-based client for the bio Web Worker pool, with an in-thread
// fallback for environments without Worker support (Node/vitest, old browsers).
import type { PlasmidDocument } from '../types/schema';
import { bioApi, type BioApi, type BioFn, type BioRequest, type BioResponse } from './bio-api';
import { initPython } from '../lib/python';
import { docRevision } from './revision';
import { isDocCurrent } from './store';
import { getLocale, t as translate } from '../lib/i18n';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

const POOL_SIZE =
  typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? Math.min(4, Math.max(1, navigator.hardwareConcurrency - 1))
    : 2;

let workers: Worker[] | null = null;
let nextWorker = 0;
let nextId = 1;
const pending = new Map<number, Pending>();

let workersBroken = false;

function getWorkers(): Worker[] | null {
  if (typeof Worker === 'undefined' || workersBroken) return null;
  if (workers) return workers;
  try {
    workers = Array.from({ length: POOL_SIZE }, () => {
      const w = new Worker(new URL('./bio.worker.ts', import.meta.url), { type: 'module' });
      // Resolved here because the worker's own location is the bundled script, not
      // the page, and the app may be served from a sub-path. Where there is no
      // document at all the worker falls back to its own resolution.
      const page = typeof location === 'undefined' ? null : location.href;
      if (page) {
        w.postMessage({
          pyodideURL: new URL(`${import.meta.env?.BASE_URL ?? '/'}pyodide/`, page).href,
        });
      }
      w.onmessage = (e: MessageEvent<BioResponse>) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.ok) p.resolve(e.data.result);
        else p.reject(new Error(e.data.error));
      };
      // A worker that failed to load or crashed answers nothing: fail its tasks
      // instead of leaving them (and edits queued behind them) waiting forever.
      w.onerror = (e) => {
        e.preventDefault?.();
        failWorker(translate('计算线程出错：{v0}', { v0: e.message || '脚本加载失败' }));
      };
      w.onmessageerror = () => failWorker('计算线程返回了无法读取的数据');
      return w;
    });
  } catch {
    workers = null;
  }
  return workers;
}

/** Fail every task in flight and stop using workers; later calls run in-thread. */
function failWorker(message: string) {
  workers?.forEach((w) => w.terminate());
  workers = null;
  workersBroken = true;
  for (const [id, p] of pending) {
    pending.delete(id);
    p.reject(new Error(message));
  }
}

export function callBioSync<K extends BioFn>(fn: K, ...args: Parameters<BioApi[K]>): ReturnType<BioApi[K]> {
  return (bioApi[fn] as (...a: unknown[]) => ReturnType<BioApi[K]>)(...args);
}

export function callBio<K extends BioFn>(
  fn: K,
  ...args: Parameters<BioApi[K]>
): Promise<Awaited<ReturnType<BioApi[K]>>> {
  return dispatch(fn, args, undefined);
}

/**
 * Run `fn` for a computation derived from `doc`. Resolves to null when `doc` was
 * edited, replaced or closed while the task ran, so a slow result can never
 * overwrite data for a newer edit.
 */
export async function callBioForDoc<K extends BioFn>(
  doc: PlasmidDocument,
  fn: K,
  ...args: Parameters<BioApi[K]>
): Promise<Awaited<ReturnType<BioApi[K]>> | null> {
  const revision = docRevision(doc);
  const result = await dispatch(fn, args, { docId: doc.id, revision });
  return isDocCurrent(doc.id, revision) ? result : null;
}

function dispatch<K extends BioFn>(
  fn: K,
  args: Parameters<BioApi[K]>,
  doc: BioRequest['doc'],
): Promise<Awaited<ReturnType<BioApi[K]>>> {
  const pool = getWorkers();
  if (!pool) {
    // No worker here, so the interpreter the engine needs has to run in this
    // thread instead. It is started once and only on this path.
    return initPython().then(() => callBioSync(fn, ...args) as unknown) as Promise<
      Awaited<ReturnType<BioApi[K]>>
    >;
  }
  const id = nextId++;
  const worker = pool[nextWorker++ % pool.length];
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    const msg: BioRequest = { id, fn, args, doc, locale: getLocale() };
    worker.postMessage(msg);
  });
}
