import type { CutSite, OverhangEnd, RestrictionEnzyme } from '../../types/schema';
import {
  findMotifOnBothStrands,
  findMotifOnlyPositions,
  mod,
  normalizeDNA,
  reverseComplement,
  sequenceSlice,
} from './utils';

export interface EnzymeDefinition extends RestrictionEnzyme {
  isTypeIIS?: boolean;
}

export function makeEnzyme(
  name: string,
  recognitionSeq: string,
  cutIndexTop: number,
  cutIndexBottom: number,
  options?: Partial<RestrictionEnzyme>,
): RestrictionEnzyme {
  return {
    name,
    recognitionSeq: normalizeDNA(recognitionSeq),
    cutIndexTop,
    cutIndexBottom,
    isTypeIIS: options?.isTypeIIS ?? Math.max(cutIndexTop, cutIndexBottom) > recognitionSeq.length,
    methylationSensitivity: options?.methylationSensitivity,
    suppliers: options?.suppliers,
    nebBuffers: options?.nebBuffers,
  };
}

export const COMMON_ENZYMES: RestrictionEnzyme[] = [
  makeEnzyme('EcoRI', 'GAATTC', 1, 5, { suppliers: ['NEB', 'Thermo'] }),
  makeEnzyme('BamHI', 'GGATCC', 1, 5, { suppliers: ['NEB', 'Thermo'] }),
  makeEnzyme('BglII', 'AGATCT', 1, 5, { suppliers: ['NEB', 'Thermo'] }),
  makeEnzyme('NheI', 'GCTAGC', 1, 5, { suppliers: ['NEB'] }),
  makeEnzyme('SpeI', 'ACTAGT', 1, 5, { suppliers: ['NEB'] }),
  makeEnzyme('XbaI', 'TCTAGA', 1, 5, { suppliers: ['NEB'] }),
  makeEnzyme('SalI', 'GTCGAC', 1, 5, { suppliers: ['NEB'] }),
  makeEnzyme('XhoI', 'CTCGAG', 1, 5, { suppliers: ['NEB'] }),
  makeEnzyme('HindIII', 'AAGCTT', 1, 5, { suppliers: ['NEB'] }),
  makeEnzyme('PstI', 'CTGCAG', 5, 1, { suppliers: ['NEB'] }),
  makeEnzyme('KpnI', 'GGTACC', 5, 1, { suppliers: ['NEB'] }),
  makeEnzyme('SacI', 'GAGCTC', 5, 1, { suppliers: ['NEB'] }),
  makeEnzyme('SmaI', 'CCCGGG', 3, 3, { suppliers: ['NEB'] }),
  makeEnzyme('NotI', 'GCGGCCGC', 2, 6, { suppliers: ['NEB'] }),
  makeEnzyme('BsaI', 'GGTCTC', 7, 11, { isTypeIIS: true, suppliers: ['NEB'] }),
  makeEnzyme('BsmBI', 'CGTCTC', 7, 11, { isTypeIIS: true, suppliers: ['NEB'] }),
  makeEnzyme('BbsI', 'GAAGAC', 8, 12, { isTypeIIS: true, suppliers: ['NEB'] }),
  makeEnzyme('SapI', 'GCTCTTC', 8, 11, { isTypeIIS: true, suppliers: ['NEB'] }),
  makeEnzyme('PaqCI', 'CACCTGC', 11, 15, { isTypeIIS: true, suppliers: ['NEB'] }),
  makeEnzyme('BspQI', 'GCTCTTC', 8, 11, { isTypeIIS: true, suppliers: ['NEB'] }),
  makeEnzyme('AgeI', 'ACCGGT', 1, 5, { suppliers: ['NEB'] }),
  makeEnzyme('AvrII', 'CCTAGG', 1, 5, { suppliers: ['NEB'] }),
  makeEnzyme('BclI', 'TGATCA', 1, 5, {
    suppliers: ['NEB'],
    methylationSensitivity: { dam: 'blocked', dcm: 'insensitive', cpg: 'insensitive' },
  }),
  makeEnzyme('ClaI', 'ATCGAT', 2, 4, {
    suppliers: ['NEB'],
    methylationSensitivity: { dam: 'blocked', dcm: 'impaired', cpg: 'insensitive' },
  }),
  makeEnzyme('EcoRV', 'GATATC', 3, 3, { suppliers: ['NEB'] }),
  makeEnzyme('HpaI', 'GTTAAC', 3, 3, { suppliers: ['NEB'] }),
  makeEnzyme('MluI', 'ACGCGT', 1, 5, { suppliers: ['NEB'] }),
  makeEnzyme('NcoI', 'CCATGG', 1, 5, { suppliers: ['NEB'] }),
  makeEnzyme('NdeI', 'CATATG', 2, 4, { suppliers: ['NEB'] }),
  makeEnzyme('PvuII', 'CAGCTG', 3, 3, { suppliers: ['NEB'] }),
  makeEnzyme('ScaI', 'AGTACT', 3, 3, { suppliers: ['NEB'] }),
  makeEnzyme('StuI', 'AGGCCT', 3, 3, { suppliers: ['NEB'] }),
  makeEnzyme('ApaI', 'GGGCCC', 5, 1, { suppliers: ['NEB'] }),
  makeEnzyme('AscI', 'GGCGCGCC', 2, 6, { suppliers: ['NEB'] }),
  makeEnzyme('PacI', 'TTAATTAA', 5, 3, { suppliers: ['NEB'] }),
  makeEnzyme('PmeI', 'GTTTAAAC', 4, 4, { suppliers: ['NEB'] }),
  makeEnzyme('SbfI', 'CCTGCAGG', 6, 2, { suppliers: ['NEB'] }),
  makeEnzyme('SgrAI', 'CRCCGGYG', 2, 6, { suppliers: ['NEB'] }),
  makeEnzyme('BspEI', 'TCCGGA', 1, 5, { suppliers: ['NEB'] }),
  makeEnzyme('BstBI', 'TTCGAA', 1, 5, { suppliers: ['NEB'] }),
  makeEnzyme('KasI', 'GGCGCC', 1, 5, { suppliers: ['NEB'] }),
  makeEnzyme('MfeI', 'CAATTG', 1, 5, { suppliers: ['NEB'] }),
  makeEnzyme('MscI', 'TGGCCA', 3, 3, { suppliers: ['NEB'] }),
  makeEnzyme('NsiI', 'ATGCAT', 5, 1, { suppliers: ['NEB'] }),
  makeEnzyme('ZraI', 'GACGTC', 3, 3, { suppliers: ['NEB'] }),
  makeEnzyme('BspHI', 'TCATGA', 1, 5, { suppliers: ['NEB'] }),
  makeEnzyme('BstZ17I', 'GTATAC', 3, 3, { suppliers: ['NEB'] }),
  makeEnzyme('PspOMI', 'GGGCCC', 1, 5, { suppliers: ['NEB'] }),
  makeEnzyme('Eco47III', 'AGCGCT', 3, 3, { suppliers: ['NEB'] }),
  makeEnzyme('HpaII', 'CCGG', 1, 3, { suppliers: ['NEB'] }),
  makeEnzyme('BstUI', 'CGCG', 2, 2, { suppliers: ['NEB'] }),
  makeEnzyme('DpnII', 'GATC', 0, 4, { suppliers: ['NEB'] }),
  makeEnzyme('BstNI', 'CCWGG', 2, 3, { suppliers: ['NEB'] }),
  makeEnzyme('CviQI', 'GTAC', 1, 3, { suppliers: ['NEB'] }),
];

