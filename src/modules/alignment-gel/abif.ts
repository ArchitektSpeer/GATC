// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Qiu Shui
// SPDX-License-Identifier: GPL-3.0-or-later
import type { SangerTraceData } from '../../types/schema';
import { iupacForPair } from './genetics';

type BaseChannel = 'A' | 'T' | 'G' | 'C';

interface AbifEntry {
  name: string;
  number: number;
  type: number;
  elementSize: number;
  elementCount: number;
  dataSize: number;
  dataOffset: number;
  inlineOffset: number;
  hasExternal: boolean;
}

interface ParsedAbif {
  sequence: string;
  qualities: number[];
  locations: number[];
  traces: Record<BaseChannel, number[]>;
}

const ABIF_ENTRY_SIZE = 28;
const MAX_PHRED = 62;

function tagKey(name: string, number: number): string {
  return `${name}:${number}`;
}

function readAscii(view: DataView, offset: number, count: number): string {
  let text = '';
  for (let i = 0; i < count; i += 1) {
    const code = view.getUint8(offset + i);
    if (code === 0) break;
    text += String.fromCharCode(code);
  }
  return text;
}

function elementStride(type: number): number {
  switch (type) {
    case 1:
    case 2:
    case 8:
      return 1;
    case 3:
    case 4:
      return 2;
    case 5:
    case 6:
      return 4;
    case 7:
      return 8;
    case 9:
    case 10:
      return 4;
    default:
      return 1;
  }
}

function readNumericEntry(view: DataView, entry: AbifEntry): number[] {
  const stride = elementStride(entry.type) || entry.elementSize || 1;
  const inlinePreferred = entry.elementCount * stride <= 4;
  const dataOffset = inlinePreferred
    ? entry.inlineOffset
    : entry.hasExternal
      ? entry.dataOffset
      : entry.inlineOffset;
  const available = Math.max(0, Math.floor((view.byteLength - dataOffset) / stride));
  const count = Math.max(0, Math.min(entry.elementCount, available));
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const offset = dataOffset + i * stride;
    let value = 0;
    switch (entry.type) {
      case 1:
      case 8:
        value = view.getUint8(offset);
        break;
      case 3:
        value = view.getUint16(offset, false);
        break;
      case 4:
        value = view.getInt16(offset, false);
        break;
      case 5:
        value = view.getInt32(offset, false);
        break;
      case 6:
        value = view.getFloat32(offset, false);
        break;
      case 7:
        value = view.getFloat64(offset, false);
        break;
      default:
        value = view.getUint8(offset);
        break;
    }
    values.push(value);
  }
  return values;
}

function readDirectory(view: DataView): Map<string, AbifEntry> {
  const entries = new Map<string, AbifEntry>();
  if (view.byteLength < 128) {
    throw new Error('Invalid ABIF data: file is shorter than the 128-byte header');
  }
  const magic = readAscii(view, 0, 4);
  if (magic !== 'ABIF') {
    throw new Error('Invalid ABIF data: missing ABIF magic bytes');
  }
  const directoryOffset = view.getInt32(26, false);
  const directoryCount = view.getInt32(18, false);
  if (directoryOffset < 0 || directoryOffset + directoryCount * ABIF_ENTRY_SIZE > view.byteLength) {
    throw new Error('Invalid ABIF data: directory is outside the file bounds');
  }
  for (let index = 0; index < directoryCount; index += 1) {
    const offset = directoryOffset + index * ABIF_ENTRY_SIZE;
    const name = readAscii(view, offset, 4);
    if (name.length < 4) continue;
    const number = view.getInt32(offset + 4, false);
    const type = view.getInt16(offset + 8, false);
    const elementSize = view.getInt16(offset + 10, false);
    const elementCount = view.getInt32(offset + 12, false);
    const dataSize = view.getInt32(offset + 16, false);
    const dataOffsetField = view.getInt32(offset + 20, false);
    if (elementCount <= 0 && dataSize <= 0) continue;
    const stride = elementStride(type) || elementSize || 1;
    const count = elementCount > 0 ? elementCount : Math.floor(dataSize / stride);
    if (count <= 0) continue;
    const byteSize = Math.min(
      dataSize > 0 ? dataSize : count * stride,
      count * stride
    );
    const inline = byteSize > 0 && byteSize <= 4;
    const hasExternal =
      dataOffsetField >= 0 &&
      dataOffsetField < view.byteLength &&
      dataOffsetField + byteSize <= view.byteLength;
    if (!inline && !hasExternal) continue;
    entries.set(tagKey(name, number), {
      name,
      number,
      type,
      elementSize,
      elementCount: count,
      dataSize,
      dataOffset: dataOffsetField,
      inlineOffset: offset + 20,
      hasExternal
    });
  }
  return entries;
}

