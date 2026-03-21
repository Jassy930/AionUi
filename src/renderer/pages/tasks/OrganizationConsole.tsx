/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Empty, Message } from '@arco-design/web-react';
import { Left } from '@icon-park/react';
import { ipcBridge } from '@/common';
import type {
  TOrganization,
  TOrgArtifact,
  TOrgEvalSpec,
  TOrgGenomePatch,
  TOrgMemoryCard,
  TOrgRun,
  TOrgSkill,
  TOrgTask,
} from '@/common/types/organization';
import { getLastDirectoryName } from '@/renderer/utils/workspace';
import OrganizationControlTower from './OrganizationControlTower';
import OrganizationConversationPanel from './OrganizationConversationPanel';
import OrganizationNavigator, { type OrganizationConsoleView, type OrganizationNavItem } from './OrganizationNavigator';
import OrganizationArtifactsView from './views/OrganizationArtifactsView';
import OrganizationEvalSpecsView from './views/OrganizationEvalSpecsView';
import OrganizationGenomePatchesView from './views/OrganizationGenomePatchesView';
import OrganizationMemoryView from './views/OrganizationMemoryView';
import OrganizationOverviewView from './views/OrganizationOverviewView';
import OrganizationRunsView from './views/OrganizationRunsView';
import OrganizationSkillsView from './views/OrganizationSkillsView';
import OrganizationTasksView from './views/OrganizationTasksView';

type OrganizationConsoleProps = {
  organization: TOrganization;
  tasks: TOrgTask[];
  runs: TOrgRun[];
  artifacts: TOrgArtifact[];
  memoryCards: TOrgMemoryCard[];
  evalSpecs: TOrgEvalSpec[];
  skills: TOrgSkill[];
  genomePatches: TOrgGenomePatch[];
  pendingGovernanceCount: number;
  onBack: () => void;
  onRefresh: () => Promise<void> | void;
};

