// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { create } from 'zustand';
import { temporal } from 'zundo';
import type {
  CutSite,
  PlasmidDocument,
  SangerTraceData,
  SelectionRange,
} from '../types/schema';
import type { GelRunParams, GelSampleInput } from '../modules/alignment-gel';
import type { EnzymeSet } from '../modules/seq-engine';
import type { ProteinDocument } from '../modules/io-adapter';
import type { MapDisplayOptions } from '../modules/canvas-ui';
import { docRevision } from './revision';

export type ViewMode = 'split' | 'map' | 'sequence' | 'enzymes' | 'features' | 'gel' | 'sanger' | 'align' | 'history';
export type Theme = 'light' | 'dark' | 'publication';
export type WizardKind = 'pcr' | 'restriction' | 'gibson' | 'golden_gate' | 'mutagenesis' | 'primers' | 'gateway' | 'ta_topo' | 'lic' | 'recombinase' | 'insert';
export type NebBuffer = 'r1.1' | 'r2.1' | 'r3.1' | 'rCutSmart';
export type ToolDialog = 'find' | 'backtranslate' | 'ncbi' | 'primerlib' | 'vectors' | null;
export type MapShape = 'auto' | 'circular' | 'linear';

/** A reusable oligo kept across sessions, independent of any sequence. */
export interface LibraryPrimer {
  id: string;
  name: string;
  sequence: string;
  note?: string;
}

/** Values a wizard tab reads once on mount, e.g. when replaying a history step. */
export interface WizardPreset {
  enzymes?: string[];
  docIds?: string[];
  primerNames?: string[];
}

/** Enzyme set ids: a preset from ENZYME_SETS, a custom set, or every commercial enzyme. */
export const ALL_COMMERCIAL_SET = 'commercial';
const CUSTOM_SETS_KEY = 'gatc.enzymeSets';
const PRIMER_LIBRARY_KEY = 'gatc.primerLibrary';
const MAP_OPTIONS_KEY = 'gatc.mapOptions';
const SETTINGS_KEY = 'gatc.settings';

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function storeJson(key: string, value: unknown) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode); the value then lasts for the session.
  }
}

/** User preferences for saving and undo, kept in localStorage. */
export interface WorkbenchSettings {
  /** Quiet period after the last change before the recovery snapshot is written. */
  autosaveDelayMs: number;
  /** Undo steps kept; applied on the next start. */
  undoLimit: number;
}

export const DEFAULT_SETTINGS: WorkbenchSettings = { autosaveDelayMs: 3000, undoLimit: 500 };

export function loadSettings(): WorkbenchSettings {
  const raw = loadJson<Partial<WorkbenchSettings>>(SETTINGS_KEY, {});
  const int = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
  return {
    autosaveDelayMs: int(raw.autosaveDelayMs, 500, 60_000, DEFAULT_SETTINGS.autosaveDelayMs),
    undoLimit: int(raw.undoLimit, 10, 5000, DEFAULT_SETTINGS.undoLimit),
  };
}

export type AutosaveStatus =
  | { state: 'idle' }
  | { state: 'saved'; at: string }
  | { state: 'error'; error: string };

const loadCustomSets = () => loadJson<EnzymeSet[]>(CUSTOM_SETS_KEY, []);
const storeCustomSets = (sets: EnzymeSet[]) => storeJson(CUSTOM_SETS_KEY, sets);

export const DEFAULT_MAP_OPTIONS: MapDisplayOptions = {
  showFeatures: true,
  showEnzymes: true,
  showPrimers: true,
  showOrfs: false,
  showFeatureLabels: true,
  showEnzymeLabels: true,
  labelFontSize: 11,
  showTicks: true,
  tickInterval: 'auto',
  showGcPlot: false,
  showLinearEnds: true,
  showLength: true,
  hiddenFeatureTypes: [],
};

export interface EnzymeFilter {
  uniqueOnly: boolean;
  excludeMethylationBlocked: boolean;
  buffer: NebBuffer | null;
  query: string;
}

export interface Highlight {
  start: number;
  end: number;
  reason: string;
}

