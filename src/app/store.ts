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

export type ViewMode = 'split' | 'map' | 'sequence' | 'enzymes' | 'features' | 'gel' | 'sanger' | 'align' | 'history';
export type Theme = 'light' | 'dark' | 'publication';
export type WizardKind = 'pcr' | 'restriction' | 'gibson' | 'golden_gate' | 'mutagenesis' | 'primers' | 'gateway' | 'ta_topo' | 'lic' | 'recombinase' | 'insert';
export type NebBuffer = 'r1.1' | 'r2.1' | 'r3.1' | 'rCutSmart';
export type ToolDialog = 'find' | 'backtranslate' | 'ncbi' | 'primerlib' | null;
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
  activeId: string | null;
  selection: SelectionRange | null;
  highlight: Highlight | null;
  traces: Record<string, SangerTraceData[]>;
  cutSites: Record<string, CutSite[]>;
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

  openDocs: (docs: PlasmidDocument[], activate?: boolean) => void;
  closeDoc: (id: string) => void;
  setActive: (id: string) => void;
  replaceDoc: (doc: PlasmidDocument) => void;
  setSelection: (sel: SelectionRange | null) => void;
  setHighlight: (h: Highlight | null) => void;
  setTraces: (docId: string, traces: SangerTraceData[]) => void;
  setCutSites: (docId: string, sites: CutSite[]) => void;
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
      activeId: null,
      selection: null,
      highlight: null,
      traces: {},
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

      openDocs: (docs, activate = true) =>
        set((s) => ({
          docs: [...s.docs, ...docs.filter((d) => !s.docs.some((x) => x.id === d.id))],
          activeId: activate && docs.length ? docs[0].id : s.activeId ?? docs[0]?.id ?? null,
          selection: activate ? null : s.selection,
        })),
      closeDoc: (id) =>
        set((s) => {
          const docs = s.docs.filter((d) => d.id !== id);
          return { docs, activeId: s.activeId === id ? docs[0]?.id ?? null : s.activeId };
        }),
      setActive: (id) => set({ activeId: id, activeProteinId: null, selection: null, highlight: null }),
      replaceDoc: (doc) =>
        set((s) => ({ docs: s.docs.map((d) => (d.id === doc.id ? doc : d)) })),
      setSelection: (selection) => set({ selection }),
      setHighlight: (highlight) => set({ highlight }),
      setTraces: (docId, traces) => set((s) => ({ traces: { ...s.traces, [docId]: traces } })),
      setCutSites: (docId, sites) => set((s) => ({ cutSites: { ...s.cutSites, [docId]: sites } })),
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
      limit: 500,
    },
  ),
);

export const useTemporal = () => useWorkbench.temporal.getState();

export function selectActiveDoc(s: WorkbenchState): PlasmidDocument | null {
  return s.docs.find((d) => d.id === s.activeId) ?? null;
}
