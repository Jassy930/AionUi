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
import SummaryCards from './SummaryCards';
import TrendChart from './TrendChart';
import ModelTable from './ModelTable';
import SessionList from './SessionList';

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

  return (
    <SettingsPageWrapper>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
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
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('usageStats.trend.dimension.label')}</span>
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
              <SummaryCards byAgent={data.summary.byAgent} />
              <TrendChart points={data.trend.points} />
              <ModelTable rows={data.byModel} />
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

export default UsageStats;