function findEntry(
  entries: Map<string, AbifEntry>,
  tagName: string,
  preferredNumbers: number[]
): AbifEntry | undefined {
  for (const number of preferredNumbers) {
    const entry = entries.get(tagKey(tagName, number));
    if (entry) return entry;
  }
  return undefined;
}

function readStringEntry(view: DataView, entry: AbifEntry): string {
  const stride = elementStride(entry.type) || entry.elementSize || 1;
  const count = Math.max(
    0,
    Math.min(entry.elementCount, Math.floor((view.byteLength - entry.inlineOffset) / stride))
  );
  if (entry.elementCount <= 4) {
    const inline = readAscii(view, entry.inlineOffset, entry.elementCount);
    if (inline.length === entry.elementCount && /^[A-Za-z*]+$/.test(inline)) {
      return inline;
    }
    if (entry.hasExternal) {
      return readAscii(
        view,
        entry.dataOffset,
        Math.max(
          0,
          Math.min(entry.elementCount, Math.floor((view.byteLength - entry.dataOffset) / stride))
        )
      );
    }
    return inline;
  }
  const dataOffset = entry.hasExternal ? entry.dataOffset : entry.inlineOffset;
  const available = Math.max(0, Math.min(count, Math.floor((view.byteLength - dataOffset) / stride)));
  return readAscii(view, dataOffset, available);
}

function normalizeChannelOrder(value: string): BaseChannel[] {
  const fallback: BaseChannel[] = ['G', 'A', 'T', 'C'];
  const seen = new Set<string>();
  const order: BaseChannel[] = [];
  for (let index = 0; index < 4; index += 1) {
    const candidate = (value[index] ?? '').toUpperCase();
    if (/^[ATGC]$/.test(candidate) && !seen.has(candidate)) {
      order.push(candidate as BaseChannel);
      seen.add(candidate);
    } else {
      const replacement = fallback.find(base => !seen.has(base));
      if (replacement) {
        order.push(replacement);
        seen.add(replacement);
      }
    }
  }
  return order;
}

function positiveTrace(values: number[]): number[] {
  if (!values.length) return values;
  let hasNegative = false;
  for (const value of values) {
    if (value < 0) {
      hasNegative = true;
      break;
    }
  }
  if (!hasNegative) return values;
  return values.map(value => (value > 0 ? value : 0));
}

function smoothSignal(values: number[]): number[] {
  if (values.length === 0) return [];
  const smoothed = new Array<number>(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const left = values[i - 1] ?? values[i];
    const center = values[i];
    const right = values[i + 1] ?? values[i];
    smoothed[i] = (left + 2 * center + right) / 4;
  }
  return smoothed;
}

