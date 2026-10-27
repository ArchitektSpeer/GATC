import type {
  CloningHistoryNode,
  PlasmidDocument,
  Primer,
  SequenceFeature,
} from '../../types/schema';
import { designPrimerPair } from './primer';
import { meltingTemperature } from './thermo';
import {
  appendHistory,
  clamp,
  cloneFeature,
  cloneHistoryNode,
  clonePrimer,
  gcPercentOf,
  makeDocument,
  makeHistoryNode,
  mod,
  normalizeDNA,
  rangeLength,
  reverseComplement,
  shiftFeature,
  shiftPrimer,
  sliceDocumentData,
} from './utils';

export type HomologyAssemblyKit = 'Gibson' | 'NEBuilder HiFi' | 'In-Fusion';

interface KitSpec {
  min: number;
  max: number;
  defaultLength: number;
  targetTm: number;
}

const KIT_SPECS: Record<HomologyAssemblyKit, KitSpec> = {
  Gibson: { min: 20, max: 40, defaultLength: 30, targetTm: 48 },
  'NEBuilder HiFi': { min: 15, max: 35, defaultLength: 20, targetTm: 48 },
  'In-Fusion': { min: 15, max: 15, defaultLength: 15, targetTm: 0 },
};

const ANNEALING_TM_MIN = 58;
const ANNEALING_TM_MAX = 62;
const ANNEALING_TM_TARGET = 60;

interface JunctionOverlap {
  length: number;
  leftArm: string;
  rightArm: string;
}

function chooseJunctionOverlap(
  leftSequence: string,
  rightSequence: string,
  spec: KitSpec,
  requestedLength: number | undefined,
  kit: HomologyAssemblyKit,
  junctionLabel: string,
  warnings: string[],
): JunctionOverlap {
  const requested = requestedLength ?? spec.defaultLength;
  const maxAvailable = Math.min(spec.max, leftSequence.length, rightSequence.length);
  const minimum = Math.min(spec.min, maxAvailable);
  let length = clamp(Math.round(requested), minimum, maxAvailable);
  if (length !== Math.round(requested)) {
    warnings.push(
      `Requested overlap length ${Math.round(requested)} bp for ${junctionLabel} was adjusted to ${length} bp for ${kit}.`,
    );
  }
  if (maxAvailable < spec.min) {
    warnings.push(
      `Fragments at ${junctionLabel} are shorter than the ${spec.min} bp minimum homology arm; using ${maxAvailable} bp.`,
    );
  }
  const armTm = (arm: string): number => (arm.length >= 2 ? meltingTemperature(arm).tm : 0);
  let selected = length;
  if (spec.targetTm > 0) {
    let satisfied = false;
    for (let candidate = length; candidate <= maxAvailable; candidate += 1) {
      const leftArm = leftSequence.slice(leftSequence.length - candidate);
      const rightArm = reverseComplement(rightSequence.slice(0, candidate));
      selected = candidate;
      if (armTm(leftArm) >= spec.targetTm && armTm(rightArm) >= spec.targetTm) {
        satisfied = true;
        break;
      }
    }
    if (!satisfied) {
      warnings.push(
        `Homology arms at ${junctionLabel} remain below ${spec.targetTm} °C after extending to ${selected} bp.`,
      );
    }
  }
  return {
    length: selected,
    leftArm: leftSequence.slice(leftSequence.length - selected),
    rightArm: reverseComplement(rightSequence.slice(0, selected)),
  };
}

/**
 * Designs Gibson, NEBuilder HiFi or In-Fusion primers for a list of fragments
 * supplied in assembly order. Internal junctions receive homology arms from
 * both neighbouring fragments (the 3' end of the upstream fragment and the
 * reverse complement of the 5' end of the downstream fragment). For a
 * circular assembly the first and last fragments are joined in the same way;
 * for a linear assembly the two outer ends receive no tail.
 */
