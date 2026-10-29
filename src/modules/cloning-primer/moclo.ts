// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Modular cloning: the published fusion-site syntaxes, a check that a part really
// presents the overhangs its slot calls for, and combinatorial Golden Gate - one
// assembly per combination of the candidates put in each slot.
import type { OverhangEnd, PlasmidDocument, RestrictionEnzyme } from '../../types/schema';
import type { Primer } from '../../types/schema';
import { designGoldenGatePrimers, goldenGatePartEnds, simulateGoldenGateAssembly } from './cloning';
import { findCutSites, resolveEnzyme, scoreOverhang } from './enzymes';
import { reverseComplement, sequenceSlice } from './utils';
import { t as translate } from '../../lib/i18n';

/** One position in a syntax, named by the fusion sites that flank it. */
export interface MocloSlot {
  /** The position label the standard itself uses, e.g. `A1` or `3a`. */
  id: string;
  /** The standard's short name for the position, e.g. `PROM`. */
  code: string;
  label: string;
  /** The 4 bp fusion site on the part's left, read on the top strand. */
  upstream: string;
  /** The 4 bp fusion site on the part's right, read on the top strand. */
  downstream: string;
}

export interface MocloStandard {
  id: string;
  name: string;
  /** The Type IIS enzyme that releases a part from its level-0 plasmid. */
  enzyme: string;
  slots: MocloSlot[];
  /** Where the fusion sites in this table were read from. */
  source: string;
  /** True when the table was checked against the standard's own publication. */
  verifiedAgainstPublication: boolean;
  note?: string;
}

/**
 * The plant common syntax (PhytoBricks). Twelve fusion sites, read from Fig. 3 of
 * Patron NJ et al. (2015) Standards for plant synthetic biology: a common syntax for
 * exchange of DNA parts. New Phytologist 208: 13-19. doi:10.1111/nph.13532.
 *
 * The paper's figure labels the 5'UTR position B1 while the table beside it prints A4;
 * the community uses B1, so that is what is used here. The CDS1/CDS2 junction is
 * written AGCC/AGGT in the paper: AGCC where the parts fuse through a Gly-Ala linker
 * and AGGT otherwise. Both are listed, as separate variants of the same position.
 */
const PHYTOBRICKS: MocloStandard = {
  id: 'phytobricks',
  name: 'PhytoBricks 植物通用语法（Patron 2015）',
  enzyme: 'BsaI',
  source: 'Patron NJ et al. 2015, New Phytologist 208: 13–19, Fig. 3',
  verifiedAgainstPublication: true,
  note: 'CDS1 与 CDS2 之间有 AGCC 与 AGGT 两种接法：经 Gly-Ala 连接时用 AGCC，否则用 AGGT。',
  slots: [
    { id: 'A1', code: 'DIST', label: '远端启动子 / 增强子', upstream: 'GGAG', downstream: 'TGAC' },
    { id: 'A2', code: 'PROX', label: '近端启动子', upstream: 'TGAC', downstream: 'TCCC' },
    { id: 'A3', code: 'CORE', label: '核心启动子（含转录起始位点）', upstream: 'TCCC', downstream: 'TACT' },
    { id: 'B1', code: '5UTR', label: "5' 非翻译区", upstream: 'TACT', downstream: 'CCAT' },
    { id: 'B2', code: 'NTAG', label: 'N 端编码区 / 信号肽', upstream: 'CCAT', downstream: 'AATG' },
    { id: 'B3', code: 'CDS1', label: '编码区（含起始密码子）', upstream: 'AATG', downstream: 'AGGT' },
    { id: 'B3-GA', code: 'CDS1', label: '编码区（经 Gly-Ala 连接）', upstream: 'AATG', downstream: 'AGCC' },
    { id: 'B4', code: 'CDS2', label: '编码区（无起始/终止密码子）', upstream: 'AGGT', downstream: 'TTCG' },
    { id: 'B4-GA', code: 'CDS2', label: '编码区（经 Gly-Ala 连接）', upstream: 'AGCC', downstream: 'TTCG' },
    { id: 'B5', code: 'CTAG', label: 'C 端编码区 / 标签', upstream: 'TTCG', downstream: 'GCTT' },
    { id: 'B6', code: '3UTR', label: "3' 非翻译区", upstream: 'GCTT', downstream: 'GGTA' },
    { id: 'C1', code: 'TERM', label: '终止子（含加尾信号）', upstream: 'GGTA', downstream: 'CGCT' },
    // Parts may span several fusion sites; the figure marks PROM+5UTR, CDS and
    // 3UTR+TERM as the usual ones. A1-A3 is the same idea applied to the promoter.
    { id: 'A1-A3', code: 'PROM', label: '整段启动子（A1–A3）', upstream: 'GGAG', downstream: 'TACT' },
    { id: 'A1-B1', code: 'PROM+5UTR', label: '启动子 + 5′UTR（A1–B1）', upstream: 'GGAG', downstream: 'CCAT' },
    { id: 'B3-B4', code: 'CDS', label: '完整编码区（B3–B4）', upstream: 'AATG', downstream: 'TTCG' },
    { id: 'B6-C1', code: '3UTR+TERM', label: "3′UTR + 终止子（B6–C1）", upstream: 'GCTT', downstream: 'CGCT' },
  ],
};

