// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Annealed oligonucleotide duplexes: two ordered oligos hybridised into a short
// double-stranded fragment with defined ends, ready for ligation or Golden Gate.
// This is how sgRNA spacers, linkers, adaptors and short tags are cloned in practice,
// and it needs no PCR step at all.
import type { OverhangEnd, PlasmidDocument } from '../../types/schema';
import type { ReactionConditions } from './thermo';
import { evaluateOligoThermodynamics, meltingTemperature } from './thermo';
import { makeDocument, makeHistoryNode, normalizeDNA, reverseComplement } from './utils';

/** An end of a duplex, before it is known which enzyme (if any) produced it. */
export type DuplexEnd = Pick<OverhangEnd, 'type' | 'sequence'>;

export interface OligoAnnealingOptions {
  /** Shortest base-paired stretch worth calling an anneal. */
  minDuplexLength?: number;
  /** Mismatches tolerated inside the paired region; 0 means a perfect duplex. */
  maxMismatches?: number;
  /**
   * Whether the oligos carry a 5' phosphate. Oligos arrive from the supplier with a
   * free 5'-OH, so this is false unless they were treated with T4 polynucleotide kinase.
   */
  phosphorylated?: boolean;
  name?: string;
  conditions?: ReactionConditions;
}

export interface OligoAnnealingResult {
  /** The duplex as a linear fragment; `sequence` is its top strand, exactly. */
  duplex: PlasmidDocument;
  /** Where the bottom oligo sits on the top oligo, in top-strand coordinates. */
  offset: number;
  /** Length of the base-paired stretch. */
  duplexLength: number;
  /** 0-based positions inside the paired stretch that are not complementary. */
  mismatchPositions: number[];
  /** Melting temperature of the paired stretch alone. */
  tm: number;
  left: OverhangEnd;
  right: OverhangEnd;
  /** Other registers that pair just as well; more than zero means the design is ambiguous. */
  alternatives: number;
  warnings: string[];
}

const PAIRABLE = new Set(['A', 'C', 'G', 'T']);

/**
 * The bottom oligo is laid out reverse-complemented, in the top strand's direction,
 * so two bases pair exactly when they read the same. Ambiguity codes never pair.
 */
function pairs(top: string, bottomInTopDirection: string): boolean {
  return top === bottomInTopDirection && PAIRABLE.has(top);
}

interface Register {
  offset: number;
  length: number;
  mismatches: number[];
}

/** Every register in which the two oligos overlap, best first. */
function registers(top: string, pairingBottom: string, minLength: number, maxMismatches: number): Register[] {
  const out: Register[] = [];
  for (let offset = -(pairingBottom.length - 1); offset <= top.length - 1; offset += 1) {
    const from = Math.max(0, offset);
    const to = Math.min(top.length, offset + pairingBottom.length);
    const length = to - from;
    if (length < minLength) continue;
    const mismatches: number[] = [];
    for (let index = from; index < to; index += 1) {
      if (!pairs(top[index], pairingBottom[index - offset])) mismatches.push(index - from);
    }
    if (mismatches.length > maxMismatches) continue;
    out.push({ offset, length, mismatches });
  }
  // Prefer the longest perfect pairing; each mismatch has to buy back several paired bases.
  return out.sort(
    (a, b) => b.length - b.mismatches.length * 4 - (a.length - a.mismatches.length * 4),
  );
}

/**
 * Hybridise two oligos, each written 5'->3'. The oligos are aligned in the register
 * that pairs best, and the stretches hanging off either side become the duplex's ends.
 */