export function designHomologyAssemblyPrimers(
  fragments: PlasmidDocument[],
  kit: HomologyAssemblyKit,
  opts?: { circular?: boolean; overlapLength?: number },
): { primers: Array<{ fragmentId: string; forward: Primer; reverse: Primer }>; warnings: string[] } {
  const warnings: string[] = [];
  const spec = KIT_SPECS[kit];
  const circular = opts?.circular ?? true;
  if (!fragments.length) {
    return { primers: [], warnings: ['At least one fragment is required for homology assembly.'] };
  }
  if (circular && fragments.length === 1) {
    warnings.push('A circular assembly with one fragment simply rejoins its own ends.');
  }
  if (opts?.overlapLength !== undefined && kit === 'In-Fusion' && opts.overlapLength !== 15) {
    warnings.push('In-Fusion uses a fixed 15 bp homology arm; the requested overlap length was ignored.');
  }
  const sequences = fragments.map((fragment) => normalizeDNA(fragment.sequence));
  const forwardTails: string[] = fragments.map(() => '');
  const reverseTails: string[] = fragments.map(() => '');
  const junctionCount = circular ? fragments.length : Math.max(0, fragments.length - 1);
  for (let index = 0; index < junctionCount; index += 1) {
    const nextIndex = (index + 1) % fragments.length;
    const junction = chooseJunctionOverlap(
      sequences[index],
      sequences[nextIndex],
      spec,
      opts?.overlapLength,
      kit,
      `${fragments[index].name}->${fragments[nextIndex].name}`,
      warnings,
    );
    forwardTails[nextIndex] = junction.leftArm;
    reverseTails[index] = junction.rightArm;
  }
  const tag = kit === 'NEBuilder HiFi' ? 'NEBuilder' : kit.replace(/[^A-Za-z]/g, '');
  const primers: Array<{ fragmentId: string; forward: Primer; reverse: Primer }> = [];
  for (let index = 0; index < fragments.length; index += 1) {
    const fragment = fragments[index];
    const pair = designPrimerPair(
      fragment,
      { start: 0, end: fragment.length },
      {
        minLen: 15,
        maxLen: 30,
        targetTm: ANNEALING_TM_TARGET,
        forwardTail: forwardTails[index],
        reverseTail: reverseTails[index],
      },
    );
    const forward: Primer = {
      ...clonePrimer(pair.forward),
      name: `${fragment.name}_${tag}_F${index + 1}`,
    };
    const reverse: Primer = {
      ...clonePrimer(pair.reverse),
      name: `${fragment.name}_${tag}_R${index + 1}`,
    };
    if (
      forward.tmAnnealing < ANNEALING_TM_MIN ||
      forward.tmAnnealing > ANNEALING_TM_MAX ||
      reverse.tmAnnealing < ANNEALING_TM_MIN ||
      reverse.tmAnnealing > ANNEALING_TM_MAX
    ) {
      warnings.push(
        `Fragment ${index + 1} (${fragment.name}) annealing Tm is ${forward.tmAnnealing.toFixed(1)}/${reverse.tmAnnealing.toFixed(1)} °C, outside the 58-62 °C target.`,
      );
    }
    if (kit === 'In-Fusion') {
      const forwardGc = gcPercentOf(forwardTails[index]);
      const reverseGc = gcPercentOf(reverseTails[index]);
      if (forwardTails[index] && (forwardGc < 40 || forwardGc > 60)) {
        warnings.push(
          `In-Fusion forward homology arm for fragment ${index + 1} has ${forwardGc.toFixed(0)}% GC; 40-60% is recommended.`,
        );
      }
      if (reverseTails[index] && (reverseGc < 40 || reverseGc > 60)) {
        warnings.push(
          `In-Fusion reverse homology arm for fragment ${index + 1} has ${reverseGc.toFixed(0)}% GC; 40-60% is recommended.`,
        );
      }
    }
    warnings.push(...pair.warnings);
    primers.push({ fragmentId: fragment.id, forward, reverse });
  }
  return { primers, warnings };
}

interface Piece {
  start: number;
  end: number;
}

interface EditDescriptor {
  oldLength: number;
  newLength: number;
  replaceStart: number;
  replaceEnd: number;
  replaceLength: number;
  insertLength: number;
  circular: boolean;
  mode: 'insertion' | 'replacement' | 'wrapped' | 'full';
}