export interface WorkbenchState {
  docs: PlasmidDocument[];
  /**
   * The version of each document last written to or read from a file. A document
   * has unsaved changes when its current version is a different object.
   */
  savedDocs: Record<string, PlasmidDocument>;
  /** Documents whose sequencing reads changed since they were last saved. */
  unsavedTraces: Record<string, true>;
  /**
   * Documents last saved through a browser download, which cannot confirm the file
   * was written. Their recovery snapshot is kept until the session ends normally.
   */
  unconfirmedSaves: Record<string, true>;
  activeId: string | null;
  selection: SelectionRange | null;
  highlight: Highlight | null;
  traces: Record<string, SangerTraceData[]>;
  /** Revision of each document that its trace alignments were computed against. */
  traceAlignedTo: Record<string, number>;
  /** Cut sites per document, tagged with the revision and enzyme set they were computed for. */
  cutSites: Record<string, { revision: number; enzymeKey: string; sites: CutSite[] }>;
  gelSamples: GelSampleInput[];
  gelParams: Required<GelRunParams>;
  gelMode: 'uv' | 'publication';
  view: ViewMode;
  theme: Theme;
  enzymeFilter: EnzymeFilter;
  copilotOpen: boolean;
  paletteOpen: boolean;
  wizard: WizardKind | null;
  toast: string | null;
  tool: ToolDialog;
  enzymeSetId: string;
  customEnzymeSets: EnzymeSet[];
  proteins: ProteinDocument[];
  /** When set, the main area shows this protein instead of the active DNA document. */
  activeProteinId: string | null;
  mapOptions: MapDisplayOptions;
  mapShape: MapShape;
  wizardPreset: WizardPreset | null;
  primerLibrary: LibraryPrimer[];
  /** Demo mode: current step index and whether it auto-advances. */
  demo: { step: number; playing: boolean } | null;
  /** Asks the alignment view to align these documents (nonce re-triggers the same set). */
  alignRequest: { ids: string[]; nonce: number } | null;
  settings: WorkbenchSettings;
  autosave: AutosaveStatus;
  /** Asks the user what to do with unsaved changes before closing a tab or the window. */
  closePrompt: { kind: 'doc'; id: string } | { kind: 'window' } | null;

  /** `saved`: the documents come from a file as-is (no unsaved changes). */
  openDocs: (docs: PlasmidDocument[], activate?: boolean, opts?: { saved?: boolean }) => void;
  /** Record the current versions of these documents (default: all) as saved. */
  markSaved: (ids?: string[], opts?: { confirmed?: boolean }) => void;
  setSettings: (s: Partial<WorkbenchSettings>) => void;
  setAutosave: (s: AutosaveStatus) => void;
  setClosePrompt: (p: WorkbenchState['closePrompt']) => void;
  closeDoc: (id: string) => void;
  setActive: (id: string) => void;
  replaceDoc: (doc: PlasmidDocument) => void;
  setSelection: (sel: SelectionRange | null) => void;
  setHighlight: (h: Highlight | null) => void;
  /** Pass `alignedTo` (a document revision) when the traces carry alignments to that revision. */
  setTraces: (docId: string, traces: SangerTraceData[], alignedTo?: number) => void;
  /** Attach newly imported reads to a document; they count as unsaved until saved. */
  addTraces: (docId: string, traces: SangerTraceData[]) => void;
  setCutSites: (doc: PlasmidDocument, enzymeKey: string, sites: CutSite[]) => void;
  setGelSamples: (samples: GelSampleInput[]) => void;
  addGelSample: (sample: GelSampleInput) => void;
  setGelParams: (p: Partial<GelRunParams>) => void;
  setGelMode: (m: 'uv' | 'publication') => void;
  setView: (v: ViewMode) => void;
  setTheme: (t: Theme) => void;
  setEnzymeFilter: (f: Partial<EnzymeFilter>) => void;
  setCopilotOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setWizard: (w: WizardKind | null) => void;
  notify: (msg: string | null) => void;
  setTool: (t: ToolDialog) => void;
  setEnzymeSet: (id: string) => void;
  saveCustomEnzymeSet: (set: EnzymeSet) => void;
  deleteCustomEnzymeSet: (id: string) => void;
  openProteins: (proteins: ProteinDocument[]) => void;
  closeProtein: (id: string) => void;
  setActiveProtein: (id: string | null) => void;
  setMapOptions: (o: Partial<MapDisplayOptions>) => void;
  setMapShape: (shape: MapShape) => void;
  openWizard: (w: WizardKind, preset?: WizardPreset) => void;
  setPrimerLibrary: (primers: LibraryPrimer[]) => void;
  setDemo: (demo: { step: number; playing: boolean } | null) => void;
  requestAlign: (ids: string[]) => void;
}

