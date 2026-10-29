// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Runs a multi-step plan in the sandbox before anything is committed: every step
// calls the same engine the matching wizard calls, the products stay in memory,
// and only the button at the bottom opens them as documents.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clipboard, CircleSlash, FlaskConical, Play, XCircle } from 'lucide-react';
import type { PipelinePlan } from '../types/schema';
import { dryRunPipeline, pipelineToMarkdown, validatePipelinePlan, PIPELINE_OP_LABELS, type PipelineRun } from './pipeline';
import { useWorkbench } from './store';
import { Badge, Button, Dialog } from './ui';
import { useLocale, useT } from '../lib/i18n';

/** A plan that works on whatever is open, so the dialog is never an empty box. */
function examplePlan(docName: string, t: (message: string) => string): PipelinePlan {
  return {
    name: `${docName} EcoRI/HindIII`,
    goal: t('把片段切下来再连回去，最后用 EcoRI 单切鉴定。'),
    steps: [
      { id: 'backbone', op: 'digest', inputs: [docName], label: t('骨架'), params: { enzymes: ['EcoRI', 'HindIII'], select: 'largest' } },
      { id: 'insert', op: 'digest', inputs: [docName], label: t('插入片段'), params: { enzymes: ['EcoRI', 'HindIII'], select: 'smallest' } },
      { id: 'ligation', op: 'ligate', inputs: ['backbone', 'insert'], label: t('连接产物'), params: { circularize: true } },
      { id: 'check', op: 'check_digest', inputs: ['ligation'], label: t('鉴定酶切'), params: { enzymes: ['EcoRI'] } },
    ],
  };
}

function StepRow({ index, result }: { index: number; result: PipelineRun['steps'][number] }) {
  const t = useT();
  const icon = result.skipped ? (
    <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
  ) : result.ok ? (
    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
  ) : (
    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
  );
  return (
    <li className="flex gap-2 border-b border-[var(--border)] py-2 last:border-b-0">
      <span className="w-5 shrink-0 text-right text-[var(--muted)]">{index + 1}</span>
      {icon}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{result.label}</span>
          <Badge tone="slate">{t(PIPELINE_OP_LABELS[result.op])}</Badge>
          {result.product && (
            <Badge tone="blue">
              {result.product.length} bp · {result.product.topology === 'circular' ? t('环状') : t('线性')}
            </Badge>
          )}
        </div>
        {result.error && <div className="mt-1 text-red-600">{result.error}</div>}
        {result.notes.map((note) => (
          <div key={note} className="mt-1 text-[var(--muted)]">
            {note}
          </div>
        ))}
        {result.warnings.map((warning) => (
          <div key={warning} className="mt-1 flex items-start gap-1 text-amber-600">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{warning}</span>
          </div>
        ))}
        {result.alternatives && result.alternatives.length > 1 && (
          <div className="mt-1 text-[var(--muted)]">
            {t('其他产物：{v0}', {
              v0: result.alternatives.map((item) => `${item.name} ${item.length} bp`).join('、'),
            })}
          </div>
        )}
      </div>
    </li>
  );
}

