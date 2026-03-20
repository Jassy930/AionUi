/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TOrganization } from '@/common/types/organization';

type OrganizationControlTowerProps = {
  organization: TOrganization;
  selectedViewLabel: string;
  pendingGovernanceCount: number;
  onCreateTask: () => void;
  onStartRun: () => void;
  onExecuteEval: () => void;
  onPromoteMemory: () => void;
  onProposePatch: () => void;
  children?: React.ReactNode;
};

const OrganizationControlTower: React.FC<OrganizationControlTowerProps> = ({
  organization,
  selectedViewLabel,
  pendingGovernanceCount,
  onCreateTask,
  onStartRun,
  onExecuteEval,
  onPromoteMemory,
  onProposePatch,
  children,
}) => {
  const { t } = useTranslation();

  return (
    <aside className='organization-console__tower'>
      <section className='organization-console__tower-card'>
        <h3 className='organization-console__tower-title'>
          {t('project.console.tower.aiTitle', { defaultValue: 'Organization AI' })}
        </h3>
        <div className='organization-console__tower-body'>
          {children || (
            <p className='organization-console__tower-text'>
              {t('project.console.tower.aiPlaceholder', {
                defaultValue: 'Organization-level control conversation will be connected in the next iteration.',
              })}
            </p>
          )}
        </div>
      </section>

      <section className='organization-console__tower-card'>
        <h3 className='organization-console__tower-title'>
          {t('project.console.tower.actionsTitle', { defaultValue: 'Structured Actions' })}
        </h3>
        <div className='organization-console__action-list'>
          <button type='button' className='organization-console__action' onClick={onCreateTask}>
            {t('project.console.actions.createTask', { defaultValue: 'Create Task Contract' })}
          </button>
          <button type='button' className='organization-console__action' onClick={onStartRun}>
            {t('project.console.actions.startRun', { defaultValue: 'Start Run' })}
          </button>
          <button type='button' className='organization-console__action' onClick={onExecuteEval}>
            {t('project.console.actions.executeEval', { defaultValue: 'Execute Eval' })}
          </button>
          <button type='button' className='organization-console__action' onClick={onPromoteMemory}>
            {t('project.console.actions.promoteMemory', { defaultValue: 'Promote Memory' })}
          </button>
          <button type='button' className='organization-console__action' onClick={onProposePatch}>
            {t('project.console.actions.proposePatch', { defaultValue: 'Propose Patch' })}
          </button>
        </div>
      </section>

      <section className='organization-console__tower-card'>
        <h3 className='organization-console__tower-title'>
          {t('project.console.tower.inspectorTitle', { defaultValue: 'Object Inspector' })}
        </h3>
        <dl className='organization-console__inspector'>
          <div>
            <dt>{t('project.console.tower.inspector.organization', { defaultValue: 'Organization' })}</dt>
            <dd>{organization.name}</dd>
          </div>
          <div>
            <dt>{t('project.console.tower.inspector.workspace', { defaultValue: 'Workspace' })}</dt>
            <dd>{organization.workspace}</dd>
          </div>
          <div>
            <dt>{t('project.console.tower.inspector.currentView', { defaultValue: 'Current View' })}</dt>
            <dd>{selectedViewLabel}</dd>
          </div>
          <div>
            <dt>{t('project.console.tower.inspector.pendingGovernance', { defaultValue: 'Pending Governance' })}</dt>
            <dd>{pendingGovernanceCount}</dd>
          </div>
        </dl>
      </section>
    </aside>
  );
};

export default OrganizationControlTower;
