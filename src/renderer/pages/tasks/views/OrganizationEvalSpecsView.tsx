/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Empty } from '@arco-design/web-react';
import type { TOrgEvalSpec } from '@/common/types/organization';

type OrganizationEvalSpecsViewProps = {
  evalSpecs: TOrgEvalSpec[];
};

const OrganizationEvalSpecsView: React.FC<OrganizationEvalSpecsViewProps> = ({ evalSpecs }) => {
  if (!evalSpecs.length) {
    return <Empty description='No eval specs yet' />;
  }

  return (
    <div className='organization-console__list'>
      {evalSpecs.map((evalSpec) => (
        <article key={evalSpec.id} className='organization-console__summary-card'>
          <h3>{evalSpec.name}</h3>
          <p>{evalSpec.description || `${evalSpec.test_commands.length} commands`}</p>
        </article>
      ))}
    </div>
  );
};

export default OrganizationEvalSpecsView;