export function enzymeByName(name: string): RestrictionEnzyme | undefined {
  const query = name.trim().toLowerCase();
  return COMMON_ENZYMES.find((enzyme) => enzyme.name.toLowerCase() === query);
}

export function resolveEnzyme(nameOrSequence: string): RestrictionEnzyme | undefined {
  const direct = enzymeByName(nameOrSequence);
  if (direct) return direct;
  const seq = normalizeDNA(nameOrSequence);
  if (/^[ACGTNRYSWKMBDHV]{4,}$/.test(seq)) {
    return makeEnzyme(seq, seq, 0, 0);
  }
  return undefined;
}

export interface EnzymeCutCoordinates {
  topLocal: number;
  bottomLocal: number;
  top: number;
  bottom: number;
}

/**
 * Cut coordinates in the top-strand coordinate system. For a site on the
 * bottom strand the enzyme's recognition-strand offsets are mirrored.
 */
export function cutCoordinates(
  position: number,
  enzyme: RestrictionEnzyme,
  strand: 1 | -1,
  sequenceLength: number,
  second = false,
): EnzymeCutCoordinates {
  const recognitionLength = enzyme.recognitionSeq.length;
  const cutTop = second && enzyme.secondCut ? enzyme.secondCut.top : enzyme.cutIndexTop;
  const cutBottom = second && enzyme.secondCut ? enzyme.secondCut.bottom : enzyme.cutIndexBottom;
  let topLocal: number;
  let bottomLocal: number;
  if (strand === 1) {
    topLocal = position + cutTop;
    bottomLocal = position + cutBottom;
  } else {
    topLocal = position + recognitionLength - cutBottom;
    bottomLocal = position + recognitionLength - cutTop;
  }
  return {
    topLocal,
    bottomLocal,
    top: mod(topLocal, sequenceLength),
    bottom: mod(bottomLocal, sequenceLength),
  };
}

