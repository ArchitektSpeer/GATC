// SPDX-License-Identifier: GPL-3.0-or-later
// Regressions for the glue/UI review of 2026-10-27 (docs/REVIEW-2026-10-27-glue-ui.md).
// Each test names the finding it covers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIToolAction, PlasmidDocument, SangerTraceData } from '../types/schema';
import { aiActionError, applyAIAction, newDocument, refreshCutSites } from './actions';
import { MemorySnapshotStore, buildSnapshot, type SnapshotStore } from './autosave';
import { bioApi } from './bio-api';
import { remapDocIds } from './doc-ids';
import { withNote } from './editors';
import { recordSave, saveFile } from './files';
import { fromUiRange, rangeError, rangeSequence } from '../lib/ranges';
import { recoverRecord, sortOutCleanExits } from './session';
import { selectActiveDoc, selectCutSites, selectDirtyIds, useWorkbench } from './store';

const st = () => useWorkbench.getState();
const current = (id: string) => st().docs.find((d) => d.id === id)!;

const trace: SangerTraceData = {
  id: 't',
  fileName: 'r.ab1',
  calledSequence: 'ACGT',
  qualityScores: [30, 30, 30, 30],
  baseLocations: [1, 2, 3, 4],
  trimRange: [0, 4],
  traces: { A: [1], T: [1], G: [1], C: [1] },
};

let doc: PlasmidDocument;

beforeEach(() => {
  useWorkbench.setState({
    docs: [],
    savedDocs: {},
    unsavedTraces: {},
    unconfirmedSaves: {},
    activeId: null,
    traces: {},
    traceAlignedTo: {},
    cutSites: {},
    enzymeSetId: 'commercial',
  });
  doc = newDocument('pFix', 'GAATTCAAAAGGATCCAAAAAAAAAAGAATTCAAAAGCGGCCGC', 'circular');
  st().openDocs([doc], true, { saved: true });
  useWorkbench.temporal.getState().clear();
});

afterEach(() => vi.unstubAllGlobals());

describe('#2 imported reads count as unsaved', () => {
  it('marks the document until it is saved', () => {
    expect(selectDirtyIds(st())).toEqual([]);
    st().addTraces(doc.id, [trace]);
    expect(selectDirtyIds(st())).toEqual([doc.id]);
    st().markSaved([doc.id]);
    expect(selectDirtyIds(st())).toEqual([]);
  });

  it('does not count recomputed alignments as a change', () => {
    st().setTraces(doc.id, [trace], 1);
    expect(selectDirtyIds(st())).toEqual([]);
  });
});

describe('#3 saves the browser cannot confirm', () => {
  function stubDownload() {
    const click = vi.fn();
    vi.stubGlobal('document', { createElement: () => ({ click }) });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
    return click;
  }

  it('reports a write through the save dialog as confirmed', async () => {
    const written: unknown[] = [];
    vi.stubGlobal('showSaveFilePicker', async () => ({
      createWritable: async () => ({ write: async (d: unknown) => void written.push(d), close: async () => {} }),
    }));
    expect(await saveFile('a.gatc', 'TEXT', 'application/json', '.gatc')).toBe('confirmed');
    expect(written).toEqual(['TEXT']);
  });

  it('reports a cancelled dialog as cancelled and leaves the document unsaved', async () => {
    vi.stubGlobal('showSaveFilePicker', async () => {
      throw new DOMException('cancel', 'AbortError');
    });
    const outcome = await saveFile('a.gatc', 'TEXT', 'application/json', '.gatc');
    expect(outcome).toBe('cancelled');
    st().replaceDoc({ ...doc, name: 'edited' });
    recordSave([doc.id], outcome, '');
    expect(selectDirtyIds(st())).toEqual([doc.id]);
  });

  it('treats a plain download as unconfirmed and remembers it', async () => {
    const click = stubDownload();
    const outcome = await saveFile('a.gatc', 'TEXT', 'application/json', '.gatc');
    expect(outcome).toBe('unconfirmed');
    expect(click).toHaveBeenCalled();
    st().replaceDoc({ ...doc, name: 'edited' });
    recordSave([doc.id], outcome, '');
    expect(selectDirtyIds(st())).toEqual([]);
    expect(st().unconfirmedSaves[doc.id]).toBe(true);
  });
});

