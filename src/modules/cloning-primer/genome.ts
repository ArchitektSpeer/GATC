// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Genome engineering: finding CRISPR target sites, checking them against the sequences
// that are open, and designing a homologous-recombination replacement at a locus
// together with the primers that confirm it worked.
import type { PlasmidDocument, Primer } from '../../types/schema';
import { designPrimerPair } from './primer';
import {
  gcPercentOf,
  makeDocument,
  mod,
  normalizeDNA,
  reverseComplement,
  sequenceSlice,
} from './utils';
import { simulateInsertFragment } from './fragment-assembly';

/* -------------------------------------------------------------------------- */
/* Nucleases                                                                   */
/* -------------------------------------------------------------------------- */

export interface Nuclease {
  id: string;
  name: string;
  /** PAM written 5'->3' on the protospacer strand, IUPAC allowed. */
  pam: string;
  /** Which side of the protospacer the PAM sits on. */
  pamSide: 'three-prime' | 'five-prime';
  spacerLength: number;
  /**
   * Where the nuclease cuts, as an offset from the protospacer's 5' end: a cut at
   * offset n falls between protospacer positions n and n+1. `protospacerStrand` is the
   * strand the spacer is written on; `otherStrand` is its complement. The two are equal
   * for a blunt cut.
   */
  cut: { protospacerStrand: number; otherStrand: number };
  /** The PAM-proximal window where a mismatch hurts most. */
  seedLength: number;
  source: string;
  /** True when the published cut position is given as a range rather than a single base. */
  cutApproximate?: boolean;
  note?: string;
}

export const NUCLEASES: Nuclease[] = [
  {
    id: 'SpCas9',
    name: 'SpCas9（化脓链球菌）',
    pam: 'NGG',
    pamSide: 'three-prime',
    spacerLength: 20,
    // Blunt, 3 bp 5' of the PAM.
    cut: { protospacerStrand: 17, otherStrand: 17 },
    seedLength: 12,
    source: 'Jinek et al. 2012 Science 337: 816；Cong et al. 2013 Science 339: 819',
  },
  {
    id: 'SaCas9',
    name: 'SaCas9（金黄色葡萄球菌，体积小、适合 AAV）',
    pam: 'NNGRRT',
    pamSide: 'three-prime',
    spacerLength: 21,
    cut: { protospacerStrand: 18, otherStrand: 18 },
    seedLength: 12,
    source: 'Ran et al. 2015 Nature 520: 186',
    note: 'NNGRRT 效率最高；NNGRR 也可被切开，评估脱靶时要按更宽的 NNGRR 考虑。间隔序列 21–23 nt 皆可，21 nt 最常用。',
  },
  {
    id: 'Cas12a',
    name: 'Cas12a / Cpf1（PAM 在 5′ 端，切出粘性末端）',
    pam: 'TTTV',
    pamSide: 'five-prime',
    spacerLength: 23,
    // Staggered, distal to the PAM: 5-nt 5' overhang.
    cut: { protospacerStrand: 18, otherStrand: 23 },
    seedLength: 8,
    source: 'Zetsche et al. 2015 Cell 163: 759',
    cutApproximate: true,
    note: '切点位置各来源给的是 18–19 / 23，突出端 4–5 nt；此处按 18 / 23 计算，用于设计时请当作近似值。',
  },
];

export function nucleaseById(id: string): Nuclease | undefined {
  return NUCLEASES.find((n) => n.id === id);
}

const IUPAC: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T',
  R: 'AG', Y: 'CT', S: 'CG', W: 'AT', K: 'GT', M: 'AC',
  B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT',
};