export function PipelineRunnerDialog() {
  const t = useT();
  const open = useWorkbench((s) => s.tool === 'pipeline');
  const setTool = useWorkbench((s) => s.setTool);
  const docs = useWorkbench((s) => s.docs);
  const handedOver = useWorkbench((s) => s.pipelineDraft);
  const locale = useLocale();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<PipelineRun | null>(null);
  const autoRun = useRef(false);
  /** Until the plan is touched, it is the example and follows the language. */
  const [edited, setEdited] = useState(false);

  // The AI hands its plan over here; otherwise start from an example on what is open.
  useEffect(() => {
    if (!open) return;
    if (handedOver) {
      setText(JSON.stringify(handedOver, null, 2));
      setError(null);
      setRun(null);
      setEdited(true);
      autoRun.current = true;
      useWorkbench.getState().setPipelineDraft(null);
      return;
    }
    if (!edited) setText(JSON.stringify(examplePlan(docs[0]?.name ?? 'pUC19', t), null, 2));
    // `locale` is in the list so the example is rewritten when the language changes.
  }, [open, handedOver, docs, edited, t, locale]);

  // A finished dry run is written in the language it ran in, so a change of
  // language drops it rather than leaving stale text on screen.
  useEffect(() => {
    setRun(null);
    setError(null);
  }, [locale]);

  const execute = useCallback(() => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (caught) {
      setRun(null);
      setError(t('JSON 解析失败：{v0}', { v0: caught instanceof Error ? caught.message : String(caught) }));
      return;
    }
    const checked = validatePipelinePlan(parsed, docs);
    if (!checked.ok) {
      setRun(null);
      setError(checked.error);
      return;
    }
    setError(null);
    setRun(dryRunPipeline(checked.plan, docs));
  }, [text, docs, t]);

  // A plan that arrived from the copilot is run straight away.
  useEffect(() => {
    if (!open || !autoRun.current || !text) return;
    autoRun.current = false;
    execute();
  }, [open, text, execute]);

  const commit = () => {
    if (!run?.products.length) return;
    const st = useWorkbench.getState();
    st.openDocs(run.products);
    st.setView('split');
    st.notify(
      t('已写入 {v0} 个产物：{v1}', {
        v0: run.products.length,
        v1: run.products.map((product) => `${product.name} (${product.length} bp)`).join('、'),
      }),
    );
    setTool(null);
  };

  const sendToGel = () => {
    if (!run) return;
    const samples = run.steps.flatMap((step) => step.gelSamples ?? []);
    if (!samples.length) return;
    const st = useWorkbench.getState();
    st.setGelSamples(samples);
    st.setView('gel');
    setTool(null);
  };

  const copyReport = async () => {
    if (!run) return;
    try {
      await navigator.clipboard.writeText(pipelineToMarkdown(run));
      useWorkbench.getState().notify(t('推演报告已复制'));
    } catch {
      useWorkbench.getState().notify(t('复制失败，请手动选择文本'));
    }
  };

  const hasGel = !!run?.steps.some((step) => step.gelSamples?.length);

  return (
    <Dialog
      open={open}
      onClose={() => setTool(null)}
      title={t('多步克隆方案沙盒推演')}
      width={880}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[var(--muted)]">
            {run
              ? run.ok
                ? t('{v0} 步全部通过，终产物 {v1} 个', { v0: run.steps.length, v1: run.products.length })
                : t('{v0} 步中有 {v1} 步未通过', {
                    v0: run.steps.length,
                    v1: run.steps.filter((step) => !step.ok).length,
                  })
              : t('推演只在内存中进行，确认前不会改动任何文档')}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={execute}>
              <Play size={14} /> {t('推演')}
            </Button>
            <Button disabled={!run} onClick={copyReport}>
              <Clipboard size={14} /> {t('复制报告')}
            </Button>
            <Button disabled={!hasGel} onClick={sendToGel}>
              <FlaskConical size={14} /> {t('鉴定胶图')}
            </Button>
            <Button variant="primary" disabled={!run?.products.length} onClick={commit}>
              {t('写入工作区')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-xs">
        <p className="text-[var(--muted)]">
          {t('方案是一张有向无环图：每一步的 inputs 填上游步骤的 id，或已打开文档的名称。每一步都用对应向导的同一套引擎计算，算完才问你要不要写入。')}
        </p>
        <textarea
          className="mono min-h-[180px] w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-[11px] leading-5"
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setEdited(true);
            setText(e.target.value);
          }}
          aria-label={t('方案 JSON')}
        />
        <div className="flex flex-wrap gap-2 text-[var(--muted)]">
          <span>{t('可用操作：')}</span>
          {(Object.keys(PIPELINE_OP_LABELS) as Array<keyof typeof PIPELINE_OP_LABELS>).map((op) => (
            <span key={op} className="mono">
              {op}
            </span>
          ))}
        </div>
        {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-red-600">{error}</div>}
        {run && (
          <div className="rounded-md border border-[var(--border)] p-3">
            <div className="mb-1 font-medium">{run.plan.name}</div>
            {run.plan.goal && <div className="mb-2 text-[var(--muted)]">{run.plan.goal}</div>}
            <ol className="flex flex-col">
              {run.steps.map((result, index) => (
                <StepRow key={result.stepId} index={index} result={result} />
              ))}
            </ol>
          </div>
        )}
        {run && run.products.length > 0 && (
          <div className="rounded-md border border-[var(--border)] p-3">
            <div className="mb-1 font-medium">{t('终产物')}</div>
            <ul className="list-inside list-disc text-[var(--muted)]">
              {run.products.map((product) => (
                <li key={product.id}>
                  {product.name} — {product.length} bp,{' '}
                  {product.topology === 'circular' ? t('环状') : t('线性')}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}
