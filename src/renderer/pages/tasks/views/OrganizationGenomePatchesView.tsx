/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Empty } from '@arco-design/web-react';
import type { TOrgGenomePatch } from '@/common/types/organization';

type OrganizationGenomePatchesViewProps = {
  genomePatches: TOrgGenomePatch[];
};

const OrganizationGenomePatchesView: React.FC<OrganizationGenomePatchesViewProps> = ({ genomePatches }) => {
  if (!genomePatches.length) {
    return <Empty description='No genome patches yet' />;
  }

  return (
    <div className='organization-console__list'>
      {genomePatches.map((patch) => (
        <article key={patch.id} className='organization-console__summary-card'>
          <h3>{patch.id}</h3>
          <p>Status: {patch.status}</p>
        </article>
      ))}
    </div>
  );
};

export default OrganizationGenomePatchesView;
