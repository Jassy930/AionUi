/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Card } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { TrendPoint } from '@/common/types/agentUsage';

const TrendChart: React.FC<{ points: TrendPoint[] }> = ({ points }) => {
  const { t } = useTranslation();
  const max = Math.max(1, ...points.map((p) => Object.values(p.byAgent).reduce((s, v) => s + v, 0)));
  return (
    <Card title={t('usageStats.trend.title')} bordered style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160, overflowX: 'auto' }}>
        {points.map((p) => {
          const total = Object.values(p.byAgent).reduce((s, v) => s + v, 0);
          // Linear scale, but clamp to a minimum visible height when there is
          // any usage — token volumes vary by orders of magnitude (cache
          // tokens can spike a single day into the hundreds of millions), so
          // an unclamped linear bar renders normal days as sub-pixel slivers.
          const barHeight = total > 0 ? Math.max((total / max) * 130, 4) : 0;
          return (
            <div key={p.bucket} style={{ textAlign: 'center', minWidth: 28 }}>
              <div
                title={`${p.bucket}: ${total}`}
                style={{
                  height: `${barHeight}px`,
                  background: 'var(--primary)',
                  borderRadius: 2,
                }}
              />
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4, whiteSpace: 'nowrap' }}>
                {p.bucket.slice(5)}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

export default TrendChart;
