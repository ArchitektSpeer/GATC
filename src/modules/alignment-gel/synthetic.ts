// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import type { SangerTraceData } from '../../types/schema';
import { mottTrim } from './abif';
import { isCanonicalBase } from './genetics';

export interface SyntheticTraceOptions {
  fileName?: string;
  start?: number;
  length?: number;
  mutations?: Array<{ index: number; base: string }>;
  heterozygous?: Array<{ index: number; base: string }>;
  seed?: number;
}

const CHANNELS = ['A', 'T', 'G', 'C'] as const;
type SyntheticChannel = (typeof CHANNELS)[number];

function modulo(value: number, length: number): number {
  return ((value % length) + length) % length;
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function syntheticId(fileName: string, referenceLength: number, start: number, length: number, seed: number): string {
  let hash = 0x811c9dc5;
  const material = `${fileName}:${referenceLength}:${start}:${length}:${seed}`;
  for (let index = 0; index < material.length; index += 1) {
    hash ^= material.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `synthetic-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function createSyntheticTrace(
  referenceSeq: string,
  options: SyntheticTraceOptions = {}
): SangerTraceData {
  const reference = referenceSeq.toUpperCase();
  if (!reference.length) {
    throw new Error('createSyntheticTrace requires a non-empty reference sequence');
  }
  const readLength = Math.max(
    1,
    Math.floor(
      Number.isFinite(options.length)
        ? (options.length as number)
        : Math.min(400, reference.length)
    )
  );
  const start = Math.floor(Number.isFinite(options.start) ? (options.start as number) : 0);
  const seed = Math.floor(Number.isFinite(options.seed) ? (options.seed as number) : 20261026);
  const fileName = options.fileName ?? `synthetic-${readLength}bp.ab1`;

  const resolveReadOffset = (index: number): number => {
    const integer = Math.floor(index);
    if (integer >= start && integer < start + readLength) return integer - start;
    if (integer >= 0 && integer < readLength) return integer;
    const relative = modulo(integer - start, reference.length);
    return relative < readLength ? relative : -1;
  };

  const mutationOffsets = new Map<number, string>();
  for (const mutation of options.mutations ?? []) {
    const offset = resolveReadOffset(mutation.index);
    const base = mutation.base.toUpperCase();
    if (offset >= 0 && isCanonicalBase(base)) mutationOffsets.set(offset, base);
  }

  const heterozygousOffsets = new Map<number, string>();
  for (const heterozygous of options.heterozygous ?? []) {
    const offset = resolveReadOffset(heterozygous.index);
    const base = heterozygous.base.toUpperCase();
    if (offset >= 0 && isCanonicalBase(base)) heterozygousOffsets.set(offset, base);
  }

  const calledSequence: string[] = [];
  for (let index = 0; index < readLength; index += 1) {
    const referenceBase = reference[modulo(start + index, reference.length)];
    const base = mutationOffsets.get(index) ?? referenceBase;
    calledSequence.push(isCanonicalBase(base) ? base : 'N');
  }

  const spacing = 12;
  const padding = spacing;
  const totalSamples = padding * 2 + readLength * spacing;
  const values: Record<SyntheticChannel, Float64Array> = {
    A: new Float64Array(totalSamples),
    T: new Float64Array(totalSamples),
    G: new Float64Array(totalSamples),
    C: new Float64Array(totalSamples)
  };
  const baseLocations = new Array<number>(readLength);
  const qualityScores = new Array<number>(readLength);
  const random = createRandom(seed);
  const levels: Record<SyntheticChannel, number> = { A: 0, T: 0, G: 0, C: 0 };
  for (const channel of CHANNELS) levels[channel] = 2 + random() * 5;

  for (let index = 0; index < readLength; index += 1) {
    const center = padding + Math.round((index + 0.5) * spacing);
    baseLocations[index] = center;
    qualityScores[index] = 30 + Math.floor(random() * 15);
  }

  for (let index = 0; index < readLength; index += 1) {
    const center = baseLocations[index];
    const called = calledSequence[index];
    const primary: SyntheticChannel = isCanonicalBase(called) ? (called as SyntheticChannel) : 'A';
    const primaryAmplitude = 850 + random() * 350;
    const sigma = 2.6 + random() * 0.7;
    const radius = Math.ceil(sigma * 3.2);
    const applyPeak = (channel: SyntheticChannel, amplitude: number): void => {
      const target = values[channel];
      for (let sample = center - radius; sample <= center + radius; sample += 1) {
        if (sample < 0 || sample >= totalSamples) continue;
        const distance = (sample - center) / sigma;
        target[sample] += amplitude * Math.exp(-0.5 * distance * distance);
      }
    };
    applyPeak(primary, primaryAmplitude);
    applyPeak('A', 3 + random() * 5);
    applyPeak('T', 3 + random() * 5);
    applyPeak('G', 3 + random() * 5);
    applyPeak('C', 3 + random() * 5);

    const heterozygousBase = heterozygousOffsets.get(index);
    if (heterozygousBase && isCanonicalBase(heterozygousBase) && heterozygousBase !== primary) {
      const secondaryAmplitude = primaryAmplitude * (0.38 + random() * 0.16);
      applyPeak(heterozygousBase as SyntheticChannel, secondaryAmplitude);
    }
  }

  const traces: Record<SyntheticChannel, number[]> = { A: [], T: [], G: [], C: [] };
  for (const channel of CHANNELS) {
    const output = new Array<number>(totalSamples);
    for (let sample = 0; sample < totalSamples; sample += 1) {
      const noise = levels[channel] + random() * 3;
      output[sample] = Math.max(0, Math.round(values[channel][sample] + noise));
    }
    traces[channel] = output;
  }

  const sequence = calledSequence.join('');
  return {
    id: syntheticId(fileName, reference.length, start, readLength, seed),
    fileName,
    calledSequence: sequence,
    qualityScores,
    baseLocations,
    trimRange: mottTrim(qualityScores),
    traces
  };
}
