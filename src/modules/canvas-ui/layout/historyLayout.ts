// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import type { CloningHistoryNode } from '../../../types/schema';

export interface HistorySnapshot {
  id: string;
  name: string;
  length: number;
  extractedRange?: [number, number];
}

export interface HistoryGraphNode {
  id: string;
  label: string;
  sublabel: string;
  operation: string;
  timestamp: string;
  description: string;
  enzymes: string[];
  primers: string[];
  synthetic: boolean;
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
  extractedRange?: [number, number];
}

export interface HistoryGraphEdge {
  id: string;
  from: string;
  to: string;
}

export interface HistoryLayout {
  nodes: HistoryGraphNode[];
  edges: HistoryGraphEdge[];
  width: number;
  height: number;
  layerCount: number;
}

export const HISTORY_NODE_WIDTH = 210;
export const HISTORY_NODE_HEIGHT = 98;
const GAP_X = 34;
const GAP_Y = 76;
const MARGIN = 34;

export function formatHistoryTimestamp(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function wrapText(text: string, maxChars: number, maxLines = 2): string[] {
  if (!text) return [];
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    const last = lines[maxLines - 1] ?? '';
    lines[maxLines - 1] =
      last.length > maxChars - 1
        ? `${last.slice(0, Math.max(1, maxChars - 1))}…`
        : `${last}…`;
  }
  return lines;
}