export function annealOligos(
  topOligo: string,
  bottomOligo: string,
  options: OligoAnnealingOptions = {},
): OligoAnnealingResult {
  const top = normalizeDNA(topOligo);
  const bottom = normalizeDNA(bottomOligo);
  if (top.length < 4 || bottom.length < 4) {
    throw new Error('Annealing needs two oligos of at least 4 nt each');
  }
  const minDuplexLength = Math.max(2, options.minDuplexLength ?? 6);
  const maxMismatches = Math.max(0, options.maxMismatches ?? 0);
  const phosphorylated = options.phosphorylated ?? false;

  // The bottom oligo laid out in the top strand's direction, so positions line up.
  const pairingBottom = reverseComplement(bottom);
  const found = registers(top, pairingBottom, minDuplexLength, maxMismatches);
  if (!found.length) {
    throw new Error(
      `The two oligos do not pair over ${minDuplexLength} nt or more with at most ${maxMismatches} mismatch(es)`,
    );
  }
  const best = found[0];
  const bestScore = best.length - best.mismatches.length * 4;
  const alternatives = found.filter(
    (register) => register !== best && register.length - register.mismatches.length * 4 === bestScore,
  ).length;

  const offset = best.offset;
  const pairedStart = Math.max(0, offset);
  const core = top.slice(pairedStart, pairedStart + best.length);

  // Both ends are sealed through one of the two oligos' own 5' termini - the top oligo's
  // on the left, the bottom oligo's on the right - so both carry the same phosphate state.
  const left: OverhangEnd =
    offset > 0
      ? { type: '5-prime', sequence: top.slice(0, offset), phosphorylated }
      : offset < 0
        ? { type: '3-prime', sequence: bottom.slice(bottom.length + offset), phosphorylated }
        : { type: 'blunt', sequence: '', phosphorylated };
  const topRightOverhang = top.length - (offset + bottom.length);
  const right: OverhangEnd =
    topRightOverhang > 0
      ? { type: '3-prime', sequence: top.slice(offset + bottom.length), phosphorylated }
      : topRightOverhang < 0
        ? { type: '5-prime', sequence: bottom.slice(0, -topRightOverhang), phosphorylated }
        : { type: 'blunt', sequence: '', phosphorylated };

  const tm = meltingTemperature(core, options.conditions).tm;
  const warnings: string[] = [];
  if (best.mismatches.length) {
    warnings.push(
      `Paired region carries ${best.mismatches.length} mismatch(es) at position(s) ${best.mismatches
        .map((position) => position + 1)
        .join(', ')} of the duplex.`,
    );
  }
  if (alternatives) {
    warnings.push(
      `${alternatives} other register(s) pair equally well; the oligos may anneal in more than one way.`,
    );
  }
  if (best.length < 12) {
    warnings.push(
      `The paired region is only ${best.length} bp (Tm ${tm.toFixed(1)} °C); anneal by heating to 95 °C and cooling slowly rather than at room temperature.`,
    );
  }
  if (!phosphorylated && (left.type !== 'blunt' || right.type !== 'blunt')) {
    warnings.push(
      "Ordered oligos have a free 5'-OH: phosphorylate them with T4 PNK, or keep the vector phosphorylated, or the junctions cannot be sealed.",
    );
  }
  if (left.type === 'blunt' && right.type === 'blunt') {
    warnings.push('Both ends are blunt; ligation will not be directional.');
  }
  for (const [label, oligo] of [
    ['top', top],
    ['bottom', bottom],
  ] as const) {
    const thermo = evaluateOligoThermodynamics(oligo, options.conditions);
    if (thermo.hairpinDeltaG <= -3) {
      warnings.push(
        `The ${label} oligo folds on itself (hairpin dG ${thermo.hairpinDeltaG.toFixed(1)} kcal/mol), which competes with annealing.`,
      );
    }
  }

  const name = options.name ?? `Oligo_duplex_${best.length}bp`;
  const duplex = makeDocument({
    name,
    sequence: top,
    topology: 'linear',
    linearEnds: { left, right },
    description: `Annealed oligo duplex: ${best.length} bp paired, ${describeEnd(left)} / ${describeEnd(right)} ends.`,
  });
  duplex.history.push(
    makeHistoryNode(
      'oligo_annealing',
      `Annealed ${top.length} nt and ${bottom.length} nt oligos into a ${best.length} bp duplex (Tm ${tm.toFixed(1)} °C).`,
      { primersUsed: [top, bottom] },
    ),
  );

  return {
    duplex,
    offset,
    duplexLength: best.length,
    mismatchPositions: best.mismatches,
    tm,
    left,
    right,
    alternatives,
    warnings,
  };
}

/** A short human label for an end, as the dialog and the fragment description show it. */
export function describeEnd(end: DuplexEnd): string {
  if (end.type === 'blunt') return 'blunt';
  return `${end.type === '5-prime' ? "5'" : "3'"}-${end.sequence}`;
}

export interface AnnealedOligoDesign {
  /** The oligo to order for the top strand, 5'->3'. */
  top: string;
  /** The oligo to order for the bottom strand, 5'->3'. */
  bottom: string;
  /** The duplex those two oligos give, with the requested ends. */
  result: OligoAnnealingResult;
}

/**
 * Work the other way round: given the double-stranded stretch wanted and the ends it
 * must present, write the two oligos to order. Pass the ends of a digested vector
 * straight in and the duplex will ligate into it.
 */
export function designAnnealedOligos(spec: {
  /** The base-paired core of the insert, written on the top strand 5'->3'. */
  insert: string;
  /** The end the duplex should show on its left, in the same form a digest reports. */
  leftOverhang?: DuplexEnd;
  /** The end the duplex should show on its right. */
  rightOverhang?: DuplexEnd;
  phosphorylated?: boolean;
  name?: string;
  conditions?: ReactionConditions;
}): AnnealedOligoDesign {
  const core = normalizeDNA(spec.insert);
  if (core.length < 2) throw new Error('The insert needs at least 2 bp');
  const left: DuplexEnd = spec.leftOverhang
    ? { type: spec.leftOverhang.type, sequence: normalizeDNA(spec.leftOverhang.sequence) }
    : { type: 'blunt', sequence: '' };
  const right: DuplexEnd = spec.rightOverhang
    ? { type: spec.rightOverhang.type, sequence: normalizeDNA(spec.rightOverhang.sequence) }
    : { type: 'blunt', sequence: '' };
  for (const end of [left, right]) {
    if (end.type === 'blunt' && end.sequence) {
      throw new Error('A blunt end cannot carry overhang bases');
    }
    if (end.type !== 'blunt' && !end.sequence) {
      throw new Error(`A ${end.type} end needs its overhang bases`);
    }
  }

  // Overhang bases sit on whichever strand protrudes; the core is on both.
  const top =
    (left.type === '5-prime' ? left.sequence : '') + core + (right.type === '3-prime' ? right.sequence : '');
  const bottom =
    (right.type === '5-prime' ? right.sequence : '') +
    reverseComplement(core) +
    (left.type === '3-prime' ? left.sequence : '');

  const result = annealOligos(top, bottom, {
    minDuplexLength: Math.min(core.length, 6),
    phosphorylated: spec.phosphorylated,
    name: spec.name ?? `Oligo_duplex_${core.length}bp`,
    conditions: spec.conditions,
  });
  if (result.duplexLength !== core.length) {
    // The two oligos pair somewhere other than intended, which only happens when the
    // insert is repetitive enough to slip; say so rather than return a wrong duplex.
    throw new Error(
      `The designed oligos pair over ${result.duplexLength} bp instead of the intended ${core.length} bp; the insert or the overhangs repeat.`,
    );
  }
  return { top, bottom, result };
}
