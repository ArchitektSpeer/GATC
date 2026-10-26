import type { SequenceFeature } from '../../types/schema';

export interface Point {
  x: number;
  y: number;
}

export interface RangeSegment {
  start: number;
  end: number;
}

export function mod(value: number, length: number): number {
  if (length <= 0) return 0;
  return ((value % length) + length) % length;
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function round(value: number, precision = 0): number {
  const p = 10 ** precision;
  return Math.round(value * p) / p;
}

export function formatBp(value: number): string {
  return value.toLocaleString('en-US');
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function trimNumber(value: number, digits = 1): string {
  const rounded = round(value, digits);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(digits);
}

/**
 * Split a 0-based half-open range into non-wrapping segments. In circular
 * coordinates start > end denotes a range crossing the origin.
 */
export function splitRange(
  start: number,
  end: number,
  length: number,
  circular = true,
): RangeSegment[] {
  if (length <= 0) return [];
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  if (!circular) {
    const s = clamp(Math.min(start, end), 0, length);
    const e = clamp(Math.max(start, end), 0, length);
    return e > s ? [{ start: s, end: e }] : [];
  }
  const s = mod(start, length);
  const e = mod(end, length);
  if (s === e) {
    if (start === end) return [];
    return [{ start: 0, end: length }];
  }
  if (s < e) return [{ start: s, end: e }];
  return [
    { start: s, end: length },
    { start: 0, end: e },
  ];
}

export function featureSegments(
  feature: SequenceFeature,
  length: number,
  circular = true,
): RangeSegment[] {
  if (length <= 0) return [];
  if (!circular) {
    const s = clamp(feature.start, 0, length);
    const e = clamp(feature.end, 0, length);
    return e > s ? [{ start: s, end: e }] : [];
  }
  const rawStart = mod(feature.start, length);
  const rawEnd = mod(feature.end, length);
  if (rawStart === rawEnd) {
    return feature.start === feature.end ? [] : [{ start: 0, end: length }];
  }
  if (rawStart < rawEnd) return [{ start: rawStart, end: rawEnd }];
  return [
    { start: rawStart, end: length },
    { start: 0, end: rawEnd },
  ];
}

export function segmentsOverlap(a: RangeSegment, b: RangeSegment): boolean {
  return a.start < b.end && b.start < a.end;
}

export function segmentLength(segments: RangeSegment[]): number {
  return segments.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
}

export function pointOnCircle(
  cx: number,
  cy: number,
  radius: number,
  angleDeg: number,
): Point {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

export function indexToAngle(index: number, length: number, startAngle = -90): number {
  if (length <= 0) return startAngle;
  return startAngle + (360 * mod(index, length)) / length;
}

export function angleToIndex(
  angleDeg: number,
  length: number,
  startAngle = -90,
): number {
  if (length <= 0) return 0;
  return mod(((angleDeg - startAngle) / 360) * length, length);
}

export function pointToIndex(
  x: number,
  y: number,
  cx: number,
  cy: number,
  length: number,
  startAngle = -90,
): number {
  const angle = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
  return angleToIndex(angle, length, startAngle);
}

export function describeArc(
  cx: number,
  cy: number,
  radius: number,
  start: number,
  end: number,
  length: number,
  startAngle = -90,
): string {
  if (length <= 0 || end <= start) return '';
  const a0 = indexToAngle(start, length, startAngle);
  const a1 = indexToAngle(end, length, startAngle);
  const p0 = pointOnCircle(cx, cy, radius, a0);
  const p1 = pointOnCircle(cx, cy, radius, a1);
  const span = ((end - start) / length) * 360;
  const largeArc = span > 180 ? 1 : 0;
  return `M ${p0.x.toFixed(3)} ${p0.y.toFixed(3)} A ${radius.toFixed(3)} ${radius.toFixed(3)} 0 ${largeArc} 1 ${p1.x.toFixed(3)} ${p1.y.toFixed(3)}`;
}

export function annularSectorPath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  start: number,
  end: number,
  length: number,
  startAngle = -90,
): string {
  if (length <= 0 || end <= start) return '';
  const a0 = indexToAngle(start, length, startAngle);
  const a1 = indexToAngle(end, length, startAngle);
  const span = ((end - start) / length) * 360;
  const largeArc = span > 180 ? 1 : 0;
  const outerStart = pointOnCircle(cx, cy, outerRadius, a0);
  const outerEnd = pointOnCircle(cx, cy, outerRadius, a1);
  const innerStart = pointOnCircle(cx, cy, innerRadius, a0);
  const innerEnd = pointOnCircle(cx, cy, innerRadius, a1);
  return [
    `M ${innerStart.x.toFixed(3)} ${innerStart.y.toFixed(3)}`,
    `L ${outerStart.x.toFixed(3)} ${outerStart.y.toFixed(3)}`,
    `A ${outerRadius.toFixed(3)} ${outerRadius.toFixed(3)} 0 ${largeArc} 1 ${outerEnd.x.toFixed(3)} ${outerEnd.y.toFixed(3)}`,
    `L ${innerEnd.x.toFixed(3)} ${innerEnd.y.toFixed(3)}`,
    `A ${innerRadius.toFixed(3)} ${innerRadius.toFixed(3)} 0 ${largeArc} 0 ${innerStart.x.toFixed(3)} ${innerStart.y.toFixed(3)}`,
    'Z',
  ].join(' ');
}

export interface ArrowPolygon {
  points: string;
  tip: Point;
}

export function directionalArrow(
  index: number,
  radius: number,
  length: number,
  direction: 1 | -1,
  size: number,
  cx: number,
  cy: number,
  startAngle = -90,
): ArrowPolygon {
  const tipAngle = indexToAngle(index, length, startAngle);
  const sweep = direction === 1 ? 1 : -1;
  const tangent = tipAngle + sweep * 90;
  const tangentRad = (tangent * Math.PI) / 180;
  const radialRad = (tipAngle * Math.PI) / 180;
  const tip = pointOnCircle(cx, cy, radius, tipAngle);
  const back = {
    x: tip.x - Math.cos(tangentRad) * size,
    y: tip.y - Math.sin(tangentRad) * size,
  };
  const left = {
    x: back.x + Math.cos(radialRad) * size * 0.55,
    y: back.y + Math.sin(radialRad) * size * 0.55,
  };
  const right = {
    x: back.x - Math.cos(radialRad) * size * 0.55,
    y: back.y - Math.sin(radialRad) * size * 0.55,
  };
  return {
    tip,
    points: `${tip.x.toFixed(2)},${tip.y.toFixed(2)} ${left.x.toFixed(2)},${left.y.toFixed(2)} ${right.x.toFixed(2)},${right.y.toFixed(2)}`,
  };
}

export function rectangularArrow(
  x1: number,
  x2: number,
  y: number,
  height: number,
  direction: 1 | -1,
): string {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const tip = direction === 1 ? right : left;
  const base = direction === 1 ? right - height : left + height;
  const top = y - height / 2;
  const bottom = y + height / 2;
  const notch = direction === 1 ? base : base;
  return [
    `${left.toFixed(2)},${top.toFixed(2)}`,
    `${notch.toFixed(2)},${top.toFixed(2)}`,
    `${tip.toFixed(2)},${y.toFixed(2)}`,
    `${notch.toFixed(2)},${bottom.toFixed(2)}`,
    `${right.toFixed(2)},${bottom.toFixed(2)}`,
  ].join(' ');
}

/**
 * Greedy interval-graph colouring for features. Wrapped features are split at
 * the origin before lane occupancy is tested.
 */
export interface FeatureTrackAssignment {
  lanes: SequenceFeature[][];
  laneById: Map<string, number>;
  segmentsById: Map<string, RangeSegment[]>;
}

export function assignFeatureTracks(
  features: SequenceFeature[],
  length: number,
  circular = true,
): FeatureTrackAssignment {
  const lanes: SequenceFeature[][] = [];
  const laneSegments: RangeSegment[][] = [];
  const laneById = new Map<string, number>();
  const segmentsById = new Map<string, RangeSegment[]>();
  if (length <= 0) {
    return { lanes, laneById, segmentsById };
  }

  const ordered = [...features].sort((a, b) => {
    const aSeg = featureSegments(a, length, circular);
    const bSeg = featureSegments(b, length, circular);
    const aStart = aSeg.length > 0 ? aSeg[0].start : 0;
    const bStart = bSeg.length > 0 ? bSeg[0].start : 0;
    if (aStart !== bStart) return aStart - bStart;
    const aLen = segmentLength(aSeg);
    const bLen = segmentLength(bSeg);
    if (aLen !== bLen) return bLen - aLen;
    return a.id.localeCompare(b.id);
  });

  for (const feature of ordered) {
    const segments = featureSegments(feature, length, circular);
    if (segments.length === 0) continue;
    let lane = -1;
    for (let i = 0; i < lanes.length; i += 1) {
      const occupied = laneSegments[i];
      const collision = segments.some((seg) =>
        occupied.some((existing) => segmentsOverlap(seg, existing)),
      );
      if (!collision) {
        lane = i;
        break;
      }
    }
    if (lane === -1) {
      lane = lanes.length;
      lanes.push([]);
      laneSegments.push([]);
    }
    lanes[lane].push(feature);
    laneSegments[lane].push(...segments);
    laneById.set(feature.id, lane);
    segmentsById.set(feature.id, segments);
  }
  return { lanes, laneById, segmentsById };
}

export interface LeaderItem {
  id: string;
  anchorIndex: number;
  text: string;
}

export type LeaderSide = 'left' | 'right';

export interface LeaderLabel<T extends LeaderItem = LeaderItem> {
  item: T;
  side: LeaderSide;
  anchor: Point;
  elbow: Point;
  textX: number;
  textY: number;
  textAnchor: 'start' | 'end';
  emphasis: boolean;
  muted: boolean;
}

export interface LeaderLayoutOptions {
  cx: number;
  cy: number;
  radius: number;
  length: number;
  minY: number;
  maxY: number;
  gap?: number;
  elbowOffset?: number;
  textOffset?: number;
}

export interface LeaderSource extends LeaderItem {
  emphasis?: boolean;
  muted?: boolean;
}

/**
 * Force-relaxed vertical scan for radial leader lines. Labels are separated by
 * a minimum vertical gap on each side and kept within the available viewport.
 */
export function layoutLeaderLabels<T extends LeaderSource>(
  items: T[],
  options: LeaderLayoutOptions,
): Array<LeaderLabel<T>> {
  const {
    cx,
    cy,
    radius,
    length,
    minY,
    maxY,
    gap = 14,
    elbowOffset = 26,
    textOffset = 58,
  } = options;
  if (length <= 0) return [];
  const left: T[] = [];
  const right: T[] = [];
  for (const item of items) {
    const angle = indexToAngle(item.anchorIndex, length);
    if (Math.cos((angle * Math.PI) / 180) >= 0) right.push(item);
    else left.push(item);
  }

  const place = (sideItems: T[], side: LeaderSide): Array<LeaderLabel<T>> => {
    if (sideItems.length === 0) return [];
    const available = Math.max(0, maxY - minY);
    const capacity = Math.max(1, Math.floor(available / gap) + 1);
    let chosen = sideItems;
    if (sideItems.length > capacity) {
      const important = sideItems.filter((item) => item.emphasis);
      if (important.length >= capacity) {
        chosen = important.slice(0, capacity);
      } else {
        const remainder = sideItems.filter((item) => !item.emphasis);
        const slots = capacity - important.length;
        const sampled: T[] = [];
        for (let i = 0; i < slots && remainder.length > 0; i += 1) {
          sampled.push(remainder[Math.floor((i * remainder.length) / slots)]);
        }
        chosen = [...important, ...sampled];
      }
    }
    const sorted = [...chosen].sort((a, b) => {
      const ay = pointOnCircle(cx, cy, radius, indexToAngle(a.anchorIndex, length)).y;
      const by = pointOnCircle(cx, cy, radius, indexToAngle(b.anchorIndex, length)).y;
      if (ay !== by) return ay - by;
      return a.id.localeCompare(b.id);
    });
    const desired = sorted.map((item) =>
      clamp(
        pointOnCircle(cx, cy, radius + 18, indexToAngle(item.anchorIndex, length)).y,
        minY,
        maxY,
      ),
    );
    const n = sorted.length;
    const ys = [...desired];
    if (n > 1) {
      const crowded = (n - 1) * gap > available;
      if (crowded) {
        for (let i = 0; i < n; i += 1) {
          ys[i] = minY + (available * i) / (n - 1);
        }
      } else {
        ys[0] = clamp(desired[0], minY, maxY);
        for (let i = 1; i < n; i += 1) {
          ys[i] = Math.max(desired[i], ys[i - 1] + gap);
        }
        if (ys[n - 1] > maxY) {
          ys[n - 1] = maxY;
          for (let i = n - 2; i >= 0; i -= 1) {
            ys[i] = Math.min(ys[i], ys[i + 1] - gap);
          }
        }
        if (ys[0] < minY) {
          const shift = minY - ys[0];
          for (let i = 0; i < n; i += 1) ys[i] += shift;
          if (ys[n - 1] > maxY) {
            for (let i = 0; i < n; i += 1) {
              ys[i] = maxY - (n - 1 - i) * gap;
            }
          }
        }
      }
    }
    const sign = side === 'right' ? 1 : -1;
    const elbowX = cx + sign * (radius + elbowOffset);
    const textX = cx + sign * (radius + textOffset);
    return sorted.map((item, i) => {
      const angle = indexToAngle(item.anchorIndex, length);
      return {
        item,
        side,
        anchor: pointOnCircle(cx, cy, radius, angle),
        elbow: { x: elbowX, y: ys[i] },
        textX,
        textY: ys[i],
        textAnchor: side === 'right' ? 'start' : 'end',
        emphasis: Boolean(item.emphasis),
        muted: Boolean(item.muted),
      };
    });
  };

  return [...place(left, 'left'), ...place(right, 'right')];
}

export function niceTickStep(length: number, targetTicks = 12): number {
  if (length <= 0) return 1;
  const rough = length / Math.max(1, targetTicks);
  const power = Math.floor(Math.log10(Math.max(1, rough)));
  const base = 10 ** power;
  const normalized = rough / base;
  let nice = 1;
  if (normalized > 5) nice = 10;
  else if (normalized > 2) nice = 5;
  else if (normalized > 1) nice = 2;
  return Math.max(1, Math.round(nice * base));
}

export function textWidthEstimate(text: string, fontSize: number): number {
  return text.length * fontSize * 0.58;
}

export function hexToRgba(hex: string, alpha: number): string {
  let value = hex.trim();
  if (!value.startsWith('#')) return `rgba(100, 116, 139, ${alpha})`;
  if (value.length === 4) {
    value = `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  const parsed = Number.parseInt(value.slice(1), 16);
  if (!Number.isFinite(parsed)) return `rgba(100, 116, 139, ${alpha})`;
  const r = (parsed >> 16) & 255;
  const g = (parsed >> 8) & 255;
  const b = parsed & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function contrastText(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '#ffffff';
  const parsed = Number.parseInt(clean, 16);
  if (!Number.isFinite(parsed)) return '#ffffff';
  const r = (parsed >> 16) & 255;
  const g = (parsed >> 8) & 255;
  const b = parsed & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#111111' : '#ffffff';
}
