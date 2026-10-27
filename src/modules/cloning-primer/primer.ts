import type {
  PlasmidDocument,
  Primer,
  RestrictionEnzyme,
  SequenceFeature,
} from '../../types/schema';
import {
  COMMON_ENZYMES,
  NEB_LEADER_BASES,
  enzymeByName,
  enzymeRecognitionForTail,
  findCutSites,
  recommendedLeader,
} from './enzymes';
import {
  calcCrossDimer,
  evaluateOligoThermodynamics,
  type ReactionConditions,
} from './thermo';
import {
  AMINO_ACID_NAMES,
  CODON_TABLE,
  SYNONYMOUS_CODONS,
  adjustFeaturesForMutation,
  applySequenceMutation,
  cloneDocument,
  clamp,
  cloneFeature,
  clonePrimer,
  complementBase,
  gcPercentOf,
  makeDocument,
  makeHistoryNode,
  mod,
  normalizeDNA,
  rangeLength,
  reverseComplement,
  sequenceSlice,
  shiftFeature,
  uid,
} from './utils';

export interface PrimerDesignOptions {
  minLen?: number;
  maxLen?: number;
  targetTm?: number;
  forwardTail?: string;
  reverseTail?: string;
  enzymeSiteForward?: string;
  enzymeSiteReverse?: string;
  leaderBases?: string;
  cond?: ReactionConditions;
}

export function buildPrimer(
  doc: PlasmidDocument,
  bindingStart: number,
  bindingEnd: number,
  strand: 1 | -1,
  tail = '',
  name?: string,
  cond?: ReactionConditions,
): Primer {
  const length = doc.length || doc.sequence.length;
  const circular = doc.topology === 'circular';
  const start = circular ? mod(bindingStart, length) : clamp(bindingStart, 0, length);
  const end = circular ? mod(bindingEnd, length) : clamp(bindingEnd, 0, length);
  const templateRegion = sequenceSlice(doc.sequence, start, end, circular);
  const annealing = strand === 1 ? templateRegion : reverseComplement(templateRegion);
  const tailSequence = normalizeDNA(tail);
  const fullSequence = tailSequence + annealing;
  const fullThermo = evaluateOligoThermodynamics(fullSequence, cond);
  const annealingThermo = evaluateOligoThermodynamics(annealing, cond);
  return {
    id: uid('primer'),
    name: name ?? `Primer_${start + 1}`,
    sequence: fullSequence,
    bindingStart: start,
    bindingEnd: end,
    strand,
    tailSequence,
    tmAnnealing: annealingThermo.tm,
    tmTotal: fullThermo.tm,
    gcPercent: fullThermo.gcPercent,
    has3PrimeGCClamp: fullThermo.has3PrimeGCClamp,
    hairpinDeltaG: fullThermo.hairpinDeltaG,
    selfDimerDeltaG: fullThermo.selfDimerDeltaG,
  };
}

interface TailParts {
  tail: string;
  enzyme?: RestrictionEnzyme;
}

function enzymeTail(
  site: string | undefined,
  reverse: boolean,
  leaderBases: string | undefined,
  customTail: string | undefined,
): TailParts {
  const custom = normalizeDNA(customTail ?? '');
  if (!site) return { tail: custom };
  const resolved = enzymeRecognitionForTail(site, reverse);
  const leader = leaderBases ?? (resolved.enzyme ? recommendedLeader(resolved.enzyme.name) : 'GCG');
  return {
    tail: custom + normalizeDNA(leader) + normalizeDNA(resolved.sequence),
    enzyme: resolved.enzyme,
  };
}

interface CandidatePrimer {
  length: number;
  bindingStart: number;
  bindingEnd: number;
  annealing: string;
  tm: number;
  clamp: boolean;
  hairpin: number;
  dimer: number;
}

function primerCandidates(
  doc: PlasmidDocument,
  target: { start: number; end: number },
  strand: 1 | -1,
  minLen: number,
  maxLen: number,
  cond?: ReactionConditions,
): CandidatePrimer[] {
  const circular = doc.topology === 'circular';
  const targetLength = rangeLength(target.start, target.end, doc.length, circular);
  const effectiveMax = Math.max(1, Math.min(maxLen, Math.max(1, targetLength)));
  const candidates: CandidatePrimer[] = [];
  for (let length = minLen; length <= effectiveMax; length += 1) {
    let bindingStart: number;
    let bindingEnd: number;
    if (strand === 1) {
      bindingStart = target.start;
      bindingEnd = circular ? mod(target.start + length, doc.length) : Math.min(doc.length, target.start + length);
    } else {
      bindingEnd = target.end;
      bindingStart = circular ? mod(target.end - length, doc.length) : Math.max(0, target.end - length);
    }
    const region = sequenceSlice(doc.sequence, bindingStart, bindingEnd, circular);
    if (region.length < length) continue;
    const annealing = strand === 1 ? region : reverseComplement(region);
    const thermo = evaluateOligoThermodynamics(annealing, cond);
    const selfDimer = thermo.selfDimerDeltaG;
    candidates.push({
      length,
      bindingStart,
      bindingEnd,
      annealing,
      tm: thermo.tm,
      clamp: thermo.has3PrimeGCClamp,
      hairpin: thermo.hairpinDeltaG,
      dimer: selfDimer,
    });
  }
  return candidates;
}

