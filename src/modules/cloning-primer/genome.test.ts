// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  designGenomicReplacement,
  findCrisprSites,
  makeDocument,
  NUCLEASES,
  nucleaseById,
  reverseComplement,
  scanOffTargets,
  spacerWarnings,
} from './index';

const spCas9 = nucleaseById('SpCas9')!;
const cas12a = nucleaseById('Cas12a')!;

const SPACER = 'GTCAGGCTTCTGGATATCTA'; // 20 nt, no TTTT, mixed GC
const FILLER = 'ACGTTGCAATCGATCGAACC';

describe('nuclease definitions', () => {
  it('names a source for every nuclease and keeps the cut inside the protospacer', () => {
    for (const n of NUCLEASES) {
      expect(n.source, n.id).toMatch(/\d{4}/);
      expect(n.pam, n.id).toMatch(/^[ACGTRYSWKMBDHVN]+$/);
      expect(n.cut.protospacerStrand).toBeGreaterThan(0);
      expect(n.cut.protospacerStrand).toBeLessThanOrEqual(n.spacerLength);
      expect(n.cut.otherStrand).toBeLessThanOrEqual(n.spacerLength);
    }
    // SpCas9 cuts bluntly three bases before the PAM.
    expect(spCas9.cut).toEqual({ protospacerStrand: 17, otherStrand: 17 });
    expect(spCas9.spacerLength - spCas9.cut.protospacerStrand).toBe(3);
    // Cas12a is staggered and its published position is a range, so it says so.
    expect(cas12a.cut.otherStrand - cas12a.cut.protospacerStrand).toBe(5);
    expect(cas12a.cutApproximate).toBe(true);
  });
});

describe('finding target sites', () => {
  it('finds a plus-strand SpCas9 site and puts the blunt cut 3 bp before the PAM', () => {
    const doc = makeDocument({
      name: 'target',
      sequence: `${FILLER}${SPACER}TGG${FILLER}`,
      topology: 'linear',
    });
    const site = findCrisprSites(doc, spCas9).find((s) => s.spacer === SPACER)!;
    expect(site).toBeDefined();
    expect(site.strand).toBe(1);
    expect(site.start).toBe(FILLER.length);
    expect(site.pam).toBe('TGG');
    expect(site.cutTop).toBe(FILLER.length + 17);
    expect(site.cutBottom).toBe(site.cutTop);
    // The three bases between the cut and the PAM.
    expect(doc.sequence.slice(site.cutTop, site.cutTop + 3)).toBe(SPACER.slice(17));
  });

  it('finds the same site on the minus strand with the cut mirrored', () => {
    const doc = makeDocument({
      name: 'target_rc',
      sequence: `${FILLER}CCA${reverseComplement(SPACER)}${FILLER}`,
      topology: 'linear',
    });
    const site = findCrisprSites(doc, spCas9).find((s) => s.spacer === SPACER)!;
    expect(site).toBeDefined();
    expect(site.strand).toBe(-1);
    expect(site.pam).toBe('TGG');
    // The protospacer sits just after the top-strand CCA.
    expect(site.start).toBe(FILLER.length + 3);
    expect(site.cutTop).toBe(FILLER.length + 3 + 20 - 17);
  });

  it('reads a Cas12a site with the PAM in front and a 5 nt staggered cut', () => {
    const spacer23 = 'GCAGGCTTCTGGATATCTAGCAA';
    const doc = makeDocument({
      name: 'cas12a_target',
      sequence: `${FILLER}TTTA${spacer23}${FILLER}`,
      topology: 'linear',
    });
    const site = findCrisprSites(doc, cas12a).find((s) => s.spacer === spacer23)!;
    expect(site).toBeDefined();
    expect(site.pam).toBe('TTTA');
    expect(site.start).toBe(FILLER.length + 4);
    expect(site.cutTop).toBe(FILLER.length + 4 + 18);
    expect(site.cutBottom).toBe(FILLER.length + 4 + 23);
    expect(site.cutBottom - site.cutTop).toBe(5);
  });

  it('finds sites that straddle the origin of a circular molecule', () => {
    const half = `${SPACER}TGG`;
    const doc = makeDocument({
      name: 'circle',
      // The site starts 10 bp before the end and wraps round.
      sequence: `${half.slice(13)}${FILLER}${FILLER}${half.slice(0, 13)}`,
      topology: 'circular',
    });
    const found = findCrisprSites(doc, spCas9).find((s) => s.spacer === SPACER);
    expect(found).toBeDefined();
    expect(found!.start).toBe(doc.length - 13);
  });

  it('honours a region and never returns a spacer with an ambiguous base', () => {
    const doc = makeDocument({
      name: 'two_sites',
      sequence: `${SPACER}AGG${FILLER}${SPACER}CGG${FILLER}`,
      topology: 'linear',
    });
    const all = findCrisprSites(doc, spCas9).filter((s) => s.spacer === SPACER);
    expect(all).toHaveLength(2);
    const second = findCrisprSites(doc, spCas9, { region: { start: 40, end: doc.length } }).filter(
      (s) => s.spacer === SPACER,
    );
    expect(second).toHaveLength(1);
    expect(second[0].start).toBeGreaterThan(40);

    const withN = makeDocument({ name: 'n', sequence: `${FILLER}${SPACER.slice(0, 10)}N${SPACER.slice(11)}TGG${FILLER}`, topology: 'linear' });
    expect(findCrisprSites(withN, spCas9).every((s) => !s.spacer.includes('N'))).toBe(true);
  });
});