describe('#3 a session that ended cleanly', () => {
  it('has its snapshot discarded on the next start, other snapshots are still offered', () => {
    const data = new Map<string, string>([['gatc.cleanExit.done', '1'], ['gatc.cleanExit.gone', '1'], ['gatc.other', 'x']]);
    const storage = {
      get length() {
        return data.size;
      },
      key: (i: number) => [...data.keys()][i] ?? null,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
    } as Storage;
    const rec = (sessionId: string) => ({ sessionId, savedAt: '', dirtyIds: ['d'], names: ['n'], project: '' });
    const { clean, orphans } = sortOutCleanExits([rec('done'), rec('crashed')], storage);
    expect(clean.map((r) => r.sessionId)).toEqual(['done']);
    expect(orphans.map((r) => r.sessionId)).toEqual(['crashed']);
    // Markers are consumed, and markers of sessions without a snapshot are dropped.
    expect([...data.keys()]).toEqual(['gatc.other']);
  });
});

describe('#4 recovering keeps the old snapshot until the new one is written', () => {
  function crashedRecord() {
    st().replaceDoc({ ...doc, name: 'crashed work' });
    const s = st();
    const record = buildSnapshot('crashed', { docs: s.docs, dirtyIds: [doc.id], traces: {}, activeId: doc.id });
    useWorkbench.setState({ docs: [], savedDocs: {}, activeId: null });
    return record;
  }

  it('keeps the record when the new snapshot fails', async () => {
    const record = crashedRecord();
    const store = new MemorySnapshotStore();
    await store.write(record);
    expect(await recoverRecord(record, store, async () => false)).toBe('kept');
    expect(store.records.has('crashed')).toBe(true);
    expect(current(doc.id).name).toBe('crashed work');
  });

  it('retires the record once the new snapshot is written', async () => {
    const record = crashedRecord();
    const store: SnapshotStore = new MemorySnapshotStore();
    await store.write(record);
    expect(await recoverRecord(record, store, async () => true)).toBe('retired');
    expect(await store.orphans('other')).toEqual([]);
  });
});

describe('#6 #18 UI ranges across the origin', () => {
  const circ = { length: 1000, topology: 'circular' as const };
  const lin = { length: 1000, topology: 'linear' as const };

  it('keeps a range across the origin instead of collapsing it to an insertion', () => {
    expect(fromUiRange(circ, 901, 100)).toEqual({ start: 900, end: 100 });
    expect(fromUiRange(lin, 901, 100)).toHaveProperty('error');
  });

  it('reads end = start − 1 as an empty range', () => {
    expect(fromUiRange(circ, 11, 10)).toEqual({ start: 10, end: 10 });
    expect(fromUiRange(lin, 1, 0)).toEqual({ start: 0, end: 0 });
  });

  it('previews the bases of a range across the origin', () => {
    expect(rangeSequence({ sequence: 'ABCDEFGH' }, { start: 6, end: 2 })).toBe('GHAB');
  });

  it('rejects coordinates outside the molecule', () => {
    expect(fromUiRange(circ, 0, 10)).toHaveProperty('error');
    expect(fromUiRange(circ, 5, 1001)).toHaveProperty('error');
    expect(rangeError(lin, 5, 2)).toMatch(/线性/);
    expect(rangeError(circ, 1.5, 2)).toMatch(/整数/);
  });
});

