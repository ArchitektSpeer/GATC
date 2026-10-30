// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Why the sequencing came back wrong. The attribution itself lives in the
// alignment module; this layer finds the cloning junctions, which it can only do
// by looking for the sites the enzymes in the history left behind, and lets the
// user add any junction the sequence no longer shows (Golden Gate, Gibson).
import { useMemo, useState } from 'react';
import { AlertTriangle, Clipboard, HelpCircle, Info } from 'lucide-react';
import type { PlasmidDocument, SangerTraceData } from '../types/schema';
import { findCutSites, getEnzymeByName } from '../modules/seq-engine';
import {
  attributeSangerFailures,
  CAUSE_LABELS,
  type SangerCause,
  type SangerDiagnosis,
  type TraceJunction,
} from '../modules/alignment-gel';
import { useWorkbench } from './store';
import { t as translate } from '../lib/i18n';
import { Badge, Button, Dialog, Field, Input } from './ui';
import { useT } from '../lib/i18n';

/**
 * Cloning junctions this document still shows: a ligation keeps the site of the
 * enzyme that made it, so the sites of the enzymes named in the history are the
 * junctions. Golden Gate and Gibson leave no site, so those junctions can only
 * be given by hand.
 */
export function junctionsFromHistory(doc: PlasmidDocument): TraceJunction[] {
  const names = new Set<string>();
  for (const node of doc.history) {
    if (node.operation !== 'restriction_ligation') continue;
    for (const name of node.enzymesUsed ?? []) names.add(name);
  }
  const junctions: TraceJunction[] = [];
  for (const name of names) {
    const enzyme = getEnzymeByName(name);
    if (!enzyme) continue;
    for (const site of findCutSites(doc, [enzyme])) {
      junctions.push({ position: site.cutPositionTop, label: enzyme.name });
    }
  }
  return junctions.sort((a, b) => a.position - b.position);
}

/**
 * The attribution as plain text for the AI copilot, so the model reasons over
 * what the engine actually found instead of re-deriving it from the raw
 * mismatch list. Empty when there is nothing aligned to attribute.
 */
export function sangerContextForAI(doc: PlasmidDocument, traces: SangerTraceData[]): string {
  const aligned = traces.filter((trace) => trace.alignment);
  if (!aligned.length) return '';
  const junctions = junctionsFromHistory(doc);
  const lines: string[] = [translate('### 测序异常归因（GATC 规则引擎已算出，依据可核对）')];
  if (junctions.length) {
    lines.push(
      translate('- 已识别的连接边界：{v0}', {
        v0: junctions.map((junction) => `${junction.label}@${junction.position}`).join(', '),
      }),
    );
  } else {
    lines.push(translate('- 未能从历史中识别出连接边界（Golden Gate / Gibson 不留酶切位点），因此没有“连接边界”这一类归因。'));
  }
  for (const trace of aligned) {
    const diagnosis = attributeSangerFailures(trace, doc, { junctions });
    lines.push(`- ${diagnosis.fileName}`);
    for (const line of diagnosis.summary) lines.push(`  ${line}`);
    for (const finding of diagnosis.findings) {
      const where = finding.event ? `refIndex=${finding.event.refStart}` : 'read-level';
      const change = finding.event ? `${finding.event.refBases || '-'}->${finding.event.queryBases || '-'}` : '-';
      lines.push(
        `    * ${where} ${change} cause=${finding.cause} confidence=${finding.confidence} evidence=${finding.evidence.join(' | ')}`,
      );
    }
  }
  lines.push(translate('- 归因只用三类证据：Phred 与高质量区、引物在分子上的足迹、连接边界位置。标为 unexplained 的，不要替它编原因。'));
  return lines.join('\n');
}

const CAUSE_TONE: Record<SangerCause, 'red' | 'amber' | 'blue' | 'slate'> = {
  read_quality: 'slate',
  mixed_template: 'red',
  heterozygous_peak: 'amber',
  primer_tail: 'red',
  primer_annealing: 'amber',
  junction: 'amber',
  unexplained: 'blue',
};