export function layoutHistoryTree(history: CloningHistoryNode[]): HistoryLayout {
  if (history.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0, layerCount: 0 };
  }

  const realById = new Map<string, CloningHistoryNode>();
  const snapshots = new Map<string, HistorySnapshot>();
  const order = new Map<string, number>();
  history.forEach((node, index) => {
    realById.set(node.id, node);
    order.set(node.id, index);
  });

  for (const node of history) {
    for (const snapshot of node.parentSnapshots ?? []) {
      if (!snapshots.has(snapshot.id)) {
        snapshots.set(snapshot.id, {
          id: snapshot.id,
          name: snapshot.name,
          length: snapshot.length,
          extractedRange: snapshot.extractedRange,
        });
      }
      if (!order.has(snapshot.id)) order.set(snapshot.id, history.length + snapshots.size);
    }
  }

  const ids = new Set<string>();
  for (const node of history) ids.add(node.id);
  for (const snapshot of snapshots.keys()) ids.add(snapshot);

  const parentsOf = new Map<string, string[]>();
  const edges: HistoryGraphEdge[] = [];
  const edgeKeys = new Set<string>();
  for (const node of history) {
    for (const snapshot of node.parentSnapshots ?? []) {
      if (snapshot.id === node.id) continue;
      const parents = parentsOf.get(node.id);
      if (parents) {
        if (!parents.includes(snapshot.id)) parents.push(snapshot.id);
      } else {
        parentsOf.set(node.id, [snapshot.id]);
      }
      const key = `${snapshot.id}->${node.id}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push({ id: key, from: snapshot.id, to: node.id });
      }
    }
  }

  const depthMemo = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const memoized = depthMemo.get(id);
    if (memoized !== undefined) return memoized;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let depth = 0;
    for (const parent of parentsOf.get(id) ?? []) {
      depth = Math.max(depth, depthOf(parent) + 1);
    }
    visiting.delete(id);
    depthMemo.set(id, depth);
    return depth;
  };

  for (const id of ids) depthOf(id);

  const byLayer = new Map<number, string[]>();
  for (const id of ids) {
    const layer = depthMemo.get(id) ?? 0;
    const list = byLayer.get(layer);
    if (list) list.push(id);
    else byLayer.set(layer, [id]);
  }
  const layerCount = byLayer.size === 0 ? 0 : Math.max(...byLayer.keys()) + 1;
  for (const list of byLayer.values()) {
    list.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }

  let maxPerLayer = 1;
  for (const list of byLayer.values()) maxPerLayer = Math.max(maxPerLayer, list.length);
  const contentWidth = maxPerLayer * (HISTORY_NODE_WIDTH + GAP_X) - GAP_X;
  const width = contentWidth + MARGIN * 2;
  const height = layerCount * (HISTORY_NODE_HEIGHT + GAP_Y) - GAP_Y + MARGIN * 2;

  const nodes: HistoryGraphNode[] = [];
  for (let layer = 0; layer < layerCount; layer += 1) {
    const list = byLayer.get(layer) ?? [];
    const rowWidth = list.length * (HISTORY_NODE_WIDTH + GAP_X) - GAP_X;
    const startX = (width - rowWidth) / 2;
    list.forEach((id, index) => {
      const real = realById.get(id);
      const snapshot = snapshots.get(id);
      const extractedRange = snapshot?.extractedRange;
      const length = real ? 0 : snapshot?.length ?? 0;
      const sublabel = real
        ? real.enzymesUsed?.length
          ? `Digest: ${real.enzymesUsed.join(', ')}`
          : real.primersUsed?.length
            ? `Primers: ${real.primersUsed.join(', ')}`
            : formatHistoryTimestamp(real.timestamp)
        : `${length > 0 ? `${length} bp` : 'Input'}${extractedRange ? ` · ${extractedRange[0] + 1}–${extractedRange[1]}` : ''}`;
      nodes.push({
        id,
        label: real ? operationTitle(real.operation) : snapshot?.name ?? id,
        sublabel,
        operation: real?.operation ?? 'import',
        timestamp: real ? formatHistoryTimestamp(real.timestamp) : '',
        description: real?.description ?? `Starting material · ${snapshot?.name ?? id}`,
        enzymes: real?.enzymesUsed ?? [],
        primers: real?.primersUsed ?? [],
        synthetic: !real,
        layer,
        x: startX + index * (HISTORY_NODE_WIDTH + GAP_X),
        y: MARGIN + layer * (HISTORY_NODE_HEIGHT + GAP_Y),
        width: HISTORY_NODE_WIDTH,
        height: HISTORY_NODE_HEIGHT,
        extractedRange,
      });
    });
  }

  return { nodes, edges, width, height, layerCount };
}

export function operationTitle(operation: string): string {
  switch (operation) {
    case 'import':
      return 'Imported construct';
    case 'restriction_ligation':
      return 'Restriction–ligation';
    case 'gibson_assembly':
      return 'Gibson assembly';
    case 'golden_gate':
      return 'Golden Gate';
    case 'gateway_bp':
      return 'Gateway BP';
    case 'gateway_lr':
      return 'Gateway LR';
    case 'pcr':
      return 'PCR amplification';
    case 'soe_pcr':
      return 'SOE-PCR';
    case 'site_directed_mutagenesis':
      return 'Site-directed mutagenesis';
    case 'oligo_annealing':
      return 'Oligo annealing';
    case 'blunting':
      return 'End blunting';
    case 'manual_edit':
      return 'Manual edit';
    default:
      return operation;
  }
}

export function relatedNodeIds(
  layout: HistoryLayout,
  selectedId: string | null,
): Set<string> | null {
  if (!selectedId || !layout.nodes.some((node) => node.id === selectedId)) return null;
  const related = new Set<string>([selectedId]);
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const edge of layout.edges) {
    const p = parents.get(edge.to);
    if (p) p.push(edge.from);
    else parents.set(edge.to, [edge.from]);
    const c = children.get(edge.from);
    if (c) c.push(edge.to);
    else children.set(edge.from, [edge.to]);
  }
  const walk = (id: string, direction: 'up' | 'down') => {
    const next = direction === 'up' ? parents.get(id) ?? [] : children.get(id) ?? [];
    for (const id2 of next) {
      if (related.has(id2)) continue;
      related.add(id2);
      walk(id2, direction);
    }
  };
  walk(selectedId, 'up');
  walk(selectedId, 'down');
  return related;
}