function scoreCandidate(candidate: CandidatePrimer, targetTm: number): number {
  let score = Math.abs(candidate.tm - targetTm);
  if (!candidate.clamp) score += 2.5;
  score += Math.max(0, -candidate.hairpin - 6) * 1.5;
  score += Math.max(0, -candidate.dimer - 8) * 1.2;
  const gc = gcPercentOf(candidate.annealing);
  if (gc < 35 || gc > 65) score += 1.5;
  const sequence = candidate.annealing;
  if (/(.)\1{4,}/.test(sequence)) score += 1.5;
  return score;
}

export function designPrimerPair(
  doc: PlasmidDocument,
  target: { start: number; end: number; strand?: 1 | -1 | 'both' },
  options?: PrimerDesignOptions,
): { forward: Primer; reverse: Primer; productLength: number; productSequence: string; warnings: string[] } {
  const circular = doc.topology === 'circular';
  const minLen = Math.max(12, options?.minLen ?? 18);
  const maxLen = Math.max(minLen, options?.maxLen ?? 28);
  const targetTm = options?.targetTm ?? 60;
  const cond = options?.cond;
  const warnings: string[] = [];
  const targetLength = rangeLength(target.start, target.end, doc.length, circular);
  if (targetLength <= 0) {
    warnings.push('Target range is empty; using the entire molecule as the amplicon.');
  }
  const effectiveTarget = targetLength > 0
    ? target
    : { start: 0, end: doc.length, strand: 'both' as const };
  const forwardTailParts = enzymeTail(
    options?.enzymeSiteForward,
    false,
    options?.leaderBases,
    options?.forwardTail,
  );
  const reverseTailParts = enzymeTail(
    options?.enzymeSiteReverse,
    true,
    options?.leaderBases,
    options?.reverseTail,
  );

  const forwardCandidates = primerCandidates(doc, effectiveTarget, 1, minLen, maxLen, cond);
  const reverseCandidates = primerCandidates(doc, effectiveTarget, -1, minLen, maxLen, cond);
  if (!forwardCandidates.length || !reverseCandidates.length) {
    const length = Math.max(1, Math.min(maxLen, Math.max(1, targetLength)));
    const forward = buildPrimer(
      doc,
      effectiveTarget.start,
      mod(effectiveTarget.start + length, doc.length),
      1,
      forwardTailParts.tail,
      'Forward',
      cond,
    );
    const reverse = buildPrimer(
      doc,
      mod(effectiveTarget.end - length, doc.length),
      effectiveTarget.end,
      -1,
      reverseTailParts.tail,
      'Reverse',
      cond,
    );
    const amplicon = sequenceSlice(doc.sequence, effectiveTarget.start, effectiveTarget.end, circular);
    const productSequence = forwardTailParts.tail + amplicon + reverseComplement(reverseTailParts.tail);
    if (forwardTailParts.enzyme) warnings.push(`Forward primer carries a ${forwardTailParts.enzyme.name} site.`);
    if (reverseTailParts.enzyme) warnings.push(`Reverse primer carries a ${reverseTailParts.enzyme.name} site.`);
    return {
      forward,
      reverse,
      productLength: productSequence.length,
      productSequence,
      warnings: [...warnings, 'Unable to evaluate candidate primers; returned minimal-length primers.'],
    };
  }

  let bestForward = forwardCandidates[0];
  let bestReverse = reverseCandidates[0];
  let bestPairScore = Number.POSITIVE_INFINITY;
  for (const forward of forwardCandidates) {
    for (const reverse of reverseCandidates) {
      const tmDifference = Math.abs(forward.tm - reverse.tm);
      const cross = calcCrossDimer(forward.annealing, reverse.annealing, cond);
      let pairScore =
        scoreCandidate(forward, targetTm) +
        scoreCandidate(reverse, targetTm) +
        tmDifference * 2.5 +
        Math.max(0, -cross.deltaG - 8) * 1.5;
      if (tmDifference > 1.5) pairScore += (tmDifference - 1.5) * 3;
      if (pairScore < bestPairScore) {
        bestPairScore = pairScore;
        bestForward = forward;
        bestReverse = reverse;
      }
    }
  }

  if (Math.abs(bestForward.tm - bestReverse.tm) > 1.5) {
    warnings.push(
      `Annealing Tm difference is ${Math.abs(bestForward.tm - bestReverse.tm).toFixed(1)} °C (> 1.5 °C).`,
    );
  }
  if (!bestForward.clamp || !bestReverse.clamp) {
    warnings.push('One or both primers lack a 3-prime G/C clamp.');
  }
  if (bestForward.hairpin < -9 || bestReverse.hairpin < -9) {
    warnings.push('Strong hairpin predicted in one or both primers.');
  }
  if (bestForward.dimer < -9 || bestReverse.dimer < -9) {
    warnings.push('Strong self-dimer predicted in one or both primers.');
  }
  if (targetLength > 0 && targetLength > 12000) {
    warnings.push('Amplicon exceeds 12 kb; consider a high-fidelity long-range polymerase.');
  }

  const forward = buildPrimer(
    doc,
    bestForward.bindingStart,
    bestForward.bindingEnd,
    1,
    forwardTailParts.tail,
    'Forward',
    cond,
  );
  const reverse = buildPrimer(
    doc,
    bestReverse.bindingStart,
    bestReverse.bindingEnd,
    -1,
    reverseTailParts.tail,
    'Reverse',
    cond,
  );
  const amplicon = sequenceSlice(doc.sequence, effectiveTarget.start, effectiveTarget.end, circular);
  const productSequence = forwardTailParts.tail + amplicon + reverseComplement(reverseTailParts.tail);
  if (forwardTailParts.enzyme) warnings.push(`Forward primer carries a ${forwardTailParts.enzyme.name} site.`);
  if (reverseTailParts.enzyme) warnings.push(`Reverse primer carries a ${reverseTailParts.enzyme.name} site.`);
  return {
    forward,
    reverse,
    productLength: productSequence.length,
    productSequence,
    warnings,
  };
}

