// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Why a Sanger read disagrees with the plasmid it was aligned to. Every finding
// names the evidence it rests on: the Phred score at the base, the primer whose
// footprint it falls in, or the cloning junction it sits next to. Nothing is
// inferred from a model — a change with no such evidence is reported as
// unexplained rather than given a plausible-sounding cause.
import type { PlasmidDocument, Primer, SangerTraceData } from '../../types/schema';
import { t as translate } from '../../lib/i18n';

export type SangerCause =
  /** Low Phred at the called base, or outside the high-quality window. */
  | 'read_quality'
  /** Several double peaks in one read: more than one template. */
  | 'mixed_template'
  /** A single double peak, which may be real or may be peak overlap. */
  | 'heterozygous_peak'
  /** Inside the 5' tail a primer added to the molecule. */
  | 'primer_tail'
  /** Inside a primer's annealing footprint. */
  | 'primer_annealing'
  /** At or next to a cloning junction the caller supplied. */
  | 'junction'
  /** No evidence points anywhere; said so rather than guessed. */
  | 'unexplained';

export interface SangerEvent {
  /** On the plasmid, 0-based half-open. An insertion has refStart === refEnd. */
  refStart: number;
  refEnd: number;
  /** In the called sequence of the read, 0-based half-open. */
  queryStart: number;
  queryEnd: number;
  type: 'substitution' | 'insertion' | 'deletion' | 'heterozygous_peak';
  refBases: string;
  queryBases: string;
  /** Lowest Phred over the read bases involved, or null for a pure deletion. */
  minQuality: number | null;
  /** The amino-acid consequence the alignment already worked out, if any. */
  effect?: string;
}

export interface SangerFinding {
  /** The change this is about; null for findings about the whole read. */
  event: SangerEvent | null;
  cause: SangerCause;
  confidence: 'high' | 'medium' | 'low';
  /** Facts from the data, each one checkable in the trace or the document. */
  evidence: string[];
  suggestion: string;
  primerName?: string;
  junctionLabel?: string;
}

/** A cloning junction in the document's own coordinates. */
export interface TraceJunction {
  position: number;
  label: string;
}

export interface SangerAttributionOptions {
  junctions?: TraceJunction[];
  /** Phred at or below which a called base is not trusted. Default 20. */
  minQuality?: number;
  /** How many bases from a junction still counts as at it. Default 6. */
  junctionWindow?: number;
  /** Double peaks needed before a read is called mixed. Default 3. */
  mixedTemplatePeaks?: number;
}

export interface SangerDiagnosis {
  traceId: string;
  fileName: string;
  aligned: boolean;
  read: {
    usableBases: number;
    calledBases: number;
    identityPercent: number;
    strand: 1 | -1;
    refStart: number;
    refEnd: number;
  };
  events: SangerEvent[];
  findings: SangerFinding[];
  /** One line per thing worth saying, in the order a reader wants them. */
  summary: string[];
}

/** 0-based half-open containment that also works across the origin. */
function inRange(position: number, start: number, end: number, length: number): boolean {
  if (length <= 0) return false;
  const p = ((position % length) + length) % length;
  const s = ((start % length) + length) % length;
  const e = ((end % length) + length) % length;
  if (s === e) return start !== end; // a full turn
  return s < e ? p >= s && p < e : p >= s || p < e;
}

/** Shortest distance between two positions, the long way round included. */
function circularDistance(a: number, b: number, length: number, circular: boolean): number {
  const direct = Math.abs(a - b);
  if (!circular) return direct;
  return Math.min(direct, length - direct);
}

/** Where the 5' tail of a primer sits on this molecule, or null when it has none. */
function tailFootprint(primer: Primer, length: number): { start: number; end: number } | null {
  const tail = primer.tailSequence?.length ?? 0;
  if (!tail) return null;
  if (primer.strand === 1) return { start: primer.bindingStart - tail, end: primer.bindingStart };
  return { start: primer.bindingEnd, end: primer.bindingEnd + tail };
}

/**
 * Group the per-base mismatches the aligner reported into events: a run of
 * deletions is one deletion, not three, which is what decides whether a coding
 * sequence stays in frame.
 */
