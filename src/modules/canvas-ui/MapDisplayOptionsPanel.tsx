// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import type { CSSProperties } from 'react';
import { t as translate, useT } from '../../lib/i18n';
import {
  MAX_LABEL_FONT_SIZE,
  MIN_LABEL_FONT_SIZE,
  resolveMapDisplayOptions,
  type MapDisplayOptions,
} from './mapDisplayOptions';

export interface MapDisplayOptionsPanelProps {
  value: MapDisplayOptions;
  onChange: (value: MapDisplayOptions) => void;
  featureTypes: string[];
}

const TICK_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: '50', label: '50 bp' },
  { value: '100', label: '100 bp' },
  { value: '200', label: '200 bp' },
  { value: '500', label: '500 bp' },
  { value: '1000', label: '1 kb' },
  { value: '5000', label: '5 kb' },
];

function toggleRow(
  label: string,
  checked: boolean,
  onChange: (next: boolean) => void,
): JSX.Element {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        fontSize: 11.5,
        lineHeight: 1.5,
        cursor: 'pointer',
        color: 'inherit',
        minWidth: 0,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        style={{ accentColor: '#0284c7', margin: 0, flexShrink: 0 }}
      />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </label>
  );
}

/**
 * Compact, fully controlled editor for `MapDisplayOptions`. The component does
 * not own state: every interaction calls `onChange` with a merged option set.
 */
export function MapDisplayOptionsPanel({
  value,
  onChange,
  featureTypes,
}: MapDisplayOptionsPanelProps) {
  const t = useT();
  const resolved = resolveMapDisplayOptions(value);
  const patch = (next: Partial<MapDisplayOptions>): void => {
    onChange({ ...value, ...next });
  };
  const setHiddenType = (type: string, hidden: boolean): void => {
    const current = new Set(resolved.hiddenFeatureTypes);
    if (hidden) current.add(type);
    else current.delete(type);
    patch({ hiddenFeatureTypes: [...current] });
  };

  const sectionTitle: CSSProperties = {
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: '0.09em',
    textTransform: 'uppercase',
    opacity: 0.55,
    margin: '12px 0 6px',
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '10px 12px 12px',
        border: '1px solid rgba(148, 163, 184, 0.35)',
        borderRadius: 10,
        background: 'rgba(148, 163, 184, 0.06)',
        color: 'inherit',
        fontFamily: 'inherit',
        fontSize: 11.5,
        minWidth: 232,
        maxWidth: 360,
        boxSizing: 'border-box',
      }}
      role="group"
      aria-label={t('图谱显示选项')}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        <span>{t('图谱显示')}</span>
        <span style={{ fontFamily: 'monospace', fontSize: 9.5, opacity: 0.5 }}>
          {resolved.hiddenFeatureTypes.length > 0
            ? `${resolved.hiddenFeatureTypes.length} hidden`
            : 'all types'}
        </span>
      </div>

      <div style={sectionTitle}>{t('图层')}</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: '3px 12px',
        }}
      >
        {toggleRow(t('特征'), resolved.showFeatures, (next) => patch({ showFeatures: next }))}
        {toggleRow(t('酶'), resolved.showEnzymes, (next) => patch({ showEnzymes: next }))}
        {toggleRow(t('引物'), resolved.showPrimers, (next) => patch({ showPrimers: next }))}
        {toggleRow(t('ORF'), resolved.showOrfs, (next) => patch({ showOrfs: next }))}
        {toggleRow(t('特征标签'), resolved.showFeatureLabels, (next) =>
          patch({ showFeatureLabels: next }),
        )}
        {toggleRow(t('酶标签'), resolved.showEnzymeLabels, (next) =>
          patch({ showEnzymeLabels: next }),
        )}
        {toggleRow(t('刻度线'), resolved.showTicks, (next) => patch({ showTicks: next }))}
        {toggleRow(t('GC 曲线'), resolved.showGcPlot, (next) => patch({ showGcPlot: next }))}
        {toggleRow('Sticky ends', resolved.showLinearEnds, (next) =>
          patch({ showLinearEnds: next }),
        )}
        {toggleRow(t('长度标记'), resolved.showLength, (next) => patch({ showLength: next }))}
      </div>

      <div style={sectionTitle}>{t('文字')}</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
        <span style={{ minWidth: 66 }}>{t('标签字号')}</span>
        <input
          type="range"
          min={MIN_LABEL_FONT_SIZE}
          max={MAX_LABEL_FONT_SIZE}
          step={1}
          value={resolved.labelFontSize}
          onChange={(event) =>
            patch({ labelFontSize: Number(event.currentTarget.value) })
          }
          style={{ flex: 1, accentColor: '#0284c7' }}
        />
        <span style={{ width: 24, textAlign: 'right', fontFamily: 'monospace' }}>
          {resolved.labelFontSize}
        </span>
      </label>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          fontSize: 11,
          marginTop: 5,
        }}
      >
        <span>{t('刻度间隔')}</span>
        <select
          value={String(resolved.tickInterval)}
          onChange={(event) => {
            const raw = event.currentTarget.value;
            patch({ tickInterval: raw === 'auto' ? 'auto' : Number(raw) });
          }}
          style={{
            fontSize: 11,
            padding: '3px 6px',
            borderRadius: 6,
            border: '1px solid rgba(148, 163, 184, 0.45)',
            background: 'transparent',
            color: 'inherit',
            fontFamily: 'inherit',
          }}
        >
          {TICK_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          {!TICK_OPTIONS.some(
            (option) => option.value === String(resolved.tickInterval),
          ) ? (
            <option value={String(resolved.tickInterval)}>
              {resolved.tickInterval} bp
            </option>
          ) : null}
        </select>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
        <span style={{ fontSize: 11 }}>{t('自定义标题')}</span>
        <input
          type="text"
          value={resolved.title}
          placeholder={t('默认用文档名')}
          onChange={(event) => patch({ title: event.currentTarget.value })}
          style={{
            fontSize: 11,
            padding: '4px 7px',
            borderRadius: 6,
            border: '1px solid rgba(148, 163, 184, 0.45)',
            background: 'transparent',
            color: 'inherit',
            fontFamily: 'inherit',
          }}
        />
      </label>

      {featureTypes.length > 0 ? (
        <>
          <div style={sectionTitle}>{t('特征类型')}</div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px 6px',
              maxHeight: 116,
              overflowY: 'auto',
            }}
          >
            {featureTypes.map((type) => {
              const hidden = resolved.hiddenFeatureTypes.includes(type);
              return (
                <label
                  key={type}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 7px 2px 5px',
                    borderRadius: 99,
                    border: `1px solid ${hidden ? 'rgba(148, 163, 184, 0.3)' : 'rgba(2, 132, 199, 0.45)'}`,
                    background: hidden ? 'transparent' : 'rgba(2, 132, 199, 0.10)',
                    fontSize: 10.5,
                    cursor: 'pointer',
                    opacity: hidden ? 0.55 : 1,
                    textDecoration: hidden ? 'line-through' : 'none',
                    whiteSpace: 'nowrap',
                  }}
                  title={hidden ? `Show ${type}` : `Hide ${type}`}
                >
                  <input
                    type="checkbox"
                    checked={!hidden}
                    onChange={(event) => setHiddenType(type, !event.currentTarget.checked)}
                    style={{ display: 'none' }}
                  />
                  {type}
                </label>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
