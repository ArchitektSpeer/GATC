// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Runs Biopython in the page. The interpreter and the wheels are served by the app
// itself (public/pyodide, put there by scripts/vendor-pyodide.mjs), so this needs no
// network and works offline; it is loaded on first use rather than at start-up,
// because it is tens of megabytes and most sessions never ask for it.
//
// Everything callable lives in bio.py. This file only moves arguments across and
// hands the answers back as plain data.
import source from './bio.py?raw';

export interface RestrictionHit {
  enzyme: string;
  site: string;
  /** 0-based start of the recognition site, or null when it could not be placed. */
  position: number | null;
  /** Which strand the recognition site reads on. */
  strand: 1 | -1;
  /** 0-based cut on the top strand. */
  cutTop: number;
  /** 0-based cut on the bottom strand. */
  cutBottom: number;
  /** Negative for a 5' overhang, positive for a 3' one, 0 for a blunt cut. */
  ovhg: number;
  overhang: string;
}

export interface RestrictionResult {
  sites: RestrictionHit[];
  /** Names Bio.Restriction does not know; the caller decides what to do about them. */
  unknown: string[];
}

interface Runtime {
  runPython: (code: string) => unknown;
  loadPackage: (names: string[]) => Promise<void>;
  globals: { get: (name: string) => unknown };
}

let runtime: Promise<Runtime> | null = null;

/** Where the app serves Pyodide from, honouring a non-root base path. */
function indexURL(): string {
  const base = import.meta.env?.BASE_URL ?? '/';
  return new URL(`${base.replace(/\/$/, '')}/pyodide/`, globalThis.location?.href ?? 'http://localhost/').href;
}

async function start(): Promise<Runtime> {
  let loadPyodide: (options?: Record<string, unknown>) => Promise<Runtime>;
  if (typeof globalThis.location === 'undefined') {
    // Node, where the tests run: the npm package finds its own files.
    ({ loadPyodide } = (await import('pyodide')) as unknown as { loadPyodide: typeof loadPyodide });
  } else {
    const url = `${indexURL()}pyodide.mjs`;
    ({ loadPyodide } = (await import(/* @vite-ignore */ url)) as { loadPyodide: typeof loadPyodide });
  }
  const py = await loadPyodide(typeof globalThis.location === 'undefined' ? {} : { indexURL: indexURL() });
  await py.loadPackage(['biopython']);
  py.runPython(source);
  ready = py;
  return py;
}

/**
 * Start the interpreter. Loading is asynchronous and costs tens of megabytes, so
 * it happens once, explicitly, before anything that needs it; after that every
 * call into Python is an ordinary synchronous call.
 */
export function initPython(): Promise<void> {
  return python().then(() => undefined);
}

/** Start the interpreter, or hand back the one already running. */
export function python(): Promise<Runtime> {
  runtime ??= start().catch((error) => {
    runtime = null;
    throw error;
  });
  return runtime;
}

/** Whether the interpreter has already been started, for code that must not wait. */
export function pythonReady(): boolean {
  return runtime !== null;
}

function call<T>(name: string, args: unknown[]): Promise<T> {
  return python().then((py) => {
    const fn = py.globals.get(name) as ((...a: unknown[]) => { toJs: (o: unknown) => unknown }) | undefined;
    if (typeof fn !== 'function') throw new Error(`bio.py has no ${name}`);
    const result = fn(...args);
    // Python dicts come back as Maps unless asked for objects.
    return (result as { toJs: (o: unknown) => T }).toJs({ dict_converter: Object.fromEntries }) as T;
  });
}

let ready: Runtime | null = null;

/** The running interpreter, or an error saying it was never started. */
function running(): Runtime {
  if (!ready) {
    throw new Error('Python has not been started; call initPython() before using it');
  }
  return ready;
}

function callSync<T>(name: string, args: unknown[]): T {
  const py = running();
  const fn = py.globals.get(name) as ((...a: unknown[]) => { toJs: (o: unknown) => T }) | undefined;
  if (typeof fn !== 'function') throw new Error(`bio.py has no ${name}`);
  return fn(...args).toJs({ dict_converter: Object.fromEntries });
}

/**
 * Cut sites from Bio.Restriction, synchronously. Names it does not know come back
 * in `unknown` rather than being guessed at.
 */
export function restrictionSitesSync(
  sequence: string,
  circular: boolean,
  names: string[],
): RestrictionResult {
  return callSync('restriction_sites', [sequence.toUpperCase(), circular, names]);
}

/** Cut sites found by Bio.Restriction. Names it does not know are reported, not guessed. */
export function restrictionSites(
  sequence: string,
  circular: boolean,
  names: string[],
): Promise<RestrictionResult> {
  return call('restriction_sites', [sequence.toUpperCase(), circular, names]);
}

/** The versions actually loaded, for the about box and for the tests. */
export function pythonVersions(): Promise<Record<string, string>> {
  return call('versions', []);
}
