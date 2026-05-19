/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Card, Table } from '@arco-design/web-react';
import type { ColumnProps } from '@arco-design/web-react/es/Table';
import { useTranslation } from 'react-i18next';
import type { UsageByModel } from '@/common/types/agentUsage';

const ModelTable: React.FC<{ rows: UsageByModel[] }> = ({ rows }) => {
  const { t } = useTranslation();
  const columns: ColumnProps<UsageByModel>[] = [
    { title: t('usageStats.byModel.agent'), dataIndex: 'agent' },
    { title: t('usageStats.byModel.model'), dataIndex: 'model' },
    {
      title: t('usageStats.byModel.sessions'),
      dataIndex: 'sessions',
      sorter: (a: UsageByModel, b: UsageByModel) => a.sessions - b.sessions,
    },
    {
      title: t('usageStats.byModel.tokens'),
      dataIndex: 'totalTokens',
      sorter: (a: UsageByModel, b: UsageByModel) => a.totalTokens - b.totalTokens,
      defaultSortOrder: 'descend' as const,
    },
  ];
  return (
    <Card title={t('usageStats.byModel.title')} bordered style={{ marginBottom: 16 }}>
      <Table rowKey={(r) => `${r.agent}-${r.model}`} columns={columns} data={rows} pagination={false} />
    </Card>
  );
};

export default ModelTable;