export function groupTraceMismatches(trace: SangerTraceData): SangerEvent[] {
  const alignment = trace.alignment;
  if (!alignment) return [];
  const quality = (index: number): number | null =>
    index >= 0 && index < trace.qualityScores.length ? trace.qualityScores[index] : null;

  const events: SangerEvent[] = [];
  for (const mismatch of alignment.mismatches) {
    const refSpan = mismatch.type === 'insertion' ? 0 : Math.max(1, mismatch.refBase.length);
    const querySpan = mismatch.type === 'deletion' ? 0 : Math.max(1, mismatch.queryBase.length);
    const last = events[events.length - 1];
    const joins =
      last !== undefined &&
      last.type === mismatch.type &&
      last.refEnd === mismatch.refIndex &&
      last.queryEnd === mismatch.queryIndex;
    if (joins) {
      last.refEnd += refSpan;
      last.queryEnd += querySpan;
      last.refBases += mismatch.refBase;
      last.queryBases += mismatch.queryBase;
      const q = quality(mismatch.queryIndex);
      if (q !== null) last.minQuality = last.minQuality === null ? q : Math.min(last.minQuality, q);
      if (!last.effect && mismatch.aminoAcidImpact) last.effect = mismatch.aminoAcidImpact;
      continue;
    }
    events.push({
      refStart: mismatch.refIndex,
      refEnd: mismatch.refIndex + refSpan,
      queryStart: mismatch.queryIndex,
      queryEnd: mismatch.queryIndex + querySpan,
      type: mismatch.type,
      refBases: mismatch.refBase,
      queryBases: mismatch.queryBase,
      minQuality: querySpan > 0 ? quality(mismatch.queryIndex) : null,
      ...(mismatch.aminoAcidImpact ? { effect: mismatch.aminoAcidImpact } : {}),
    });
  }
  return events;
}

/**
 * Attribute every disagreement between `trace` and `doc` to the thing in the
 * data that explains it. `options.junctions` are cloning junctions in the
 * document's own coordinates; without them, junction attribution is skipped
 * rather than guessed.
 */
export function attributeSangerFailures(
  trace: SangerTraceData,
  doc: PlasmidDocument,
  options: SangerAttributionOptions = {},
): SangerDiagnosis {
  const minQuality = options.minQuality ?? 20;
  const junctionWindow = options.junctionWindow ?? 6;
  const mixedTemplatePeaks = options.mixedTemplatePeaks ?? 3;
  const junctions = options.junctions ?? [];
  const circular = doc.topology === 'circular';
  const length = doc.length;
  const [trimStart, trimEnd] = trace.trimRange;

  if (!trace.alignment) {
    return {
      traceId: trace.id,
      fileName: trace.fileName,
      aligned: false,
      read: {
        usableBases: Math.max(0, trimEnd - trimStart),
        calledBases: trace.calledSequence.length,
        identityPercent: 0,
        strand: 1,
        refStart: 0,
        refEnd: 0,
      },
      events: [],
      findings: [],
      summary: [translate('这条读长还没有比对到 {v0}，先做比对再看归因。', { v0: doc.name })],
    };
  }

  const alignment = trace.alignment;
  const events = groupTraceMismatches(trace);
  const findings: SangerFinding[] = [];

  // A read-level call first: several double peaks mean the template was not one molecule.
  const doublePeaks = events.filter((event) => event.type === 'heterozygous_peak');
  const doublePeaksInWindow = doublePeaks.filter(
    (event) => event.queryStart >= trimStart && event.queryStart < trimEnd,
  );
  if (doublePeaksInWindow.length >= mixedTemplatePeaks) {
    findings.push({
      event: null,
      cause: 'mixed_template',
      confidence: 'high',
      evidence: [
        translate('高质量区内有 {v0} 处双峰，位置 {v1}', {
          v0: doublePeaksInWindow.length,
          v1: doublePeaksInWindow
            .slice(0, 6)
            .map((event) => event.refStart + 1)
            .join('、'),
        }),
      ],
      suggestion: translate(
        '模板不是单一分子：重新划单克隆再挑一个菌落送测；若模板是 PCR 产物，先用 Dpn I 消化残留的母本质粒。',
      ),
    });
  }

  for (const event of events) {
    findings.push(attributeEvent(event, { doc, circular, length, minQuality, junctionWindow, junctions, trimStart, trimEnd }));
  }

  const summary: string[] = [];
  summary.push(
    translate('{v0} 比对到 {v1} 的 {v2}–{v3}（{v4} 链），一致度 {v5}%，高质量区 {v6} nt。', {
      v0: trace.fileName,
      v1: doc.name,
      v2: alignment.refStart + 1,
      v3: alignment.refEnd,
      v4: alignment.strand === 1 ? translate('正') : translate('负'),
      v5: alignment.identityPercent.toFixed(1),
      v6: Math.max(0, trimEnd - trimStart),
    }),
  );
  if (!events.length) {
    summary.push(translate('比对区内没有发现差异。'));
  } else {
    const counted = new Map<SangerCause, number>();
    for (const finding of findings) {
      if (!finding.event) continue;
      counted.set(finding.cause, (counted.get(finding.cause) ?? 0) + 1);
    }
    summary.push(
      translate('{v0} 处差异：{v1}', {
        v0: events.length,
        v1: [...counted.entries()].map(([cause, count]) => `${translate(CAUSE_LABELS[cause])} ${count}`).join('，'),
      }),
    );
    const frameshift = findings.find((finding) => /Frameshift/i.test(finding.event?.effect ?? ''));
    if (frameshift?.event) {
      summary.push(
        translate('{v0} 处发生移码，下游氨基酸序列全部改变：{v1}', {
          v0: frameshift.event.refStart + 1,
          v1: frameshift.event.effect ?? '',
        }),
      );
    }
  }
  if (!junctions.length && events.length) {
    summary.push(translate('没有提供连接边界坐标，因此不判断“连接边界”这一类归因。'));
  }
  summary.push(translate('以上归因只用测序质量、引物足迹与连接边界这三类可核对的证据，没有把握的一律标为未能归因。'));

  return {
    traceId: trace.id,
    fileName: trace.fileName,
    aligned: true,
    read: {
      usableBases: Math.max(0, trimEnd - trimStart),
      calledBases: trace.calledSequence.length,
      identityPercent: alignment.identityPercent,
      strand: alignment.strand,
      refStart: alignment.refStart,
      refEnd: alignment.refEnd,
    },
    events,
    findings,
    summary,
  };
}