function parseSegmentCoordinate(text: string): Piece | null {
  const match = /^\s*(-?\d+)\s*-\s*(-?\d+)\s*$/.exec(text);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  return { start, end };
}

function toLinearIntervals(
  start: number,
  end: number,
  length: number,
  circular: boolean,
): Piece[] {
  if (!circular) {
    const from = clamp(start, 0, length);
    const to = clamp(end, 0, length);
    return to > from ? [{ start: from, end: to }] : [];
  }
  if (length <= 0) return [];
  const from = mod(start, length);
  const to = mod(end, length);
  if (from < to) return [{ start: from, end: to }];
  if (from > to) {
    return [
      { start: from, end: length },
      { start: 0, end: to },
    ];
  }
  return [];
}

function featureIntervals(feature: SequenceFeature, length: number, circular: boolean): Piece[] {
  const segments = feature.notes?.segments;
  if (segments && segments.length) {
    const intervals: Piece[] = [];
    for (const text of segments) {
      const parsed = parseSegmentCoordinate(text);
      if (!parsed) continue;
      intervals.push(...toLinearIntervals(parsed.start, parsed.end, length, circular));
    }
    return intervals;
  }
  return toLinearIntervals(feature.start, feature.end, length, circular);
}

function mapPieceThroughEdit(piece: Piece, edit: EditDescriptor): Piece[] {
  const { start: a, end: b } = piece;
  if (edit.mode === 'full') return [];
  if (edit.mode === 'wrapped') {
    const retainedFrom = edit.replaceEnd;
    const retainedTo = edit.replaceStart;
    const from = Math.max(a, retainedFrom);
    const to = Math.min(b, retainedTo);
    return to > from ? [{ start: from - retainedFrom, end: to - retainedFrom }] : [];
  }
  const { replaceStart: s, replaceEnd: e, replaceLength, insertLength } = edit;
  const delta = insertLength - replaceLength;
  if (edit.mode === 'insertion') {
    if (b <= s) return [{ start: a, end: b }];
    if (a >= s) return [{ start: a + insertLength, end: b + insertLength }];
    return [{ start: a, end: b + insertLength }];
  }
  if (b <= s) return [{ start: a, end: b }];
  if (a >= e) return [{ start: a + delta, end: b + delta }];
  const pieces: Piece[] = [];
  if (a < s) pieces.push({ start: a, end: s });
  if (b > e) pieces.push({ start: s + insertLength, end: b + delta });
  return pieces;
}

function mergePieces(pieces: Piece[]): Piece[] {
  const sorted = pieces
    .filter((piece) => piece.end > piece.start)
    .slice()
    .sort((a, b) => a.start - b.start);
  const merged: Piece[] = [];
  for (const piece of sorted) {
    const last = merged[merged.length - 1];
    if (last && piece.start <= last.end) {
      last.end = Math.max(last.end, piece.end);
    } else {
      merged.push({ ...piece });
    }
  }
  return merged;
}

/**
 * Combines the retained pieces of a feature. A feature that survives on both
 * sides of the origin is returned as a single wrapped interval (start > end).
 * Features with three or more disjoint pieces are represented with
 * `notes.segments` so that no annotation is lost.
 */
function buildFeatureFromPieces(
  feature: SequenceFeature,
  pieces: Piece[],
  edit: EditDescriptor,
  warnings: string[],
): SequenceFeature | null {
  const copy = cloneFeature(feature);
  const merged = mergePieces(pieces);
  if (!merged.length) return null;
  const newLength = edit.newLength;
  if (merged.length === 1) {
    copy.start = merged[0].start;
    copy.end = merged[0].end;
    if (copy.notes?.segments) {
      const notes = { ...copy.notes };
      delete notes.segments;
      copy.notes = notes;
    }
    return copy;
  }
  const first = merged[0];
  const last = merged[merged.length - 1];
  if (first.start === 0 && last.end >= newLength && newLength > 0) {
    const middle = merged.slice(1, -1);
    copy.start = last.start;
    copy.end = first.end;
    if (middle.length) {
      copy.notes = {
        ...(copy.notes ?? {}),
        segments: [
          `${last.start}-${newLength}`,
          ...middle.map((piece) => `${piece.start}-${piece.end}`),
          `0-${first.end}`,
        ],
      };
    }
    return copy;
  }
  const ordered = feature.strand === -1 ? merged.slice().reverse() : merged;
  copy.start = ordered[0].start;
  copy.end = ordered[ordered.length - 1].end;
  copy.notes = {
    ...(copy.notes ?? {}),
    segments: ordered.map((piece) => `${piece.start}-${piece.end}`),
  };
  warnings.push(
    `Feature ${feature.name} was split into ${ordered.length} segments by the replacement.`,
  );
  return copy;
}