function callFromTrace(traces: Record<BaseChannel, number[]>): {
  sequence: string;
  locations: number[];
} {
  const totalSamples = Math.max(
    traces.A.length,
    traces.T.length,
    traces.G.length,
    traces.C.length
  );
  if (totalSamples === 0) return { sequence: '', locations: [] };
  const channels: Array<{ base: BaseChannel; values: number[] }> = [
    { base: 'A', values: traces.A },
    { base: 'T', values: traces.T },
    { base: 'G', values: traces.G },
    { base: 'C', values: traces.C }
  ];
  const smoothed = channels.map(channel => ({
    base: channel.base,
    values: smoothSignal(channel.values)
  }));
  const combined = new Array<number>(totalSamples).fill(0);
  for (const channel of smoothed) {
    for (let i = 0; i < totalSamples; i += 1) {
      combined[i] += channel.values[i] ?? 0;
    }
  }
  let maximum = 0;
  for (const value of combined) maximum = Math.max(maximum, value);
  if (maximum <= 0) return { sequence: '', locations: [] };
  const threshold = maximum * 0.08;
  const locations: number[] = [];
  for (let i = 1; i < totalSamples - 1; i += 1) {
    if (combined[i] < threshold) continue;
    if (combined[i] < combined[i - 1] || combined[i] < combined[i + 1]) continue;
    if (locations.length && i - locations[locations.length - 1] < 3) {
      const previous = locations[locations.length - 1];
      if (combined[i] > combined[previous]) locations[locations.length - 1] = i;
      continue;
    }
    locations.push(i);
  }
  let sequence = '';
  for (const location of locations) {
    let bestBase: BaseChannel = 'A';
    let bestValue = -Infinity;
    for (const channel of smoothed) {
      const value = channel.values[location] ?? 0;
      if (value > bestValue) {
        bestValue = value;
        bestBase = channel.base;
      }
    }
    sequence += bestBase;
  }
  return { sequence, locations };
}

