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
  /** The same two cuts before being wrapped into the sequence, for comparing them. */
  rawTop: number;
  rawBottom: number;
  overhang: string;
}

/** An enzyme as REBASE states it: cuts are offsets from the start of the site. */
export interface EnzymeDefinition {
  name: string;
  site: string;
  cutTop: number;
  cutBottom: number;
  /** The second pair of cuts of an enzyme that cleaves on both sides of its site. */
  second?: { top: number; bottom: number };
}

export interface RestrictionResult {
  sites: RestrictionHit[];
  /** Enzymes Bio.Restriction does not carry, built from the definition given. */
  built: string[];
}

interface Runtime {
  runPython: (code: string) => unknown;
  loadPackage: (names: string[]) => Promise<void>;
  globals: { get: (name: string) => unknown };
}

let runtime: Promise<Runtime> | null = null;

let configuredURL: string | null = null;

/**
 * Where the app serves Pyodide from. A worker's own location is the bundled script,
 * not the page, so a relative base would resolve against the wrong directory; the
 * thread that creates the worker resolves it and passes it in.
 */
export function setPythonIndexURL(url: string): void {
  configuredURL = url;
}

function indexURL(): string {
  if (configuredURL) return configuredURL;
  const base = import.meta.env?.BASE_URL ?? '/';
  return new URL(`${base}pyodide/`, globalThis.location?.href ?? 'http://localhost/').href;
}

async function start(): Promise<Runtime> {
  let loadPyodide: (options?: Record<string, unknown>) => Promise<Runtime>;
  if (typeof globalThis.location === 'undefined') {
    // Node, where the tests run: the npm package finds its own files. The name is
    // held in a variable so the bundler cannot follow it into the browser build,
    // where that copy of Pyodide reaches for node:fs.
    const nodePackage = 'pyodide';
    ({ loadPyodide } = (await import(/* @vite-ignore */ nodePackage)) as unknown as {
      loadPyodide: typeof loadPyodide;
    });
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
    const fn = py.globals.get(name) as ((...a: unknown[]) => unknown) | undefined;
    if (typeof fn !== 'function') throw new Error(`bio.py has no ${name}`);
    return fromPython<T>(fn(...args));
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

/**
 * Pyodide hands back a string or a number as itself and anything else as a proxy,
 * so only a proxy is converted; dicts come over as objects rather than Maps.
 */
function fromPython<T>(value: unknown): T {
  const proxy = value as { toJs?: (options: unknown) => T };
  return typeof proxy?.toJs === 'function'
    ? proxy.toJs({ dict_converter: Object.fromEntries })
    : (value as T);
}

function callSync<T>(name: string, args: unknown[]): T {
  const py = running();
  const fn = py.globals.get(name) as ((...a: unknown[]) => unknown) | undefined;
  if (typeof fn !== 'function') throw new Error(`bio.py has no ${name}`);
  return fromPython<T>(fn(...args));
}

/**
 * Cut sites from Bio.Restriction, synchronously. Names it does not know come back
 * in `unknown` rather than being guessed at.
 */
export function restrictionSitesSync(
  sequence: string,
  circular: boolean,
  enzymes: EnzymeDefinition[],
): RestrictionResult {
  return callSync('restriction_sites', [sequence.toUpperCase(), circular, enzymes]);
}

/** Cut sites found by Bio.Restriction, for callers that cannot wait for a start-up. */
export function restrictionSites(
  sequence: string,
  circular: boolean,
  enzymes: EnzymeDefinition[],
): Promise<RestrictionResult> {
  return call('restriction_sites', [sequence.toUpperCase(), circular, enzymes]);
}

export interface ProteinProperties {
  molecularWeight: number;
  isoelectricPoint: number;
  /** Standard residues the figures were computed from. */
  counted: number;
  length: number;
}

/** The protein a stretch of DNA codes for, by Biopython's genetic code tables. */
export function translateSync(sequence: string, table = 1, toStop = false): string {
  return callSync('translate', [sequence.toUpperCase(), table, toStop]);
}

/** The genetic code as a codon-to-residue map, for building a lookup from. */
export function codonTableSync(table = 1): Record<string, string> {
  return callSync('codon_table', [table]);
}

/** Molecular weight and isoelectric point, from Bio.SeqUtils. */
export function proteinPropertiesSync(sequence: string): ProteinProperties {
  return callSync('protein_properties', [sequence]);
}

/** The versions actually loaded, for the about box and for the tests. */
export function pythonVersions(): Promise<Record<string, string>> {
  return call('versions', []);
}