function annotateFeatureChange(
  feature: SequenceFeature,
  originalCoverage: number,
  newCoverage: number,
): void {
  if (newCoverage === originalCoverage) return;
  const notes = { ...(feature.notes ?? {}) };
  if (newCoverage > originalCoverage) {
    notes.insertion = [
      ...(notes.insertion ?? []),
      `Extended by ${newCoverage - originalCoverage} bp of inserted sequence.`,
    ];
  } else {
    notes.truncated = [
      ...(notes.truncated ?? []),
      `Truncated at the replaced region boundary (${originalCoverage - newCoverage} bp removed).`,
    ];
  }
  feature.notes = notes;
  delete feature.translation;
}

function wholeFeatureShift(
  feature: SequenceFeature,
  edit: EditDescriptor,
): number | null {
  const intervals = featureIntervals(feature, edit.oldLength, edit.circular);
  if (!intervals.length) return null;
  if (edit.mode === 'full') return null;
  if (edit.mode === 'insertion') {
    const point = edit.replaceStart;
    let inside = false;
    let entirelyBefore = true;
    let entirelyAfter = true;
    for (const interval of intervals) {
      if (interval.start < point && point < interval.end) inside = true;
      if (interval.end > point) entirelyBefore = false;
      if (interval.start < point) entirelyAfter = false;
    }
    if (inside) return null;
    if (entirelyAfter) return edit.insertLength;
    if (entirelyBefore) return 0;
    return null;
  }
  if (edit.mode === 'replacement') {
    let entirelyBefore = true;
    let entirelyAfter = true;
    for (const interval of intervals) {
      if (interval.end > edit.replaceStart) entirelyBefore = false;
      if (interval.start < edit.replaceEnd) entirelyAfter = false;
    }
    if (entirelyBefore) return 0;
    if (entirelyAfter) return edit.insertLength - edit.replaceLength;
    return null;
  }
  if (edit.mode === 'wrapped') {
    let entirelyInside = true;
    for (const interval of intervals) {
      if (interval.start < edit.replaceEnd || interval.end > edit.replaceStart) {
        entirelyInside = false;
        break;
      }
    }
    return entirelyInside ? -edit.replaceEnd : null;
  }
  return null;
}

function shiftPreservingSegments(
  feature: SequenceFeature,
  shift: number,
): SequenceFeature {
  const copy = cloneFeature(feature);
  copy.start += shift;
  copy.end += shift;
  if (copy.notes?.segments) {
    copy.notes = {
      ...copy.notes,
      segments: copy.notes.segments.map((text) => {
        const parsed = parseSegmentCoordinate(text);
        if (!parsed) return text;
        return `${parsed.start + shift}-${parsed.end + shift}`;
      }),
    };
  }
  return copy;
}

function mapVectorFeature(
  feature: SequenceFeature,
  edit: EditDescriptor,
  warnings: string[],
): SequenceFeature | null {
  const fastShift = wholeFeatureShift(feature, edit);
  if (fastShift !== null) return shiftPreservingSegments(feature, fastShift);
  const intervals = featureIntervals(feature, edit.oldLength, edit.circular);
  if (!intervals.length) return null;
  const originalCoverage = intervals.reduce((sum, piece) => sum + (piece.end - piece.start), 0);
  const pieces: Piece[] = [];
  for (const interval of intervals) {
    pieces.push(...mapPieceThroughEdit(interval, edit));
  }
  const newCoverage = pieces.reduce((sum, piece) => sum + (piece.end - piece.start), 0);
  const mapped = buildFeatureFromPieces(feature, pieces, edit, warnings);
  if (!mapped) return null;
  annotateFeatureChange(mapped, originalCoverage, newCoverage);
  return mapped;
}

