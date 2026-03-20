/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

type OrganizationOverviewViewProps = {
  tasksCount: number;
  runsCount: number;
  artifactsCount: number;
  pendingGovernanceCount: number;
};

const OrganizationOverviewView: React.FC<OrganizationOverviewViewProps> = ({
  tasksCount,
  runsCount,
  artifactsCount,
  pendingGovernanceCount,
}) => {
  const { t } = useTranslation();

  return (
    <div className='organization-console__overview'>
      <div className='organization-console__stats'>
        <article className='organization-console__stat-card'>
          <span className='organization-console__stat-label'>
            {t('project.console.overview.stats.tasks', { defaultValue: 'Task Contracts' })}
          </span>
          <strong className='organization-console__stat-value'>{tasksCount}</strong>
        </article>
        <article className='organization-console__stat-card'>
          <span className='organization-console__stat-label'>
            {t('project.console.overview.stats.runs', { defaultValue: 'Runs' })}
          </span>
          <strong className='organization-console__stat-value'>{runsCount}</strong>
        </article>
        <article className='organization-console__stat-card'>
          <span className='organization-console__stat-label'>
            {t('project.console.overview.stats.artifacts', { defaultValue: 'Artifacts' })}
          </span>
          <strong className='organization-console__stat-value'>{artifactsCount}</strong>
        </article>
        <article className='organization-console__stat-card'>
          <span className='organization-console__stat-label'>
            {t('project.console.overview.stats.pendingGovernance', { defaultValue: 'Pending Governance' })}
          </span>
          <strong className='organization-console__stat-value'>{pendingGovernanceCount}</strong>
        </article>
      </div>
      <div className='organization-console__summary-card'>
        <h3>{t('project.console.overview.controlLoopTitle', { defaultValue: 'Control Loop' })}</h3>
        <p>
          {t('project.console.overview.controlLoopDescription', {
            defaultValue: 'Task Contract -> Run -> Artifact -> Eval -> MemoryCard -> GenomePatch -> Governance',
          })}
        </p>
      </div>
    </div>
  );
};

export default OrganizationOverviewView;
