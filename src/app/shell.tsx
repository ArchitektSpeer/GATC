// SPDX-License-Identifier: GPL-3.0-or-later
// Application frame: view rail, menus, document tabs, status bar and the welcome screen.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  AlignLeft,
  ChevronDown,
  CircleAlert,
  CircleDot,
  Columns2,
  FolderOpen,
  Globe,
  History,
  ListTree,
  Plus,
  Rows3,
  Scissors,
  Tags,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { CutSite, PlasmidDocument, SelectionRange } from '../types/schema';
import { useT } from '../lib/i18n';
import { isDirty, selectDirtyIds, useWorkbench, type ViewMode } from './store';
import { Button, Select, cn } from './ui';

export const UNDO_SCOPE = '撤销范围：序列文档的内容与打开/关闭（序列、特征、引物、历史、甲基化设置）。不含测序数据、电泳设置、视图与选区。';

interface ViewItem {
  value: ViewMode;
  label: string;
  /** Shown in the narrow rail; part of `label`, which stays the accessible name. */
  short?: string;
  icon: LucideIcon;
  hint: string;
}

export const VIEW_GROUPS: Array<{ title: string; items: ViewItem[] }> = [
  {
    title: '查看',
    items: [
      { value: 'split', label: '双视图', icon: Columns2, hint: '图谱与序列并排' },
      { value: 'map', label: '环形图谱', short: '图谱', icon: CircleDot, hint: '整张图谱' },
      { value: 'sequence', label: '序列', icon: AlignLeft, hint: '双链序列，可直接编辑' },
    ],
  },
  {
    title: '分析',
    items: [
      { value: 'enzymes', label: '酶', icon: Scissors, hint: '酶切位点、筛选与跑胶' },
      { value: 'features', label: '特征/引物', icon: Tags, hint: '特征、引物与 ORF 列表' },
      { value: 'gel', label: '虚拟电泳', short: '电泳', icon: Rows3, hint: '预测的电泳条带' },
    ],
  },
  {
    title: '测序',
    items: [
      { value: 'sanger', label: 'Sanger 比对', short: 'Sanger', icon: Activity, hint: '测序读段与参考的比对' },
      { value: 'align', label: '多序列比对', short: '多序列', icon: ListTree, hint: '比较多条序列' },
    ],
  },
  { title: '记录', items: [{ value: 'history', label: '历史树', short: '历史', icon: History, hint: '构建步骤与来源' }] },
];

export const VIEWS = VIEW_GROUPS.flatMap((g) => g.items);

