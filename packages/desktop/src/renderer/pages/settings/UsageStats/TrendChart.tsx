/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Card, Radio, Tooltip } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { TrendPoint } from '@/common/types/agentUsage';
import { SEGMENT_PALETTE } from './Sparkline';
import { cumulative } from './chartMath';

const TrendChart: React.FC<{ points: TrendPoint[]; perPointLabel: string }> = ({ points, perPointLabel }) => {
  const { t } = useTranslation();
  const [mode, setMode] = React.useState<'split' | 'cumulative'>('split');
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());

  const allSegments = React.useMemo(() => {
    const set = new Set<string>();
    for (const p of points) for (const k of Object.keys(p.bySegment)) set.add(k);
    return Array.from(set).toSorted();
  }, [points]);

  const colorOf = React.useMemo(
    () => new Map(allSegments.map((n, i) => [n, SEGMENT_PALETTE[i % SEGMENT_PALETTE.length]])),
    [allSegments]
  );

  // 每桶（应用 hidden 过滤后）总量序列；累计模式做前缀和
  const totalsRaw = points.map((p) =>
    Object.entries(p.bySegment)
      .filter(([k]) => !hidden.has(k))
      .reduce((s, [, v]) => s + v, 0)
  );
  const totals = mode === 'cumulative' ? cumulative(totalsRaw) : totalsRaw;
  const max = Math.max(1, ...totals);

  if (points.length === 0) {
    return (
      <Card title={t('usageStats.trend.title')} bordered style={{ marginBottom: 16 }}>
        <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-secondary, #86909c)', fontSize: 13 }}>—</span>
        </div>
      </Card>
    );
  }

  return (
    <Card title={t('usageStats.trend.title')} bordered style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Radio.Group
          type='button'
          size='small'
          value={mode}
          onChange={(v: string) => setMode(v as 'split' | 'cumulative')}
        >
          <Radio value='split'>{t('usageStats.trendCtl.split')}</Radio>
          <Radio value='cumulative'>{t('usageStats.trendCtl.cumulative')}</Radio>
        </Radio.Group>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-secondary, #86909c)' }}>
          {perPointLabel}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160, overflowX: 'auto' }}>
        {points.map((p, idx) => {
          const segs = Object.entries(p.bySegment)
            .filter(([k]) => !hidden.has(k))
            .toSorted(([, x], [, y]) => y - x);
          const totalHere = totals[idx];
          const barHeight = totalHere > 0 ? Math.max((totalHere / max) * 130, 4) : 0;
          const rawTotal = totalsRaw[idx];
          // hover 详情: 日期 + 各 series 分量 + 总量 (Arco Tooltip, 多行 JSX)
          const tooltipContent = (
            <div style={{ fontSize: 12, lineHeight: 1.7, minWidth: 140 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{p.bucket}</div>
              {segs.map(([name, val]) => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                  <span>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: colorOf.get(name),
                        marginRight: 6,
                      }}
                    />
                    {name}
                  </span>
                  <span>{val.toLocaleString()}</span>
                </div>
              ))}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 16,
                  marginTop: 4,
                  paddingTop: 4,
                  borderTop: '1px solid rgba(255,255,255,0.2)',
                  fontWeight: 600,
                }}
              >
                <span>{t('usageStats.kpi.totalTokens')}</span>
                <span>{rawTotal.toLocaleString()}</span>
              </div>
            </div>
          );
          return (
            <Tooltip key={p.bucket} content={tooltipContent} position='top'>
              <div style={{ textAlign: 'center', minWidth: 28, cursor: 'default' }}>
                <div
                  style={{
                    height: `${barHeight}px`,
                    display: 'flex',
                    flexDirection: 'column-reverse',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}
                >
                  {segs.map(([name, val]) => {
                    const frac = rawTotal > 0 ? val / rawTotal : 0;
                    return (
                      <div
                        key={name}
                        style={{ height: `${frac * barHeight}px`, background: colorOf.get(name), flexShrink: 0 }}
                      />
                    );
                  })}
                </div>
                <div
                  style={{ fontSize: 10, color: 'var(--text-secondary, #86909c)', marginTop: 4, whiteSpace: 'nowrap' }}
                >
                  {p.bucket.slice(5)}
                </div>
              </div>
            </Tooltip>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontSize: 11 }}>
        {allSegments.map((name) => {
          const off = hidden.has(name);
          return (
            <span
              key={name}
              onClick={() => {
                setHidden((prev) => {
                  const next = new Set(prev);
                  if (next.has(name)) next.delete(name);
                  else next.add(name);
                  return next;
                });
              }}
              style={{ cursor: 'pointer', opacity: off ? 0.4 : 1, textDecoration: off ? 'line-through' : 'none' }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: colorOf.get(name),
                  marginRight: 4,
                }}
              />
              {name}
            </span>
          );
        })}
      </div>
    </Card>
  );
};

export default TrendChart;
