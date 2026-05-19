/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Spin, Empty, Alert, Button, Radio } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { AgentUsageResponse, AgentUsageParams } from '@/common/types/agentUsage';
import SettingsPageWrapper from '../components/SettingsPageWrapper';
import SourceBanner from './SourceBanner';
import KpiRow from './KpiRow';
import TrendChart from './TrendChart';
import CompositionDonut from './CompositionDonut';
import ComparisonRow from './ComparisonRow';
import SessionList from './SessionList';
import { SEGMENT_PALETTE } from './Sparkline';

const PAGE = 200;

const UsageStats: React.FC = () => {
  const { t } = useTranslation();
  const [data, setData] = useState<AgentUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<'error' | 'unsupported' | null>(null);
  const [gran, setGran] = useState<'day' | 'week'>('day');
  const [range, setRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [dim, setDim] = useState<'agent' | 'project' | 'model'>('agent');
  const [offset, setOffset] = useState(0);

  const load = useCallback(async (params: AgentUsageParams, append: boolean) => {
    setLoading(true);
    setErr(null);
    try {
      const r = await ipcBridge.analytics.getAgentUsage.invoke(params);
      setData((prev) => (append && prev ? { ...r, sessions: [...prev.sessions, ...r.sessions] } : r));
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status;
      setErr(status === 404 ? 'unsupported' : 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setOffset(0);
    void load(
      { trendGranularity: gran, timeRange: range, trendDimension: dim, sessionsLimit: PAGE, sessionsOffset: 0 },
      false
    );
  }, [gran, range, dim, load]);

  const refresh = () => {
    setOffset(0);
    void load(
      {
        trendGranularity: gran,
        timeRange: range,
        trendDimension: dim,
        refresh: true,
        sessionsLimit: PAGE,
        sessionsOffset: 0,
      },
      false
    );
  };

  const loadMore = () => {
    const next = offset + PAGE;
    setOffset(next);
    void load(
      { trendGranularity: gran, timeRange: range, trendDimension: dim, sessionsLimit: PAGE, sessionsOffset: next },
      true
    );
  };

  const perPointLabel = t('usageStats.trendCtl.perPoint', {
    span: gran === 'week' ? t('usageStats.granularity.week') : t('usageStats.granularity.day'),
  });

  return (
    <SettingsPageWrapper>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Radio.Group type='button' value={range} onChange={(v: string) => setRange(v as '7d' | '30d' | '90d' | 'all')}>
          <Radio value='7d'>{t('usageStats.timeRange.7d')}</Radio>
          <Radio value='30d'>{t('usageStats.timeRange.30d')}</Radio>
          <Radio value='90d'>{t('usageStats.timeRange.90d')}</Radio>
          <Radio value='all'>{t('usageStats.timeRange.all')}</Radio>
        </Radio.Group>
        <Radio.Group type='button' value={gran} onChange={(v: string) => setGran(v as 'day' | 'week')}>
          <Radio value='day'>{t('usageStats.granularity.day')}</Radio>
          <Radio value='week'>{t('usageStats.granularity.week')}</Radio>
        </Radio.Group>
        <span style={{ fontSize: 12, color: 'var(--text-secondary, #86909c)' }}>
          {t('usageStats.trend.dimension.label')}
        </span>
        <Radio.Group type='button' value={dim} onChange={(v: string) => setDim(v as 'agent' | 'project' | 'model')}>
          <Radio value='agent'>{t('usageStats.trend.dimension.agent')}</Radio>
          <Radio value='project'>{t('usageStats.trend.dimension.project')}</Radio>
          <Radio value='model'>{t('usageStats.trend.dimension.model')}</Radio>
        </Radio.Group>
        <Button onClick={refresh} loading={loading}>
          {t('usageStats.refresh')}
        </Button>
      </div>

      {err === 'unsupported' && <Alert type='warning' content={t('usageStats.unsupported')} />}
      {err === 'error' && <Alert type='error' content={t('usageStats.error')} />}
      {loading && !data && <Spin style={{ display: 'block', textAlign: 'center', padding: 48 }} />}

      {data && !err && (
        <>
          <SourceBanner sources={data.sources} />
          {data.summary.byAgent.length === 0 ? (
            <Empty description={t('usageStats.empty')} />
          ) : (
            <>
              <KpiRow data={data} />
              <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 2, minWidth: 320 }}>
                  <TrendChart points={data.trend.points} perPointLabel={perPointLabel} />
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <CompositionDonutCard data={data} />
                </div>
              </div>
              <ComparisonRow data={data} />
              <SessionList
                rows={data.sessions}
                total={data.sessionsTotal}
                hasMore={data.sessions.length < data.sessionsTotal}
                onLoadMore={loadMore}
              />
            </>
          )}
        </>
      )}
    </SettingsPageWrapper>
  );
};

// token 构成环卡片（用 summary 求和的四类 token）
const CompositionDonutCard: React.FC<{ data: AgentUsageResponse }> = ({ data }) => {
  const { t } = useTranslation();
  const a = data.summary.byAgent;
  const inp = a.reduce((s, x) => s + x.inputTokens, 0);
  const out = a.reduce((s, x) => s + x.outputTokens, 0);
  const cr = a.reduce((s, x) => s + x.cacheReadTokens, 0);
  const cc = a.reduce((s, x) => s + x.cacheCreationTokens, 0);
  const total = inp + out + cr + cc;
  const fmtT = total >= 1_000_000 ? `${(total / 1_000_000).toFixed(1)}M` : String(total);
  const segs = [
    { name: t('usageStats.composition.input'), value: inp, color: SEGMENT_PALETTE[0] },
    { name: t('usageStats.composition.output'), value: out, color: SEGMENT_PALETTE[2] },
    { name: t('usageStats.composition.cacheRead'), value: cr, color: SEGMENT_PALETTE[4] },
    { name: t('usageStats.composition.cacheCreation'), value: cc, color: SEGMENT_PALETTE[5] },
  ];
  return (
    <div
      style={{
        border: '1px solid var(--color-border, #e5e6eb)',
        borderRadius: 4,
        padding: 16,
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ fontWeight: 500, marginBottom: 12 }}>{t('usageStats.composition.title')}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <CompositionDonut segments={segs} centerLabel={fmtT} centerSub='tokens' />
        <div style={{ fontSize: 12, lineHeight: 1.9 }}>
          {segs.map((s) => (
            <div key={s.name}>
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: s.color,
                  marginRight: 6,
                }}
              />
              {s.name} {s.value.toLocaleString()}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default UsageStats;
