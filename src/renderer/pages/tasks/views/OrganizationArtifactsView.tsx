/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Empty } from '@arco-design/web-react';
import type { TOrgArtifact } from '@/common/types/organization';

type OrganizationArtifactsViewProps = {
  artifacts: TOrgArtifact[];
};

const OrganizationArtifactsView: React.FC<OrganizationArtifactsViewProps> = ({ artifacts }) => {
  const { t } = useTranslation();

  if (!artifacts.length) {
    return <Empty description={t('project.console.empty.artifacts', { defaultValue: 'No artifacts yet' })} />;
  }

  return (
    <div className='organization-console__list'>
      {artifacts.map((artifact) => (
        <article key={artifact.id} className='organization-console__summary-card'>
          <h3>{artifact.title}</h3>
          <p>{artifact.summary || artifact.type}</p>
        </article>
      ))}
    </div>
  );
};

export default OrganizationArtifactsView;