export const useWorkbench = create<WorkbenchState>()(
  temporal(
    (set) => ({
      docs: [],
      savedDocs: {},
      unsavedTraces: {},
      unconfirmedSaves: {},
      activeId: null,
      selection: null,
      highlight: null,
      traces: {},
      traceAlignedTo: {},
      cutSites: {},
      gelSamples: [],
      // voltage is in volts as shown in the UI; see GEL_BOX_CM in App.tsx.
      gelParams: { agarosePercent: 1, voltage: 100, minutes: 45 },
      gelMode: 'uv',
      view: 'split',
      theme: 'light',
      enzymeFilter: { uniqueOnly: false, excludeMethylationBlocked: false, buffer: null, query: '' },
      copilotOpen: false,
      paletteOpen: false,
      wizard: null,
      toast: null,
      tool: null,
      enzymeSetId: ALL_COMMERCIAL_SET,
      customEnzymeSets: loadCustomSets(),
      proteins: [],
      activeProteinId: null,
      mapOptions: { ...DEFAULT_MAP_OPTIONS, ...loadJson<MapDisplayOptions>(MAP_OPTIONS_KEY, {}) },
      mapShape: 'auto',
      wizardPreset: null,
      primerLibrary: loadJson<LibraryPrimer[]>(PRIMER_LIBRARY_KEY, []),
      demo: null,
      alignRequest: null,
      settings: loadSettings(),
      autosave: { state: 'idle' },
      closePrompt: null,

      openDocs: (docs, activate = true, opts) =>
        set((s) => {
          const added = docs.filter((d) => !s.docs.some((x) => x.id === d.id));
          const savedDocs = opts?.saved ? { ...s.savedDocs, ...Object.fromEntries(added.map((d) => [d.id, d])) } : s.savedDocs;
          return {
            docs: [...s.docs, ...added],
            savedDocs,
            activeId: activate && docs.length ? docs[0].id : s.activeId ?? docs[0]?.id ?? null,
            selection: activate ? null : s.selection,
          };
        }),
      markSaved: (ids, opts) =>
        set((s) => {
          const savedDocs = { ...s.savedDocs };
          const unsavedTraces = { ...s.unsavedTraces };
          const unconfirmedSaves = { ...s.unconfirmedSaves };
          for (const d of s.docs) {
            if (ids && !ids.includes(d.id)) continue;
            savedDocs[d.id] = d;
            delete unsavedTraces[d.id];
            if (opts?.confirmed === false) unconfirmedSaves[d.id] = true;
            else delete unconfirmedSaves[d.id];
          }
          return { savedDocs, unsavedTraces, unconfirmedSaves };
        }),
      setSettings: (o) =>
        set((s) => {
          const settings = { ...s.settings, ...o };
          storeJson(SETTINGS_KEY, settings);
          return { settings };
        }),
      setAutosave: (autosave) => set({ autosave }),
      setClosePrompt: (closePrompt) => set({ closePrompt }),
      closeDoc: (id) =>
        set((s) => {
          const docs = s.docs.filter((d) => d.id !== id);
          const { [id]: _closed, ...savedDocs } = s.savedDocs;
          const { [id]: _t, ...unsavedTraces } = s.unsavedTraces;
          const { [id]: _u, ...unconfirmedSaves } = s.unconfirmedSaves;
          return { docs, savedDocs, unsavedTraces, unconfirmedSaves, activeId: s.activeId === id ? docs[0]?.id ?? null : s.activeId };
        }),
      setActive: (id) => set({ activeId: id, activeProteinId: null, selection: null, highlight: null }),
      replaceDoc: (doc) => {
        // `length` must always equal the sequence length; derived data depends on it.
        const next = doc.length === doc.sequence.length ? doc : { ...doc, length: doc.sequence.length };
        set((s) => ({ docs: s.docs.map((d) => (d.id === next.id ? next : d)) }));
      },
      setSelection: (selection) => set({ selection }),
      setHighlight: (highlight) => set({ highlight }),
      setTraces: (docId, traces, alignedTo) =>
        set((s) => ({
          traces: { ...s.traces, [docId]: traces },
          traceAlignedTo: alignedTo === undefined ? s.traceAlignedTo : { ...s.traceAlignedTo, [docId]: alignedTo },
        })),
      addTraces: (docId, traces) =>
        set((s) => ({
          traces: { ...s.traces, [docId]: [...(s.traces[docId] ?? []), ...traces] },
          unsavedTraces: { ...s.unsavedTraces, [docId]: true },
        })),
      setCutSites: (doc, enzymeKey, sites) =>
        set((s) => ({ cutSites: { ...s.cutSites, [doc.id]: { revision: docRevision(doc), enzymeKey, sites } } })),
      setGelSamples: (gelSamples) => set({ gelSamples }),
      addGelSample: (sample) => set((s) => ({ gelSamples: [...s.gelSamples, sample] })),
      setGelParams: (p) => set((s) => ({ gelParams: { ...s.gelParams, ...p } })),
      setGelMode: (gelMode) => set({ gelMode }),
      setView: (view) => set({ view }),
      setTheme: (theme) => set({ theme }),
      setEnzymeFilter: (f) => set((s) => ({ enzymeFilter: { ...s.enzymeFilter, ...f } })),
      setCopilotOpen: (copilotOpen) => set({ copilotOpen }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setWizard: (wizard) => set({ wizard, wizardPreset: null }),
      notify: (toast) => set({ toast }),
      setTool: (tool) => set({ tool }),
      setEnzymeSet: (enzymeSetId) => set({ enzymeSetId }),
      saveCustomEnzymeSet: (es) =>
        set((s) => {
          const customEnzymeSets = [...s.customEnzymeSets.filter((x) => x.id !== es.id), es];
          storeCustomSets(customEnzymeSets);
          return { customEnzymeSets, enzymeSetId: es.id };
        }),
      openProteins: (proteins) =>
        set((s) => ({
          proteins: [...s.proteins, ...proteins.filter((p) => !s.proteins.some((x) => x.id === p.id))],
          activeProteinId: proteins[0]?.id ?? s.activeProteinId,
        })),
      closeProtein: (id) =>
        set((s) => ({ proteins: s.proteins.filter((p) => p.id !== id), activeProteinId: s.activeProteinId === id ? null : s.activeProteinId })),
      setActiveProtein: (activeProteinId) => set({ activeProteinId }),
      setMapOptions: (o) =>
        set((s) => {
          const mapOptions = { ...s.mapOptions, ...o };
          storeJson(MAP_OPTIONS_KEY, mapOptions);
          return { mapOptions };
        }),
      setMapShape: (mapShape) => set({ mapShape }),
      setDemo: (demo) => set({ demo }),
      requestAlign: (ids) => set((s) => ({ alignRequest: { ids, nonce: (s.alignRequest?.nonce ?? 0) + 1 } })),
      openWizard: (wizard, preset) => set({ wizard, wizardPreset: preset ?? null }),
      setPrimerLibrary: (primerLibrary) => {
        storeJson(PRIMER_LIBRARY_KEY, primerLibrary);
        set({ primerLibrary });
      },
      deleteCustomEnzymeSet: (id) =>
        set((s) => {
          const customEnzymeSets = s.customEnzymeSets.filter((x) => x.id !== id);
          storeCustomSets(customEnzymeSets);
          return { customEnzymeSets, enzymeSetId: s.enzymeSetId === id ? ALL_COMMERCIAL_SET : s.enzymeSetId };
        }),
    }),
    {
      // Only sequence documents participate in undo/redo time travel.
      partialize: (s) => ({ docs: s.docs }),
      equality: (a, b) => a.docs === b.docs,
      limit: loadSettings().undoLimit,
    },
  ),
);

/** Ids of open documents with changes not yet written to a file. */
type SaveState = Pick<WorkbenchState, 'docs' | 'savedDocs' | 'unsavedTraces'>;

/** Ids of open documents with changes (to the document or its reads) not yet written to a file. */
export function selectDirtyIds(s: SaveState): string[] {
  return s.docs.filter((d) => isDirty(s, d)).map((d) => d.id);
}

export function isDirty(s: Pick<WorkbenchState, 'savedDocs' | 'unsavedTraces'>, doc: PlasmidDocument): boolean {
  return s.savedDocs[doc.id] !== doc || !!s.unsavedTraces[doc.id];
}

// Undo/redo can remove the active document (e.g. undoing its opening); fall back to one still open.
useWorkbench.subscribe((s, prev) => {
  if (s.docs === prev.docs || !s.activeId || s.docs.some((d) => d.id === s.activeId)) return;
  useWorkbench.setState({ activeId: s.docs[0]?.id ?? null, selection: null, highlight: null });
});

export const useTemporal = () => useWorkbench.temporal.getState();

export function selectActiveDoc(s: WorkbenchState): PlasmidDocument | null {
  return s.docs.find((d) => d.id === s.activeId) ?? null;
}

const NO_SITES: CutSite[] = [];

/** Identifies the enzyme set selection; cut sites computed for another set are stale. */
export function enzymeSetKey(s: Pick<WorkbenchState, 'enzymeSetId' | 'customEnzymeSets'>): string {
  const custom = s.customEnzymeSets.find((x) => x.id === s.enzymeSetId);
  return custom ? `${s.enzymeSetId}:${custom.enzymeNames.join(',')}` : s.enzymeSetId;
}

/** Cut sites of `doc`, or none while sites for this exact revision and enzyme set are still being computed. */
export function selectCutSites(s: WorkbenchState, doc: PlasmidDocument | null): CutSite[] {
  const entry = doc && s.cutSites[doc.id];
  return entry && entry.revision === docRevision(doc) && entry.enzymeKey === enzymeSetKey(s) ? entry.sites : NO_SITES;
}

/** True when the trace alignments stored for `doc` were computed against its current revision. */
export function tracesAlignedToCurrent(s: WorkbenchState, doc: PlasmidDocument): boolean {
  return s.traceAlignedTo[doc.id] === docRevision(doc);
}

/** True when the document `docId` still exists at `revision`; results for older revisions are stale. */
export function isDocCurrent(docId: string, revision: number): boolean {
  const current = useWorkbench.getState().docs.find((d) => d.id === docId);
  return !!current && docRevision(current) === revision;
}
