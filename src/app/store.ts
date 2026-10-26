import { create } from 'zustand';
import { temporal } from 'zundo';
import type {
  CutSite,
  PlasmidDocument,
  SangerTraceData,
  SelectionRange,
} from '../types/schema';
import type { GelRunParams, GelSampleInput } from '../modules/alignment-gel';

export type ViewMode = 'split' | 'map' | 'sequence' | 'enzymes' | 'features' | 'gel' | 'sanger' | 'history';
export type Theme = 'light' | 'dark' | 'publication';
export type WizardKind = 'pcr' | 'restriction' | 'gibson' | 'golden_gate' | 'mutagenesis' | 'primers' | 'gateway';
export type NebBuffer = 'r1.1' | 'r2.1' | 'r3.1' | 'rCutSmart';

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
      setActive: (id) => set({ activeId: id, selection: null, highlight: null }),
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
      setWizard: (wizard) => set({ wizard }),
      notify: (toast) => set({ toast }),
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