function overhangFromDelta(
  sequence: string,
  topLocal: number,
  bottomLocal: number,
  circular: boolean,
  enzymeName: string,
): { left: OverhangEnd; right: OverhangEnd } {
  const delta = bottomLocal - topLocal;
  if (delta === 0) {
    return {
      left: { type: 'blunt', sequence: '', phosphorylated: true, sourceEnzyme: enzymeName },
      right: { type: 'blunt', sequence: '', phosphorylated: true, sourceEnzyme: enzymeName },
    };
  }
  if (delta > 0) {
    const overhang = sequenceSlice(sequence, topLocal, bottomLocal, circular).toUpperCase();
    return {
      left: { type: '5-prime', sequence: overhang, phosphorylated: true, sourceEnzyme: enzymeName },
      right: {
        type: '5-prime',
        sequence: reverseComplement(overhang),
        phosphorylated: true,
        sourceEnzyme: enzymeName,
      },
    };
  }
  const overhang = sequenceSlice(sequence, bottomLocal, topLocal, circular).toUpperCase();
  return {
    left: {
      type: '3-prime',
      sequence: reverseComplement(overhang),
      phosphorylated: true,
      sourceEnzyme: enzymeName,
    },
    right: { type: '3-prime', sequence: overhang, phosphorylated: true, sourceEnzyme: enzymeName },
  };
}

export function cutEnds(
  sequence: string,
  coordinates: EnzymeCutCoordinates,
  circular: boolean,
  enzymeName: string,
): { left: OverhangEnd; right: OverhangEnd } {
  return overhangFromDelta(sequence, coordinates.topLocal, coordinates.bottomLocal, circular, enzymeName);
}

export interface MethylationProfile {
  dam: boolean;
  dcm: boolean;
  cpg: boolean;
}

function overlapsMotif(
  sequence: string,
  motif: string,
  from: number,
  to: number,
  circular: boolean,
): boolean {
  const length = sequence.length;
  const span = Math.max(1, to - from);
  for (const position of findMotifOnlyPositions(sequence, motif, circular)) {
    const motifLength = motif.length;
    for (let offset = 0; offset < motifLength; offset += 1) {
      const point = mod(position + offset, length);
      const relative = circular ? mod(point - from, length) : point - from;
      if (relative >= 0 && relative < span) return true;
    }
  }
  return false;
}

export function isMethylationBlocked(
  sequence: string,
  enzyme: RestrictionEnzyme,
  position: number,
  profile: MethylationProfile = { dam: true, dcm: true, cpg: false },
): boolean {
  const length = sequence.length;
  const recognitionLength = enzyme.recognitionSeq.length;
  const regionStart = position - 4;
  const regionEnd = position + recognitionLength + 6;
  const damDecision = enzyme.methylationSensitivity?.dam;
  const dcmDecision = enzyme.methylationSensitivity?.dcm;
  if (profile.dam && damDecision !== 'insensitive' && overlapsMotif(sequence, 'GATC', regionStart, regionEnd, true)) {
    return damDecision === 'blocked';
  }
  if (profile.dcm && dcmDecision !== 'insensitive' && overlapsMotif(sequence, 'CCWGG', regionStart, regionEnd, true)) {
    return dcmDecision === 'blocked';
  }
  if (profile.cpg && overlapsMotif(sequence, 'CG', regionStart, regionEnd, true)) {
    return true;
  }
  return false;
}

export function findCutSites(
  sequence: string,
  enzyme: RestrictionEnzyme,
  circular = true,
  profile?: MethylationProfile,
): CutSite[] {
  const seq = normalizeDNA(sequence);
  const length = seq.length;
  if (!length) return [];
  const matches = findMotifOnBothStrands(seq, enzyme.recognitionSeq, circular);
  const cuts: CutSite[] = [];
  const passes = enzyme.secondCut ? [false, true] : [false];
  for (const match of matches) for (const second of passes) {
    const coordinates = cutCoordinates(match.position, enzyme, match.strand, length, second);
    const ends = cutEnds(seq, coordinates, circular, enzyme.name);
    cuts.push({
      id: `${enzyme.name}_${match.position}_${match.strand}${second ? '_2' : ''}`,
      enzyme,
      position: match.position,
      strand: match.strand,
      cutPositionTop: coordinates.top,
      cutPositionBottom: coordinates.bottom,
      overhangType: ends.left.type,
      overhangSeq: ends.left.sequence,
      isMethylationBlocked: profile ? isMethylationBlocked(seq, enzyme, match.position, profile) : false,
      totalCutsInPlasmid: matches.length * passes.length,
    });
  }
  return cuts.sort((a, b) => a.position - b.position);
}

