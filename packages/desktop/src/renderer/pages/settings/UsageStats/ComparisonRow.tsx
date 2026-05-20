/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Card, Grid } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { AgentUsageResponse } from '@/common/types/agentUsage';
import CompositionDonut from './CompositionDonut';
import RankBar from './RankBar';
import { SEGMENT_PALETTE } from './Sparkline';
import { topN, formatTokens, pct } from './chartMath';

const ComparisonRow: React.FC<{ data: AgentUsageResponse }> = ({ data }) => {
  const { t } = useTranslation();
  const agentSegs = data.summary.byAgent.map((x, i) => ({
    name: x.agent,
    value: x.totalTokens,
    color: SEGMENT_PALETTE[i % SEGMENT_PALETTE.length],
  }));
  const grandTotal = data.summary.byAgent.reduce((s, x) => s + x.totalTokens, 0);
  const fmtTotal = formatTokens(grandTotal);

  // by_project / by_model 后端按 (agent, X) 聚合，同名跨工具会有多条 — id 用复合 key 防 React 冲突，tag 显示工具来源
  const projRows = topN(data.byProject, (p) => p.totalTokens, 8).map((p) => ({
    id: `${p.agent}/${p.project}`,
    label: p.project,
    value: p.totalTokens,
    tag: p.agent,
  }));
  const modelRows = topN(data.byModel, (m) => m.totalTokens, 8).map((m) => ({
    id: `${m.agent}/${m.model}`,
    label: m.model,
    value: m.totalTokens,
    tag: m.agent,
  }));

  return (
    <Grid.Row gutter={12} style={{ marginBottom: 16 }}>
      <Grid.Col span={8}>
        <Card title={t('usageStats.comparison.title')} bordered>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
            <CompositionDonut
              segments={agentSegs}
              centerLabel={fmtTotal}
              centerSub={t('usageStats.composition.unit')}
            />
            <div style={{ fontSize: 12, lineHeight: 1.9 }}>
              {agentSegs.map((s) => (
                <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: s.color }}
                  />
                  <span>{s.name}</span>
                  <span style={{ color: 'var(--text-secondary, #86909c)' }}>
                    {formatTokens(s.value)} ({pct(s.value, grandTotal).toFixed(0)}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </Grid.Col>
      <Grid.Col span={8}>
        <Card title={t('usageStats.comparison.projectsTitle')} bordered>
          <RankBar rows={projRows} />
        </Card>
      </Grid.Col>
      <Grid.Col span={8}>
        <Card title={t('usageStats.comparison.modelsTitle')} bordered>
          <RankBar rows={modelRows} />
        </Card>
      </Grid.Col>
    </Grid.Row>
  );
};

export default ComparisonRow;