describe('guide warnings', () => {
  it('flags a U6 terminator, extreme GC and homopolymers', () => {
    expect(spacerWarnings('GCAGTTTTCTGGATATCTAG').some((w) => w.includes('TTTT'))).toBe(true);
    expect(spacerWarnings('ATATATATATAAATATATAT').some((w) => w.includes('GC'))).toBe(true);
    expect(spacerWarnings('GCGCGCGCGCGCGCGCGCGC').some((w) => w.includes('GC'))).toBe(true);
    expect(spacerWarnings('GCAGGCAAAAACTGGATCTA').some((w) => w.includes('连续'))).toBe(true);
    expect(spacerWarnings(SPACER)).toEqual([]);
  });
});

describe('off-target scanning in the loaded sequences', () => {
  const onTarget = makeDocument({ name: 'locus', sequence: `${FILLER}${SPACER}TGG${FILLER}`, topology: 'linear' });
  // One base off, in the PAM-distal half: the classic tolerated mismatch.
  const distal = `A${SPACER.slice(1)}`;
  const nearMiss = makeDocument({ name: 'other_locus', sequence: `${FILLER}${distal}AGG${FILLER}`, topology: 'linear' });
  const noPam = makeDocument({ name: 'no_pam', sequence: `${FILLER}${SPACER}TTA${FILLER}`, topology: 'linear' });

  it('finds the on-target and a one-mismatch site, and ignores one without a PAM', () => {
    const scan = scanOffTargets(SPACER, spCas9, [onTarget, nearMiss, noPam]);
    expect(scan.hits.map((h) => `${h.docName}:${h.mismatches}`)).toEqual(['locus:0', 'other_locus:1']);
    // The mismatch is at the PAM-distal end, so it is outside the seed.
    expect(scan.hits[1].seedMismatches).toBe(0);
    expect(scan.skipped).toEqual([]);
  });

  it('counts a seed mismatch separately', () => {
    const seedMiss = `${SPACER.slice(0, 19)}${SPACER[19] === 'A' ? 'C' : 'A'}`;
    const doc = makeDocument({ name: 'seed', sequence: `${FILLER}${seedMiss}AGG${FILLER}`, topology: 'linear' });
    const scan = scanOffTargets(SPACER, spCas9, [doc]);
    expect(scan.hits[0].mismatches).toBe(1);
    expect(scan.hits[0].seedMismatches).toBe(1);
  });

  it('respects the mismatch budget and says which sequences were too long to scan', () => {
    const strict = scanOffTargets(SPACER, spCas9, [onTarget, nearMiss], { maxMismatches: 0 });
    expect(strict.hits).toHaveLength(1);
    expect(strict.hits[0].docName).toBe('locus');

    const huge = makeDocument({ name: 'chromosome', sequence: 'ACGT'.repeat(60_000), topology: 'linear' });
    const capped = scanOffTargets(SPACER, spCas9, [onTarget, huge], { maxScanBp: 1000 });
    expect(capped.skipped).toEqual([{ name: 'chromosome', length: 240_000 }]);
    expect(capped.scannedBp).toBe(onTarget.length);
  });
});

