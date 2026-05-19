/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Card, Table, Button } from '@arco-design/web-react';
import type { ColumnProps } from '@arco-design/web-react/es/Table';
import { useTranslation } from 'react-i18next';
import type { SessionRow } from '@/common/types/agentUsage';

const SessionList: React.FC<{
  rows: SessionRow[];
  total: number;
  hasMore: boolean;
  onLoadMore: () => void;
}> = ({ rows, total, hasMore, onLoadMore }) => {
  const { t } = useTranslation();
  const columns: ColumnProps<SessionRow>[] = [
    {
      title: t('usageStats.sessions.time'),
      dataIndex: 'lastActiveAt',
      render: (v: string) => v.replace('T', ' ').slice(0, 16),
    },
    { title: t('usageStats.sessions.agent'), dataIndex: 'agent' },
    { title: t('usageStats.sessions.model'), dataIndex: 'model' },
    { title: t('usageStats.sessions.project'), dataIndex: 'project', ellipsis: true },
    { title: t('usageStats.sessions.tokens'), dataIndex: 'totalTokens' },
  ];
  return (
    <Card title={`${t('usageStats.sessions.title')} · ${t('usageStats.sessions.total', { count: total })}`} bordered>
      <Table rowKey='sessionId' columns={columns} data={rows} pagination={false} scroll={{ y: 360 }} virtualized />
      {hasMore && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Button onClick={onLoadMore}>{t('usageStats.sessions.loadMore')}</Button>
        </div>
      )}
    </Card>
  );
};

export default SessionList;
