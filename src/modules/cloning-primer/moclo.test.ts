// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { PlasmidDocument } from '../../types/schema';
import {
  checkPartInSlot,
  checkSlotChain,
  combinations,
  combinatorialAssembly,
  designSlotPrimers,
  fusionSitesOf,
  identifySlots,
  makeDocument,
  MOCLO_STANDARDS,
  mocloStandard,
  resolveEnzyme,
  reverseComplement,
  scoreFusionSiteSet,
} from './index';

const bsaI = resolveEnzyme('BsaI')!;
const phytobricks = mocloStandard('phytobricks')!;
const slot = (id: string) => phytobricks.slots.find((s) => s.id === id)!;

/**
 * A level-0 part plasmid: two inward-facing BsaI sites release `upstream + core`,
 * with `downstream` left on the bottom strand as the next part's fusion site.
 */
function levelZero(name: string, upstream: string, core: string, downstream: string): PlasmidDocument {
  const backbone = 'ACGTTGCA'.repeat(20);
  return makeDocument({
    name,
    sequence: `GGTCTCA${upstream}${core}${downstream}TGAGACC${backbone}`,
    topology: 'circular',
  });
}

describe('fusion-site syntaxes', () => {
  it('gives every slot a non-palindromic 4 bp site and chains the plant syntax end to end', () => {
    for (const standard of MOCLO_STANDARDS) {
      for (const s of standard.slots) {
        expect(s.upstream, `${standard.id} ${s.id} upstream`).toMatch(/^[ACGT]{4}$/);
        expect(s.downstream, `${standard.id} ${s.id} downstream`).toMatch(/^[ACGT]{4}$/);
        // A palindromic fusion site self-ligates, so no standard uses one.
        expect(reverseComplement(s.upstream), `${standard.id} ${s.id}`).not.toBe(s.upstream);
        expect(reverseComplement(s.downstream), `${standard.id} ${s.id}`).not.toBe(s.downstream);
      }
    }
    // The twelve plant fusion sites of Patron 2015, in transcription-unit order.
    const chain = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'C1'].map(slot);
    expect(checkSlotChain(chain, { circular: false })).toEqual({ ok: true, gaps: [] });
    expect(chain[0].upstream).toBe('GGAG');
    expect(chain[chain.length - 1].downstream).toBe('CGCT');
    const sites = new Set([...chain.map((s) => s.upstream), ...chain.map((s) => s.downstream)]);
    // Ten adjacent positions share nine internal sites, plus the two outer ones.
    expect(sites.size).toBe(11);
    // The Gly-Ala variant adds the twelfth.
    expect(slot('B3-GA').downstream).toBe('AGCC');
  });

  it('says which tables were checked against their own publication', () => {
    expect(mocloStandard('phytobricks')!.verifiedAgainstPublication).toBe(true);
    // The YTK overhangs come from a third-party implementation; the UI must be able to say so.
    expect(mocloStandard('ytk')!.verifiedAgainstPublication).toBe(false);
    expect(mocloStandard('ytk')!.source).toMatch(/moclo/i);
  });

  it('reports a gap in a chain, and the gap that stops a circle closing', () => {
    const broken = checkSlotChain([slot('A1'), slot('B1')], { circular: false });
    expect(broken.ok).toBe(false);
    expect(broken.gaps[0]).toContain('TGAC');
    expect(broken.gaps[0]).toContain('TACT');

    const open = checkSlotChain([slot('A1'), slot('A2')], { circular: true });
    expect(open.gaps.some((g) => g.includes('环化缺口'))).toBe(true);
  });
});