function matchesPam(sequence: string, pam: string): boolean {
  if (sequence.length !== pam.length) return false;
  for (let index = 0; index < pam.length; index += 1) {
    const allowed = IUPAC[pam[index]];
    if (!allowed || !allowed.includes(sequence[index])) return false;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Finding target sites                                                        */
/* -------------------------------------------------------------------------- */

export interface CrisprSite {
  id: string;
  strand: 1 | -1;
  /** Protospacer span on the top strand, 0-based and half-open. */
  start: number;
  end: number;
  /** The 20-ish nt guide, written 5'->3' on the protospacer strand. */
  spacer: string;
  /** The PAM as read on the protospacer strand. */
  pam: string;
  /** Where the protospacer strand is cut, as a top-strand index (the first base after the cut). */
  cutTop: number;
  /** Where the complementary strand is cut; equal to `cutTop` for a blunt nuclease. */
  cutBottom: number;
  gcPercent: number;
  warnings: string[];
}

/**
 * Every protospacer the nuclease can target in the given region. Sites are returned in
 * order along the top strand, both strands included.
 */
export function findCrisprSites(
  doc: PlasmidDocument,
  nuclease: Nuclease,
  options: { region?: { start: number; end: number }; limit?: number } = {},
): CrisprSite[] {
  const sequence = normalizeDNA(doc.sequence);
  const length = sequence.length;
  const circular = doc.topology === 'circular';
  const total = nuclease.spacerLength + nuclease.pam.length;
  if (length < total) return [];
  const region = options.region;
  const limit = options.limit ?? 500;

  // Reading past the end of a circle is allowed, so the window can straddle the origin.
  const window = (from: number, size: number): string | null => {
    if (circular) return sequenceSlice(sequence, mod(from, length), mod(from, length) + size, true);
    if (from < 0 || from + size > length) return null;
    return sequence.slice(from, from + size);
  };
  const inRegion = (start: number, end: number): boolean => {
    if (!region) return true;
    return start >= region.start && end <= region.end;
  };

  const sites: CrisprSite[] = [];
  const last = circular ? length - 1 : length - total;
  for (let index = 0; index <= last && sites.length < limit; index += 1) {
    for (const strand of [1, -1] as const) {
      // On the minus strand the whole unit reads the other way round, so the window is
      // reverse-complemented before the PAM and spacer are pulled out of it.
      const raw = window(index, total);
      if (raw === null) continue;
      const unit = strand === 1 ? raw : reverseComplement(raw);
      const pam =
        nuclease.pamSide === 'three-prime' ? unit.slice(nuclease.spacerLength) : unit.slice(0, nuclease.pam.length);
      if (!matchesPam(pam, nuclease.pam)) continue;
      const spacer =
        nuclease.pamSide === 'three-prime' ? unit.slice(0, nuclease.spacerLength) : unit.slice(nuclease.pam.length);
      if (/[^ACGT]/.test(spacer)) continue;

      // Protospacer span in top-strand coordinates.
      const offsetInUnit =
        nuclease.pamSide === 'three-prime'
          ? strand === 1
            ? 0
            : nuclease.pam.length
          : strand === 1
            ? nuclease.pam.length
            : 0;
      const start = mod(index + offsetInUnit, length);
      const end = start + nuclease.spacerLength;
      if (!circular && end > length) continue;
      if (!inRegion(start, end)) continue;

      const toTop = (offset: number) =>
        strand === 1 ? start + offset : start + nuclease.spacerLength - offset;
      sites.push({
        id: `${nuclease.id}:${start}:${strand}`,
        strand,
        start,
        end,
        spacer,
        pam,
        cutTop: mod(toTop(nuclease.cut.protospacerStrand), length),
        cutBottom: mod(toTop(nuclease.cut.otherStrand), length),
        gcPercent: gcPercentOf(spacer),
        warnings: spacerWarnings(spacer),
      });
    }
  }
  return sites.sort((a, b) => a.start - b.start || a.strand - b.strand);
}

/** The checks that can be made on the guide alone, with no genome to compare against. */
export function spacerWarnings(spacer: string): string[] {
  const warnings: string[] = [];
  const gc = gcPercentOf(spacer);
  if (gc < 30) warnings.push(`GC 仅 ${gc.toFixed(0)}%，结合偏弱`);
  else if (gc > 80) warnings.push(`GC 高达 ${gc.toFixed(0)}%，容易形成二级结构`);
  if (/TTTT/.test(spacer)) warnings.push('含 TTTT，会提前终止 U6 启动子的转录');
  if (/^(.)\1{3,}/.test(spacer) || /(.)\1{4,}/.test(spacer)) warnings.push('存在 ≥5 个连续相同碱基');
  return warnings;
}

/* -------------------------------------------------------------------------- */
/* Off-target scanning, within the sequences that are loaded                   */
/* -------------------------------------------------------------------------- */

export interface OffTargetHit {
  docId: string;
  docName: string;
  start: number;
  strand: 1 | -1;
  mismatches: number;
  /** Mismatches inside the PAM-proximal seed, where they matter most. */
  seedMismatches: number;
  sequence: string;
  pam: string;
}

export interface OffTargetScan {
  hits: OffTargetHit[];
  /** Documents left out because they were longer than the limit. */
  skipped: Array<{ name: string; length: number }>;
  scannedBp: number;
}

/**
 * Look for the guide elsewhere in the sequences that are open. This is not a
 * genome-wide off-target search - only what is loaded is searched - so a clean result
 * means "nothing here", never "nothing in the genome".
 */
export function scanOffTargets(
  spacer: string,
  nuclease: Nuclease,
  docs: PlasmidDocument[],
  options: { maxMismatches?: number; maxScanBp?: number; limit?: number } = {},
): OffTargetScan {
  const guide = normalizeDNA(spacer);
  const maxMismatches = options.maxMismatches ?? 3;
  const maxScanBp = options.maxScanBp ?? 200_000;
  const limit = options.limit ?? 200;
  const hits: OffTargetHit[] = [];
  const skipped: Array<{ name: string; length: number }> = [];
  let scannedBp = 0;
  const total = guide.length + nuclease.pam.length;
  // The seed sits next to the PAM, so which end of the guide it is depends on the side.
  const seedFrom = nuclease.pamSide === 'three-prime' ? guide.length - nuclease.seedLength : 0;
  const seedTo = nuclease.pamSide === 'three-prime' ? guide.length : nuclease.seedLength;

  for (const doc of docs) {
    if (doc.sequence.length > maxScanBp) {
      skipped.push({ name: doc.name, length: doc.sequence.length });
      continue;
    }
    const sequence = normalizeDNA(doc.sequence);
    const circular = doc.topology === 'circular';
    const search = circular ? sequence + sequence.slice(0, total - 1) : sequence;
    scannedBp += sequence.length;
    for (let index = 0; index + total <= search.length && hits.length < limit; index += 1) {
      for (const strand of [1, -1] as const) {
        const raw = search.slice(index, index + total);
        const unit = strand === 1 ? raw : reverseComplement(raw);
        const pam =
          nuclease.pamSide === 'three-prime' ? unit.slice(guide.length) : unit.slice(0, nuclease.pam.length);
        if (!matchesPam(pam, nuclease.pam)) continue;
        const candidate =
          nuclease.pamSide === 'three-prime' ? unit.slice(0, guide.length) : unit.slice(nuclease.pam.length);
        let mismatches = 0;
        for (let i = 0; i < guide.length && mismatches <= maxMismatches; i += 1) {
          if (candidate[i] !== guide[i]) mismatches += 1;
        }
        if (mismatches > maxMismatches) continue;
        let seedMismatches = 0;
        for (let i = seedFrom; i < seedTo; i += 1) if (candidate[i] !== guide[i]) seedMismatches += 1;
        hits.push({
          docId: doc.id,
          docName: doc.name,
          start: index % sequence.length,
          strand,
          mismatches,
          seedMismatches,
          sequence: candidate,
          pam,
        });
      }
    }
  }
  return { hits: hits.sort((a, b) => a.mismatches - b.mismatches), skipped, scannedBp };
}

/* -------------------------------------------------------------------------- */
/* Homologous recombination at a locus                                         */
/* -------------------------------------------------------------------------- */

export interface GenomicReplacement {
  /** The locus after recombination. */
  product: PlasmidDocument;
  leftArm: string;
  rightArm: string;
  /** Primers that amplify the donor with the homology arms as 5' tails. */
  donorPrimers: { forward: Primer; reverse: Primer };
  /** Primers outside the arms, which bind both the original and the edited locus. */
  checkPrimers: { forward: Primer; reverse: Primer } | null;
  /** Diagnostic PCR product sizes, so the gel can be read before it is run. */
  expected: { wildTypeBp: number; editedBp: number } | null;
  replacedBp: number;
  insertedBp: number;
  warnings: string[];
}

/**
 * Replace a stretch of a locus with a donor sequence, the way homologous recombination
 * does it: the donor is amplified with the locus flanks as 5' tails, and the arms
 * direct it to the target. A target of zero length is an insertion.
 */
export function designGenomicReplacement(spec: {
  locus: PlasmidDocument;
  target: { start: number; end: number };
  donor: PlasmidDocument;
  donorRange?: { start: number; end: number };
  /** Length of each homology arm; 40-60 bp is the usual range for yeast and for lambda-Red. */
  armLength?: number;
  /** How far outside the arms the check primers should sit. */
  checkFlank?: number;
}): GenomicReplacement {
  const warnings: string[] = [];
  const { locus, donor } = spec;
  const armLength = Math.max(20, spec.armLength ?? 50);
  const checkFlank = Math.max(60, spec.checkFlank ?? 300);
  const circular = locus.topology === 'circular';
  const length = locus.sequence.length;
  const start = circular ? mod(spec.target.start, length) : Math.max(0, Math.min(length, spec.target.start));
  const end = circular ? mod(spec.target.end, length) : Math.max(start, Math.min(length, spec.target.end));
  const replacedBp = circular ? mod(end - start, length) : end - start;
  const donorRange = spec.donorRange ?? { start: 0, end: donor.sequence.length };
  const insertedBp = donorRange.end - donorRange.start;
  if (insertedBp <= 0) {
    warnings.push('供体片段长度为 0，结果等同于直接删除目标区段。');
  }

  if (!circular && (start < armLength || end + armLength > length)) {
    warnings.push(
      `线性位点两侧不足 ${armLength} bp，同源臂会被截短；请用包含上下游的更长片段（可用「从 NCBI 导入」按坐标区间取）。`,
    );
  }
  const leftArm = sequenceSlice(locus.sequence, start - armLength, start, circular);
  const rightArm = sequenceSlice(locus.sequence, end, end + armLength, circular);

  // The donor is amplified with the arms hanging off the 5' ends of its primers.
  const donorPair = designPrimerPair(donor, { start: donorRange.start, end: donorRange.end });
  const donorPrimers = {
    forward: {
      ...donorPair.forward,
      name: `${donor.name}_HR_F`,
      tailSequence: leftArm,
      sequence: leftArm + donorPair.forward.sequence.slice(donorPair.forward.tailSequence.length),
    },
    reverse: {
      ...donorPair.reverse,
      name: `${donor.name}_HR_R`,
      tailSequence: reverseComplement(rightArm),
      sequence: reverseComplement(rightArm) + donorPair.reverse.sequence.slice(donorPair.reverse.tailSequence.length),
    },
  };

  const insert =
    spec.donorRange && (donorRange.start > 0 || donorRange.end < donor.sequence.length)
      ? makeDocument({
          name: `${donor.name}_${donorRange.start + 1}-${donorRange.end}`,
          sequence: donor.sequence.slice(donorRange.start, donorRange.end),
          topology: 'linear',
        })
      : donor;
  const replacement = simulateInsertFragment(locus, { start, end }, insert);
  warnings.push(...replacement.warnings);
  const product = {
    ...replacement.product,
    name: `${locus.name}_HR_${donor.name}`,
    description: `${locus.name} 的 ${start + 1}..${end} 段（${replacedBp} bp）经同源重组换成 ${insert.name}（${insertedBp} bp）`,
  };

  // Check primers bind outside the arms, so one pair reports both alleles.
  let checkPrimers: GenomicReplacement['checkPrimers'] = null;
  let expected: GenomicReplacement['expected'] = null;
  const outerStart = start - armLength - checkFlank;
  const outerEnd = end + armLength + checkFlank;
  if (circular || (outerStart >= 0 && outerEnd <= length)) {
    const pair = designPrimerPair(locus, { start: outerStart, end: outerEnd });
    checkPrimers = {
      forward: { ...pair.forward, name: `${locus.name}_check_F` },
      reverse: { ...pair.reverse, name: `${locus.name}_check_R` },
    };
    const wildTypeBp = pair.productLength;
    expected = { wildTypeBp, editedBp: wildTypeBp - replacedBp + insertedBp };
    if (Math.abs(expected.editedBp - wildTypeBp) < 50) {
      warnings.push(
        `鉴定 PCR 的野生型与重组型产物只差 ${Math.abs(expected.editedBp - wildTypeBp)} bp，普通琼脂糖胶上分不开，建议改用一条落在供体内部的引物。`,
      );
    }
  } else {
    warnings.push('位点两侧长度不足以设计鉴定引物；请提供更长的基因组片段。');
  }

  return { product, leftArm, rightArm, donorPrimers, checkPrimers, expected, replacedBp, insertedBp, warnings };
}
