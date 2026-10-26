import { useId, useMemo } from 'react';
import { GitBranch, Workflow } from 'lucide-react';
import type { CloningHistoryNode } from '../../types/schema';
import type { VizTheme } from './theme';
import { getTheme, OPERATION_LABEL, OPERATION_TINT } from './theme';
import { formatBp } from './utils';
import {
  layoutHistoryTree,
  relatedNodeIds,
  wrapText,
} from './layout/historyLayout';

export interface CloningHistoryTreeProps {
  history: CloningHistoryNode[];
  selectedId?: string | null;
  onSelectNode?: (id: string) => void;
  theme?: VizTheme;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

export function CloningHistoryTree({
  history,
  selectedId = null,
  onSelectNode,
  theme = 'light',
}: CloningHistoryTreeProps) {
  const tokens = getTheme(theme);
  const rawUid = useId();
  const uid = safeId(rawUid);
  const layout = useMemo(() => layoutHistoryTree(history), [history]);
  const related = useMemo(
    () => relatedNodeIds(layout, selectedId ?? null),
    [layout, selectedId],
  );
  const operationSet = useMemo(() => {
    const set = new Set<string>();
    for (const node of layout.nodes) {
      if (!node.synthetic) set.add(node.operation);
    }
    return [...set];
  }, [layout.nodes]);

  const css = `
    .osg-history-node { cursor: pointer; transition: opacity 160ms ease; outline: none; }
    .osg-history-node .osg-history-body { transition: filter 140ms ease, stroke 140ms ease; }
    .osg-history-node:hover .osg-history-body { filter: brightness(1.06); }
    .osg-history-node:focus-visible .osg-history-body { stroke-width: 2.4; }
  `;

  if (layout.nodes.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 9,
          minHeight: 190,
          border: `1px dashed ${tokens.border}`,
          borderRadius: 16,
          background: tokens.panel,
          color: tokens.muted,
          fontFamily: tokens.fontSans,
        }}
      >
        <GitBranch size={26} strokeWidth={1.5} />
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>No cloning history yet</div>
        <div style={{ fontSize: 11 }}>History nodes appear here after the first assembly or edit.</div>
      </div>
    );
  }

  return (
    <div
      className="osg-history-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: '100%',
        fontFamily: tokens.fontSans,
        color: tokens.text,
        background: tokens.background,
        border: `1px solid ${tokens.border}`,
        borderRadius: 16,
        padding: 12,
        boxSizing: 'border-box',
      }}
    >
      <style>{css}</style>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              borderRadius: 9,
              background: tokens.accentSoft,
              color: tokens.accent,
              flexShrink: 0,
            }}
          >
            <Workflow size={16} />
          </span>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>Cloning lineage</div>
            <div style={{ fontSize: 10.5, color: tokens.muted }}>
              {history.length} steps · {layout.layerCount} generations · {layout.nodes.length} constructs
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', maxWidth: 520 }}>
          {operationSet.map((operation) => (
            <span
              key={operation}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 9,
                color: tokens.muted,
                background: tokens.panel,
                border: `1px solid ${tokens.border}`,
                borderRadius: 99,
                padding: '2px 6px',
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: 99, background: OPERATION_TINT[operation] ?? tokens.accent }} />
              {OPERATION_LABEL[operation] ?? operation}
            </span>
          ))}
        </div>
      </div>

      <div
        style={{
          overflow: 'auto',
          maxHeight: 760,
          border: `1px solid ${tokens.border}`,
          borderRadius: 12,
          background: tokens.panel,
        }}
      >
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label="Cloning history directed acyclic graph"
          style={{ display: 'block', minWidth: layout.width }}
        >
          <defs>
            <pattern id={`osg-history-grid-${uid}`} width="22" height="22" patternUnits="userSpaceOnUse">
              <circle cx="1.2" cy="1.2" r="0.7" fill={tokens.grid} />
            </pattern>
            <marker
              id={`osg-history-arrow-${uid}`}
              viewBox="0 0 10 10"
              refX="8.2"
              refY="5"
              markerWidth="6.5"
              markerHeight="6.5"
              orient="auto-start-reverse"
            >
              <path d="M 1 1 L 9 5 L 1 9 z" fill={tokens.faint} />
            </marker>
            <marker
              id={`osg-history-arrow-active-${uid}`}
              viewBox="0 0 10 10"
              refX="8.2"
              refY="5"
              markerWidth="6.5"
              markerHeight="6.5"
              orient="auto-start-reverse"
            >
              <path d="M 1 1 L 9 5 L 1 9 z" fill={tokens.accent} />
            </marker>
          </defs>
          <rect width={layout.width} height={layout.height} fill={`url(#osg-history-grid-${uid})`} />
          <rect width={layout.width} height={layout.height} fill="transparent" />

          {layout.edges.map((edge) => {
            const from = layout.nodes.find((node) => node.id === edge.from);
            const to = layout.nodes.find((node) => node.id === edge.to);
            if (!from || !to) return null;
            const x1 = from.x + from.width / 2;
            const y1 = from.y + from.height;
            const x2 = to.x + to.width / 2;
            const y2 = to.y;
            const midY = (y1 + y2) / 2;
            const active = Boolean(related && related.has(from.id) && related.has(to.id));
            const dim = Boolean(related && !active);
            return (
              <path
                key={edge.id}
                d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2 - 1}`}
                fill="none"
                stroke={active ? tokens.accent : tokens.faint}
                strokeWidth={active ? 1.8 : 1.2}
                opacity={dim ? 0.28 : active ? 0.92 : 0.72}
                markerEnd={`url(#osg-history-arrow-${active ? 'active-' : ''}${uid})`}
              />
            );
          })}

          {layout.nodes.map((node) => {
            const selected = node.id === selectedId;
            const dim = Boolean(related && !related.has(node.id));
            const tint = node.synthetic ? tokens.muted : OPERATION_TINT[node.operation] ?? tokens.accent;
            const descriptionLines = wrapText(
              node.description || (node.synthetic ? 'Starting construct' : ''),
              31,
              2,
            );
            const detail =
              node.enzymes.length > 0
                ? `Enzymes · ${node.enzymes.join(', ')}`
                : node.primers.length > 0
                  ? `Primers · ${node.primers.join(', ')}`
                  : node.synthetic
                    ? 'Unmodified input'
                    : node.sublabel;
            return (
              <g
                key={node.id}
                className="osg-history-node"
                role="button"
                tabIndex={0}
                aria-label={`${node.label}. ${node.description}`}
                onClick={() => onSelectNode?.(node.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectNode?.(node.id);
                  }
                }}
                opacity={dim ? 0.32 : 1}
              >
                <title>
                  {`${node.label}\n${node.description}${node.enzymes.length ? `\nEnzymes: ${node.enzymes.join(', ')}` : ''}${node.primers.length ? `\nPrimers: ${node.primers.join(', ')}` : ''}`}
                </title>
                <rect
                  className="osg-history-body"
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={10}
                  fill={selected ? hexAlpha(tint, 0.10) : node.synthetic ? tokens.panelAlt : tokens.panel}
                  stroke={selected ? tint : tokens.border}
                  strokeWidth={selected ? 2 : 1}
                  strokeDasharray={node.synthetic ? '5 4' : undefined}
                  style={{ filter: selected ? undefined : `drop-shadow(0 5px 10px ${tokens.shadow})` }}
                />
                <rect
                  x={node.x}
                  y={node.y}
                  width={4}
                  height={node.height}
                  rx={2}
                  fill={tint}
                  opacity={node.synthetic ? 0.5 : 0.9}
                />
                <text x={node.x + 13} y={node.y + 16} fill={tint} fontSize={7.5} fontWeight={700} letterSpacing="0.08em">
                  {node.synthetic ? 'STARTING MATERIAL' : (OPERATION_LABEL[node.operation] ?? node.operation).toUpperCase()}
                </text>
                {node.timestamp ? (
                  <text x={node.x + node.width - 10} y={node.y + 16} textAnchor="end" fill={tokens.faint} fontSize={7.5} fontFamily={tokens.fontMono}>
                    {node.timestamp.slice(0, 10)}
                  </text>
                ) : null}
                <text x={node.x + 13} y={node.y + 35} fill={tokens.text} fontSize={11.5} fontWeight={700}>
                  {truncate(node.label, 24)}
                </text>
                {descriptionLines.map((line, index) => (
                  <text key={`desc-${node.id}-${index}`} x={node.x + 13} y={node.y + 50 + index * 12} fill={tokens.muted} fontSize={9}>
                    {line}
                  </text>
                ))}
                <line
                  x1={node.x + 12}
                  y1={node.y + node.height - 23}
                  x2={node.x + node.width - 12}
                  y2={node.y + node.height - 23}
                  stroke={tokens.border}
                  strokeWidth={0.7}
                />
                <text
                  x={node.x + 13}
                  y={node.y + node.height - 9}
                  fill={tokens.muted}
                  fontSize={8}
                  fontFamily={tokens.fontMono}
                >
                  {truncate(detail, 34)}
                </text>
                {node.extractedRange ? (
                  <text x={node.x + node.width - 10} y={node.y + node.height - 9} textAnchor="end" fill={tokens.faint} fontSize={7.5} fontFamily={tokens.fontMono}>
                    {formatBp(node.extractedRange[1] - node.extractedRange[0])} bp
                  </text>
                ) : null}
                {selected ? (
                  <circle cx={node.x + node.width - 8} cy={node.y + 8} r={3} fill={tint} />
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 9.5, color: tokens.muted }}>
        <span>Select a node to trace its ancestors and descendants.</span>
        <span style={{ fontFamily: tokens.fontMono }}>{layout.nodes.filter((node) => node.synthetic).length} input constructs</span>
      </div>
    </div>
  );
}

function hexAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return `rgba(100, 116, 139, ${alpha})`;
  const parsed = Number.parseInt(clean, 16);
  if (!Number.isFinite(parsed)) return `rgba(100, 116, 139, ${alpha})`;
  return `rgba(${(parsed >> 16) & 255}, ${(parsed >> 8) & 255}, ${parsed & 255}, ${alpha})`;
}
