// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Browser for the built-in vector catalogue: filter by category, search by name, accession
// or marker, and open a vector as a new document.
import { useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { useWorkbench } from './store';
import { Badge, Button, Dialog, Input, Select } from './ui';
import { openVector, searchVectors, VECTOR_CATEGORIES, type VectorCategory, type VectorEntry } from './vectors';
import { t as translate, useT } from '../lib/i18n';

export function VectorLibraryDialog() {
  const t = useT();
  const open = useWorkbench((s) => s.tool === 'vectors');
  const setTool = useWorkbench((s) => s.setTool);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<VectorCategory | 'all'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const results = useMemo(() => searchVectors(query, category), [query, category]);
  const bundledCount = results.filter((v) => v.bundled).length;

  async function open_(entry: VectorEntry) {
    setBusy(entry.id);
    setError(null);
    try {
      const doc = await openVector(entry);
      useWorkbench.getState().openDocs([doc]);
      setTool(null);
    } catch (e) {
      setError(`${entry.name}：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onClose={() => setTool(null)} title={t('载体库')} width={860}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-64 flex-1">
            <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <Input
              autoFocus
              className="pl-7"
              placeholder={t('搜索名称、登录号或抗性标记，例如 pUC、U55762、AmpR')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Select value={category} onChange={(e) => setCategory(e.target.value as VectorCategory | 'all')}>
            <option value="all">{t('全部分类')}</option>
            {VECTOR_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {t(c.label)}
              </option>
            ))}
          </Select>
        </div>

        <p className="text-xs text-[var(--muted)]">
          {t('共 {v0} 个载体，其中 {v1} 个已内置、可离线打开；其余按 GenBank 登录号从 NCBI 获取。每个条目都对应一条公开的 GenBank 记录。', { v0: results.length, v1: bundledCount })}
        </p>

        {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-600">{error}</p>}

        <div className="max-h-[52vh] overflow-auto rounded-md border border-[var(--border)]">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-[var(--panel)] text-xs text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t('载体')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('长度')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('标记')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('说明')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {results.map((v) => (
                <tr key={v.id} className="border-t border-[var(--border)] align-top hover:bg-[var(--bg)]">
                  <td className="px-3 py-2">
                    <div className="font-medium">{v.name}</div>
                    <div className="mono text-[11px] text-[var(--muted)]">{v.accession}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--muted)]">
                    {v.lengthBp ? `${v.lengthBp.toLocaleString()} bp` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {v.markers.map((m) => (
                        <Badge key={m} tone="blue">
                          {m}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--muted)]">{t(v.notes)}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" disabled={busy !== null} onClick={() => open_(v)}>
                      {busy === v.id ? t('打开中…') : v.bundled ? t('打开') : <><Download size={12} />{t('获取')}</>}
                    </Button>
                  </td>
                </tr>
              ))}
              {results.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-[var(--muted)]">
                    {t('没有匹配的载体。商业载体（pET-28a、pcDNA3.1、pQE 等）没有公开的 GenBank 记录，不在库内；可用「从 NCBI 导入」或直接打开厂商提供的文件。')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Dialog>
  );
}