describe('checking a part against a slot', () => {
  it('reads the fusion sites a part presents', () => {
    const part = levelZero('pPROM', 'GGAG', 'TTGACAGGATCCTAACAGGA', 'CCAT');
    const sites = fusionSitesOf(part, bsaI)!;
    expect(sites.upstream).toBe('GGAG');
    expect(sites.downstream).toBe('CCAT');
    // The released top strand is the upstream site plus the core; the downstream site
    // stays on the bottom strand for the next part to match.
    expect(sites.length).toBe(4 + 20);
  });

  it('identifies the slot, and sees a part cloned the other way round', () => {
    const part = levelZero('pPROM', 'GGAG', 'TTGACAGGATCCTAACAGGA', 'CCAT');
    expect(identifySlots(part, phytobricks).map((m) => m.slot.id)).toEqual(['A1-B1']);

    const flipped = levelZero(
      'pPROM_rev',
      reverseComplement('CCAT'),
      'TTGACAGGATCCTAACAGGA',
      reverseComplement('GGAG'),
    );
    const found = identifySlots(flipped, phytobricks);
    expect(found.map((m) => m.slot.id)).toEqual(['A1-B1']);
    expect(found[0].forward).toBe(false);
  });

  it('names both wrong overhangs when a part does not fit its slot', () => {
    const part = levelZero('pWrong', 'AAAC', 'TTGACAGGATCCTAACAGGA', 'TTTG');
    const check = checkPartInSlot(part, slot('A1'), phytobricks);
    expect(check.ok).toBe(false);
    expect(check.found).toEqual({ upstream: 'AAAC', downstream: 'TTTG' });
    expect(check.problems.map((p) => p.message).join(' ')).toMatch(/上游接头是 AAAC.*GGAG/);
    expect(check.problems.map((p) => p.message).join(' ')).toMatch(/下游接头是 TTTG.*TGAC/);
  });

  it('rejects a plasmid that is not a level-0 part at all', () => {
    const notAPart = makeDocument({ name: 'pUC-like', sequence: 'ACGTTGCA'.repeat(30), topology: 'circular' });
    expect(fusionSitesOf(notAPart, bsaI)).toBeNull();
    const check = checkPartInSlot(notAPart, slot('A1'), phytobricks);
    expect(check.ok).toBe(false);
    expect(check.problems[0].message).toContain('不是合格的 Level 0 元件');
  });

  it('passes a part that fits, and only warns when it is reversed', () => {
    const part = levelZero('pCDS', 'AATG', 'GCTAGCAAAGGAGAAGAACTTTTC', 'TTCG');
    const good = checkPartInSlot(part, slot('B3-B4'), phytobricks);
    expect(good.ok).toBe(true);
    expect(good.problems).toEqual([]);

    const reversed = levelZero('pCDS_rev', reverseComplement('TTCG'), 'GCTAGCAAAGGAGAAGAACTTTTC', reverseComplement('AATG'));
    const flipped = checkPartInSlot(reversed, slot('B3-B4'), phytobricks);
    expect(flipped.ok).toBe(true);
    expect(flipped.problems.map((p) => p.severity)).toEqual(['warning']);
    expect(flipped.problems[0].message).toContain('方向与 B3-B4 相反');
  });
});

describe('fusion-site set fidelity', () => {
  it('flags a repeated site and a palindrome', () => {
    const repeated = scoreFusionSiteSet(['GGAG', 'AATG', 'GGAG']);
    expect(repeated.warnings.some((w) => w.includes('出现了 2 次'))).toBe(true);

    const palindromic = scoreFusionSiteSet(['GGAG', 'AATT']);
    expect(palindromic.warnings.some((w) => /AATT.*self-ligate/.test(w))).toBe(true);
    expect(palindromic.score).toBeLessThan(scoreFusionSiteSet(['GGAG', 'AATG']).score);
  });

  it('gives the published plant set a clean score', () => {
    const chain = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'C1'].map(slot);
    const result = scoreFusionSiteSet(chain.map((s) => s.upstream));
    expect(result.score).toBeGreaterThan(0.8);
  });
});