/**
 * The Yeast Toolkit part types of Lee ME, DeLoache WC, Cervantes B, Dueber JE (2015)
 * A Highly Characterized Yeast Toolkit for Modular, Multipart Assembly.
 * ACS Synth Biol 4: 975-986. doi:10.1021/sb500366v.
 *
 * The paper gives the overhangs in Figure 2 and its Supporting Information, neither of
 * which is machine-readable, so the table below was taken from the `moclo` Python
 * package (MIT) and is marked as unverified against the paper itself. One entry is
 * independently corroborated: the type 3 upstream site TATG, which Jessop-Fabre et al.
 * 2021 (ACS Synth Biol 10: 3461) names in its text.
 */
const YTK: MocloStandard = {
  id: 'ytk',
  name: '酵母工具箱 YTK（Lee 2015）',
  enzyme: 'BsaI',
  source: 'moclo Python 包（MIT）moclo/kits/ytk.py，读取于 2026-10-28',
  verifiedAgainstPublication: false,
  note: '该表取自第三方实现而非论文原文（论文的接头序列只在图片与补充材料中）。用于正式设计前请对照 Lee 2015 的 Supporting Information 核对。',
  slots: [
    { id: '1', code: 'ConLS', label: '上游装配连接子', upstream: 'CCCT', downstream: 'AACG' },
    { id: '2', code: 'PRO', label: '启动子', upstream: 'AACG', downstream: 'TATG' },
    { id: '3', code: 'CDS', label: '完整编码区', upstream: 'TATG', downstream: 'ATCC' },
    { id: '3a', code: 'CDS-N', label: 'N 端编码区', upstream: 'TATG', downstream: 'TTCT' },
    { id: '3b', code: 'CDS-C', label: 'C 端编码区', upstream: 'TTCT', downstream: 'ATCC' },
    { id: '4', code: 'TERM', label: '终止子', upstream: 'ATCC', downstream: 'GCTG' },
    { id: '4a', code: 'CTAG', label: 'C 端标签', upstream: 'ATCC', downstream: 'TGGC' },
    { id: '4b', code: 'TERM', label: '终止子（接 4a 之后）', upstream: 'TGGC', downstream: 'GCTG' },
    { id: '5', code: 'ConRE', label: '下游装配连接子', upstream: 'GCTG', downstream: 'TACA' },
    { id: '6', code: 'MARKER', label: '酵母筛选标记', upstream: 'TACA', downstream: 'GAGT' },
    { id: '7', code: 'ORI-Y', label: "酵母复制起点或 3' 同源臂", upstream: 'GAGT', downstream: 'CCGA' },
    { id: '8', code: 'BACKBONE', label: '细菌复制起点与标记', upstream: 'CCGA', downstream: 'CCCT' },
    { id: '8a', code: 'BACKBONE-INT', label: '细菌骨架（整合型）', upstream: 'CCGA', downstream: 'CAAT' },
    { id: '8b', code: 'HOM-5', label: "5' 同源臂", upstream: 'CAAT', downstream: 'CCCT' },
    { id: '234', code: 'TU', label: '完整转录单元（2–4）', upstream: 'AACG', downstream: 'GCTG' },
    { id: '678', code: 'VECTOR', label: '标记 + 起点 + 骨架（6–8）', upstream: 'TACA', downstream: 'CCCT' },
  ],
};

