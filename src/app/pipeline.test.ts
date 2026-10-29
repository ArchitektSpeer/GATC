// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Multi-step plans run as a DAG over the bundled real plasmids.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PlasmidDocument } from '../types/schema';
import { reverseComplement } from '../modules/cloning-primer';
import { loadSampleLibrary } from './samples';
import { dryRunPipeline, pipelineToMarkdown, validatePipelinePlan, type PipelinePlan } from './pipeline';

let pUC19: PlasmidDocument;
let pEGFP: PlasmidDocument;
let docs: PlasmidDocument[];

beforeAll(async () => {
  const lib = await loadSampleLibrary();
  [pUC19, pEGFP] = lib.docs;
  docs = lib.docs;
});

/** Validate then run, failing the test if the plan was rejected. */
function run(plan: PipelinePlan) {
  const checked = validatePipelinePlan(plan, docs);
  if (!checked.ok) throw new Error(`plan rejected: ${checked.error}`);
  return dryRunPipeline(checked.plan, docs);
}

describe('plan validation', () => {
  it('names the step whose inputs cannot be resolved', () => {
    const result = validatePipelinePlan(
      { name: 'x', steps: [{ id: 'a', op: 'digest', inputs: ['pBR322'], params: { enzymes: ['EcoRI'] } }] },
      docs,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('pBR322');
  });

  it('refuses a cycle', () => {
    const result = validatePipelinePlan(
      {
        name: 'x',
        steps: [
          { id: 'a', op: 'digest', inputs: ['b'], params: { enzymes: ['EcoRI'] } },
          { id: 'b', op: 'digest', inputs: ['a'], params: { enzymes: ['EcoRI'] } },
        ],
      },
      docs,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/循环|cycle/i);
  });

  it('refuses a duplicate step id, a wrong input count and an unknown enzyme', () => {
    const duplicate = validatePipelinePlan(
      {
        name: 'x',
        steps: [
          { id: 'a', op: 'digest', inputs: ['pUC19'], params: { enzymes: ['EcoRI'] } },
          { id: 'a', op: 'digest', inputs: ['pUC19'], params: { enzymes: ['EcoRI'] } },
        ],
      },
      docs,
    );
    expect(duplicate.ok).toBe(false);

    const arity = validatePipelinePlan(
      { name: 'x', steps: [{ id: 'a', op: 'gibson', inputs: ['pUC19'], params: {} }] },
      docs,
    );
    expect(arity.ok).toBe(false);
    if (!arity.ok) expect(arity.error).toMatch(/2–8/);

    const enzyme = validatePipelinePlan(
      { name: 'x', steps: [{ id: 'a', op: 'digest', inputs: ['pUC19'], params: { enzymes: ['NotAnEnzyme'] } }] },
      docs,
    );
    expect(enzyme.ok).toBe(false);
    if (!enzyme.ok) expect(enzyme.error).toContain('NotAnEnzyme');
  });

  it('accepts a plan that names documents by id as well as by name', () => {
    const result = validatePipelinePlan(
      { name: 'x', steps: [{ id: 'a', op: 'digest', inputs: [pUC19.id], params: { enzymes: ['EcoRI'] } }] },
      docs,
    );
    expect(result.ok).toBe(true);
  });
});

describe('dry run', () => {
  it('re-ligates the two halves of a double digest back into pUC19', () => {
    const result = run({
      name: 'EcoRI/HindIII 回连',
      steps: [
        { id: 'backbone', op: 'digest', inputs: ['pUC19'], params: { enzymes: ['EcoRI', 'HindIII'], select: 'largest' } },
        { id: 'piece', op: 'digest', inputs: ['pUC19'], params: { enzymes: ['EcoRI', 'HindIII'], select: 'smallest' } },
        { id: 'ligation', op: 'ligate', inputs: ['backbone', 'piece'], params: { circularize: true } },
        { id: 'check', op: 'check_digest', inputs: ['ligation'], params: { enzymes: ['EcoRI'] } },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.order).toEqual(['backbone', 'piece', 'ligation', 'check']);
    const ligation = result.steps.find((step) => step.stepId === 'ligation');
    expect(ligation?.product?.length).toBe(pUC19.length);
    expect(ligation?.product?.topology).toBe('circular');
    // The two digest products were consumed, so only the ligation is a terminal product.
    expect(result.products.map((product) => product.length)).toEqual([pUC19.length]);
    // The verification lane carries the single linear band next to the ladder.
    const check = result.steps.find((step) => step.stepId === 'check');
    expect(check?.lanes).toHaveLength(2);
    expect(check?.lanes?.[1].bands.map((band) => band.sizeBp)).toEqual([pUC19.length]);
  });

  it('amplifies a known stretch and reports the product length', () => {
    const forward = pUC19.sequence.slice(100, 122);
    const reverse = reverseComplement(pUC19.sequence.slice(600, 622));
    const result = run({
      name: 'PCR',
      steps: [{ id: 'amp', op: 'pcr', inputs: ['pUC19'], label: 'lacZ 片段', params: { forward, reverse } }],
    });
    expect(result.ok).toBe(true);
    const amp = result.steps[0];
    expect(amp.product?.length).toBe(522);
    expect(amp.product?.name).toBe('lacZ 片段');
    expect(amp.product?.topology).toBe('linear');
  });

  it('stops the steps below a failure and leaves the rest of the run readable', () => {
    const result = run({
      name: '切不开',
      steps: [
        // AscI has no site in pUC19, so the digest cannot produce a fragment.
        { id: 'cut', op: 'digest', inputs: ['pUC19'], params: { enzymes: ['AscI'] } },
        { id: 'join', op: 'ligate', inputs: ['cut'], params: {} },
        { id: 'other', op: 'digest', inputs: ['pEGFP-N1'], params: { enzymes: ['EcoRI'] } },
      ],
    });

    expect(result.ok).toBe(false);
    const cut = result.steps.find((step) => step.stepId === 'cut');
    expect(cut?.ok).toBe(false);
    expect(cut?.error).toContain('AscI');
    const join = result.steps.find((step) => step.stepId === 'join');
    expect(join?.skipped).toBe(true);
    // A branch that does not depend on the failure still runs.
    expect(result.steps.find((step) => step.stepId === 'other')?.ok).toBe(true);
  });

  it('applies a replacement and carries the new length downstream', () => {
    const result = run({
      name: '定点突变',
      steps: [
        { id: 'mut', op: 'mutate', inputs: ['pUC19'], params: { start: 500, end: 510, bases: 'AAA' } },
        { id: 'check', op: 'check_digest', inputs: ['mut'], params: { enzymes: ['EcoRI'] } },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.steps[0].product?.length).toBe(pUC19.length - 10 + 3);
  });

  it('anneals two oligos into a duplex with no input document', () => {
    const result = run({
      name: 'sgRNA 接头',
      steps: [
        {
          id: 'duplex',
          op: 'anneal_oligos',
          label: 'spacer 退火产物',
          params: { top: 'CACCGGGTCTTCGAGAAGACCT', bottom: 'AAACAGGTCTTCTCGAAGACCC' },
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.steps[0].product?.name).toBe('spacer 退火产物');
    expect(result.steps[0].product?.topology).toBe('linear');
    expect(result.steps[0].notes.join(' ')).toMatch(/Tm/);
  });

  it('flags a diagnostic digest whose bands cannot be told apart', () => {
    const result = run({
      name: '鉴定',
      steps: [{ id: 'check', op: 'check_digest', inputs: ['pEGFP-N1'], params: { enzymes: ['EcoRI', 'HindIII'] } }],
    });
    const notes = result.steps[0].notes.join(' ');
    expect(notes).toMatch(/预期条带/);
  });

  it('writes the run out as a markdown table', () => {
    const result = run({
      name: 'EcoRI 线性化',
      goal: '把 pUC19 切成线性，再上胶确认',
      steps: [
        { id: 'cut', op: 'digest', inputs: ['pUC19'], params: { enzymes: ['EcoRI'] } },
        { id: 'gel', op: 'check_digest', inputs: ['cut'], params: { enzymes: ['EcoRI'] } },
      ],
    });
    const markdown = pipelineToMarkdown(result);
    expect(markdown).toContain('# EcoRI 线性化');
    expect(markdown).toContain('把 pUC19 切成线性');
    expect(markdown.split('\n').filter((line) => line.startsWith('| '))).toHaveLength(4);
    expect(markdown).toMatch(/不能替代湿实验/);
  });
});