function diagnosisToMarkdown(diagnosis: SangerDiagnosis, t: (m: string, v?: Record<string, string | number>) => string): string {
  const lines = [`## ${diagnosis.fileName}`, ''];
  for (const line of diagnosis.summary) lines.push(`- ${line}`);
  lines.push('');
  if (diagnosis.findings.length) {
    lines.push(`| ${t('位置')} | ${t('改动')} | ${t('归因')} | ${t('依据')} | ${t('建议')} |`, '| --- | --- | --- | --- | --- |');
    for (const finding of diagnosis.findings) {
      const where = finding.event ? `${finding.event.refStart + 1}` : t('整条读长');
      const change = finding.event
        ? `${finding.event.refBases || '—'} → ${finding.event.queryBases || '—'}`
        : '—';
      lines.push(
        `| ${where} | ${change} | ${t(CAUSE_LABELS[finding.cause])} | ${finding.evidence.join('；')} | ${finding.suggestion} |`.replace(
          /\n/g,
          ' ',
        ),
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

function FindingRow({ finding }: { finding: SangerDiagnosis['findings'][number] }) {
  const t = useT();
  const event = finding.event;
  return (
    <li className="flex gap-2 border-b border-[var(--border)] py-2 last:border-b-0">
      <span className="mono w-20 shrink-0 text-[var(--muted)]">
        {event ? event.refStart + 1 : t('整条读长')}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={CAUSE_TONE[finding.cause]}>{t(CAUSE_LABELS[finding.cause])}</Badge>
          {event && (
            <span className="mono">
              {event.refBases || '—'} → {event.queryBases || '—'}
            </span>
          )}
          {event?.effect && <Badge tone="slate">{event.effect}</Badge>}
          <span className="text-[var(--muted)]">
            {finding.confidence === 'high' ? t('证据充分') : finding.confidence === 'medium' ? t('证据一般') : t('证据薄弱')}
          </span>
        </div>
        {finding.evidence.map((item) => (
          <div key={item} className="mt-1 flex items-start gap-1 text-[var(--muted)]">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{item}</span>
          </div>
        ))}
        <div className="mt-1 flex items-start gap-1">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" aria-hidden="true" />
          <span>{finding.suggestion}</span>
        </div>
      </div>
    </li>
  );
}

export function SangerTriageDialog() {
  const t = useT();
  const open = useWorkbench((s) => s.tool === 'sanger-triage');
  const setTool = useWorkbench((s) => s.setTool);
  const docs = useWorkbench((s) => s.docs);
  const activeId = useWorkbench((s) => s.activeId);
  const allTraces = useWorkbench((s) => s.traces);
  const doc = docs.find((d) => d.id === activeId) ?? null;
  const traces: SangerTraceData[] = doc ? (allTraces[doc.id] ?? []) : [];
  const [extra, setExtra] = useState('');

  const auto = useMemo(() => (doc ? junctionsFromHistory(doc) : []), [doc]);
  const junctions = useMemo(() => {
    const manual: TraceJunction[] = [];
    for (const piece of extra.split(/[,，\s]+/)) {
      const position = Number(piece);
      if (!Number.isInteger(position) || position < 1 || !doc || position > doc.length) continue;
      manual.push({ position: position - 1, label: t('手工指定 {v0}', { v0: position }) });
    }
    return [...auto, ...manual];
  }, [auto, extra, doc, t]);

  const diagnoses = useMemo(
    () => (doc ? traces.map((trace) => attributeSangerFailures(trace, doc, { junctions })) : []),
    [doc, traces, junctions],
  );

  const copyAll = async () => {
    const text = diagnoses.map((diagnosis) => diagnosisToMarkdown(diagnosis, t)).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      useWorkbench.getState().notify(t('归因报告已复制'));
    } catch {
      useWorkbench.getState().notify(t('复制失败，请手动选择文本'));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => setTool(null)}
      title={t('测序异常归因')}
      width={860}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[var(--muted)]">
            {t('自动识别到 {v0} 个连接边界（来自历史里记录的酶的位点）', { v0: auto.length })}
          </div>
          <div className="flex gap-2">
            <Button disabled={!diagnoses.length} onClick={copyAll}>
              <Clipboard size={14} /> {t('复制报告')}
            </Button>
            <Button variant="primary" onClick={() => setTool(null)}>
              {t('关闭')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-xs">
        {!doc && <p className="text-[var(--muted)]">{t('请先打开参考质粒。')}</p>}
        {doc && traces.length === 0 && (
          <p className="text-[var(--muted)]">{t('{v0} 上还没有测序读长，先导入 .ab1 或 .fastq。', { v0: doc.name })}</p>
        )}
        {doc && traces.length > 0 && (
          <>
            <Field
              label={t('额外的连接边界位置（1-based，可留空）')}
              hint={t('Golden Gate 与 Gibson 不留下酶切位点，自动识别不到；把你知道的边界坐标写在这里，用逗号分隔。')}
            >
              <Input className="mono" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="1024, 2310" />
            </Field>
            {auto.length > 0 && (
              <div className="text-[var(--muted)]">
                {t('自动边界：{v0}', { v0: auto.map((j) => `${j.label} @${j.position + 1}`).join('、') })}
              </div>
            )}
            {diagnoses.map((diagnosis) => (
              <div key={diagnosis.traceId} className="rounded-md border border-[var(--border)] p-3">
                <div className="mb-1 font-medium">{diagnosis.fileName}</div>
                {diagnosis.summary.map((line) => (
                  <div key={line} className="text-[var(--muted)]">
                    {line}
                  </div>
                ))}
                {diagnosis.findings.length > 0 && (
                  <ol className="mt-2 flex flex-col">
                    {diagnosis.findings.map((finding, index) => (
                      <FindingRow key={`${finding.cause}-${finding.event?.refStart ?? 'read'}-${index}`} finding={finding} />
                    ))}
                  </ol>
                )}
              </div>
            ))}
            <p className="flex items-start gap-1 text-[var(--muted)]">
              <HelpCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              <span>
                {t('归因只用三类能核对的证据：该位点的 Phred 与高质量区、引物在分子上的足迹、以及连接边界的位置。没有证据支持的改动一律标为“未能归因”，不会编一个听起来合理的原因。')}
              </span>
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}