describe('#10 #12 AI actions', () => {
  const highlight = (start: number, end: number): AIToolAction => ({ type: 'HIGHLIGHT_RANGE', payload: { start, end, reason: 'x' } });

  it('refuses an action meant for another document', async () => {
    await applyAIAction(highlight(0, 5), 'some-other-doc');
    expect(st().highlight).toBeNull();
  });

  it('refuses coordinates that do not fit the document', async () => {
    expect(aiActionError(highlight(0, doc.length + 1), doc)).toMatch(/超出/);
    const features: AIToolAction = {
      type: 'ADD_FEATURES',
      payload: { features: [{ name: 'f', type: 'CDS', start: 10, end: 5000, strand: 1, color: '#000' }] },
    };
    await applyAIAction(features, doc.id);
    expect(current(doc.id).features).toEqual([]);
  });

  it('accepts a range across the origin of a circular document', () => {
    expect(aiActionError(highlight(40, 5), doc)).toBeNull();
  });

  it('designs a deletion when mutationSeq is empty', async () => {
    const action: AIToolAction = { type: 'DESIGN_PRIMERS', payload: { targetStart: 20, targetEnd: 23, cloningMethod: 'mutagenesis', mutationSeq: '' } };
    expect(aiActionError(action, doc)).toBeNull();
    await applyAIAction(action, doc.id);
    expect(current(doc.id).history.at(-1)?.description).toBe('AI 定点突变引物');
  });
});

describe('#13 cut sites belong to an enzyme set', () => {
  it('are not served after switching the enzyme set', async () => {
    await refreshCutSites(doc);
    expect(selectCutSites(st(), doc).length).toBeGreaterThan(0);
    st().setEnzymeSet('some-other-set');
    expect(selectCutSites(st(), doc)).toEqual([]);
  });
});

describe('#15 renamed project documents', () => {
  it('rewrite history parents that point at a renamed document', () => {
    const parent = newDocument('parent', 'ACGT', 'linear');
    const child: PlasmidDocument = {
      ...newDocument('child', 'ACGTACGT', 'linear'),
      history: [{ id: 'h', operation: 'pcr', timestamp: '', description: 'PCR', parentSnapshots: [{ id: parent.id, name: 'parent', length: 4 }, { id: 'elsewhere', name: 'x', length: 1 }] }],
    };
    const { docs, idMap } = remapDocIds([parent, child], (id) => id === parent.id, (d) => `${d.id}-copy`);
    expect(docs[0].id).toBe(`${parent.id}-copy`);
    expect(docs[1].id).toBe(child.id);
    expect(docs[1].history[0].parentSnapshots!.map((p) => p.id)).toEqual([`${parent.id}-copy`, 'elsewhere']);
    expect(idMap.get(parent.id)).toBe(`${parent.id}-copy`);
  });
});

describe('#16 undoing the opening of the active document', () => {
  it('moves the active document to one that is still open', () => {
    const second = newDocument('second', 'ACGT', 'linear');
    st().openDocs([second]);
    expect(st().activeId).toBe(second.id);
    useWorkbench.temporal.getState().undo();
    expect(st().docs.map((d) => d.id)).toEqual([doc.id]);
    expect(selectActiveDoc(st())?.id).toBe(doc.id);
  });
});

describe('#20 feature notes', () => {
  it('can be cleared without losing other qualifiers', () => {
    expect(withNote({ note: ['old'], gene: ['lacZ'] }, '')).toEqual({ gene: ['lacZ'] });
    expect(withNote({ note: ['old'] }, '')).toBeUndefined();
    expect(withNote(undefined, 'new')).toEqual({ note: ['new'] });
  });
});

describe('#22 FASTQ import', () => {
  it('keeps only the first reads but reports the total', () => {
    const record = (i: number) => `@r${i}\nACGTACGTACGT\n+\nIIIIIIIIIIII\n`;
    const text = Array.from({ length: 30 }, (_, i) => record(i)).join('');
    const { traces, total } = bioApi.fastqToTraces(text, 5);
    expect(total).toBe(30);
    expect(traces).toHaveLength(5);
  });
});
