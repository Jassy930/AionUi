/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Card, Grid } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { AgentUsageResponse } from '@/common/types/agentUsage';
import Sparkline from './Sparkline';
import { pct } from './chartMath';

const fmt = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

const KpiRow: React.FC<{ data: AgentUsageResponse }> = ({ data }) => {
  const { t } = useTranslation();
  const a = data.summary.byAgent;
  const totalTok = a.reduce((s, x) => s + x.totalTokens, 0);
  const sessions = a.reduce((s, x) => s + x.sessions, 0);
  const messages = a.reduce((s, x) => s + x.messages, 0);
  const cacheTok = a.reduce((s, x) => s + x.cacheReadTokens + x.cacheCreationTokens, 0);
  const cacheRatio = pct(cacheTok, totalTok);
  const trendTotals = data.trend.points.map((p) => Object.values(p.bySegment).reduce((s, v) => s + v, 0));

  const cards: { label: string; value: string; spark: number[] }[] = [
    { label: t('usageStats.kpi.totalTokens'), value: fmt(totalTok), spark: trendTotals },
    { label: t('usageStats.kpi.sessions'), value: String(sessions), spark: trendTotals },
    { label: t('usageStats.kpi.messages'), value: String(messages), spark: trendTotals },
    { label: t('usageStats.kpi.cacheRatio'), value: `${cacheRatio.toFixed(0)}%`, spark: trendTotals },
  ];
  return (
    <Grid.Row gutter={12} style={{ marginBottom: 16 }}>
      {cards.map((c) => (
        <Grid.Col span={6} key={c.label}>
          <Card bordered>
            <div style={{ fontSize: 12, color: 'var(--text-secondary, #86909c)' }}>{c.label}</div>
            <div style={{ fontSize: 22, fontWeight: 600, margin: '4px 0' }}>{c.value}</div>
            <Sparkline values={c.spark} />
          </Card>
        </Grid.Col>
      ))}
    </Grid.Row>
  );
};

export default KpiRow;