function combinePiecesForPrimer(pieces: Piece[], newLength: number): Piece[] {
  const merged = mergePieces(pieces);
  if (merged.length > 1 && merged[0].start === 0 && merged[merged.length - 1].end >= newLength) {
    const first = merged.shift() as Piece;
    const last = merged.pop() as Piece;
    return [...merged, { start: last.start, end: first.end }];
  }
  return merged;
}

function mapVectorPrimer(primer: Primer, edit: EditDescriptor): Primer | null {
  const originalLength = rangeLength(
    primer.bindingStart,
    primer.bindingEnd,
    edit.oldLength,
    edit.circular,
  );
  if (originalLength <= 0) return null;
  const intervals = toLinearIntervals(
    primer.bindingStart,
    primer.bindingEnd,
    edit.oldLength,
    edit.circular,
  );
  const pieces: Piece[] = [];
  for (const interval of intervals) {
    pieces.push(...mapPieceThroughEdit(interval, edit));
  }
  const combined = combinePiecesForPrimer(pieces, edit.newLength);
  if (combined.length !== 1) return null;
  const mapped = combined[0];
  const mappedLength = rangeLength(mapped.start, mapped.end, edit.newLength, edit.circular);
  if (mappedLength !== originalLength) return null;
  return {
    ...clonePrimer(primer),
    bindingStart: mapped.start,
    bindingEnd: mapped.end,
  };
}

function shiftFeatureToProduct(
  feature: SequenceFeature,
  offset: number,
  newLength: number,
  circular: boolean,
  insertLength: number,
): SequenceFeature {
  const shifted = shiftFeature(feature, offset);
  if (!circular || newLength <= 0) return shifted;
  if (feature.start > feature.end) {
    const pieces: Piece[] = [];
    const high = {
      start: feature.start + offset,
      end: insertLength + offset,
    };
    const low = { start: offset, end: feature.end + offset };
    for (const piece of [high, low]) {
      const start = Math.max(0, piece.start);
      const end = Math.min(newLength, piece.end);
      if (end > start) pieces.push({ start, end });
    }
    const ordered = feature.strand === -1 ? pieces.slice().reverse() : pieces;
    if (ordered.length > 1) {
      shifted.start = ordered[0].start;
      shifted.end = ordered[ordered.length - 1].end;
      shifted.notes = {
        ...(shifted.notes ?? {}),
        segments: ordered.map((piece) => `${piece.start}-${piece.end}`),
      };
      return shifted;
    }
  }
  shifted.start = mod(shifted.start, newLength);
  shifted.end = mod(shifted.end, newLength);
  if (shifted.start === shifted.end && feature.start !== feature.end) {
    shifted.start = 0;
    shifted.end = newLength;
  }
  if (shifted.notes?.segments) {
    shifted.notes = {
      ...shifted.notes,
      segments: shifted.notes.segments.map((text) => {
        const parsed = parseSegmentCoordinate(text);
        if (!parsed) return text;
        return `${mod(parsed.start + offset, newLength)}-${mod(parsed.end + offset, newLength)}`;
      }),
    };
  }
  return shifted;
}

function shiftPrimerToProduct(
  primer: Primer,
  offset: number,
  newLength: number,
  circular: boolean,
): Primer {
  const shifted = shiftPrimer(primer, offset);
  if (!circular || newLength <= 0) return shifted;
  shifted.bindingStart = mod(shifted.bindingStart, newLength);
  shifted.bindingEnd = mod(shifted.bindingEnd, newLength);
  return shifted;
}