/** Vertical navigation between the views of the active document. */
export function ViewRail({ value, onChange, disabled }: { value: ViewMode; onChange: (v: ViewMode) => void; disabled: boolean }) {
  const t = useT();
  return (
    <nav aria-label={t('视图')} className="flex w-[76px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-[var(--border)] bg-[var(--panel)] px-1.5 py-2">
      {VIEW_GROUPS.map((group, gi) => (
        <div key={group.title} className={cn('flex flex-col gap-0.5', gi > 0 && 'mt-1 border-t border-[var(--border)] pt-2')}>
          <div className="px-1 pb-0.5 text-[10px] font-medium text-[var(--muted)]">{t(group.title)}</div>
          {group.items.map(({ value: v, label, short, icon: Icon, hint }) => (
            <button
              key={v}
              disabled={disabled}
              onClick={() => onChange(v)}
              aria-label={t(label)}
              title={`${t(label)}：${t(hint)}`}
              aria-current={value === v ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] leading-tight disabled:opacity-40',
                value === v
                  ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                  : 'text-[var(--muted)] hover:bg-slate-100 hover:text-[var(--text)] dark:hover:bg-slate-800',
              )}
            >
              <Icon size={18} strokeWidth={value === v ? 2.2 : 1.8} />
              <span className="w-full break-words text-center leading-[1.15]">{t(short ?? label)}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

export type MenuEntry = { label: string; hint?: string; onSelect: () => void; disabled?: boolean } | { divider: true };

/** Button that opens a list of commands; closes on selection, outside click or Escape. */
export function Menu({ label, icon, entries, disabled, align = 'left' }: { label: string; icon?: ReactNode; entries: MenuEntry[]; disabled?: boolean; align?: 'left' | 'right' }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <Button size="sm" disabled={disabled} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        {icon} {t(label)} <ChevronDown size={12} className="opacity-60" />
      </Button>
      {open && (
        <div role="menu" className={cn('absolute top-9 z-40 min-w-56 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1 shadow-xl', align === 'right' ? 'right-0' : 'left-0')}>
          {entries.map((e, i) =>
            'divider' in e ? (
              <div key={i} className="my-1 border-t border-[var(--border)]" />
            ) : (
              <button
                key={i}
                role="menuitem"
                disabled={e.disabled}
                className="flex w-full items-center justify-between gap-4 rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
                onClick={() => {
                  setOpen(false);
                  e.onSelect();
                }}
              >
                <span>{t(e.label)}</span>
                {e.hint && <span className="text-[10px] text-[var(--muted)]">{t(e.hint)}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** Open documents and proteins as tabs. */
export function DocTabs({ onOpen, onClose }: { onOpen: () => void; onClose: (id: string) => void }) {
  const t = useT();
  const s = useWorkbench();
  const { docs, proteins, activeId, activeProteinId } = s;
  const tab = (active: boolean, tone: 'blue' | 'green') =>
    cn(
      'group flex max-w-[240px] shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-xs',
      active
        ? cn('border-[var(--border)] bg-[var(--bg)] font-medium', tone === 'blue' ? 'text-blue-700 dark:text-blue-300' : 'text-emerald-700 dark:text-emerald-300')
        : 'border-transparent text-[var(--muted)] hover:bg-slate-100 hover:text-[var(--text)] dark:hover:bg-slate-800',
    );
  return (
    <div className="flex items-end gap-0.5 overflow-x-auto border-b border-[var(--border)] bg-[var(--panel)] px-2 pt-1.5">
      {docs.map((d) => (
        <div key={d.id} className={tab(d.id === activeId && !activeProteinId, 'blue')} onClick={() => s.setActive(d.id)} title={`${d.name} · ${d.length.toLocaleString()} bp · ${t(d.topology === 'circular' ? '环状' : '线性')}`}>
          <span className="truncate">{d.name}</span>
          {isDirty(s, d) && (
            <span className="text-amber-500" title={t('有未保存的修改')} aria-label={t('未保存')}>
              ●
            </span>
          )}
          <span className="shrink-0 text-[var(--muted)]">{d.length} bp</span>
          <button className="-m-1 shrink-0 rounded p-1 opacity-40 hover:bg-slate-200 hover:opacity-100 dark:hover:bg-slate-700" onClick={(e) => (e.stopPropagation(), onClose(d.id))} aria-label={t('关闭')}>
            <X size={12} />
          </button>
        </div>
      ))}
      {proteins.map((p) => (
        <div key={p.id} className={tab(p.id === activeProteinId, 'green')} onClick={() => s.setActiveProtein(p.id)} title={`${p.name} · ${p.sequence.length} aa`}>
          <span className="truncate">{p.name}</span>
          <span className="shrink-0 text-[var(--muted)]">{p.sequence.length} aa</span>
          <button className="-m-1 shrink-0 rounded p-1 opacity-40 hover:bg-slate-200 hover:opacity-100 dark:hover:bg-slate-700" onClick={(e) => (e.stopPropagation(), s.closeProtein(p.id))} aria-label={t('关闭')}>
            <X size={12} />
          </button>
        </div>
      ))}
      <button className="mb-1 ml-1 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--muted)] hover:bg-slate-100 hover:text-[var(--text)] dark:hover:bg-slate-800" onClick={onOpen} title={t('打开文件 (Ctrl+O)')}>
        <Plus size={13} /> {t('打开')}
      </button>
    </div>
  );
}

/** Document facts, the selection and the save state, always visible at the bottom. */
export function StatusBar({ doc, cutSites, uniqueCutters, selection }: { doc: PlasmidDocument | null; cutSites: CutSite[]; uniqueCutters: number; selection: SelectionRange | null }) {
  const t = useT();
  const selLength = doc && selection ? (selection.end >= selection.start ? selection.end - selection.start : doc.length - selection.start + selection.end) : 0;
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-[var(--border)] bg-[var(--panel)] px-3 text-[11px] text-[var(--muted)]">
      {doc ? (
        <>
          <span className="truncate font-medium text-[var(--text)]">{doc.name}</span>
          <span>
            {doc.length.toLocaleString()} bp · {t(doc.topology === 'circular' ? '环状' : '线性')}
          </span>
          <span>
            {t('{features} 特征 · {primers} 引物', { features: doc.features.length, primers: doc.primers.length })}
          </span>
          <span title={t('图谱上显示识别序列 ≥6 bp、只切一次的酶；酶视图列出当前酶集的全部切点')}>
            {t('{unique} 个单切点酶 · 共 {total} 个切点', { unique: uniqueCutters, total: cutSites.length })}
          </span>
          <span className="truncate">
            {selection && selLength > 0 ? (
              <span className="text-[var(--text)]">
                {t('选区 {from}–{to}（{length} bp）', {
                  from: selection.start + 1,
                  to: selection.end,
                  length: selLength.toLocaleString(),
                })}
              </span>
            ) : (
              t('未选择区间')
            )}
          </span>
        </>
      ) : (
        <span>{t('没有打开的序列')}</span>
      )}
      <div className="flex-1" />
      <SaveStatus />
    </footer>
  );
}

/** Unsaved count, autosave outcome and the save/undo settings. */
function SaveStatus() {
  const t = useT();
  const dirty = useWorkbench((s) => selectDirtyIds(s).length);
  const autosave = useWorkbench((s) => s.autosave);
  const settings = useWorkbench((s) => s.settings);
  const setSettings = useWorkbench((s) => s.setSettings);
  const [open, setOpen] = useState(false);
  const failed = autosave.state === 'error';
  const text = failed
    ? t('自动保存失败')
    : dirty
      ? t('{n} 个未保存', { n: dirty }) +
        (autosave.state === 'saved' ? t(' · 已自动备份 {time}', { time: new Date(autosave.at).toLocaleTimeString() }) : '')
      : t('全部已保存');
  return (
    <div className="relative">
      <button
        className={cn(
          'flex items-center gap-1 rounded px-1.5 py-0.5',
          failed ? 'bg-red-50 font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300' : dirty ? 'text-amber-600 hover:bg-slate-100 dark:hover:bg-slate-800' : 'hover:bg-slate-100 dark:hover:bg-slate-800',
        )}
        title={failed ? autosave.error : t('自动保存与撤销设置')}
        onClick={() => setOpen(!open)}
      >
        {failed && <CircleAlert size={12} />}
        {text}
      </button>
      {open && (
        <div className="absolute bottom-7 right-0 z-30 w-80 space-y-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 text-xs text-[var(--text)] shadow-xl" onMouseLeave={() => setOpen(false)}>
          {failed && <div className="text-red-600">{autosave.error}</div>}
          <div className="text-[var(--muted)]">
            {t('有未保存修改时，工作区会在停止操作后自动备份到本机（{where}），用于异常退出后恢复。它不替代保存：要交给他人或长期保留，请用 Ctrl+S 保存为 .gatc 项目。', {
              where: t("__TAURI_INTERNALS__' in window ? '应用数据目录' : '浏览器 IndexedDB"),
            })}
          </div>
          <label className="flex items-center justify-between gap-2">
            {t('自动备份延迟')}
            <Select value={settings.autosaveDelayMs} onChange={(e) => setSettings({ autosaveDelayMs: Number(e.target.value) })}>
              {[1000, 3000, 5000, 10000, 30000].map((ms) => (
                <option key={ms} value={ms}>
                  {t('{n} 秒', { n: ms / 1000 })}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center justify-between gap-2">
            {t('撤销步数（重启后生效）')}
            <Select value={settings.undoLimit} onChange={(e) => setSettings({ undoLimit: Number(e.target.value) })}>
              {[100, 500, 1000, 2000].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
          <div className="text-[var(--muted)]">{t(UNDO_SCOPE)}</div>
        </div>
      )}
    </div>
  );
}

/** Shown when nothing is open: what the program does and how to start. */
export function Welcome({ loading, onOpen, onNcbi, onSamples }: { loading: boolean; onOpen: () => void; onNcbi: () => void; onSamples: () => void }) {
  const t = useT();
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-8 shadow-sm">
        <div className="mono text-2xl font-bold tracking-[0.12em]">
          <span>G</span>
          <span className="text-emerald-600">A</span>
          <span className="text-red-600">T</span>
          <span className="text-blue-600">C</span>
        </div>
        <p className="mt-2 text-sm text-[var(--muted)]">{t('查看与编辑质粒，设计引物和克隆方案，核对测序结果。所有计算都在本机完成。')}</p>
        {loading ? (
          <p className="mt-6 text-sm text-[var(--muted)]">{t('正在加载示例质粒…')}</p>
        ) : (
          <div className="mt-6 grid gap-2">
            <Button variant="primary" onClick={onOpen} className="justify-center">
              <FolderOpen size={15} /> {t('打开文件')}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={onNcbi} className="justify-center">
                <Globe size={14} /> {t('从 NCBI 导入')}
              </Button>
              <Button onClick={onSamples} className="justify-center">
                {t('打开示例质粒')}
              </Button>
            </div>
          </div>
        )}
        <p className="mt-5 text-xs text-[var(--muted)]">
          {t('也可以把文件拖进窗口。支持 SnapGene .dna、GenBank、FASTA、EMBL、GFF、AB1 测序文件和 GATC 项目 (.gatc)。')}
        </p>
      </div>
    </div>
  );
}
