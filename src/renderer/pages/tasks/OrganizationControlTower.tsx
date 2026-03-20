/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { TOrganization } from '@/common/types/organization';

type OrganizationControlTowerProps = {
  organization: TOrganization;
  selectedViewLabel: string;
  pendingGovernanceCount: number;
  children?: React.ReactNode;
};

const OrganizationControlTower: React.FC<OrganizationControlTowerProps> = ({
  organization,
  selectedViewLabel,
  pendingGovernanceCount,
  children,
}) => {
  return (
    <aside className='organization-console__tower'>
      <section className='organization-console__tower-card'>
        <h3 className='organization-console__tower-title'>Organization AI</h3>
        <div className='organization-console__tower-body'>
          {children || (
            <p className='organization-console__tower-text'>
              Organization-level control conversation will be connected in the next iteration.
            </p>
          )}
        </div>
      </section>

      <section className='organization-console__tower-card'>
        <h3 className='organization-console__tower-title'>Structured Actions</h3>
        <div className='organization-console__action-list'>
          <button type='button' className='organization-console__action'>
            Create Task Contract
          </button>
          <button type='button' className='organization-console__action'>
            Start Run
          </button>
          <button type='button' className='organization-console__action'>
            Execute Eval
          </button>
          <button type='button' className='organization-console__action'>
            Propose Patch
          </button>
        </div>
      </section>

      <section className='organization-console__tower-card'>
        <h3 className='organization-console__tower-title'>Object Inspector</h3>
        <dl className='organization-console__inspector'>
          <div>
            <dt>Organization</dt>
            <dd>{organization.name}</dd>
          </div>
          <div>
            <dt>Workspace</dt>
            <dd>{organization.workspace}</dd>
          </div>
          <div>
            <dt>Current View</dt>
            <dd>{selectedViewLabel}</dd>
          </div>
          <div>
            <dt>Pending Governance</dt>
            <dd>{pendingGovernanceCount}</dd>
          </div>
        </dl>
      </section>
    </aside>
  );
};

export default OrganizationControlTower;