describe('combinatorial Golden Gate', () => {
  const acceptor = levelZero('pAcceptor', 'CGCT', 'TTAATTAAGGCGCGCCTTAATTAAGGCGCGCC', 'GGAG');
  const promoters = [
    levelZero('p35S', 'GGAG', 'TTGACAGGATCCTAACAGGAAAGGAAAGGATC', 'CCAT'),
    levelZero('pNOS', 'GGAG', 'TTCAAAGATCCTTAATTGCCTTAAGTGCATCA', 'CCAT'),
  ];
  const ntag = levelZero('pNoTag', 'CCAT', 'GGCTTCAAGCTTGGTACCGA', 'AATG');
  const cdss = [
    levelZero('pGFP', 'AATG', 'GTGAGCAAGGGCGAGGAGCTGTTCACCGGGG', 'TTCG'),
    levelZero('pRFP', 'AATG', 'GCCTCCTCCGAGGACGTCATCAAGGAGTTCA', 'TTCG'),
    levelZero('pLUC', 'AATG', 'GAAGACGCCAAAAACATAAAGAAAGGCCCGG', 'TTCG'),
  ];
  const ctag = levelZero('pHis6', 'TTCG', 'CATCACCATCACCATCACTAA', 'GCTT');
  const term = levelZero('tNOS', 'GCTT', 'GAATTTCCCCGATCGTTCAAACATTTGGCAA', 'CGCT');

  const groups = [
    { label: '骨架', parts: [acceptor] },
    { label: '启动子', parts: promoters },
    { label: 'N 端', parts: [ntag] },
    { label: 'CDS', parts: cdss },
    { label: 'C 端标签', parts: [ctag] },
    { label: '终止子', parts: [term] },
  ];

  it('takes one part from each slot, in slot order', () => {
    expect(combinations([['1', '2'], ['a', 'b'], ['x']])).toEqual([
      ['1', 'a', 'x'],
      ['1', 'b', 'x'],
      ['2', 'a', 'x'],
      ['2', 'b', 'x'],
    ]);
  });

  it('builds one circular plasmid per combination', () => {
    const result = combinatorialAssembly(groups, bsaI, { namePrefix: 'TU' });
    expect(result.total).toBe(2 * 3);
    expect(result.failures).toEqual([]);
    expect(result.notAttempted).toBe(0);
    expect(result.products).toHaveLength(6);

    const names = result.products.map((p) => p.product.name);
    expect(names).toContain('TU_pAcceptor-p35S-pNoTag-pGFP-pHis6-tNOS');
    expect(names).toContain('TU_pAcceptor-pNOS-pNoTag-pLUC-pHis6-tNOS');
    expect(new Set(names).size).toBe(6);

    for (const made of result.products) {
      expect(made.product.topology).toBe('circular');
      // Each product is the six cores plus the six 4 bp fusion sites.
      expect(made.product.length).toBe(32 + 32 + 20 + 31 + 21 + 31 + 6 * 4);
      expect(made.fidelityScore).toBeGreaterThan(0.8);
      // No BsaI site survives a correct assembly.
      expect(made.warnings.join(' ')).not.toMatch(/Residual BsaI/);
    }

    const gfpWith35S = result.products.find((p) => p.product.name.includes('p35S') && p.product.name.includes('pGFP'))!;
    expect(gfpWith35S.product.sequence).toContain('GTGAGCAAGGGCGAGGAGCTG');
    expect(gfpWith35S.product.sequence).toContain('TTGACAGGATCCTAACAGGA');
    expect(gfpWith35S.product.sequence).not.toContain('GCCTCCTCCGAGGACGTCAT');
    // The fusion sites appear once each, at the junctions.
    expect(gfpWith35S.product.sequence.match(/AATG/g)?.length).toBe(1);
  });

  it('stops at the limit and says how many combinations were left', () => {
    const result = combinatorialAssembly(groups, bsaI, { limit: 2 });
    expect(result.products).toHaveLength(2);
    expect(result.total).toBe(6);
    expect(result.notAttempted).toBe(4);
  });

  it('reports a combination that cannot close instead of dropping it', () => {
    const wrongTerm = levelZero('tBroken', 'GCTT', 'GAATTTCCCCGATCGTTCAAACATTTGGCAA', 'TTTG');
    const result = combinatorialAssembly(
      groups.map((g) => (g.label === '终止子' ? { ...g, parts: [term, wrongTerm] } : g)),
      bsaI,
      { limit: 100 },
    );
    expect(result.total).toBe(12);
    expect(result.products).toHaveLength(6);
    expect(result.failures).toHaveLength(6);
    expect(result.failures.every((f) => f.combination.includes('tBroken'))).toBe(true);
    expect(result.failures[0].reason).toMatch(/No unique directed Golden Gate assembly path/);
  });

  it('needs at least two slots with candidates', () => {
    expect(combinatorialAssembly([{ label: 'only', parts: [acceptor] }], bsaI).total).toBe(0);
  });
});

describe('designing the primers that make a part for a position', () => {
  const template = makeDocument({
    name: 'gene_source',
    // A stretch with no BsaI site, then a BsaI site, so both paths can be exercised.
    sequence: `ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCT${'ACGTTGCA'.repeat(6)}`,
    topology: 'linear',
  });

  it('adds the recognition site, spacer and the slot fusion sites as 5-prime tails', () => {
    const design = designSlotPrimers(template, { start: 3, end: 80 }, slot('B3-B4'), phytobricks)!;
    expect(design.forward.tailSequence).toBe('GGTCTCAAATG');
    expect(design.reverse.tailSequence).toBe(`GGTCTCA${reverseComplement('TTCG')}`);
    expect(design.internalSites).toBe(0);
    // AATG supplies the start codon, so the part begins at the second codon.
    expect(design.warnings.some((w) => w.includes('第二个密码子'))).toBe(true);
    expect(design.warnings.some((w) => w.includes('两个起始密码子'))).toBe(false);
  });

  it('warns about a duplicated start codon and about a site that must be domesticated', () => {
    const duplicated = designSlotPrimers(template, { start: 0, end: 80 }, slot('B3-B4'), phytobricks)!;
    expect(duplicated.warnings.some((w) => w.includes('两个起始密码子'))).toBe(true);

    const withSite = makeDocument({
      name: 'needs_domestication',
      sequence: `ATGGCTAGCAAAGGAGAAGAAGGTCTCATTTTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTT`,
      topology: 'linear',
    });
    const design = designSlotPrimers(withSite, { start: 3, end: 80 }, slot('B3-B4'), phytobricks)!;
    expect(design.internalSites).toBe(1);
    expect(design.warnings.some((w) => w.includes('domestication'))).toBe(true);
  });
});
