// Promise-based client for the bio Web Worker pool, with an in-thread
// fallback for environments without Worker support (Node/vitest, old browsers).
import { bioApi, type BioApi, type BioFn, type BioRequest, type BioResponse } from './bio-api';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

const POOL_SIZE =
  typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? Math.min(4, Math.max(1, navigator.hardwareConcurrency - 1))
    : 2;

let workers: Worker[] | null = null;
let nextWorker = 0;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorkers(): Worker[] | null {
  if (typeof Worker === 'undefined') return null;
  if (workers) return workers;
  try {
    workers = Array.from({ length: POOL_SIZE }, () => {
      const w = new Worker(new URL('./bio.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<BioResponse>) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.ok) p.resolve(e.data.result);
        else p.reject(new Error(e.data.error));
      };
      return w;
    });
  } catch {
    workers = null;
  }
  return workers;
}

export function callBioSync<K extends BioFn>(fn: K, ...args: Parameters<BioApi[K]>): ReturnType<BioApi[K]> {
  return (bioApi[fn] as (...a: unknown[]) => ReturnType<BioApi[K]>)(...args);
}

export function callBio<K extends BioFn>(
  fn: K,
  ...args: Parameters<BioApi[K]>
): Promise<Awaited<ReturnType<BioApi[K]>>> {
  const pool = getWorkers();
  if (!pool) {
    return Promise.resolve().then(() => callBioSync(fn, ...args) as unknown) as Promise<Awaited<ReturnType<BioApi[K]>>>;
  }
  const id = nextId++;
  const worker = pool[nextWorker++ % pool.length];
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    const msg: BioRequest = { id, fn, args };
    worker.postMessage(msg);
  });
}
