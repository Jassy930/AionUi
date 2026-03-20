/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Empty } from '@arco-design/web-react';
import type { TOrgMemoryCard } from '@/common/types/organization';

type OrganizationMemoryViewProps = {
  memoryCards: TOrgMemoryCard[];
};

const OrganizationMemoryView: React.FC<OrganizationMemoryViewProps> = ({ memoryCards }) => {
  const { t } = useTranslation();

  if (!memoryCards.length) {
    return <Empty description={t('project.console.empty.memory', { defaultValue: 'No memory cards yet' })} />;
  }

  return (
    <div className='organization-console__list'>
      {memoryCards.map((memoryCard) => (
        <article key={memoryCard.id} className='organization-console__summary-card'>
          <h3>{memoryCard.title}</h3>
          <p>{memoryCard.knowledge_unit}</p>
        </article>
      ))}
    </div>
  );
};

export default OrganizationMemoryView;
