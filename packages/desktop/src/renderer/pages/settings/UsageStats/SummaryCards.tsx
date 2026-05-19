/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Card, Grid } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { UsageByAgent } from '@/common/types/agentUsage';

const fmt = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

const SummaryCards: React.FC<{ byAgent: UsageByAgent[] }> = ({ byAgent }) => {
  const { t } = useTranslation();
  return (
    <Grid.Row gutter={16} style={{ marginBottom: 16 }}>
      {byAgent.map((a) => (
        <Grid.Col span={12} key={a.agent}>
          <Card title={a.agent} bordered>
            <div>
              {t('usageStats.summary.sessions')}: {a.sessions} · {t('usageStats.summary.messages')}: {a.messages}
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, margin: '8px 0' }}>
              {t('usageStats.summary.totalTokens')}: {fmt(a.totalTokens)}
            </div>
            <div style={{ color: 'var(--color-text-3)' }}>
              {t('usageStats.summary.input')} {fmt(a.inputTokens)} · {t('usageStats.summary.output')}{' '}
              {fmt(a.outputTokens)} · {t('usageStats.summary.cacheRead')} {fmt(a.cacheReadTokens)} ·{' '}
              {t('usageStats.summary.cacheCreation')} {fmt(a.cacheCreationTokens)}
            </div>
          </Card>
        </Grid.Col>
      ))}
    </Grid.Row>
  );
};

export default SummaryCards;
