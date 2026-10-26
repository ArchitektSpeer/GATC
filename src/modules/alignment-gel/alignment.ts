import type { PlasmidDocument, SangerTraceData, SequenceFeature } from '../../types/schema';
import { detectSecondaryPeaks } from './abif';
import { complementBase, translateCodon } from './genetics';

export interface GotohScoring {
  match?: number;
  mismatch?: number;
  gapOpen?: number;
  gapExtend?: number;
}

function modulo(value: number, length: number): number {
  return ((value % length) + length) % length;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function gotohLocalAlign(
  ref: string,
  query: string,
  scoring: GotohScoring = {}
): {
  score: number;
  refStart: number;
  refEnd: number;
  queryStart: number;
  queryEnd: number;
  alignedRef: string;
  alignedQuery: string;
} {
  const reference = ref.toUpperCase();
  const read = query.toUpperCase();
  const n = reference.length;
  const m = read.length;
  if (n === 0 || m === 0) {
    return {
      score: 0,
      refStart: 0,
      refEnd: 0,
      queryStart: 0,
      queryEnd: 0,
      alignedRef: '',
      alignedQuery: ''
    };
  }

  const matchScore = scoring.match ?? 2;
  const mismatchScore = scoring.mismatch ?? -1;
  const gapOpen = scoring.gapOpen === undefined ? -3 : -Math.abs(scoring.gapOpen);
  const gapExtend = scoring.gapExtend === undefined ? -1 : -Math.abs(scoring.gapExtend);

  const columns = m + 1;
  const cells = (n + 1) * columns;
  const matrix = new Int32Array(cells);
  const gapInQuery = new Int32Array(cells);
  const gapInRef = new Int32Array(cells);
  const pointerM = new Uint8Array(cells);
  const pointerX = new Uint8Array(cells);
  const pointerY = new Uint8Array(cells);

  let bestScore = 0;
  let bestI = 0;
  let bestJ = 0;
  let bestMatrix: 1 | 2 | 3 = 1;

  for (let i = 1; i <= n; i += 1) {
    const refChar = reference[i - 1];
    const row = i * columns;
    const previousRow = (i - 1) * columns;
    for (let j = 1; j <= m; j += 1) {
      const index = row + j;
      const diagonal = previousRow + j - 1;

      let previousBest = matrix[diagonal];
      let previousMatrix: 1 | 2 | 3 = 1;
      if (gapInQuery[diagonal] > previousBest) {
        previousBest = gapInQuery[diagonal];
        previousMatrix = 2;
      }
      if (gapInRef[diagonal] > previousBest) {
        previousBest = gapInRef[diagonal];
        previousMatrix = 3;
      }
      const substitution = refChar === read[j - 1] ? matchScore : mismatchScore;
      const matchValue = previousBest + substitution;
      if (matchValue > 0) {
        matrix[index] = matchValue;
        pointerM[index] = previousMatrix;
      }

      let openValue = matrix[previousRow + j] + gapOpen;
      let openPointer: 1 | 2 | 3 = 1;
      if (gapInQuery[previousRow + j] + gapExtend > openValue) {
        openValue = gapInQuery[previousRow + j] + gapExtend;
        openPointer = 2;
      }
      if (gapInRef[previousRow + j] + gapOpen > openValue) {
        openValue = gapInRef[previousRow + j] + gapOpen;
        openPointer = 3;
      }
      if (openValue > 0) {
        gapInQuery[index] = openValue;
        pointerX[index] = openPointer;
      }

      let extendValue = matrix[row + j - 1] + gapOpen;
      let extendPointer: 1 | 2 | 3 = 1;
      if (gapInRef[row + j - 1] + gapExtend > extendValue) {
        extendValue = gapInRef[row + j - 1] + gapExtend;
        extendPointer = 3;
      }
      if (gapInQuery[row + j - 1] + gapOpen > extendValue) {
        extendValue = gapInQuery[row + j - 1] + gapOpen;
        extendPointer = 2;
      }
      if (extendValue > 0) {
        gapInRef[index] = extendValue;
        pointerY[index] = extendPointer;
      }

      if (matrix[index] > bestScore) {
        bestScore = matrix[index];
        bestI = i;
        bestJ = j;
        bestMatrix = 1;
      }
      if (gapInQuery[index] > bestScore) {
        bestScore = gapInQuery[index];
        bestI = i;
        bestJ = j;
        bestMatrix = 2;
      }
      if (gapInRef[index] > bestScore) {
        bestScore = gapInRef[index];
        bestI = i;
        bestJ = j;
        bestMatrix = 3;
      }
    }
  }

  if (bestScore <= 0) {
    return {
      score: 0,
      refStart: 0,
      refEnd: 0,
      queryStart: 0,
      queryEnd: 0,
      alignedRef: '',
      alignedQuery: ''
    };
  }

  let i = bestI;
  let j = bestJ;
  let current: 1 | 2 | 3 = bestMatrix;
  const refPieces: string[] = [];
  const queryPieces: string[] = [];
  while (i > 0 && j > 0) {
    const index = i * columns + j;
    if (current === 1) {
      if (matrix[index] <= 0 || pointerM[index] === 0) break;
      refPieces.push(reference[i - 1]);
      queryPieces.push(read[j - 1]);
      const next = pointerM[index];
      i -= 1;
      j -= 1;
      current = next === 1 ? 1 : next === 2 ? 2 : 3;
    } else if (current === 2) {
      if (gapInQuery[index] <= 0 || pointerX[index] === 0) break;
      refPieces.push(reference[i - 1]);
      queryPieces.push('-');
      const next = pointerX[index];
      i -= 1;
      current = next === 1 ? 1 : next === 2 ? 2 : 3;
    } else {
      if (gapInRef[index] <= 0 || pointerY[index] === 0) break;
      refPieces.push('-');
      queryPieces.push(read[j - 1]);
      const next = pointerY[index];
      j -= 1;
      current = next === 1 ? 1 : next === 2 ? 2 : 3;
    }
  }

  const refStart = i;
  const queryStart = j;
  refPieces.reverse();
  queryPieces.reverse();
  return {
    score: bestScore,
    refStart,
    refEnd: bestI,
    queryStart,
    queryEnd: bestJ,
    alignedRef: refPieces.join(''),
    alignedQuery: queryPieces.join('')
  };
}

function buildSeedIndex(reference: string, kmerLength: number): Map<string, number[]> {
  const index = new Map<string, number[]>();
  const limit = 64;
  for (let position = 0; position + kmerLength <= reference.length; position += 1) {
    const kmer = reference.slice(position, position + kmerLength);
    if (!/^[ACGT]+$/.test(kmer)) continue;
    const locations = index.get(kmer);
    if (!locations) {
      index.set(kmer, [position]);
    } else if (locations.length < limit) {
      locations.push(position);
    }
  }
  return index;
}

function findSeedDiagonal(reference: string, query: string, kmerLength: number): number | null {
  const k = Math.max(4, Math.min(kmerLength, query.length));
  if (query.length < k) return null;
  const index = buildSeedIndex(reference, k);
  if (index.size === 0) return null;
  const step = Math.max(1, Math.floor(query.length / 32));
  const seedPositions: number[] = [];
  for (let position = 0; position + k <= query.length; position += step) {
    seedPositions.push(position);
  }
  const lastPosition = query.length - k;
  if (lastPosition >= 0 && seedPositions[seedPositions.length - 1] !== lastPosition) {
    seedPositions.push(lastPosition);
  }

  const diagonals = new Map<number, number>();
  for (const queryPosition of seedPositions) {
    const kmer = query.slice(queryPosition, queryPosition + k);
    if (!/^[ACGT]+$/.test(kmer)) continue;
    const hits = index.get(kmer);
    if (!hits) continue;
    for (const referencePosition of hits) {
      const diagonal = referencePosition - queryPosition;
      diagonals.set(diagonal, (diagonals.get(diagonal) ?? 0) + 1);
    }
  }
  if (diagonals.size === 0) return null;

  let bestDiagonal: number | null = null;
  let bestCount = -1;
  for (const [diagonal, count] of diagonals) {
    if (count > bestCount || (count === bestCount && bestDiagonal !== null && diagonal < bestDiagonal)) {
      bestCount = count;
      bestDiagonal = diagonal;
    }
  }
  return bestDiagonal;
}

interface AioliInstance {
  mount(files: Array<{ name: string; data: Uint8Array }>): Promise<void>;
  exec(command: string): Promise<string>;
}

async function tryMinimap2Diagonal(reference: string, query: string): Promise<number | null> {
  if (typeof Worker === 'undefined' || typeof self === 'undefined') return null;
  try {
    const moduleName = '@biowasm/aioli';
    const imported = (await import(/* @vite-ignore */ moduleName)) as { default?: unknown };
    const Constructor = imported.default;
    if (typeof Constructor !== 'function') return null;
    const ConstructorWithTools = Constructor as new (tools: string[]) => Promise<AioliInstance>;
    const cli = await new ConstructorWithTools(['minimap2/2.24']);
    if (!cli || typeof cli.mount !== 'function' || typeof cli.exec !== 'function') return null;
    const encoder = new TextEncoder();
    await cli.mount([
      { name: 'reference.fa', data: encoder.encode(`>reference\n${reference}\n`) },
      { name: 'query.fa', data: encoder.encode(`>query\n${query}\n`) }
    ]);
    const output = await cli.exec('minimap2 -c /mnt/reference.fa /mnt/query.fa');
    if (typeof output !== 'string') return null;
    for (const line of output.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const fields = line.split('\t');
      if (fields.length < 9) continue;
      const strand = fields[4];
      const targetStart = Number(fields[7]);
      const queryStart = Number(fields[2]);
      if (strand !== '+' || !Number.isFinite(targetStart) || !Number.isFinite(queryStart)) continue;
      return targetStart - queryStart;
    }
  } catch {
    return null;
  }
  return null;
}

function featureSpan(feature: SequenceFeature, sequenceLength: number, circular: boolean): number {
  if (feature.end > feature.start) return feature.end - feature.start;
  if (feature.end < feature.start && circular) {
    return sequenceLength - feature.start + feature.end;
  }
  return 0;
}

function featureContains(
  feature: SequenceFeature,
  position: number,
  sequenceLength: number,
  circular: boolean
): boolean {
  const span = featureSpan(feature, sequenceLength, circular);
  if (span <= 0) return false;
  if (!circular) return position >= feature.start && position < feature.end;
  return modulo(position - feature.start, sequenceLength) < span;
}

function baseAt(sequence: string, position: number, circular: boolean): string {
  if (sequence.length === 0) return 'N';
  if (circular) return sequence[modulo(position, sequence.length)] ?? 'N';
  if (position < 0 || position >= sequence.length) return 'N';
  return sequence[position] ?? 'N';
}

interface CdsContext {
  sequence: string;
  features: SequenceFeature[];
  circular: boolean;
  substitutions: Map<number, string>;
}

function findCds(position: number, context: CdsContext): SequenceFeature | undefined {
  const length = context.sequence.length;
  return context.features.find(
    feature =>
      feature.type === 'CDS' &&
      featureContains(feature, position, length, context.circular)
  );
}

function annotateSubstitution(
  position: number,
  context: CdsContext
): string | undefined {
  const feature = findCds(position, context);
  if (!feature) return undefined;
  const sequenceLength = context.sequence.length;
  const span = featureSpan(feature, sequenceLength, context.circular);
  const offset =
    feature.strand === -1
      ? modulo(feature.end - 1 - position, sequenceLength)
      : modulo(position - feature.start, sequenceLength);
  if (offset < 0 || offset >= span) return undefined;

  const frameOffset = (feature.codonStart ?? 1) - 1;
  const aminoOffset = offset - frameOffset;
  if (aminoOffset < 0) return undefined;
  if (aminoOffset + 2 >= span) return undefined;

  const codonIndex = Math.floor(aminoOffset / 3);
  const codonNumber = codonIndex + 1;
  let referenceCodon = '';
  let queryCodon = '';
  for (let baseIndex = 0; baseIndex < 3; baseIndex += 1) {
    const codonPosition =
      feature.strand === -1
        ? feature.end - 1 - frameOffset - codonIndex * 3 - baseIndex
        : feature.start + frameOffset + codonIndex * 3 + baseIndex;
    const referenceBase = baseAt(context.sequence, codonPosition, context.circular);
    const key = context.circular ? modulo(codonPosition, sequenceLength) : codonPosition;
    const queryBase = context.substitutions.get(key) ?? referenceBase;
    referenceCodon += referenceBase;
    queryCodon += queryBase;
  }

  if (feature.strand === -1) {
    referenceCodon = referenceCodon
      .split('')
      .map(base => complementBase(base))
      .join('');
    queryCodon = queryCodon
      .split('')
      .map(base => complementBase(base))
      .join('');
  }
  if (!/^[ACGT]{3}$/.test(referenceCodon) || !/^[ACGT]{3}$/.test(queryCodon)) {
    return undefined;
  }
  const referenceAmino = translateCodon(referenceCodon);
  const queryAmino = translateCodon(queryCodon);
  if (referenceAmino === 'X' || queryAmino === 'X') return undefined;

  if (referenceAmino === queryAmino) {
    return `Silent (${referenceAmino}${codonNumber}${queryAmino} in ${feature.name})`;
  }
  if (queryAmino === '*') {
    return `Nonsense (${referenceAmino}${codonNumber}* Premature Stop)`;
  }
  if (referenceAmino === '*') {
    return `Readthrough (${referenceAmino}${codonNumber}${queryAmino} in ${feature.name})`;
  }
  return `Missense (${referenceAmino}${codonNumber}${queryAmino} in ${feature.name})`;
}

function annotateIndel(position: number, delta: number, context: CdsContext): string | undefined {
  const feature = findCds(position, context);
  if (!feature) return undefined;
  const magnitude = Math.abs(delta);
  if (magnitude === 0) return undefined;
  if (magnitude % 3 !== 0) {
    const sign = delta > 0 ? '+' : '-';
    return `Frameshift (${sign}${magnitude} bp in ${feature.name})`;
  }
  if (delta > 0) {
    return `In-frame insertion (+${magnitude} bp in ${feature.name})`;
  }
  return `In-frame deletion (-${magnitude} bp in ${feature.name})`;
}

function alignmentMismatches(
  alignedRef: string,
  alignedQuery: string,
  windowStart: number,
  queryOffset: number,
  circular: boolean,
  sequenceLength: number,
  trace: SangerTraceData
): Array<{
  refIndex: number;
  queryIndex: number;
  type: 'substitution' | 'insertion' | 'deletion' | 'heterozygous_peak';
  refBase: string;
  queryBase: string;
  aminoAcidImpact?: string;
}> {
  const mismatches: Array<{
    refIndex: number;
    queryIndex: number;
    type: 'substitution' | 'insertion' | 'deletion' | 'heterozygous_peak';
    refBase: string;
    queryBase: string;
    aminoAcidImpact?: string;
  }> = [];
  const secondaryMap = new Map<number, { iupac: string; primary: string; secondary: string }>();
  for (const call of detectSecondaryPeaks(trace)) {
    secondaryMap.set(call.baseIndex, call);
  }

  const coordinate = (absolute: number): number =>
    circular ? modulo(absolute, sequenceLength) : absolute;
  let refAbsolute = windowStart;
  let queryRelative = queryOffset;
  let column = 0;
  while (column < alignedRef.length) {
    const refChar = alignedRef[column];
    const queryChar = alignedQuery[column];
    if (refChar !== '-' && queryChar !== '-') {
      const refIndex = coordinate(refAbsolute);
      const queryIndex = queryRelative;
      const secondary = secondaryMap.get(queryIndex);
      if (secondary) {
        mismatches.push({
          refIndex,
          queryIndex,
          type: 'heterozygous_peak',
          refBase: refChar,
          queryBase: secondary.iupac
        });
      } else if (refChar !== queryChar) {
        mismatches.push({
          refIndex,
          queryIndex,
          type: 'substitution',
          refBase: refChar,
          queryBase: queryChar
        });
      }
      refAbsolute += 1;
      queryRelative += 1;
      column += 1;
    } else if (refChar === '-' && queryChar !== '-') {
      const startAbsolute = refAbsolute;
      const startQuery = queryRelative;
      let inserted = '';
      while (
        column < alignedRef.length &&
        alignedRef[column] === '-' &&
        alignedQuery[column] !== '-'
      ) {
        inserted += alignedQuery[column];
        column += 1;
        queryRelative += 1;
      }
      mismatches.push({
        refIndex: coordinate(startAbsolute),
        queryIndex: startQuery,
        type: 'insertion',
        refBase: '-',
        queryBase: inserted
      });
    } else if (refChar !== '-' && queryChar === '-') {
      const startAbsolute = refAbsolute;
      const startQuery = queryRelative;
      let deleted = '';
      while (
        column < alignedRef.length &&
        alignedRef[column] !== '-' &&
        alignedQuery[column] === '-'
      ) {
        deleted += alignedRef[column];
        column += 1;
        refAbsolute += 1;
      }
      mismatches.push({
        refIndex: coordinate(startAbsolute),
        queryIndex: startQuery,
        type: 'deletion',
        refBase: deleted,
        queryBase: '-'
      });
    } else {
      column += 1;
    }
  }
  return mismatches;
}

function addImpacts(
  mismatches: ReturnType<typeof alignmentMismatches>,
  trace: SangerTraceData,
  doc: PlasmidDocument
): void {
  const sequence = doc.sequence.toUpperCase();
  const circular = doc.topology === 'circular';
  const substitutions = new Map<number, string>();
  for (const mismatch of mismatches) {
    if (mismatch.type === 'substitution' || mismatch.type === 'heterozygous_peak') {
      const primaryBase = (trace.calledSequence[mismatch.queryIndex] ?? '').toUpperCase();
      const queryBase = /^[ACGT]$/.test(primaryBase)
        ? primaryBase
        : mismatch.queryBase.toUpperCase();
      if (/^[ACGT]$/.test(queryBase)) {
        substitutions.set(mismatch.refIndex, queryBase);
      } else {
        substitutions.set(mismatch.refIndex, 'N');
      }
    }
  }
  const context: CdsContext = {
    sequence,
    features: doc.features,
    circular,
    substitutions
  };
  for (const mismatch of mismatches) {
    if (mismatch.type === 'substitution' || mismatch.type === 'heterozygous_peak') {
      const impact = annotateSubstitution(mismatch.refIndex, context);
      if (impact) mismatch.aminoAcidImpact = impact;
    } else {
      const length =
        mismatch.type === 'insertion' ? mismatch.queryBase.length : mismatch.refBase.length;
      const delta = mismatch.type === 'insertion' ? length : -length;
      const impact = annotateIndel(mismatch.refIndex, delta, context);
      if (impact) mismatch.aminoAcidImpact = impact;
    }
  }
}

export async function alignTraceToPlasmid(
  trace: SangerTraceData,
  doc: PlasmidDocument,
  options: { useWasm?: boolean; kmer?: number } = {}
): Promise<SangerTraceData> {
  const sequence = doc.sequence.toUpperCase();
  const sequenceLength = sequence.length;
  if (sequenceLength === 0) {
    return {
      ...trace,
      alignment: {
        refStart: 0,
        refEnd: 0,
        strand: 1,
        identityPercent: 0,
        alignedRef: '',
        alignedQuery: '',
        mismatches: []
      }
    };
  }

  let trimStart = 0;
  let trimEnd = trace.calledSequence.length;
  if (Array.isArray(trace.trimRange) && trace.trimRange.length === 2) {
    const suppliedStart = Number.isFinite(trace.trimRange[0]) ? trace.trimRange[0] : 0;
    const suppliedEnd = Number.isFinite(trace.trimRange[1])
      ? trace.trimRange[1]
      : trace.calledSequence.length;
    trimStart = clamp(suppliedStart, 0, trace.calledSequence.length);
    trimEnd = clamp(suppliedEnd, trimStart, trace.calledSequence.length);
  }
  if (trimEnd - trimStart < 8) {
    trimStart = 0;
    trimEnd = trace.calledSequence.length;
  }
  const query = trace.calledSequence.slice(trimStart, trimEnd).toUpperCase();
  if (!query.length) {
    return {
      ...trace,
      alignment: {
        refStart: 0,
        refEnd: 0,
        strand: 1,
        identityPercent: 0,
        alignedRef: '',
        alignedQuery: '',
        mismatches: []
      }
    };
  }

  const circular = doc.topology === 'circular';
  const reference = circular ? sequence + sequence : sequence;
  const preferredKmer = clamp(
    Math.floor(Number.isFinite(options.kmer) ? (options.kmer as number) : 15),
    4,
    32
  );

  let windowStart = 0;
  let windowEnd = reference.length;
  let diagonal: number | null = null;
  if (options.useWasm) {
    diagonal = await tryMinimap2Diagonal(reference, query);
  }
  if (diagonal === null) {
    const attempts = Array.from(
      new Set<number>([
        preferredKmer,
        Math.max(6, Math.floor(preferredKmer * 0.7)),
        6
      ])
    ).filter(kmer => kmer >= 4 && kmer <= query.length);
    for (const kmer of attempts) {
      const candidate = findSeedDiagonal(reference, query, kmer);
      if (candidate !== null) {
        diagonal = candidate;
        break;
      }
    }
  }

  let alignment = {
    score: 0,
    refStart: 0,
    refEnd: 0,
    queryStart: 0,
    queryEnd: 0,
    alignedRef: '',
    alignedQuery: ''
  };
  if (diagonal !== null) {
    const margin = Math.max(32, Math.ceil(query.length * 0.15));
    windowStart = clamp(diagonal - margin, 0, reference.length);
    windowEnd = clamp(diagonal + query.length + margin, 0, reference.length);
    if (windowEnd <= windowStart) {
      windowStart = 0;
      windowEnd = reference.length;
    }
    alignment = gotohLocalAlign(reference.slice(windowStart, windowEnd), query);
  }

  const windowCells = (windowEnd - windowStart + 1) * (query.length + 1);
  const fullCells = (reference.length + 1) * (query.length + 1);
  const shouldTryFull =
    alignment.score <= 0
      ? fullCells <= 12_000_000
      : windowCells < 300_000 && reference.length * query.length < 4_000_000;
  if (shouldTryFull) {
    const fullAlignment = gotohLocalAlign(reference, query);
    if (fullAlignment.score > alignment.score) {
      alignment = fullAlignment;
      windowStart = 0;
    }
  }

  if (alignment.score <= 0) {
    return {
      ...trace,
      alignment: {
        refStart: 0,
        refEnd: 0,
        strand: 1,
        identityPercent: 0,
        alignedRef: '',
        alignedQuery: '',
        mismatches: []
      }
    };
  }

  let matchCount = 0;
  for (let index = 0; index < alignment.alignedRef.length; index += 1) {
    const refChar = alignment.alignedRef[index];
    const queryChar = alignment.alignedQuery[index];
    if (refChar !== '-' && queryChar !== '-' && refChar === queryChar) matchCount += 1;
  }
  const identityPercent =
    alignment.alignedRef.length > 0
      ? Math.round((matchCount / alignment.alignedRef.length) * 100000) / 1000
      : 0;

  const mismatches = alignmentMismatches(
    alignment.alignedRef,
    alignment.alignedQuery,
    windowStart + alignment.refStart,
    trimStart + alignment.queryStart,
    circular,
    sequenceLength,
    trace
  );
  addImpacts(mismatches, trace, doc);

  const referenceBasesConsumed = alignment.refEnd - alignment.refStart;
  const absoluteRefStart = windowStart + alignment.refStart;
  const absoluteRefEnd = absoluteRefStart + referenceBasesConsumed;
  const refStart = circular ? modulo(absoluteRefStart, sequenceLength) : absoluteRefStart;
  const refEnd = circular ? modulo(absoluteRefEnd, sequenceLength) : absoluteRefEnd;

  return {
    ...trace,
    alignment: {
      refStart,
      refEnd,
      strand: 1,
      identityPercent,
      alignedRef: alignment.alignedRef,
      alignedQuery: alignment.alignedQuery,
      mismatches
    }
  };
}
