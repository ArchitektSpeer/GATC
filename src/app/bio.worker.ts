// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
/// <reference lib="webworker" />
import './worker-globals';
import { setLocale } from '../lib/i18n';
import { initPython, setPythonIndexURL } from '../lib/python';
import { bioApi, type BioRequest, type BioResponse } from './bio-api';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// The restriction engine is Bio.Restriction, which runs here and nowhere else:
// one interpreter for the whole app rather than one per thread. Starting it is
// the only asynchronous step, and it happens on the first request rather than at
// load, so a session that never touches an enzyme never pays for it.
let started: Promise<void> | null = null;
const ready = () => (started ??= initPython());

ctx.onmessage = async (e: MessageEvent<BioRequest | { pyodideURL: string }>) => {
  // The first message says where the interpreter is served from; see bio-client.
  if ('pyodideURL' in e.data) {
    setPythonIndexURL(e.data.pyodideURL);
    return;
  }
  const { id, fn, args, locale } = e.data;
  if (locale) setLocale(locale);
  let response: BioResponse;
  try {
    await ready();
    const impl = bioApi[fn] as (...a: unknown[]) => unknown;
    const result = await impl(...args);
    response = { id, ok: true, result };
  } catch (err) {
    response = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  ctx.postMessage(response);
};