function flipFeatureForWholeSequence(feature: SequenceFeature, length: number): SequenceFeature {
  const copy = cloneFeature(feature);
  copy.start = length - feature.end;
  copy.end = length - feature.start;
  copy.strand = (feature.strand === 1 ? -1 : feature.strand === -1 ? 1 : 0) as 1 | -1 | 0;
  if (copy.notes?.segments) {
    copy.notes = {
      ...copy.notes,
      segments: copy.notes.segments
        .slice()
        .reverse()
        .map((text) => {
          const parsed = parseSegmentCoordinate(text);
          if (!parsed) return text;
          return `${length - parsed.end}-${length - parsed.start}`;
        }),
    };
  }
  return copy;
}

function flipPrimerForWholeSequence(primer: Primer, length: number): Primer {
  return {
    ...clonePrimer(primer),
    sequence: reverseComplement(primer.sequence),
    tailSequence: reverseComplement(primer.tailSequence),
    bindingStart: length - primer.bindingEnd,
    bindingEnd: length - primer.bindingStart,
    strand: (primer.strand === 1 ? -1 : 1) as 1 | -1,
    mismatches: primer.mismatches
      ? primer.mismatches.map((position) => length - 1 - position)
      : undefined,
  };
}

interface InsertPreparation {
  sequence: string;
  features: SequenceFeature[];
  primers: Primer[];
  start: number;
  end: number;
}

function prepareInsert(
  insert: PlasmidDocument,
  insertRange: { start: number; end: number } | undefined,
  reverse: boolean,
  warnings: string[],
): InsertPreparation {
  const length = insert.sequence.length;
  const whole = !insertRange || (insertRange.start === 0 && insertRange.end === length);
  if (whole) {
    return {
      sequence: reverse ? reverseComplement(insert.sequence) : insert.sequence,
      features: reverse
        ? insert.features.map((feature) => flipFeatureForWholeSequence(feature, length))
        : insert.features.map(cloneFeature),
      primers: reverse
        ? insert.primers.map((primer) => flipPrimerForWholeSequence(primer, length))
        : insert.primers.map(clonePrimer),
      start: 0,
      end: length,
    };
  }
  const start = insertRange.start;
  const end = insertRange.end;
  const sliceLength = rangeLength(start, end, length, insert.topology === 'circular');
  if (sliceLength <= 0) {
    warnings.push('The requested insert range is empty.');
  }
  const data = sliceDocumentData(insert, start, end, {
    circular: insert.topology === 'circular',
    reverse,
  });
  return {
    sequence: reverse ? reverseComplement(data.sequence) : data.sequence,
    features: data.features.map(cloneFeature),
    primers: data.primers.map(clonePrimer),
    start,
    end,
  };
}

/**
 * Inserts or replaces a range of a vector with a fragment. Coordinates are
 * 0-based and half-open; an empty vector range performs a pure insertion and
 * a circular vector range may cross the origin. Annotations inside the
 * replaced region are removed, boundary features are truncated (and marked in
 * their notes), and the operation is appended to the product history.
 */