export const MOCLO_STANDARDS: MocloStandard[] = [PHYTOBRICKS, YTK];

export function mocloStandard(id: string): MocloStandard | undefined {
  return MOCLO_STANDARDS.find((standard) => standard.id === id);
}

/* -------------------------------------------------------------------------- */
/* Checking a part against a syntax                                           */
/* -------------------------------------------------------------------------- */

/**
 * The fusion sites a part presents, both read on the top strand in the direction the
 * assembly runs. A fragment's right end is recorded as the bottom strand's overhang,
 * so it is complemented back to give the site the next part has to match.
 */
export function fusionSitesOf(
  part: PlasmidDocument,
  enzyme: RestrictionEnzyme,
): { upstream: string; downstream: string; length: number; warnings: string[] } | null {
  const ends = goldenGatePartEnds(part, enzyme);
  if (!ends) return null;
  if (ends.left.type !== '5-prime' || ends.right.type !== '5-prime') return null;
  return {
    upstream: ends.left.sequence,
    downstream: reverseComplement(ends.right.sequence),
    length: ends.length,
    warnings: ends.warnings,
  };
}

export interface SlotMatch {
  slot: MocloSlot;
  /** False when the part only matches with its orientation flipped. */
  forward: boolean;
}

/** Every slot of the standard whose fusion sites this part presents. */
export function identifySlots(part: PlasmidDocument, standard: MocloStandard): SlotMatch[] {
  const enzyme = resolveEnzyme(standard.enzyme);
  if (!enzyme) return [];
  const sites = fusionSitesOf(part, enzyme);
  if (!sites) return [];
  const matches: SlotMatch[] = [];
  for (const slot of standard.slots) {
    if (sites.upstream === slot.upstream && sites.downstream === slot.downstream) {
      matches.push({ slot, forward: true });
    } else if (
      sites.upstream === reverseComplement(slot.downstream) &&
      sites.downstream === reverseComplement(slot.upstream)
    ) {
      matches.push({ slot, forward: false });
    }
  }
  return matches;
}

export interface SyntaxProblem {
  severity: 'error' | 'warning';
  message: string;
}

export interface SyntaxCheck {
  part: PlasmidDocument;
  slot: MocloSlot;
  ok: boolean;
  found?: { upstream: string; downstream: string };
  problems: SyntaxProblem[];
}

