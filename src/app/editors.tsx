// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Manual feature and primer editing dialogs. Edits go through replaceDoc, so they are undoable.
import { useEffect, useState } from 'react';
import type { FeatureType, PlasmidDocument, Primer, SequenceFeature, StrandDirection } from '../types/schema';
import { reverseComplement } from '../modules/seq-engine';
import { evaluateOligoThermodynamics } from '../modules/cloning-primer';
import { historyNode, uid } from './actions';
import { useWorkbench } from './store';
import { Button, Dialog, Field, Input, Select } from './ui';
import { t as translate, useT } from '../lib/i18n';

export const FEATURE_TYPES: FeatureType[] = [
  'CDS',
  'promoter',
  'terminator',
  'rep_origin',
  'primer_bind',
  'misc_feature',
  'regulatory',
  'enhancer',
  'intron',
  'protein_bind',
  'oriT',
  'attachment_site',
];

const TYPE_COLORS: Partial<Record<FeatureType, string>> = {
  CDS: '#3b82f6',
  promoter: '#22c55e',
  terminator: '#ef4444',
  rep_origin: '#f59e0b',
  primer_bind: '#a855f7',
  regulatory: '#14b8a6',
  protein_bind: '#0ea5e9',
  attachment_site: '#ec4899',
};

function edited(doc: PlasmidDocument, patch: Partial<PlasmidDocument>, description: string): PlasmidDocument {
  return {
    ...doc,
    ...patch,
    updatedAt: new Date().toISOString(),
    history: [...doc.history, historyNode('manual_edit', description)],
  };
}