export function endsCompatible(right: OverhangEnd, left: OverhangEnd): boolean {
  if (right.type !== left.type) return false;
  if (right.type === 'blunt') return true;
  const rightSeq = right.sequence.toUpperCase();
  const leftSeq = left.sequence.toUpperCase();
  if (!rightSeq.length || !leftSeq.length) return false;
  return reverseComplement(rightSeq) === leftSeq || reverseComplement(leftSeq) === rightSeq;
}

export function reverseEnd(end: OverhangEnd): OverhangEnd {
  return {
    type: end.type,
    sequence: reverseComplement(end.sequence),
    phosphorylated: end.phosphorylated,
    sourceEnzyme: end.sourceEnzyme,
  };
}

export interface OverhangFidelity {
  score: number;
  warnings: string[];
}

/**
 * Empirical overhang quality heuristic inspired by the NEB Ligase Fidelity
 * dataset: palindromic overhangs self-ligate, low-complexity overhangs are
 * promiscuous, and overhangs that differ by a single base increase mis-ligation.
 */
export function scoreOverhang(overhang: string, allOverhangs: string[]): OverhangFidelity {
  const sequence = normalizeDNA(overhang);
  const warnings: string[] = [];
  if (!sequence.length) return { score: 0, warnings: ['Empty overhang'] };
  const gc = ((sequence.match(/[GC]/g) ?? []).length / sequence.length) * 100;
  let score = 1;
  if (reverseComplement(sequence) === sequence) {
    score *= 0.35;
    warnings.push(`${sequence} is palindromic and can self-ligate`);
  }
  if (/(.)\1{2,}/.test(sequence)) {
    score *= 0.45;
    warnings.push(`${sequence} has low sequence complexity`);
  }
  if (gc === 0 || gc === 100) {
    score *= 0.5;
    warnings.push(`${sequence} is extremely GC-poor or GC-rich`);
  } else if (gc < 25 || gc > 75) {
    score *= 0.8;
  }
  for (const other of allOverhangs) {
    if (other === sequence) continue;
    const distance = Math.min(
      [...sequence].reduce((total, base, index) => total + (base === other[index] ? 0 : 1), 0),
      [...sequence].reduce((total, base, index) => total + (base === reverseComplement(other)[index] ? 0 : 1), 0),
    );
    if (distance === 1) {
      score *= 0.6;
      warnings.push(`${sequence} differs by one base from ${other}`);
      break;
    }
  }
  return { score: Math.max(0.05, Math.min(1, score)), warnings };
}

export function isTypeIIS(enzyme: RestrictionEnzyme): boolean {
  return enzyme.isTypeIIS ?? Math.max(enzyme.cutIndexTop, enzyme.cutIndexBottom) > enzyme.recognitionSeq.length;
}

export const NEB_LEADER_BASES: Record<string, string> = {
  EcoRI: 'GCG',
  BamHI: 'GCG',
  BglII: 'GCG',
  HindIII: 'GCG',
  XhoI: 'GCG',
  SalI: 'GCG',
  XbaI: 'GCG',
  SpeI: 'GCG',
  NheI: 'GCG',
  KpnI: 'GCG',
  SacI: 'GCG',
  PstI: 'GCG',
  SmaI: 'GCG',
  NotI: 'AAGGAAAAA',
  AgeI: 'GCG',
  AvrII: 'GCG',
  NcoI: 'GCG',
  NdeI: 'GCG',
  EcoRV: 'GCG',
};

export function recommendedLeader(enzymeName: string): string {
  return NEB_LEADER_BASES[enzymeName] ?? 'GCG';
}

export function enzymeRecognitionForTail(
  enzymeOrSequence: string,
  reverse: boolean,
): { sequence: string; enzyme?: RestrictionEnzyme } {
  const direct = enzymeByName(enzymeOrSequence);
  const sequence = normalizeDNA(enzymeOrSequence);
  const enzyme =
    direct ??
    COMMON_ENZYMES.find((candidate) => candidate.recognitionSeq === sequence);
  if (enzyme) {
    return {
      sequence: reverse ? reverseComplement(enzyme.recognitionSeq) : enzyme.recognitionSeq,
      enzyme,
    };
  }
  return { sequence, enzyme: undefined };
}