export interface MutationSpec {
  start: number;
  end: number;
  newBases: string;
  mode?: 'quikchange' | 'q5_back_to_back';
}

export interface SilentSiteSuggestion {
  enzyme: string;
  action: 'introduce' | 'remove';
  position: number;
  changedBases: string;
  note: string;
}

interface CodonFrame {
  anchor: number;
  label: string;
  start?: number;
  end?: number;
  strand: 1 | -1;
}

function codonFrames(doc: PlasmidDocument, mutation: MutationSpec): CodonFrame[] {
  const frames: CodonFrame[] = [];
  for (const feature of doc.features) {
    if (feature.type !== 'CDS') continue;
    if (mutation.start >= feature.end + 3 || mutation.end <= feature.start - 3) continue;
    if (feature.strand === 1) {
      const anchor = feature.start + ((feature.codonStart ?? 1) - 1);
      frames.push({
        anchor,
        label: feature.name,
        start: feature.start,
        end: feature.end,
        strand: 1,
      });
    } else if (feature.strand === -1) {
      const anchor = feature.end - ((feature.codonStart ?? 1) - 1);
      frames.push({
        anchor,
        label: feature.name,
        start: feature.start,
        end: feature.end,
        strand: -1,
      });
    }
  }
  if (!frames.length) {
    frames.push({ anchor: 0, label: 'frame 1', strand: 1 });
    frames.push({ anchor: 1, label: 'frame 2', strand: 1 });
    frames.push({ anchor: 2, label: 'frame 3', strand: 1 });
  }
  return frames;
}

function siteStarts(sequence: string, enzyme: RestrictionEnzyme, circular: boolean): number[] {
  const cuts = findCutSites(sequence, enzyme, circular);
  return Array.from(new Set(cuts.map((cut) => cut.position))).sort((a, b) => a - b);
}

function firstDifferentSite(before: number[], after: number[], near: number, length: number): number | null {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const candidates = [
    ...after.filter((position) => !beforeSet.has(position)),
    ...before.filter((position) => !afterSet.has(position)),
  ];
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const da = Math.abs(mod(a - near + length / 2, length) - length / 2);
    const db = Math.abs(mod(b - near + length / 2, length) - length / 2);
    return da - db;
  });
  return candidates[0];
}

