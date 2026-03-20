/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Empty } from '@arco-design/web-react';
import type { TOrgRun } from '@/common/types/organization';

type OrganizationRunsViewProps = {
  runs: TOrgRun[];
};

const OrganizationRunsView: React.FC<OrganizationRunsViewProps> = ({ runs }) => {
  if (!runs.length) {
    return <Empty description='No runs yet' />;
  }

  return (
    <div className='organization-console__list'>
      {runs.map((run) => (
        <article key={run.id} className='organization-console__summary-card'>
          <h3>{run.id}</h3>
          <p>Status: {run.status}</p>
        </article>
      ))}
    </div>
  );
};

export default OrganizationRunsView;