/** Add (feature = null) or edit a feature. Coordinates are shown 1-based inclusive. */
export function FeatureEditor({
  doc,
  feature,
  open,
  onClose,
}: {
  doc: PlasmidDocument;
  feature: SequenceFeature | null;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const replaceDoc = useWorkbench((s) => s.replaceDoc);
  const selection = useWorkbench((s) => s.selection);
  const [draft, setDraft] = useState({ name: '', type: 'misc_feature' as FeatureType, start: 1, end: 1, strand: 1 as StrandDirection, color: '', note: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (feature) {
      setDraft({
        name: feature.name,
        type: feature.type,
        start: feature.start + 1,
        end: feature.end,
        strand: feature.strand,
        color: feature.color,
        note: feature.notes?.note?.join('; ') ?? '',
      });
    } else {
      const sel = selection && selection.start !== selection.end ? selection : { start: 0, end: Math.min(doc.length, 100) };
      setDraft({ name: 'New feature', type: 'misc_feature', start: sel.start + 1, end: sel.end, strand: 1, color: '', note: '' });
    }
  }, [open, feature, selection, doc.length]);

  const save = () => {
    const start = Math.round(draft.start) - 1;
    const end = Math.round(draft.end);
    if (!draft.name.trim()) return setError(t('名称不能为空'));
    if (start < 0 || start >= doc.length || end < 1 || end > doc.length) return setError(t('坐标必须在 1–{v0} 之间', { v0: doc.length }));
    if (start >= end && doc.topology === 'linear') return setError(t('线性序列的起点必须小于终点'));
    const next: SequenceFeature = {
      ...(feature ?? { id: uid('f') }),
      name: draft.name.trim(),
      type: draft.type,
      start,
      end,
      strand: draft.strand,
      color: draft.color || TYPE_COLORS[draft.type] || '#64748b',
      notes: withNote(feature?.notes, draft.note.trim()),
    };
    const features = feature ? doc.features.map((f) => (f.id === feature.id ? next : f)) : [...doc.features, next];
    replaceDoc(edited(doc, { features }, feature ? t('编辑特征 {v0}', { v0: next.name }) : t('添加特征 {v0}', { v0: next.name })));
    onClose();
  };

  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <Dialog open={open} onClose={onClose} title={feature ? t('编辑特征：{v0}', { v0: feature.name }) : t('添加特征')} width={520}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('名称')}>
          <Input value={draft.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label={t('类型')}>
          <Select value={draft.type} onChange={(e) => set('type', e.target.value as FeatureType)}>
            {FEATURE_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('起点 (1-based)')} hint={doc.topology === 'circular' ? t('起点 > 终点表示跨越零点') : undefined}>
          <Input type="number" value={draft.start} onChange={(e) => set('start', Number(e.target.value))} />
        </Field>
        <Field label={t('终点 (含)')}>
          <Input type="number" value={draft.end} onChange={(e) => set('end', Number(e.target.value))} />
        </Field>
        <Field label={t('方向')}>
          <Select value={String(draft.strand)} onChange={(e) => set('strand', Number(e.target.value) as StrandDirection)}>
            <option value="1">{t('正向 →')}</option>
            <option value="-1">{t('反向 ←')}</option>
            <option value="0">{t('无方向')}</option>
          </Select>
        </Field>
        <Field label={t('颜色')}>
          <Input type="color" value={draft.color || TYPE_COLORS[draft.type] || '#64748b'} onChange={(e) => set('color', e.target.value)} />
        </Field>
        <div className="col-span-2">
          <Field label={t('注释')}>
            <Input value={draft.note} onChange={(e) => set('note', e.target.value)} />
          </Field>
        </div>
      </div>
      {error && <div className="mt-3 text-xs text-red-600">{error}</div>}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>{t('取消')}</Button>
        <Button variant="primary" onClick={save}>
          {t('保存')}
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * Locates where an oligo anneals: the longest 3'-terminal stretch (>= 15 nt) found
 * exactly on either strand. Bases 5' of that stretch become the tail.
 */
/** Set or clear the free-text note, keeping every other qualifier. */
export function withNote(notes: SequenceFeature['notes'], note: string): SequenceFeature['notes'] {
  const { note: _old, ...rest } = notes ?? {};
  if (note) return { ...rest, note: [note] };
  return Object.keys(rest).length ? rest : undefined;
}

export function locatePrimer(doc: PlasmidDocument, oligo: string): { start: number; end: number; strand: 1 | -1; tail: string } | null {
  const seq = doc.sequence.toUpperCase();
  const hay = doc.topology === 'circular' ? seq + seq.slice(0, Math.min(oligo.length, seq.length - 1)) : seq;
  const rcHay = reverseComplement(hay);
  for (let len = oligo.length; len >= 15; len--) {
    const anneal = oligo.slice(oligo.length - len);
    const fwd = hay.indexOf(anneal);
    if (fwd >= 0) return { start: fwd, end: (fwd + len) % seq.length || seq.length, strand: 1, tail: oligo.slice(0, oligo.length - len) };
    const rev = rcHay.indexOf(anneal);
    if (rev >= 0) {
      // Position in the reverse complement maps back to the top strand.
      const topEnd = hay.length - rev;
      const topStart = topEnd - len;
      return { start: topStart % seq.length, end: topEnd % seq.length || seq.length, strand: -1, tail: oligo.slice(0, oligo.length - len) };
    }
  }
  return null;
}

export function PrimerEditor({ doc, open, onClose }: { doc: PlasmidDocument; open: boolean; onClose: () => void }) {
  const t = useT();
  const replaceDoc = useWorkbench((s) => s.replaceDoc);
  const [name, setName] = useState('Primer');
  const [sequence, setSequence] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(`Primer ${doc.primers.length + 1}`);
      setSequence('');
      setError(null);
    }
  }, [open, doc.primers.length]);

  // Whitespace is ignored and U read as T; IUPAC codes are kept (e.g. an N tail), anything else is refused.
  const oligo = sequence.toUpperCase().replace(/\s+/g, '').replace(/U/g, 'T');
  const invalid = [...new Set(oligo.replace(/[ACGTRYSWKMBDHVN]/g, ''))].join('');
  const site = oligo.length >= 15 && !invalid ? locatePrimer(doc, oligo) : null;

  const save = () => {
    if (invalid) return setError(t('序列含无效字符：{v0}', { v0: invalid }));
    if (oligo.length < 15) return setError(t('引物至少 15 nt'));
    if (!site) return setError(t('未在序列任一链上找到 ≥15 nt 的 3′ 端结合区'));
    const annealing = oligo.slice(site.tail.length);
    const thermoAnneal = evaluateOligoThermodynamics(annealing);
    const thermoFull = evaluateOligoThermodynamics(oligo);
    const primer: Primer = {
      id: uid('p'),
      name: name.trim() || 'Primer',
      sequence: oligo,
      bindingStart: site.start,
      bindingEnd: site.end,
      strand: site.strand,
      tailSequence: site.tail,
      tmAnnealing: thermoAnneal.tm,
      tmTotal: thermoFull.tm,
      gcPercent: thermoFull.gcPercent,
      has3PrimeGCClamp: /[GC]$/.test(oligo),
      hairpinDeltaG: thermoFull.hairpinDeltaG,
      selfDimerDeltaG: thermoFull.selfDimerDeltaG,
    };
    replaceDoc(edited(doc, { primers: [...doc.primers, primer] }, t('添加引物 {v0}', { v0: primer.name })));
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('添加引物')} width={560}>
      <div className="flex flex-col gap-3">
        <Field label={t('名称')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('序列 5′→3′')} hint={t('3′ 端 ≥15 nt 与模板完全互补即可，5′ 多出的碱基视为尾巴')}>
          <Input className="mono" value={sequence} onChange={(e) => setSequence(e.target.value)} placeholder="ACGT…" />
        </Field>
        {oligo.length >= 15 && (
          <div className="text-xs text-[var(--muted)]">
            {invalid
              ? t('含无效字符：{v0}', { v0: invalid })
              : site
              ? t('结合位置 {v0}–{v1}（{v2}）{v3}', { v0: site.start + 1, v1: site.end, v2: site.strand === 1 ? t('正链') : t('负链'), v3: site.tail ? `，5′ 尾巴 ${site.tail.length} nt` : '' })
              : t('未找到结合位点')}
          </div>
        )}
        {error && <div className="text-xs text-red-600">{error}</div>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button variant="primary" onClick={save}>
            {t('添加')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