/** Does this part present exactly the fusion sites its slot calls for? */
export function checkPartInSlot(
  part: PlasmidDocument,
  slot: MocloSlot,
  standard: MocloStandard,
): SyntaxCheck {
  const problems: SyntaxProblem[] = [];
  const enzyme = resolveEnzyme(standard.enzyme);
  if (!enzyme) {
    return { part, slot, ok: false, problems: [{ severity: 'error', message: `未知的酶：${standard.enzyme}` }] };
  }
  const sites = fusionSitesOf(part, enzyme);
  if (!sites) {
    return {
      part,
      slot,
      ok: false,
      problems: [
        {
          severity: 'error',
          message: `${part.name} 没有一对朝内的 ${standard.enzyme} 位点可以切出带 5′ 突出的片段，不是合格的 Level 0 元件。`,
        },
      ],
    };
  }
  for (const warning of sites.warnings) problems.push({ severity: 'warning', message: warning });

  const flipped =
    sites.upstream === reverseComplement(slot.downstream) &&
    sites.downstream === reverseComplement(slot.upstream);
  if (flipped) {
    problems.push({
      severity: 'warning',
      message: `${part.name} 的接头方向与 ${slot.id} 相反，装配时会自动翻转。`,
    });
  } else {
    if (sites.upstream !== slot.upstream) {
      problems.push({
        severity: 'error',
        message: `${part.name} 的上游接头是 ${sites.upstream}，${slot.id}（${slot.code}）要求 ${slot.upstream}。`,
      });
    }
    if (sites.downstream !== slot.downstream) {
      problems.push({
        severity: 'error',
        message: `${part.name} 的下游接头是 ${sites.downstream}，${slot.id}（${slot.code}）要求 ${slot.downstream}。`,
      });
    }
  }
  return {
    part,
    slot,
    ok: !problems.some((p) => p.severity === 'error'),
    found: { upstream: sites.upstream, downstream: sites.downstream },
    problems,
  };
}

/**
 * Do the chosen slots chain end to end? For a circular assembly the last slot's
 * downstream site must also meet the first slot's upstream site.
 */
export function checkSlotChain(
  slots: MocloSlot[],
  options: { circular?: boolean } = {},
): { ok: boolean; gaps: string[] } {
  const circular = options.circular ?? true;
  const gaps: string[] = [];
  for (let index = 0; index + 1 < slots.length; index += 1) {
    const here = slots[index];
    const next = slots[index + 1];
    if (here.downstream !== next.upstream) {
      gaps.push(`${here.id} 的下游接头 ${here.downstream} 接不上 ${next.id} 的上游接头 ${next.upstream}。`);
    }
  }
  if (circular && slots.length > 1) {
    const first = slots[0];
    const last = slots[slots.length - 1];
    if (last.downstream !== first.upstream) {
      gaps.push(`环化缺口：${last.id} 的下游接头 ${last.downstream} 接不回 ${first.id} 的上游接头 ${first.upstream}。`);
    }
  }
  return { ok: gaps.length === 0, gaps };
}

/** The fidelity of a whole fusion-site set, scored with the same heuristic as a single assembly. */
export function scoreFusionSiteSet(sites: string[]): { score: number; warnings: string[] } {
  if (!sites.length) return { score: 0, warnings: ['没有接头可评分'] };
  const warnings: string[] = [];
  const seen = new Map<string, number>();
  for (const site of sites) seen.set(site, (seen.get(site) ?? 0) + 1);
  for (const [site, count] of seen) {
    if (count > 1) warnings.push(`接头 ${site} 出现了 ${count} 次，装配顺序会不唯一。`);
  }
  const results = sites.map((site) => scoreOverhang(site, sites));
  for (const result of results) warnings.push(...result.warnings);
  const score = results.reduce((sum, r) => sum + r.score, 0) / results.length;
  return { score: Number(score.toFixed(3)), warnings: [...new Set(warnings)] };
}

/* -------------------------------------------------------------------------- */
/* Domestication: turning a stretch of sequence into a part for a position     */
/* -------------------------------------------------------------------------- */

export interface SlotPrimerDesign {
  slot: MocloSlot;
  forward: Primer;
  reverse: Primer;
  /** Recognition sites of the standard's enzyme inside the region, which must be removed. */
  internalSites: number;
  warnings: string[];
}

/**
 * The primer pair that turns a stretch of an existing sequence into a part for one
 * position: the enzyme's recognition site, its spacer and the position's fusion site
 * are added as 5' tails. A region that still contains the enzyme's own site cannot be
 * used as a part until that site is removed, so the count is reported.
 */