function scanSilentSites(
  doc: PlasmidDocument,
  mutation: MutationSpec,
  mutatedSequence: string,
  enzymes?: RestrictionEnzyme[],
): SilentSiteSuggestionsResult {
  const panel = enzymes && enzymes.length ? enzymes : COMMON_ENZYMES;
  const suggestions: SilentSiteSuggestion[] = [];
  const seen = new Set<string>();
  const length = mutatedSequence.length;
  const frames = codonFrames(doc, mutation);
  const regionStart = Math.max(0, mutation.start - 30);
  const regionEnd = Math.min(length, mutation.end + 30);
  const circular = doc.topology === 'circular';
  const beforeCache = new Map<string, number[]>();
  const beforeSites = (enzyme: RestrictionEnzyme): number[] => {
    if (!beforeCache.has(enzyme.name)) beforeCache.set(enzyme.name, siteStarts(mutatedSequence, enzyme, circular));
    return beforeCache.get(enzyme.name) ?? [];
  };
  for (const frame of frames) {
    const plusFrame = frame.strand === 1;
    const codonStarts: number[] = [];
    if (plusFrame) {
      const firstCodon = frame.anchor + Math.ceil((regionStart - frame.anchor) / 3) * 3;
      for (let codonStart = firstCodon; codonStart + 3 <= regionEnd; codonStart += 3) {
        codonStarts.push(codonStart);
      }
    } else {
      let codonStart = frame.anchor - 3;
      while (codonStart > regionEnd) codonStart -= 3;
      while (codonStart >= 0 && codonStart + 3 >= regionStart) {
        codonStarts.push(codonStart);
        codonStart -= 3;
      }
    }
    for (const codonStart of codonStarts) {
      if (codonStart < 0 || codonStart + 3 > length) continue;
      if (frame.start !== undefined && frame.end !== undefined) {
        if (codonStart < frame.start || codonStart + 3 > frame.end) continue;
      }
      const topCodon = mutatedSequence.slice(codonStart, codonStart + 3).toUpperCase();
      const codon = plusFrame ? topCodon : reverseComplement(topCodon);
      const aminoAcid = CODON_TABLE[codon];
      if (!aminoAcid || aminoAcid === 'X' || aminoAcid === '*') continue;
      const synonymous = SYNONYMOUS_CODONS[aminoAcid] ?? [];
      for (const replacement of synonymous) {
        if (replacement === codon) continue;
        const topReplacement = plusFrame ? replacement : reverseComplement(replacement);
        const variant =
          mutatedSequence.slice(0, codonStart) + topReplacement + mutatedSequence.slice(codonStart + 3);
        for (const enzyme of panel) {
          const before = beforeSites(enzyme);
          const after = siteStarts(variant, enzyme, circular);
          const introduced = after.some((position) => !before.includes(position));
          const removed = before.some((position) => !after.includes(position));
          if (!introduced && !removed) continue;
          const action: 'introduce' | 'remove' = introduced ? 'introduce' : 'remove';
          const position = firstDifferentSite(before, after, codonStart, length);
          if (position === null) continue;
          const key = `${enzyme.name}|${action}|${position}|${codon}|${replacement}|${frame.strand}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const aminoAcidIndex = plusFrame
            ? Math.floor((codonStart - frame.anchor) / 3) + 1
            : Math.floor((frame.anchor - (codonStart + 3)) / 3) + 1;
          suggestions.push({
            enzyme: enzyme.name,
            action,
            position,
            changedBases: `${codon}>${replacement}`,
            note: `Silent ${AMINO_ACID_NAMES[aminoAcid] ?? aminoAcid}${aminoAcidIndex} codon change ${codon}>${replacement} ${action}s a ${enzyme.name} site for restriction screening (${frame.label}${plusFrame ? '' : ', minus strand'}).`,
          });
          if (suggestions.length >= 16) {
            return { suggestions: suggestions.sort((a, b) => a.enzyme.localeCompare(b.enzyme)), warnings: [] };
          }
        }
      }
    }
  }
  return {
    suggestions: suggestions.sort((a, b) => {
      if (a.action !== b.action) return a.action === 'introduce' ? -1 : 1;
      return a.enzyme.localeCompare(b.enzyme);
    }),
    warnings: suggestions.length ? [] : ['No silent restriction-site change was found near the mutation.'],
  };
}

interface SilentSiteSuggestionsResult {
  suggestions: SilentSiteSuggestion[];
  warnings: string[];
}

function chooseQuikChangeFlanks(
  doc: PlasmidDocument,
  mutation: MutationSpec,
  cond?: ReactionConditions,
): { left: number; right: number; forwardSequence: string; tm: number } {
  const circular = doc.topology === 'circular';
  const newBases = normalizeDNA(mutation.newBases);
  const mutationLength = rangeLength(mutation.start, mutation.end, doc.length, circular);
  const maxLeft = Math.min(18, mutation.start >= 0 ? mutation.start : 18);
  const maxRight = Math.min(18, doc.length - mutation.end);
  let best = {
    left: Math.min(10, Math.max(4, maxLeft)),
    right: Math.min(10, Math.max(4, maxRight)),
    forwardSequence: '',
    tm: 0,
  };
  let bestScore = Number.POSITIVE_INFINITY;
  for (let left = 6; left <= Math.max(6, maxLeft); left += 1) {
    for (let right = 6; right <= Math.max(6, maxRight); right += 1) {
      const leftStart = circular ? mod(mutation.start - left, doc.length) : Math.max(0, mutation.start - left);
      const rightEnd = circular ? mutation.end + right : Math.min(doc.length, mutation.end + right);
      const leftRegion = sequenceSlice(doc.sequence, leftStart, mutation.start, circular);
      const rightRegion = sequenceSlice(doc.sequence, mutation.end, rightEnd, circular);
      if (leftRegion.length !== left || rightRegion.length !== right) continue;
      const forwardSequence = leftRegion + newBases + rightRegion;
      if (forwardSequence.length < 24 || forwardSequence.length > 48) continue;
      const thermo = evaluateOligoThermodynamics(forwardSequence, cond);
      const score = Math.abs(thermo.tm - 78) + (forwardSequence.length > 42 ? 2 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { left, right, forwardSequence, tm: thermo.tm };
      }
    }
  }
  if (!best.forwardSequence) {
    const leftStart = circular ? mod(mutation.start - 10, doc.length) : Math.max(0, mutation.start - 10);
    const rightEnd = circular ? mutation.end + 10 : Math.min(doc.length, mutation.end + 10);
    const leftRegion = sequenceSlice(doc.sequence, leftStart, mutation.start, circular);
    const rightRegion = sequenceSlice(doc.sequence, mutation.end, rightEnd, circular);
    best.left = leftRegion.length;
    best.right = rightRegion.length;
    best.forwardSequence = leftRegion + newBases + rightRegion;
    best.tm = evaluateOligoThermodynamics(best.forwardSequence, cond).tm;
  }
  return best;
}

function chooseBackToBackFlanks(
  doc: PlasmidDocument,
  mutation: MutationSpec,
  cond?: ReactionConditions,
): { upstream: number; downstream: number; forwardSequence: string; reverseSequence: string } {
  const circular = doc.topology === 'circular';
  const newBases = normalizeDNA(mutation.newBases);
  let best = { upstream: 20, downstream: 20, forwardSequence: '', reverseSequence: '' };
  let bestScore = Number.POSITIVE_INFINITY;
  for (let upstream = 16; upstream <= 30; upstream += 1) {
    for (let downstream = 16; downstream <= 30; downstream += 1) {
      const upstreamStart = circular ? mod(mutation.start - upstream, doc.length) : Math.max(0, mutation.start - upstream);
      const downstreamEnd = circular ? mutation.end + downstream : Math.min(doc.length, mutation.end + downstream);
      const upstreamRegion = sequenceSlice(doc.sequence, upstreamStart, mutation.start, circular);
      const downstreamRegion = sequenceSlice(doc.sequence, mutation.end, downstreamEnd, circular);
      if (upstreamRegion.length !== upstream || downstreamRegion.length !== downstream) continue;
      const forwardSequence = newBases + downstreamRegion;
      const reverseSequence = reverseComplement(upstreamRegion);
      const forwardTm = evaluateOligoThermodynamics(forwardSequence, cond).tm;
      const reverseTm = evaluateOligoThermodynamics(reverseSequence, cond).tm;
      const score = Math.abs(forwardTm - 68) + Math.abs(reverseTm - 68) + Math.abs(forwardTm - reverseTm);
      if (score < bestScore) {
        bestScore = score;
        best = { upstream, downstream, forwardSequence, reverseSequence };
      }
    }
  }
  if (!best.forwardSequence) {
    const upstreamStart = circular ? mod(mutation.start - 20, doc.length) : Math.max(0, mutation.start - 20);
    const downstreamEnd = circular ? mutation.end + 20 : Math.min(doc.length, mutation.end + 20);
    const upstreamRegion = sequenceSlice(doc.sequence, upstreamStart, mutation.start, circular);
    const downstreamRegion = sequenceSlice(doc.sequence, mutation.end, downstreamEnd, circular);
    best = {
      upstream: upstreamRegion.length,
      downstream: downstreamRegion.length,
      forwardSequence: newBases + downstreamRegion,
      reverseSequence: reverseComplement(upstreamRegion),
    };
  }
  return best;
}

function mutationMismatchPositions(
  template: string,
  bindingStart: number,
  bindingEnd: number,
  topEquivalent: string,
  circular: boolean,
): number[] {
  const length = template.length;
  const oldRegion = sequenceSlice(template, bindingStart, bindingEnd, circular);
  const newRegion = normalizeDNA(topEquivalent);
  const minLength = Math.min(oldRegion.length, newRegion.length);
  const mismatchOffsets: number[] = [];
  for (let index = 0; index < minLength; index += 1) {
    if (oldRegion[index] !== newRegion[index]) mismatchOffsets.push(index);
  }
  if (oldRegion.length !== newRegion.length) {
    mismatchOffsets.push(Math.max(0, minLength - 1));
  }
  return Array.from(new Set(mismatchOffsets)).map((offset) => mod(bindingStart + offset, length));
}

export function designMutagenesisPrimers(
  doc: PlasmidDocument,
  mutation: MutationSpec,
  enzymes?: RestrictionEnzyme[],
): {
  forward: Primer;
  reverse: Primer;
  mutatedDoc: PlasmidDocument;
  silentSiteSuggestions: SilentSiteSuggestion[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const rawNewBases = normalizeDNA(mutation.newBases);
  const circular = doc.topology === 'circular';
  const newBases = rawNewBases.replace(/[^ACGTN]/g, 'N');
  if (newBases !== rawNewBases) {
    warnings.push('Mutation contains non-DNA characters; invalid bases were converted to N.');
  }
  if (!circular) {
    if (mutation.start < 0 || mutation.end < mutation.start || mutation.end > doc.length) {
      throw new Error('Mutation coordinates are outside the linear template.');
    }
  }
  const mutated = applySequenceMutation(doc.sequence, mutation.start, mutation.end, newBases, circular);
  const delta = mutated.delta;
  const mutatedFeatures = adjustFeaturesForMutation(
    doc.features,
    mutation.start,
    mutation.end,
    delta,
    doc.length,
    circular,
  );
  const mutationFeature: SequenceFeature = {
    id: uid('feature'),
    name: 'site_directed_mutation',
    type: 'misc_feature',
    start: mod(mutation.start, mutated.sequence.length),
    end: mod(mutation.start + newBases.length, mutated.sequence.length),
    strand: 1,
    color: '#e11d48',
    notes: {
      mutation: [
        `Replaced ${mutation.end - mutation.start} bp with ${newBases.length} bp (${mutation.mode ?? 'quikchange'})`,
      ],
    },
  };
  mutatedFeatures.push(mutationFeature);
  const mutatedDoc = makeDocument({
    name: `${doc.name}_mutated`,
    sequence: mutated.sequence,
    topology: doc.topology,
    features: mutatedFeatures,
    primers: [],
    history: [
      ...doc.history,
      makeHistoryNode('site_directed_mutagenesis', `Site-directed mutagenesis at ${mutation.start}-${mutation.end} (${mutation.mode ?? 'quikchange'})`, {
        parentSnapshots: [{ id: doc.id, name: doc.name, length: doc.length, extractedRange: [mutation.start, mutation.end] }],
      }),
    ],
    methylationProfile: doc.methylationProfile,
    linearEnds: doc.linearEnds,
    description: doc.description,
  });

  const mode = mutation.mode ?? 'quikchange';
  let forward: Primer;
  let reverse: Primer;
  if (mode === 'q5_back_to_back') {
    const flanks = chooseBackToBackFlanks(doc, mutation, undefined);
    const downstreamStart = circular ? mod(mutation.end, doc.length) : mutation.end;
    const downstreamEnd = circular
      ? mod(downstreamStart + flanks.downstream, doc.length)
      : Math.min(doc.length, downstreamStart + flanks.downstream);
    const upstreamStart = circular
      ? mod(mutation.start - flanks.upstream, doc.length)
      : Math.max(0, mutation.start - flanks.upstream);
    forward = buildPrimer(doc, downstreamStart, downstreamEnd, 1, newBases, 'SDM_forward');
    reverse = buildPrimer(doc, upstreamStart, mutation.start, -1, '', 'SDM_reverse');
    if (forward.sequence !== flanks.forwardSequence) {
      forward.sequence = flanks.forwardSequence;
      const thermo = evaluateOligoThermodynamics(forward.sequence);
      forward.tmAnnealing = evaluateOligoThermodynamics(sequenceSlice(doc.sequence, downstreamStart, downstreamEnd, circular)).tm;
      forward.tmTotal = thermo.tm;
      forward.gcPercent = thermo.gcPercent;
      forward.has3PrimeGCClamp = thermo.has3PrimeGCClamp;
      forward.hairpinDeltaG = thermo.hairpinDeltaG;
      forward.selfDimerDeltaG = thermo.selfDimerDeltaG;
    }
    if (reverse.sequence !== flanks.reverseSequence) {
      reverse.sequence = flanks.reverseSequence;
      const thermo = evaluateOligoThermodynamics(reverse.sequence);
      reverse.tmAnnealing = evaluateOligoThermodynamics(sequenceSlice(doc.sequence, upstreamStart, mutation.start, circular)).tm;
      reverse.tmTotal = thermo.tm;
      reverse.gcPercent = thermo.gcPercent;
      reverse.has3PrimeGCClamp = thermo.has3PrimeGCClamp;
      reverse.hairpinDeltaG = thermo.hairpinDeltaG;
      reverse.selfDimerDeltaG = thermo.selfDimerDeltaG;
    }
    if (forward.tmTotal < 55 || reverse.tmTotal < 55) {
      warnings.push('One or both SDM primers have a Tm below 55 °C; consider lengthening the annealing arms.');
    }
  } else {
    const flanks = chooseQuikChangeFlanks(doc, mutation, undefined);
    const bindingStart = circular
      ? mod(mutation.start - flanks.left, doc.length)
      : Math.max(0, mutation.start - flanks.left);
    const bindingEnd = circular
      ? mod(mutation.end + flanks.right, doc.length)
      : Math.min(doc.length, mutation.end + flanks.right);
    const annealLength = rangeLength(bindingStart, bindingEnd, doc.length, circular);
    forward = {
      id: uid('primer'),
      name: 'QuikChange_forward',
      sequence: flanks.forwardSequence,
      bindingStart,
      bindingEnd,
      strand: 1,
      tailSequence: '',
      tmAnnealing: evaluateOligoThermodynamics(flanks.forwardSequence).tm,
      tmTotal: evaluateOligoThermodynamics(flanks.forwardSequence).tm,
      gcPercent: gcPercentOf(flanks.forwardSequence),
      has3PrimeGCClamp: flanks.forwardSequence.endsWith('G') || flanks.forwardSequence.endsWith('C'),
      hairpinDeltaG: evaluateOligoThermodynamics(flanks.forwardSequence).hairpinDeltaG,
      selfDimerDeltaG: evaluateOligoThermodynamics(flanks.forwardSequence).selfDimerDeltaG,
      mismatches: mutationMismatchPositions(doc.sequence, bindingStart, bindingEnd, flanks.forwardSequence, circular),
    };
    const reverseSequence = reverseComplement(flanks.forwardSequence);
    reverse = {
      id: uid('primer'),
      name: 'QuikChange_reverse',
      sequence: reverseSequence,
      bindingStart,
      bindingEnd,
      strand: -1,
      tailSequence: '',
      tmAnnealing: evaluateOligoThermodynamics(reverseSequence).tm,
      tmTotal: evaluateOligoThermodynamics(reverseSequence).tm,
      gcPercent: gcPercentOf(reverseSequence),
      has3PrimeGCClamp: reverseSequence.endsWith('G') || reverseSequence.endsWith('C'),
      hairpinDeltaG: evaluateOligoThermodynamics(reverseSequence).hairpinDeltaG,
      selfDimerDeltaG: evaluateOligoThermodynamics(reverseSequence).selfDimerDeltaG,
      mismatches: mutationMismatchPositions(doc.sequence, bindingStart, bindingEnd, reverseComplement(reverseSequence), circular),
    };
    if (annealLength < 20) warnings.push('QuikChange primer binding region is shorter than 20 bp.');
    if (forward.tmTotal < 70) warnings.push('QuikChange primer Tm is below the recommended 78 °C.');
  }

  if (!forward.has3PrimeGCClamp || !reverse.has3PrimeGCClamp) {
    warnings.push('One or both mutagenesis primers lack a 3-prime G/C clamp.');
  }
  mutatedDoc.primers.push(clonePrimer(forward), clonePrimer(reverse));
  const silent = scanSilentSites(doc, mutation, mutated.sequence, enzymes);
  warnings.push(...silent.warnings);
  return {
    forward,
    reverse,
    mutatedDoc,
    silentSiteSuggestions: silent.suggestions,
    warnings,
  };
}

export function primerEnzymeTail(
  enzymeName: string,
  reverse: boolean,
  leaderBases?: string,
): string {
  const enzyme = enzymeByName(enzymeName);
  if (!enzyme) return '';
  const leader = leaderBases ?? NEB_LEADER_BASES[enzyme.name] ?? 'GCG';
  return leader + (reverse ? reverseComplement(enzyme.recognitionSeq) : enzyme.recognitionSeq);
}

export function silentSitePanel(): RestrictionEnzyme[] {
  return COMMON_ENZYMES.map((enzyme) => ({ ...enzyme }));
}

export function cloneFeatureList(features: SequenceFeature[]): SequenceFeature[] {
  return features.map(cloneFeature);
}

export function shiftedFeatureList(features: SequenceFeature[], offset: number): SequenceFeature[] {
  return features.map((feature) => shiftFeature(feature, offset));
}

export function mutationSpecLength(doc: PlasmidDocument, mutation: MutationSpec): number {
  return rangeLength(mutation.start, mutation.end, doc.length, doc.topology === 'circular');
}

export function mutatedDocumentCopy(doc: PlasmidDocument): PlasmidDocument {
  return cloneDocument(doc);
}

export interface PrimerBindingHit {
  start: number;
  end: number;
  strand: 1 | -1;
  mismatches: number;
  mismatchPositions: number[];
  threePrimeMatchLength: number;
  tmAnnealing: number;
}

/**
 * Finds primer binding sites on both strands of a template.
 *
 * The 3'-terminal `minThreePrimeMatch` bases (default 10) must match exactly.
 * A 5' tail does not have to match: the search reports the longest 3' suffix
 * of the primer that stays within `maxMismatches` (default 2), so a
 * non-annealing 5' extension is simply left out of the binding interval.
 * Coordinates are 0-based half-open; on circular templates a site crossing
 * the origin is returned with start > end.
 */
export function findPrimerBindingSites(
  doc: PlasmidDocument,
  primerSequence: string,
  opts?: { maxMismatches?: number; minThreePrimeMatch?: number },
): PrimerBindingHit[] {
  const template = normalizeDNA(doc.sequence);
  const primer = normalizeDNA(primerSequence);
  const templateLength = template.length;
  const primerLength = primer.length;
  if (!templateLength || !primerLength) return [];
  const circular = doc.topology === 'circular';
  const maxMismatches = Math.max(0, Math.floor(opts?.maxMismatches ?? 2));
  const minThreePrime = clamp(
    Math.floor(opts?.minThreePrimeMatch ?? 10),
    1,
    primerLength,
  );
  const maxLength = Math.min(primerLength, templateLength);
  if (maxLength < minThreePrime) return [];

  const baseAt = (index: number): string =>
    circular ? template[mod(index, templateLength)] : template[index] ?? 'N';

  const hits: PrimerBindingHit[] = [];

  const addHit = (
    strand: 1 | -1,
    bindingStart: number,
    bindingEnd: number,
    alignedLength: number,
    entries: Array<{ length: number; templateIndex: number }>,
  ): void => {
    let start = bindingStart;
    let end = bindingEnd;
    let aligned = alignedLength;
    const within = entries.filter((entry) => entry.length <= alignedLength);
    // A 5' tail appears as a contiguous block of mismatches at the 5'-most
    // end of the candidate alignment. Remove that block so the reported
    // interval describes the annealing region rather than the tail.
    let tailBlock = 0;
    for (let length = alignedLength; length > 0; length -= 1) {
      if (within.some((entry) => entry.length === length)) {
        tailBlock += 1;
      } else {
        break;
      }
    }
    if (tailBlock > 0) {
      if (strand === 1) {
        start += tailBlock;
      } else {
        end -= tailBlock;
      }
      aligned -= tailBlock;
    }
    const mismatchEntries = within.filter((entry) => entry.length <= aligned);
    const mismatchPositions = mismatchEntries
      .map((entry) => mod(entry.templateIndex, templateLength))
      .sort((a, b) => a - b);
    let threePrimeMatchLength = 0;
    for (let offset = 0; offset < aligned; offset += 1) {
      const primerBase = primer[primerLength - 1 - offset];
      const templateBase =
        strand === 1
          ? baseAt(end - 1 - offset)
          : baseAt(start + offset);
      const matches =
        strand === 1
          ? primerBase === templateBase
          : complementBase(primerBase) === templateBase;
      if (!matches) break;
      threePrimeMatchLength += 1;
    }
    const annealing = primer.slice(primerLength - aligned);
    hits.push({
      start: circular ? mod(start, templateLength) : start,
      end: circular ? mod(end, templateLength) : end,
      strand,
      mismatches: mismatchEntries.length,
      mismatchPositions,
      threePrimeMatchLength,
      tmAnnealing: evaluateOligoThermodynamics(annealing).tm,
    });
  };

  // Plus strand: the primer 3' end is the right edge of the aligned region.
  const plusFirst = circular ? 0 : minThreePrime;
  const plusLast = circular ? templateLength - 1 : templateLength;
  for (let anchor = plusFirst; anchor <= plusLast; anchor += 1) {
    let exact = true;
    for (let offset = 0; offset < minThreePrime; offset += 1) {
      if (
        primer[primerLength - minThreePrime + offset] !==
        baseAt(anchor - minThreePrime + offset)
      ) {
        exact = false;
        break;
      }
    }
    if (!exact) continue;
    const maxAligned = circular
      ? maxLength
      : Math.min(maxLength, anchor);
    if (maxAligned < minThreePrime) continue;
    let mismatches = 0;
    let aligned = minThreePrime;
    const entries: Array<{ length: number; templateIndex: number }> = [];
    for (let length = minThreePrime + 1; length <= maxAligned; length += 1) {
      const templateIndex = anchor - length;
      const primerIndex = primerLength - length;
      if (primer[primerIndex] !== baseAt(templateIndex)) {
        mismatches += 1;
        entries.push({ length, templateIndex });
        if (mismatches > maxMismatches) break;
      }
      aligned = length;
    }
    addHit(1, anchor - aligned, anchor, aligned, entries);
  }

  // Minus strand: the primer 3' end is the left edge and the alignment
  // extends to the right in template coordinates.
  const minusFirst = 0;
  const minusLast = circular ? templateLength - 1 : templateLength - minThreePrime;
  for (let anchor = minusFirst; anchor <= minusLast; anchor += 1) {
    let exact = true;
    for (let offset = 0; offset < minThreePrime; offset += 1) {
      if (
        complementBase(primer[primerLength - 1 - offset]) !==
        baseAt(anchor + offset)
      ) {
        exact = false;
        break;
      }
    }
    if (!exact) continue;
    const maxAligned = circular
      ? maxLength
      : Math.min(maxLength, templateLength - anchor);
    if (maxAligned < minThreePrime) continue;
    let mismatches = 0;
    let aligned = minThreePrime;
    const entries: Array<{ length: number; templateIndex: number }> = [];
    for (let length = minThreePrime + 1; length <= maxAligned; length += 1) {
      const templateIndex = anchor + length - 1;
      const primerIndex = primerLength - length;
      if (complementBase(primer[primerIndex]) !== baseAt(templateIndex)) {
        mismatches += 1;
        entries.push({ length, templateIndex });
        if (mismatches > maxMismatches) break;
      }
      aligned = length;
    }
    addHit(-1, anchor, anchor + aligned, aligned, entries);
  }

  const unique = new Map<string, PrimerBindingHit>();
  for (const hit of hits) {
    const key = `${hit.strand}:${hit.start}:${hit.end}`;
    const existing = unique.get(key);
    if (
      !existing ||
      hit.mismatches < existing.mismatches ||
      (hit.mismatches === existing.mismatches &&
        hit.threePrimeMatchLength > existing.threePrimeMatchLength)
    ) {
      unique.set(key, hit);
    }
  }
  return Array.from(unique.values()).sort(
    (a, b) =>
      a.mismatches - b.mismatches ||
      a.start - b.start ||
      b.threePrimeMatchLength - a.threePrimeMatchLength ||
      a.strand - b.strand,
  );
}
