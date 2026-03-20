/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

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
  return (
    <div className='organization-console__overview'>
      <div className='organization-console__stats'>
        <article className='organization-console__stat-card'>
          <span className='organization-console__stat-label'>Tasks</span>
          <strong className='organization-console__stat-value'>{tasksCount}</strong>
        </article>
        <article className='organization-console__stat-card'>
          <span className='organization-console__stat-label'>Runs</span>
          <strong className='organization-console__stat-value'>{runsCount}</strong>
        </article>
        <article className='organization-console__stat-card'>
          <span className='organization-console__stat-label'>Artifacts</span>
          <strong className='organization-console__stat-value'>{artifactsCount}</strong>
        </article>
        <article className='organization-console__stat-card'>
          <span className='organization-console__stat-label'>Pending Governance</span>
          <strong className='organization-console__stat-value'>{pendingGovernanceCount}</strong>
        </article>
      </div>
      <div className='organization-console__summary-card'>
        <h3>Control Loop</h3>
        <p>Task Contract -&gt; Run -&gt; Artifact -&gt; Eval -&gt; MemoryCard -&gt; GenomePatch -&gt; Governance</p>
      </div>
    </div>
  );
};

export default OrganizationOverviewView;