export const CAUSE_LABELS: Record<SangerCause, string> = {
  read_quality: '测序质量',
  mixed_template: '模板不纯',
  heterozygous_peak: '单处双峰',
  primer_tail: '引物 5′ 尾',
  primer_annealing: '引物结合区',
  junction: '连接边界',
  unexplained: '未能归因',
};

interface AttributionContext {
  doc: PlasmidDocument;
  circular: boolean;
  length: number;
  minQuality: number;
  junctionWindow: number;
  junctions: TraceJunction[];
  trimStart: number;
  trimEnd: number;
}

function attributeEvent(event: SangerEvent, context: AttributionContext): SangerFinding {
  const { doc, circular, length, minQuality, junctionWindow, junctions, trimStart, trimEnd } = context;

  // 1. Whether the read is trustworthy here at all comes before anything else.
  const outsideWindow = event.queryEnd > event.queryStart && (event.queryStart < trimStart || event.queryStart >= trimEnd);
  if (outsideWindow) {
    return {
      event,
      cause: 'read_quality',
      confidence: 'high',
      evidence: [
        translate('读长第 {v0} 位落在高质量区 {v1}–{v2} 之外', {
          v0: event.queryStart + 1,
          v1: trimStart + 1,
          v2: trimEnd,
        }),
      ],
      suggestion: translate('峰图两端本来就不可信，不要当成真实突变：换个方向或换条引物把这一段测通。'),
    };
  }
  if (event.minQuality !== null && event.minQuality <= minQuality) {
    return {
      event,
      cause: 'read_quality',
      confidence: 'high',
      evidence: [
        translate('该位点 Phred 仅 {v0}（阈值 {v1}），对应错误率约 {v2}', {
          v0: event.minQuality,
          v1: minQuality,
          v2: `${(100 * 10 ** (-event.minQuality / 10)).toFixed(1)}%`,
        }),
      ],
      suggestion: translate('先排除测序本身的问题：重新测这一段，或从另一方向测通后再判断。'),
    };
  }

  // 2. Bases that came from a synthesised oligo are the next most likely source.
  for (const primer of doc.primers) {
    const tail = tailFootprint(primer, length);
    if (tail && inRange(event.refStart, tail.start, tail.end, length)) {
      return {
        event,
        cause: 'primer_tail',
        confidence: 'high',
        primerName: primer.name,
        evidence: [
          translate('位点落在引物 {v0} 的 5′ 尾内（{v1} nt：{v2}）', {
            v0: primer.name,
            v1: primer.tailSequence?.length ?? 0,
            v2: primer.tailSequence ?? '',
          }),
          translate('这段碱基不来自模板，完全由寡核苷酸带入'),
        ],
        suggestion: translate('重新合成 {v0} 并复查订购序列：尾巴里的错误只能靠换引物解决，换克隆没有用。', { v0: primer.name }),
      };
    }
  }
  for (const primer of doc.primers) {
    if (inRange(event.refStart, primer.bindingStart, primer.bindingEnd, length)) {
      return {
        event,
        cause: 'primer_annealing',
        confidence: 'medium',
        primerName: primer.name,
        evidence: [
          translate('位点落在引物 {v0} 的结合区 {v1}–{v2}', {
            v0: primer.name,
            v1: primer.bindingStart + 1,
            v2: primer.bindingEnd,
          }),
          translate('产物的这一段由引物决定，而不是由模板读出'),
        ],
        suggestion: translate('先查 {v0} 的合成序列是否与设计一致；若一致，再换一个克隆确认是否模板本身带突变。', { v0: primer.name }),
      };
    }
  }

  // 3. Junctions, only when the caller could say where they are.
  let nearest: { junction: TraceJunction; distance: number } | null = null;
  for (const junction of junctions) {
    const distance = circularDistance(event.refStart, junction.position, length, circular);
    if (!nearest || distance < nearest.distance) nearest = { junction, distance };
  }
  if (nearest && nearest.distance <= junctionWindow) {
    const deleted = event.type === 'deletion' ? event.refEnd - event.refStart : 0;
    return {
      event,
      cause: 'junction',
      confidence: 'medium',
      junctionLabel: nearest.junction.label,
      evidence: [
        translate('距连接边界 {v0}（{v1}）{v2} bp', {
          v0: nearest.junction.label,
          v1: nearest.junction.position + 1,
          v2: nearest.distance,
        }),
      ],
      suggestion: deleted
        ? translate('边界缺失 {v0} bp，像是末端被过度消化：换新鲜的外切酶/聚合酶、缩短 Gibson 保温时间，或改用酶切连接做这个边界。', { v0: deleted })
        : translate('复查这个边界的设计序列（同源臂、粘性末端或酶切位点），再换一个克隆看是不是同一处改动。'),
    };
  }

  // 4. A lone double peak may be real; say both possibilities instead of picking one.
  if (event.type === 'heterozygous_peak') {
    return {
      event,
      cause: 'heterozygous_peak',
      confidence: 'low',
      evidence: [
        translate('单处双峰，{v0}/{v1}，Phred {v2}', {
          v0: event.refBases,
          v1: event.queryBases,
          v2: event.minQuality ?? '—',
        }),
      ],
      suggestion: translate('双峰既可能是真杂合，也可能只是峰形重叠：从另一方向再测一次这一段即可区分。'),
    };
  }

  const inCds = doc.features.find(
    (feature) => feature.type === 'CDS' && inRange(event.refStart, feature.start, feature.end, length),
  );
  return {
    event,
    cause: 'unexplained',
    confidence: 'low',
    evidence: [
      translate('Phred {v0}，不在任何引物足迹内{v1}', {
        v0: event.minQuality ?? '—',
        v1: junctions.length ? translate('，也不靠近已知连接边界') : translate('（未提供连接边界坐标）'),
      }),
      ...(inCds ? [translate('位于 CDS {v0} 内：{v1}', { v0: inCds.name, v1: event.effect ?? '' })] : []),
    ],
    suggestion: inCds
      ? translate('没有可归因的来源，而它确实落在编码区：另挑一个克隆送测，两个克隆都有同一处改动才说明是模板带来的。')
      : translate('没有可归因的来源：另挑一个克隆送测确认，或从另一方向把这一段再测一遍。'),
  };
}