export function designSlotPrimers(
  doc: PlasmidDocument,
  range: { start: number; end: number },
  slot: MocloSlot,
  standard: MocloStandard,
): SlotPrimerDesign | null {
  const enzyme = resolveEnzyme(standard.enzyme);
  if (!enzyme) return null;
  const designed = designGoldenGatePrimers([{ doc, range }], enzyme, [slot.upstream, slot.downstream]);
  if (!designed.length) return null;
  const region = sequenceSlice(doc.sequence, range.start, range.end, doc.topology === 'circular');
  const internalSites = findCutSites(region, enzyme, false).length;
  const warnings: string[] = [];
  if (internalSites) {
    warnings.push(
      translate('选区内还有 {n} 个 {enzyme} 位点，必须先用同义突变去掉（domestication），否则装配时片段会被切碎。', { n: internalSites, enzyme: enzyme.name }),
    );
  }
  if (slot.upstream === 'AATG') {
    // The AATG fusion site is the start codon with one spacer base in front of it,
    // so the part itself begins at the second codon.
    warnings.push('接头 AATG 已经提供起始密码子 ATG，选区应从第二个密码子开始。');
    if (/^ATG/i.test(region)) {
      warnings.push('选区以 ATG 开头，加上接头会出现两个起始密码子，请把选区起点后移 3 bp。');
    }
  }
  return { slot, forward: designed[0].forward, reverse: designed[0].reverse, internalSites, warnings };
}

/* -------------------------------------------------------------------------- */
/* Combinatorial assembly                                                     */
/* -------------------------------------------------------------------------- */

export interface CombinatorialSlot {
  /** What this position is, for naming the products. */
  label: string;
  /** The candidates to try in this position; one product per combination. */
  parts: PlasmidDocument[];
}

export interface CombinatorialProduct {
  /** The part chosen in each slot, in slot order. */
  combination: string[];
  product: PlasmidDocument;
  fidelityScore: number;
  warnings: string[];
}

export interface CombinatorialFailure {
  combination: string[];
  reason: string;
}

export interface CombinatorialResult {
  products: CombinatorialProduct[];
  failures: CombinatorialFailure[];
  /** Combinations the limit kept us from trying. */
  notAttempted: number;
  total: number;
}

/** Every way of taking one part from each slot, in slot order. */
export function combinations<T>(groups: T[][]): T[][] {
  return groups.reduce<T[][]>((acc, group) => acc.flatMap((prefix) => group.map((item) => [...prefix, item])), [[]]);
}

/**
 * One Golden Gate assembly per combination of the candidates in each slot: the
 * N x M x K matrix a combinatorial library is built from. Assemblies are run with the
 * ordinary single-assembly simulation, so a combination that cannot close is reported
 * as a failure rather than silently dropped.
 */
export function combinatorialAssembly(
  slots: CombinatorialSlot[],
  enzyme: RestrictionEnzyme,
  options: { circular?: boolean; limit?: number; namePrefix?: string } = {},
): CombinatorialResult {
  const circular = options.circular ?? true;
  const limit = Math.max(1, options.limit ?? 96);
  const usable = slots.filter((slot) => slot.parts.length > 0);
  if (usable.length < 2) {
    return { products: [], failures: [], notAttempted: 0, total: 0 };
  }
  const total = usable.reduce((product, slot) => product * slot.parts.length, 1);
  const all = combinations(usable.map((slot) => slot.parts));
  const attempted = all.slice(0, limit);

  const products: CombinatorialProduct[] = [];
  const failures: CombinatorialFailure[] = [];
  for (const chosen of attempted) {
    const names = chosen.map((part) => part.name);
    const assembly = simulateGoldenGateAssembly(chosen, enzyme, { circular });
    if (!assembly.product) {
      failures.push({ combination: names, reason: assembly.warnings.join('；') || '无法装配' });
      continue;
    }
    products.push({
      combination: names,
      product: {
        ...assembly.product,
        name: `${options.namePrefix ?? 'Assembly'}_${names.join('-')}`,
      },
      fidelityScore: assembly.fidelityScore,
      warnings: [...assembly.warnings, ...assembly.internalSiteWarnings],
    });
  }
  return { products, failures, notAttempted: Math.max(0, total - attempted.length), total };
}