const OrganizationConsole: React.FC<OrganizationConsoleProps> = ({
  organization,
  tasks,
  runs,
  artifacts,
  memoryCards,
  evalSpecs,
  skills,
  genomePatches,
  pendingGovernanceCount,
  onBack,
  onRefresh,
}) => {
  const { t } = useTranslation();
  const [activeView, setActiveView] = useState<OrganizationConsoleView>('overview');

  const navItems = useMemo<OrganizationNavItem[]>(
    () => [
      { id: 'overview', label: t('project.console.nav.overview', { defaultValue: 'Overview' }) },
      { id: 'tasks', label: t('project.console.nav.tasks', { defaultValue: 'Task Contracts' }), count: tasks.length },
      { id: 'runs', label: t('project.console.nav.runs', { defaultValue: 'Runs' }), count: runs.length },
      {
        id: 'artifacts',
        label: t('project.console.nav.artifacts', { defaultValue: 'Artifacts' }),
        count: artifacts.length,
      },
      { id: 'memory', label: t('project.console.nav.memory', { defaultValue: 'Memory' }), count: memoryCards.length },
      {
        id: 'eval_specs',
        label: t('project.console.nav.evalSpecs', { defaultValue: 'Eval Specs' }),
        count: evalSpecs.length,
      },
      { id: 'skills', label: t('project.console.nav.skills', { defaultValue: 'Skills' }), count: skills.length },
      {
        id: 'genome_patches',
        label: t('project.console.nav.genomePatches', { defaultValue: 'Genome Patches' }),
        count: genomePatches.length,
      },
      {
        id: 'governance',
        label: t('project.console.nav.governance', { defaultValue: 'Governance' }),
        count: pendingGovernanceCount,
      },
    ],
    [
      artifacts.length,
      evalSpecs.length,
      genomePatches.length,
      memoryCards.length,
      pendingGovernanceCount,
      runs.length,
      skills.length,
      tasks.length,
      t,
    ]
  );

  const selectedViewLabel =
    navItems.find((item) => item.id === activeView)?.label ||
    t('project.console.nav.overview', { defaultValue: 'Overview' });

  const handleCreateTask = async () => {
    const result = await ipcBridge.org.task.create.invoke({
      organization_id: organization.id,
      title: `Task Contract ${tasks.length + 1}`,
      objective: `Advance ${organization.name} console flow`,
      scope: ['src/renderer/pages/tasks'],
      done_criteria: ['Object view visible', 'Control action reachable'],
      budget: { max_runs: 3 },
      risk_tier: 'normal',
      validators: [],
      deliverable_schema: { type: 'object' },
    });
    if (!result.success) {
      Message.error(
        result.msg || t('project.console.messages.createTaskFailed', { defaultValue: 'Failed to create task' })
      );
      return;
    }
    await onRefresh();
  };

  const handleStartRun = async () => {
    const task = tasks[0];
    if (!task) {
      Message.warning(t('project.console.messages.noTaskAvailable', { defaultValue: 'No task contract available' }));
      return;
    }

    const result = await ipcBridge.org.run.start.invoke({
      task_id: task.id,
      workspace: {
        mode: 'isolated',
        type: 'worktree',
        path: `${organization.workspace}/runs/${task.id}`,
      },
      environment: {
        kind: 'cloud',
        env_id: 'org-ui-console',
      },
    });
    if (!result.success) {
      Message.error(
        result.msg || t('project.console.messages.startRunFailed', { defaultValue: 'Failed to start run' })
      );
      return;
    }
    await onRefresh();
  };

  const handleExecuteEval = async () => {
    const task = tasks[0];
    const run = runs[0];
    const evalSpec = evalSpecs[0];
    if (!task || !run || !evalSpec) {
      Message.warning(
        t('project.console.messages.missingEvalRequirements', {
          defaultValue: 'Task, run, and eval spec are required',
        })
      );
      return;
    }

    const result = await ipcBridge.org.eval.execute.invoke({
      task_id: task.id,
      run_id: run.id,
      eval_spec_id: evalSpec.id,
    });
    if (!result.success) {
      Message.error(
        result.msg || t('project.console.messages.executeEvalFailed', { defaultValue: 'Failed to execute eval' })
      );
      return;
    }
    await onRefresh();
  };

  const handlePromoteMemory = async () => {
    const run = runs[0];
    if (!run) {
      Message.warning(t('project.console.messages.noRunAvailable', { defaultValue: 'No run available' }));
      return;
    }

    const primaryArtifact = artifacts[0];
    const result = await ipcBridge.org.memory.promote.invoke({
      organization_id: organization.id,
      type: 'workflow_hint',
      title: t('project.console.messages.promoteMemoryTitle', {
        defaultValue: 'Memory from {{runId}}',
        runId: run.id,
      }),
      knowledge_unit:
        primaryArtifact?.summary ||
        t('project.console.messages.promoteMemoryKnowledgeFallback', {
          defaultValue: 'Capture the latest run learning for future reuse.',
        }),
      traceability: {
        source_run_ids: [run.id],
        source_artifact_ids: primaryArtifact ? [primaryArtifact.id] : undefined,
      },
      tags: ['organization-console'],
    });
    if (!result.success) {
      Message.error(
        result.msg || t('project.console.messages.promoteMemoryFailed', { defaultValue: 'Failed to promote memory' })
      );
      return;
    }
    await onRefresh();
  };

  const handleProposePatch = async () => {
    const run = runs[0];
    if (!run) {
      Message.warning(t('project.console.messages.noRunAvailable', { defaultValue: 'No run available' }));
      return;
    }

    const result = await ipcBridge.org.evolution.propose.invoke({
      organization_id: organization.id,
      mutation_target: 'skill',
      based_on: [run.id],
      proposal: {
        skill_name: skills[0]?.name || 'organization-console-skill',
        change_type: 'update',
      },
    });
    if (!result.success) {
      Message.error(
        result.msg || t('project.console.messages.proposePatchFailed', { defaultValue: 'Failed to propose patch' })
      );
      return;
    }
    await onRefresh();
  };

  const renderViewContent = () => {
    switch (activeView) {
      case 'overview':
        return (
          <OrganizationOverviewView
            tasksCount={tasks.length}
            runsCount={runs.length}
            artifactsCount={artifacts.length}
            pendingGovernanceCount={pendingGovernanceCount}
          />
        );
      case 'tasks':
        return <OrganizationTasksView tasks={tasks} />;
      case 'runs':
        return <OrganizationRunsView runs={runs} />;
      case 'artifacts':
        return <OrganizationArtifactsView artifacts={artifacts} />;
      case 'memory':
        return <OrganizationMemoryView memoryCards={memoryCards} />;
      case 'eval_specs':
        return <OrganizationEvalSpecsView evalSpecs={evalSpecs} />;
      case 'skills':
        return <OrganizationSkillsView skills={skills} />;
      case 'genome_patches':
        return <OrganizationGenomePatchesView genomePatches={genomePatches} />;
      case 'governance':
        return (
          <OrganizationGenomePatchesView
            genomePatches={genomePatches.filter((patch) => patch.status !== 'adopted' && patch.status !== 'rejected')}
            emptyDescription={t('project.console.empty.governance', { defaultValue: 'No pending governance items' })}
          />
        );
      default:
        return <Empty />;
    }
  };

  return (
    <div className='organization-console'>
      <aside className='organization-console__sidebar'>
        <Button
          type='text'
          className='organization-console__back'
          icon={<Left theme='outline' size={16} />}
          onClick={onBack}
        >
          {t('project.console.back', { defaultValue: 'Back' })}
        </Button>
        <div className='organization-console__org-card'>
          <span className='organization-console__eyebrow'>
            {t('project.console.organizationEyebrow', { defaultValue: 'Organization' })}
          </span>
          <h1 className='organization-console__title'>{organization.name}</h1>
          {organization.description ? (
            <p className='organization-console__description'>{organization.description}</p>
          ) : null}
          <span className='organization-console__workspace'>{getLastDirectoryName(organization.workspace)}</span>
        </div>
        <OrganizationNavigator items={navItems} activeView={activeView} onSelect={setActiveView} />
      </aside>

      <main className='organization-console__main'>
        <header className='organization-console__main-header'>
          <span className='organization-console__eyebrow'>
            {t('project.console.mainEyebrow', { defaultValue: 'Organization Console' })}
          </span>
          <h2 className='organization-console__main-title'>{selectedViewLabel}</h2>
        </header>
        <section className='organization-console__content'>{renderViewContent()}</section>
        <section className='organization-console__footer'>
          <section className='organization-console__main-card'>
            <h3 className='organization-console__section-title'>
              {t('project.console.tower.actionsTitle', { defaultValue: 'Structured Actions' })}
            </h3>
            <div className='organization-console__action-list'>
              <button type='button' className='organization-console__action' onClick={handleCreateTask}>
                {t('project.console.actions.createTask', { defaultValue: 'Create Task Contract' })}
              </button>
              <button type='button' className='organization-console__action' onClick={handleStartRun}>
                {t('project.console.actions.startRun', { defaultValue: 'Start Run' })}
              </button>
              <button type='button' className='organization-console__action' onClick={handleExecuteEval}>
                {t('project.console.actions.executeEval', { defaultValue: 'Execute Eval' })}
              </button>
              <button type='button' className='organization-console__action' onClick={handlePromoteMemory}>
                {t('project.console.actions.promoteMemory', { defaultValue: 'Promote Memory' })}
              </button>
              <button type='button' className='organization-console__action' onClick={handleProposePatch}>
                {t('project.console.actions.proposePatch', { defaultValue: 'Propose Patch' })}
              </button>
            </div>
          </section>

          <section className='organization-console__main-card'>
            <h3 className='organization-console__section-title'>
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
                <dt>
                  {t('project.console.tower.inspector.pendingGovernance', { defaultValue: 'Pending Governance' })}
                </dt>
                <dd>{pendingGovernanceCount}</dd>
              </div>
            </dl>
          </section>
        </section>
      </main>

      <OrganizationControlTower>
        <OrganizationConversationPanel organization={organization} />
      </OrganizationControlTower>
    </div>
  );
};

export default OrganizationConsole;
