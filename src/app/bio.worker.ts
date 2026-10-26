/// <reference lib="webworker" />
import { bioApi, type BioRequest, type BioResponse } from './bio-api';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (e: MessageEvent<BioRequest>) => {
  const { id, fn, args } = e.data;
  let response: BioResponse;
  try {
    const impl = bioApi[fn] as (...a: unknown[]) => unknown;
    const result = await impl(...args);
    response = { id, ok: true, result };
  } catch (err) {
    response = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  ctx.postMessage(response);
};