describe('homologous recombination at a locus', () => {
  // A locus with 600 bp of flank on each side of a 300 bp "gene".
  const upstream = 'ACGTTGCAATCGATCGAACCTTAGGCATCAGTCCATGGCAAT'.repeat(15).slice(0, 600);
  const gene = 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCA'.repeat(8).slice(0, 300);
  const downstream = 'TTCGAATCCGGATTACGCATGACCTAGGCATTCGAAGGCTAA'.repeat(15).slice(0, 600);
  const locus = makeDocument({
    name: 'YFG1_locus',
    sequence: upstream + gene + downstream,
    topology: 'linear',
  });
  const marker = makeDocument({
    name: 'KanMX',
    sequence: 'ATGGGTAAGGAAAAGACTCACGTTTCGAGGCCGCGATTAAATTCCAACATGGATGCTGAT'.repeat(4),
    topology: 'linear',
  });

  it('replaces the gene, hangs the arms off the donor primers and sizes the diagnostic PCR', () => {
    const design = designGenomicReplacement({
      locus,
      target: { start: 600, end: 900 },
      donor: marker,
      armLength: 50,
      checkFlank: 300,
    });

    expect(design.replacedBp).toBe(300);
    expect(design.insertedBp).toBe(marker.length);
    expect(design.leftArm).toBe(locus.sequence.slice(550, 600));
    expect(design.rightArm).toBe(locus.sequence.slice(900, 950));
    expect(design.leftArm).toHaveLength(50);

    // The product is the locus with the gene swapped out.
    expect(design.product.length).toBe(locus.length - 300 + marker.length);
    expect(design.product.sequence.startsWith(upstream)).toBe(true);
    expect(design.product.sequence.endsWith(downstream)).toBe(true);
    expect(design.product.sequence).not.toContain(gene.slice(50, 150));
    expect(design.product.sequence).toContain(marker.sequence);

    // The donor primers carry the arms as 5' tails.
    expect(design.donorPrimers.forward.tailSequence).toBe(design.leftArm);
    expect(design.donorPrimers.forward.sequence.startsWith(design.leftArm)).toBe(true);
    expect(design.donorPrimers.reverse.tailSequence).toBe(reverseComplement(design.rightArm));
    expect(design.donorPrimers.forward.sequence.length).toBeGreaterThan(50);

    // Check primers sit outside the arms and tell the two alleles apart.
    expect(design.checkPrimers).not.toBeNull();
    expect(design.checkPrimers!.forward.bindingStart).toBeLessThan(550);
    expect(design.checkPrimers!.reverse.bindingEnd).toBeGreaterThan(950);
    expect(design.expected!.editedBp - design.expected!.wildTypeBp).toBe(marker.length - 300);
  });

  it('warns when the two diagnostic products would be too close in size to tell apart', () => {
    const sameSize = makeDocument({
      name: 'same_size_donor',
      sequence: 'GGTTCCAAGGTTCCAAGGTTCCAAGGTTCCAA'.repeat(10).slice(0, 310),
      topology: 'linear',
    });
    const design = designGenomicReplacement({ locus, target: { start: 600, end: 900 }, donor: sameSize });
    expect(design.warnings.some((w) => w.includes('分不开'))).toBe(true);
  });

  it('says when the locus is too short to carry full arms', () => {
    const short = makeDocument({ name: 'short', sequence: gene, topology: 'linear' });
    const design = designGenomicReplacement({ locus: short, target: { start: 10, end: 20 }, donor: marker });
    expect(design.warnings.some((w) => w.includes('同源臂会被截短'))).toBe(true);
    expect(design.checkPrimers).toBeNull();
  });

  it('treats a zero-length target as a clean insertion', () => {
    const design = designGenomicReplacement({ locus, target: { start: 750, end: 750 }, donor: marker });
    expect(design.replacedBp).toBe(0);
    expect(design.product.length).toBe(locus.length + marker.length);
    expect(design.expected!.editedBp - design.expected!.wildTypeBp).toBe(marker.length);
  });
});
