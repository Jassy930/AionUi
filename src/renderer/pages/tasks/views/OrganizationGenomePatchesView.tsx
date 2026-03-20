/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Empty } from '@arco-design/web-react';
import type { TOrgGenomePatch } from '@/common/types/organization';

type OrganizationGenomePatchesViewProps = {
  genomePatches: TOrgGenomePatch[];
  emptyDescription?: string;
};

const OrganizationGenomePatchesView: React.FC<OrganizationGenomePatchesViewProps> = ({
  genomePatches,
  emptyDescription,
}) => {
  const { t } = useTranslation();

  if (!genomePatches.length) {
    return (
      <Empty
        description={
          emptyDescription || t('project.console.empty.genomePatches', { defaultValue: 'No genome patches yet' })
        }
      />
    );
  }

  return (
    <div className='organization-console__list'>
      {genomePatches.map((patch) => (
        <article key={patch.id} className='organization-console__summary-card'>
          <h3>{patch.id}</h3>
          <p>
            {t('project.console.genomePatch.status', {
              defaultValue: 'Status: {{status}}',
              status: patch.status,
            })}
          </p>
        </article>
      ))}
    </div>
  );
};

export default OrganizationGenomePatchesView;