function peakAt(values: number[], location: number, radius = 4): number {
  if (!values.length) return 0;
  const clamped = Math.max(0, Math.min(values.length - 1, location));
  const start = Math.max(0, clamped - radius);
  const end = Math.min(values.length - 1, clamped + radius);
  let maximum = 0;
  for (let i = start; i <= end; i += 1) maximum = Math.max(maximum, values[i] ?? 0);
  return maximum;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function windowSlice<T>(values: T[], center: number, radius: number): T[] {
  const start = Math.max(0, center - radius);
  const end = Math.min(values.length, center + radius + 1);
  return values.slice(start, end);
}

/**
 * Estimates Phred scores from raw trace geometry when PCON is absent or
 * uninformative. Each base is scored from the called peak against the second
 * highest channel (peak ratio), the local noise level, the local signal
 * strength and the regularity of neighbouring peak spacing. Non-canonical
 * calls (N and IUPAC codes) are always reported as low quality.
 */
function estimateQualities(
  sequence: string,
  locations: number[],
  traces: Record<BaseChannel, number[]>
): number[] {
  const length = sequence.length;
  if (length === 0) return [];

  const channels: BaseChannel[] = ['A', 'T', 'G', 'C'];
  const primaryAmplitudes = new Array<number>(length);
  const secondaryAmplitudes = new Array<number>(length);
  for (let index = 0; index < length; index += 1) {
    const location = locations[index] ?? 0;
    const amplitudes: Record<BaseChannel, number> = {
      A: peakAt(traces.A, location),
      T: peakAt(traces.T, location),
      G: peakAt(traces.G, location),
      C: peakAt(traces.C, location)
    };
    const base = sequence[index];
    const canonical = /^[ATGC]$/.test(base) ? (base as BaseChannel) : undefined;
    if (canonical) {
      primaryAmplitudes[index] = amplitudes[canonical];
      let secondary = 0;
      for (const channel of channels) {
        if (channel !== canonical) secondary = Math.max(secondary, amplitudes[channel]);
      }
      secondaryAmplitudes[index] = secondary;
    } else {
      const ordered = channels
        .map(channel => amplitudes[channel])
        .sort((left, right) => right - left);
      primaryAmplitudes[index] = ordered[0] ?? 0;
      secondaryAmplitudes[index] = ordered[1] ?? 0;
    }
  }

  const peakRatios = new Array<number>(length);
  for (let index = 0; index < length; index += 1) {
    const primary = primaryAmplitudes[index];
    peakRatios[index] = primary > 0
      ? clamp(secondaryAmplitudes[index] / primary, 0, 1)
      : 1;
  }

  const spacings = new Array<number>(length).fill(0);
  for (let index = 1; index < length; index += 1) {
    spacings[index] = (locations[index] ?? 0) - (locations[index - 1] ?? 0);
  }

  const SIGNAL_WINDOW = 12;
  const NOISE_WINDOW = 16;
  const RATIO_MIDPOINT = 0.42;
  const RATIO_STEEPNESS = 5;
  // Isolated weak canonical calls still receive a small score so that a single
  // dip does not dominate the cumulative Mott sum.
  const MIN_CANONICAL_QUALITY = 5;
  const values = new Array<number>(length);

  for (let index = 0; index < length; index += 1) {
    const base = sequence[index];
    const ratio = peakRatios[index];

    if (!/^[ATGC]$/.test(base)) {
      // Every ambiguous call carries the same low ceiling, with weaker calls
      // scoring even lower.
      values[index] = clamp(Math.round(5 * (1 - ratio)), 0, 5);
      continue;
    }

    const primary = primaryAmplitudes[index];
    if (primary <= 0) {
      values[index] = 0;
      continue;
    }

    const localPrimary = windowSlice(primaryAmplitudes, index, SIGNAL_WINDOW);
    const localSignal = Math.max(1, median(localPrimary));
    const signalRatio = primary / localSignal;

    const localRatios = windowSlice(peakRatios, index, NOISE_WINDOW);
    const localNoise = median(localRatios);

    const localSpacings: number[] = [];
    for (
      let neighbour = Math.max(1, index - SIGNAL_WINDOW);
      neighbour <= Math.min(length - 1, index + SIGNAL_WINDOW);
      neighbour += 1
    ) {
      localSpacings.push(spacings[neighbour]);
    }
    const medianSpacing = Math.max(1, median(localSpacings));
    let spacingDeviation = 0;
    let spacingCount = 0;
    if (index > 0) {
      spacingDeviation += Math.abs(spacings[index] - medianSpacing) / medianSpacing;
      spacingCount += 1;
    }
    if (index < length - 1) {
      spacingDeviation +=
        Math.abs(spacings[index + 1] - medianSpacing) / medianSpacing;
      spacingCount += 1;
    }
    if (spacingCount > 0) spacingDeviation /= spacingCount;

    // A single clean peak is not trustworthy when it sits inside a noisy
    // neighbourhood, so the local noise level caps the score.
    const peakRatioQuality =
      MAX_PHRED /
      (1 + Math.pow(ratio / RATIO_MIDPOINT, RATIO_STEEPNESS));
    const noiseQuality = MAX_PHRED * Math.max(0, 1 - 1.4 * localNoise);
    const spacingPenalty = Math.min(
      18,
      50 * Math.max(0, spacingDeviation - 0.15)
    );
    const intensityPenalty = Math.min(20, 20 * Math.max(0, 1 - signalRatio));

    const quality =
      Math.min(peakRatioQuality, noiseQuality) -
      spacingPenalty -
      intensityPenalty;
    values[index] = clamp(
      Math.round(quality),
      MIN_CANONICAL_QUALITY,
      MAX_PHRED
    );
  }

  return values;
}

function refineLocations(
  sequence: string,
  locations: number[],
  traces: Record<BaseChannel, number[]>,
  totalSamples: number
): number[] {
  const output = new Array<number>(sequence.length);
  const spacing = sequence.length > 0 ? totalSamples / sequence.length : totalSamples;
  const radius = Math.max(2, Math.floor(spacing / 2));
  for (let index = 0; index < sequence.length; index += 1) {
    const supplied = locations[index];
    const expected = supplied ?? Math.round((index + 0.5) * spacing);
    const base = sequence[index];
    const canonical = /^[ATGC]$/.test(base);
    const channel = canonical ? (traces[base as BaseChannel] ?? []) : [];
    const valueAt = (sample: number): number => {
      if (canonical) return channel[sample] ?? 0;
      return Math.max(
        traces.A[sample] ?? 0,
        traces.T[sample] ?? 0,
        traces.G[sample] ?? 0,
        traces.C[sample] ?? 0
      );
    };
    const anchored = Math.max(0, Math.min(totalSamples - 1, expected));
    let best = anchored;
    let bestValue = valueAt(anchored);
    const start = Math.max(0, expected - radius);
    const end = Math.min(totalSamples - 1, expected + radius);
    for (let sample = start; sample <= end; sample += 1) {
      const value = valueAt(sample);
      if (value > bestValue) {
        bestValue = value;
        best = sample;
      }
    }
    output[index] = best;
  }
  return output;
}

function parseAbifBuffer(buffer: ArrayBuffer): ParsedAbif {
  const view = new DataView(buffer);
  const entries = readDirectory(view);

  const fwoEntry = findEntry(entries, 'FWO_', [1, 2]);
  const fwo = fwoEntry ? readStringEntry(view, fwoEntry) : 'GATC';
  const channelOrder = normalizeChannelOrder(fwo);

  const traces: Record<BaseChannel, number[]> = { A: [], T: [], G: [], C: [] };
  for (let index = 0; index < 4; index += 1) {
    const entry = findEntry(entries, 'DATA', [9 + index]);
    if (!entry) continue;
    const base = channelOrder[index];
    const values = positiveTrace(readNumericEntry(view, entry));
    if (values.length && traces[base].length === 0) traces[base] = values;
  }

  let totalSamples = Math.max(
    traces.A.length,
    traces.T.length,
    traces.G.length,
    traces.C.length
  );
  if (totalSamples === 0) {
    throw new Error('Invalid ABIF data: no four-channel trace data found');
  }
  for (const base of ['A', 'T', 'G', 'C'] as BaseChannel[]) {
    const values = traces[base];
    if (values.length < totalSamples) {
      const padded = new Array<number>(totalSamples).fill(0);
      for (let i = 0; i < values.length; i += 1) padded[i] = values[i];
      traces[base] = padded;
    } else if (values.length > totalSamples) {
      traces[base] = values.slice(0, totalSamples);
    }
  }

  const baseCallEntry = findEntry(entries, 'PBAS', [2, 1]);
  const locationEntry = findEntry(entries, 'PLOC', [2, 1]);
  const qualityEntry = findEntry(entries, 'PCON', [2, 1]);

  let sequence = '';
  let locations: number[] = [];
  if (baseCallEntry) {
    const text = readStringEntry(view, baseCallEntry);
    sequence = text.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (locationEntry) {
      locations = readNumericEntry(view, locationEntry).filter(
        value => Number.isFinite(value) && value >= 0 && value < totalSamples
      );
    }
  }

  if (!sequence) {
    const called = callFromTrace(traces);
    sequence = called.sequence;
    locations = called.locations;
  }

  if (!sequence) {
    throw new Error('Invalid ABIF data: no base calls could be recovered');
  }

  if (locations.length < sequence.length) {
    locations = refineLocations(sequence, locations, traces, totalSamples);
  } else {
    locations = locations.slice(0, sequence.length);
    locations = refineLocations(sequence, locations, traces, totalSamples);
  }
  locations = locations.map(location => Math.max(0, Math.min(totalSamples - 1, location)));

  let qualities: number[] = [];
  if (qualityEntry) {
    const raw = readNumericEntry(view, qualityEntry);
    if (raw.length >= sequence.length) qualities = raw.slice(0, sequence.length);
  }
  const informative = qualities.some(value => value > 1);
  if (!informative) {
    qualities = estimateQualities(sequence, locations, traces);
  }
  qualities = qualities.map(value => Math.max(0, Math.min(MAX_PHRED, Math.round(value))));

  if (qualities.length < sequence.length) {
    const padded = new Array<number>(sequence.length).fill(20);
    for (let i = 0; i < qualities.length; i += 1) padded[i] = qualities[i];
    qualities = padded;
  }
  qualities = qualities.slice(0, sequence.length);

  return { sequence, qualities, locations, traces };
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export async function parseAb1Trace(buffer: ArrayBuffer, fileName: string): Promise<SangerTraceData> {
  const parsed = parseAbifBuffer(buffer);
  const trimRange = mottTrim(parsed.qualities);
  const id = `ab1-${hashString(`${fileName}:${buffer.byteLength}:${parsed.sequence.slice(0, 48)}`)}`;
  return {
    id,
    fileName,
    calledSequence: parsed.sequence,
    qualityScores: parsed.qualities,
    baseLocations: parsed.locations,
    trimRange,
    traces: parsed.traces
  };
}

export function mottTrim(qualityScores: number[], errorThreshold = 0.05): [number, number] {
  const length = qualityScores.length;
  if (length === 0) return [0, 0];
  const threshold = Number.isFinite(errorThreshold)
    ? Math.max(1e-6, Math.min(1, errorThreshold))
    : 0.05;
  const errors = qualityScores.map(score => {
    const quality = Number.isFinite(score) ? Math.max(0, Math.min(99, score)) : 0;
    return Math.min(1, Math.pow(10, -quality / 10));
  });

  let running = 0;
  let runningStart = 0;
  let bestScore = 0;
  let bestStart = 0;
  let bestEnd = 0;
  // Modified Mott: weight each base by (error threshold - error probability),
  // reset negative running sums, and keep the segment from the first positive
  // weight to the position with the highest running sum.
  for (let index = 0; index < length; index += 1) {
    running += threshold - errors[index];
    if (running > bestScore) {
      bestScore = running;
      bestStart = runningStart;
      bestEnd = index + 1;
    }
    if (running < 0) {
      running = 0;
      runningStart = index + 1;
    }
  }
  if (bestEnd <= bestStart) return [0, 0];
  return [bestStart, bestEnd];
}

export interface SecondaryPeakCall {
  baseIndex: number;
  primary: string;
  secondary: string;
  iupac: string;
  ratio: number;
}

export function detectSecondaryPeaks(trace: SangerTraceData, ratio = 0.35): SecondaryPeakCall[] {
  const threshold = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0.35;
  const result: SecondaryPeakCall[] = [];
  const traceLength = Math.max(
    trace.traces.A.length,
    trace.traces.T.length,
    trace.traces.G.length,
    trace.traces.C.length
  );
  if (traceLength === 0) return result;

  for (let index = 0; index < trace.calledSequence.length; index += 1) {
    const location = trace.baseLocations[index];
    if (location === undefined || !Number.isFinite(location)) continue;
    const amplitudes: Record<string, number> = {
      A: peakAt(trace.traces.A, location),
      T: peakAt(trace.traces.T, location),
      G: peakAt(trace.traces.G, location),
      C: peakAt(trace.traces.C, location)
    };
    const called = trace.calledSequence[index].toUpperCase();
    const primary = /^[ATGC]$/.test(called)
      ? called
      : (Object.keys(amplitudes) as Array<'A' | 'T' | 'G' | 'C'>).reduce((best, base) =>
          amplitudes[base] > amplitudes[best] ? base : best
        );
    let secondary = '';
    let secondaryAmplitude = -Infinity;
    let primaryAmplitude = amplitudes[primary] ?? 0;
    for (const base of ['A', 'T', 'G', 'C'] as Array<'A' | 'T' | 'G' | 'C'>) {
      if (base === primary) continue;
      if (amplitudes[base] > secondaryAmplitude) {
        secondaryAmplitude = amplitudes[base];
        secondary = base;
      }
    }
    if (primaryAmplitude <= 0) continue;
    const observedRatio = secondaryAmplitude / primaryAmplitude;
    if (observedRatio >= threshold) {
      result.push({
        baseIndex: index,
        primary,
        secondary,
        iupac: iupacForPair(primary, secondary),
        ratio: observedRatio
      });
    }
  }
  return result;
}