export function simulateInsertFragment(
  vector: PlasmidDocument,
  vectorRange: { start: number; end: number },
  insert: PlasmidDocument,
  insertRange?: { start: number; end: number },
  opts?: { reverseInsert?: boolean },
): { product: PlasmidDocument; warnings: string[] } {
  const warnings: string[] = [];
  const oldLength = vector.sequence.length;
  const circular = vector.topology === 'circular';
  let replaceStart = 0;
  let replaceEnd = 0;
  let replaceLength = 0;
  if (circular) {
    replaceLength = oldLength > 0
      ? rangeLength(vectorRange.start, vectorRange.end, oldLength, true)
      : 0;
    replaceStart = oldLength > 0 ? mod(vectorRange.start, oldLength) : 0;
    replaceEnd = oldLength > 0 ? mod(vectorRange.end, oldLength) : 0;
  } else {
    const from = clamp(vectorRange.start, 0, oldLength);
    const to = clamp(vectorRange.end, 0, oldLength);
    if (
      from !== vectorRange.start ||
      to !== vectorRange.end ||
      vectorRange.end < vectorRange.start
    ) {
      warnings.push('The vector range was outside the linear molecule or reversed; it was clamped.');
    }
    replaceStart = Math.min(from, to);
    replaceEnd = Math.max(from, to);
    replaceLength = replaceEnd - replaceStart;
  }
  const fullCircle = oldLength > 0 && replaceLength >= oldLength;
  const wrapped = !fullCircle && replaceLength > 0 && replaceStart > replaceEnd;
  const insertion = !fullCircle && replaceLength === 0;

  const insertData = prepareInsert(insert, insertRange, opts?.reverseInsert ?? false, warnings);
  const insertLength = insertData.sequence.length;

  let sequence: string;
  let insertOffset: number;
  if (fullCircle) {
    sequence = insertData.sequence;
    insertOffset = 0;
    warnings.push('The entire vector sequence was replaced by the insert.');
  } else if (wrapped) {
    sequence =
      vector.sequence.slice(replaceEnd, replaceStart) + insertData.sequence;
    insertOffset = replaceStart - replaceEnd;
  } else {
    sequence =
      vector.sequence.slice(0, replaceStart) +
      insertData.sequence +
      vector.sequence.slice(replaceEnd);
    insertOffset = replaceStart;
  }

  const edit: EditDescriptor = {
    oldLength,
    newLength: sequence.length,
    replaceStart,
    replaceEnd,
    replaceLength: fullCircle ? oldLength : replaceLength,
    insertLength,
    circular,
    mode: fullCircle ? 'full' : wrapped ? 'wrapped' : insertion ? 'insertion' : 'replacement',
  };

  const features: SequenceFeature[] = [];
  let droppedFeatures = 0;
  for (const feature of vector.features) {
    const mapped = mapVectorFeature(feature, edit, warnings);
    if (mapped) {
      features.push(mapped);
    } else {
      droppedFeatures += 1;
    }
  }
  for (const feature of insertData.features) {
    features.push(
      shiftFeatureToProduct(
        feature,
        insertOffset,
        edit.newLength,
        circular,
        insertLength,
      ),
    );
  }

  const primers: Primer[] = [];
  let droppedPrimers = 0;
  for (const primer of vector.primers) {
    const mapped = mapVectorPrimer(primer, edit);
    if (mapped) {
      primers.push(mapped);
    } else {
      droppedPrimers += 1;
    }
  }
  for (const primer of insertData.primers) {
    primers.push(shiftPrimerToProduct(primer, insertOffset, edit.newLength, circular));
  }

  if (droppedFeatures > 0) {
    warnings.push(`${droppedFeatures} feature(s) were removed with the replaced region.`);
  }
  if (droppedPrimers > 0) {
    warnings.push(`${droppedPrimers} primer binding site(s) were removed or truncated.`);
  }
  if (insertLength === 0 && replaceLength === 0) {
    warnings.push('The insert range is empty; the product retains the original vector sequence.');
  }

  const parentSnapshots: NonNullable<CloningHistoryNode['parentSnapshots']> = [
    { id: vector.id, name: vector.name, length: vector.length },
    {
      id: insert.id,
      name: insert.name,
      length: insert.length,
      extractedRange: [insertData.start, insertData.end],
    },
  ];
  const product = makeDocument({
    name: `${vector.name}_${insert.name}`,
    sequence,
    topology: vector.topology,
    features,
    primers,
    history: [...vector.history.map(cloneHistoryNode), ...insert.history.map(cloneHistoryNode)],
    linearEnds: vector.linearEnds,
    methylationProfile: vector.methylationProfile,
    description: vector.description,
  });
  const positionDescription = fullCircle
    ? 'replacing the entire vector'
    : wrapped
      ? `replacing ${replaceLength} bp across the origin at ${replaceStart}-${replaceEnd}`
      : replaceLength > 0
        ? `replacing ${replaceLength} bp at ${replaceStart}-${replaceEnd}`
        : `inserted at ${replaceStart}`;
  appendHistory(
    product,
    makeHistoryNode(
      'restriction_ligation',
      `Inserted ${insertLength} bp from ${insert.name} into ${vector.name}, ${positionDescription}.`,
      { parentSnapshots },
    ),
  );
  return { product, warnings };
}
