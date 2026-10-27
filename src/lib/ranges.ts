// SPDX-License-Identifier: GPL-3.0-or-later
// Range conversion between the UI (1-based, inclusive) and the data model
// (0-based, half-open, start > end wraps the origin of a circular molecule).
import type { PlasmidDocument } from '../types/schema';

type Topo = Pick<PlasmidDocument, 'length' | 'topology'>;

export interface Range {
  start: number;
  end: number;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * Why a 0-based half-open range is invalid on `doc`, or null when it is valid.
 * `start === end` is an empty range (an insertion point) and is accepted only with `allowEmpty`.
 */
export function rangeError(doc: Topo, start: unknown, end: unknown, opts: { allowEmpty?: boolean } = {}): string | null {
  if (!isInt(start) || !isInt(end)) return '坐标必须是整数';
  if (start < 0 || end < 0 || start > doc.length || end > doc.length) return `坐标超出序列范围 0–${doc.length}`;
  if (start === end) return opts.allowEmpty ? null : '区间为空';
  if (start > end && doc.topology !== 'circular') return '线性序列的起点必须小于终点';
  return null;
}

/**
 * Convert UI input (1-based `start`, inclusive `end`) to a model range.
 * `end === start - 1` means an empty range before `start`. On a circular
 * molecule `end < start - 1` is a range across the origin.
 */
export function fromUiRange(doc: Topo, start: number, end: number): Range | { error: string } {
  if (!isInt(start) || !isInt(end)) return { error: '坐标必须是整数' };
  const s = start - 1;
  if (s < 0 || s > doc.length) return { error: `起点必须在 1–${doc.length + 1} 之间` };
  if (end === start - 1) return { start: s, end: s };
  if (end < 1 || end > doc.length) return { error: `终点必须在 1–${doc.length} 之间，或填 起点−1 表示空区间` };
  if (end >= start) return { start: s, end };
  if (doc.topology !== 'circular') return { error: '线性序列的终点不能小于起点' };
  return { start: s, end };
}

/** Bases covered by a model range, joining the end and the start of a circular molecule. */
export function rangeSequence(doc: Pick<PlasmidDocument, 'sequence'>, { start, end }: Range): string {
  return start <= end ? doc.sequence.slice(start, end) : doc.sequence.slice(start) + doc.sequence.slice(0, end);
}
