// SPDX-License-Identifier: GPL-3.0-or-later
// Document revisions and derived-data invalidation (design.md appendix A3/A6).
import { beforeEach, describe, expect, it } from 'vitest';
import type { PlasmidDocument } from '../types/schema';
import { callBioForDoc } from './bio-client';
import { newDocument, refreshCutSites, updateDoc } from './actions';
import { docRevision } from './revision';
import { isDocCurrent, selectCutSites, tracesAlignedToCurrent, useWorkbench } from './store';

const st = () => useWorkbench.getState();
const current = (id: string) => st().docs.find((d) => d.id === id)!;

let doc: PlasmidDocument;

beforeEach(() => {
  useWorkbench.setState({ docs: [], activeId: null, cutSites: {}, traces: {}, traceAlignedTo: {} });
  doc = newDocument('pRev', 'GAATTCAAAAGGATCCAAAAAAAAAAGAATTCAAAA', 'circular');
  st().openDocs([doc]);
  useWorkbench.temporal.getState().clear();
});

const edited = (d: PlasmidDocument, sequence: string): PlasmidDocument => ({ ...d, sequence, length: sequence.length });

describe('document revisions', () => {
  it('increase with every edit and stay fixed for one version', () => {
    const r1 = docRevision(doc);
    expect(docRevision(doc)).toBe(r1);
    st().replaceDoc(edited(doc, doc.sequence + 'A'));
    expect(docRevision(current(doc.id))).toBeGreaterThan(r1);
    expect(isDocCurrent(doc.id, r1)).toBe(false);
  });

  it('keeps length equal to the sequence length', () => {
    st().replaceDoc({ ...doc, sequence: 'ACGT' });
    expect(current(doc.id).length).toBe(4);
  });
});

describe('derived data invalidation', () => {
  it('does not return cut sites of an earlier revision right after an edit', async () => {
    const sites = await refreshCutSites(doc);
    expect(sites?.length).toBeGreaterThan(0);
    expect(selectCutSites(st(), current(doc.id))).toBe(sites);
    st().replaceDoc(edited(doc, 'AAAAAAAAAAAAAAAAAAAA'));
    expect(selectCutSites(st(), current(doc.id))).toEqual([]);
  });

  it('discards a slow task when the document is edited before it returns', async () => {
    const pending = callBioForDoc(doc, 'findCutSites', doc, []);
    st().replaceDoc(edited(doc, 'CCCC'));
    expect(await pending).toBeNull();

    const slow = refreshCutSites(doc);
    const newer = current(doc.id);
    expect(await slow).toBeNull();
    expect(st().cutSites[doc.id]).toBeUndefined();
    await refreshCutSites(newer);
    expect(st().cutSites[doc.id].revision).toBe(docRevision(newer));
  });

  it('keeps only the newest cut-site request when two overlap', async () => {
    const first = refreshCutSites(doc);
    const second = refreshCutSites(doc);
    expect(await first).toBeNull();
    expect(await second).not.toBeNull();
    expect(selectCutSites(st(), doc).length).toBeGreaterThan(0);
  });

  it('marks trace alignments stale once the reference changes', () => {
    st().setTraces(doc.id, [], docRevision(doc));
    expect(tracesAlignedToCurrent(st(), doc)).toBe(true);
    st().replaceDoc(edited(doc, 'ACGT'));
    expect(tracesAlignedToCurrent(st(), current(doc.id))).toBe(false);
  });
});

describe('updateDoc', () => {
  it('applies overlapping async edits in order without losing either', async () => {
    const append = (base: string) => (d: PlasmidDocument) =>
      new Promise<PlasmidDocument>((resolve) => setTimeout(() => resolve(edited(d, d.sequence + base)), base === 'G' ? 20 : 1));
    const a = updateDoc(doc.id, append('G'));
    const b = updateDoc(doc.id, append('T'));
    await Promise.all([a, b]);
    expect(current(doc.id).sequence).toBe(doc.sequence + 'GT');
  });

  it('recomputes from the newer version when the document changes mid-task', async () => {
    let calls = 0;
    const pending = updateDoc(doc.id, async (d) => {
      calls++;
      if (calls === 1) st().replaceDoc(edited(d, d.sequence + 'C')); // an edit from elsewhere
      return edited(d, d.sequence + 'G');
    });
    await pending;
    expect(calls).toBe(2);
    expect(current(doc.id).sequence).toBe(doc.sequence + 'CG');
  });

  it('does nothing for a closed document', async () => {
    st().closeDoc(doc.id);
    expect(await updateDoc(doc.id, (d) => d)).toBeNull();
  });
});

describe('undo and redo with derived data', () => {
  it('keep revision and cut-site validity consistent', async () => {
    const sites = await refreshCutSites(doc);
    st().replaceDoc(edited(doc, 'TTTTTTTTTT'));
    const editedDoc = current(doc.id);
    await refreshCutSites(editedDoc);

    useWorkbench.temporal.getState().undo();
    expect(current(doc.id)).toBe(doc);
    // The cache holds the edited revision, so it is not served for the restored one.
    expect(selectCutSites(st(), doc)).toEqual([]);
    expect(await refreshCutSites(doc)).toEqual(sites);

    useWorkbench.temporal.getState().redo();
    expect(current(doc.id)).toBe(editedDoc);
    expect(docRevision(current(doc.id))).toBe(docRevision(editedDoc));
    expect(selectCutSites(st(), editedDoc)).toEqual([]);
  });
});
