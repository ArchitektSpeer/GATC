// SPDX-License-Identifier: GPL-3.0-or-later
// Saving and opening .gatc projects from the workbench.
import type { PlasmidDocument } from '../types/schema';
import { PROJECT_FILE_EXTENSION, PROJECT_MIME_TYPE, serializeProject, type ProjectLoadResult } from '../modules/io-adapter';
import { APP_VERSION } from './autosave';
import { remapDocIds } from './doc-ids';
import { useWorkbench, type ViewMode } from './store';

export function download(name: string, content: string | Uint8Array<ArrayBuffer>, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * How a save ended. A browser download cannot report whether the file was
 * actually written (the user may cancel it, or the disk may be full), so only a
 * save through the File System Access API counts as confirmed.
 */
export type SaveOutcome = 'confirmed' | 'unconfirmed' | 'cancelled';

interface SavePickerWindow {
  showSaveFilePicker?: (opts: {
    suggestedName: string;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<{ createWritable: () => Promise<{ write: (data: BlobPart) => Promise<void>; close: () => Promise<void> }> }>;
}

/** Whether this browser can confirm that a saved file was written. */
export function canConfirmSave(): boolean {
  return typeof (globalThis as SavePickerWindow).showSaveFilePicker === 'function';
}

/** Save a file, through a save dialog that confirms the write when the browser has one. */
export async function saveFile(name: string, content: string | Uint8Array<ArrayBuffer>, type: string, extension: string): Promise<SaveOutcome> {
  const picker = (globalThis as SavePickerWindow).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName: name, types: [{ description: extension, accept: { [type]: [extension] } }] });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return 'confirmed';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // Picker unavailable in this context (e.g. no user gesture): fall back to a download.
      if (!(e instanceof DOMException && (e.name === 'SecurityError' || e.name === 'NotAllowedError'))) throw e;
    }
  }
  download(name, content, type);
  return 'unconfirmed';
}

/** Record a save of these documents and tell the user what is known about it. */
export function recordSave(ids: string[], outcome: SaveOutcome, what: string): void {
  const st = useWorkbench.getState();
  if (outcome === 'cancelled') return st.notify('已取消保存');
  st.markSaved(ids, { confirmed: outcome === 'confirmed' });
  st.notify(
    outcome === 'confirmed'
      ? `已保存${what}`
      : `已开始下载${what}。浏览器无法确认文件已写入，请在下载目录核对；本次会话内仍保留自动恢复数据`,
  );
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'GATC-项目';
}

/** Project text for the given documents (default: every open document). */
export function projectText(ids?: string[]): { text: string; docs: PlasmidDocument[] } {
  const s = useWorkbench.getState();
  const docs = ids ? s.docs.filter((d) => ids.includes(d.id)) : s.docs;
  const text = serializeProject({
    documents: docs,
    traces: s.traces,
    workspace: { activeDocId: s.activeId, view: s.view },
    appVersion: APP_VERSION,
  });
  return { text, docs };
}

/**
 * Save documents (default: all open) as a .gatc project, the format that keeps
 * everything GATC knows about them, and clear their unsaved marker.
 */
export async function saveProject(ids?: string[]): Promise<SaveOutcome> {
  const s = useWorkbench.getState();
  const { text, docs } = projectText(ids);
  if (!docs.length) {
    s.notify('没有可保存的文档');
    return 'cancelled';
  }
  const active = docs.find((d) => d.id === s.activeId) ?? docs[0];
  const base = docs.length === 1 ? active.name : `${active.name} 等 ${docs.length} 个文档`;
  try {
    const outcome = await saveFile(`${safeFileName(base)}${PROJECT_FILE_EXTENSION}`, text, PROJECT_MIME_TYPE, PROJECT_FILE_EXTENSION);
    recordSave(docs.map((d) => d.id), outcome, `项目（${docs.length} 个文档，含测序数据与工作区）`);
    return outcome;
  } catch (e) {
    s.notify(`保存失败：${e instanceof Error ? e.message : String(e)}。修改仍未保存`);
    return 'cancelled';
  }
}

const VIEW_IDS: ViewMode[] = ['split', 'map', 'sequence', 'enzymes', 'features', 'gel', 'sanger', 'align', 'history'];

/** Open a loaded project next to what is already open; documents whose id is taken get a new id. */
export function openProject({ project, migratedFrom, warnings }: ProjectLoadResult, fileName: string): void {
  const st = useWorkbench.getState();
  const { docs, idMap } = remapDocIds(
    project.documents,
    (id) => st.docs.some((x) => x.id === id),
    (d) => `${d.id}-${Math.random().toString(36).slice(2, 8)}`,
  );
  st.openDocs(docs, true, { saved: true });
  for (const [docId, list] of Object.entries(project.traces)) {
    const id = idMap.get(docId);
    if (id) st.setTraces(id, list);
  }
  const active = project.workspace.activeDocId && idMap.get(project.workspace.activeDocId);
  if (active) st.setActive(active);
  const view = project.workspace.view as ViewMode | undefined;
  if (view && VIEW_IDS.includes(view)) st.setView(view);
  const notes = [
    `已打开项目 ${fileName}（${docs.length} 个文档）`,
    migratedFrom !== null ? `已从格式 v${migratedFrom} 升级，另存后生效` : '',
    ...warnings,
  ].filter(Boolean);
  st.notify(notes.join('；'));
}
