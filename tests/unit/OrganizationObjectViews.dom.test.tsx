/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mockOrgGet = vi.fn();
const mockOrgControlStateGet = vi.fn();
const mockOrgApprovalList = vi.fn();
const mockOrgTaskList = vi.fn();
const mockOrgTaskCreate = vi.fn();
const mockOrgRunList = vi.fn();
const mockOrgRunStart = vi.fn();
const mockOrgArtifactList = vi.fn();
const mockOrgMemoryList = vi.fn();
const mockOrgMemoryPromote = vi.fn();
const mockOrgEvalList = vi.fn();
const mockOrgEvalExecute = vi.fn();
const mockOrgSkillList = vi.fn();
const mockOrgEvolutionList = vi.fn();
const mockOrgEvolutionPropose = vi.fn();
const mockGovernanceListPending = vi.fn();

const translations: Record<string, string> = {
  'project.console.nav.tasks': '任务契约',
  'project.console.nav.runs': '运行实例',
  'project.console.nav.artifacts': '产物',
  'project.console.nav.memory': '组织记忆',
  'project.console.nav.evalSpecs': '评估规范',
  'project.console.nav.skills': '技能',
  'project.console.nav.genomePatches': '基因补丁',
  'project.console.actions.createTask': '创建任务契约',
  'project.console.actions.startRun': '启动运行',
  'project.console.actions.executeEval': '执行评估',
  'project.console.actions.promoteMemory': '提升记忆',
  'project.console.actions.proposePatch': '提交补丁提案',
  'project.console.messages.promoteMemoryTitle': '来自 {{runId}} 的记忆',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; runId?: string }) => {
      if (key === 'project.console.messages.promoteMemoryTitle') {
        return `来自 ${options?.runId ?? ''} 的记忆`;
      }
      return translations[key] || options?.defaultValue || key;
    },
    i18n: { language: 'zh-CN' },
  }),
}));

vi.mock('@icon-park/react', () => ({
  Left: () => <span data-testid='icon-left' />,
  Plus: () => <span data-testid='icon-plus' />,
  Delete: () => <span data-testid='icon-delete' />,
  Edit: () => <span data-testid='icon-edit' />,
  Time: () => <span data-testid='icon-time' />,
  DocumentFolder: () => <span data-testid='icon-document-folder' />,
  FolderOpen: () => <span data-testid='icon-folder-open' />,
}));

vi.mock('@/renderer/context/ProjectModeContext', () => ({
  useProjectMode: () => ({
    enterProjectMode: vi.fn(),
    exitProjectMode: vi.fn(),
  }),
}));

vi.mock('@/renderer/context/LayoutContext', () => ({
  useLayoutContext: () => ({
    siderCollapsed: false,
    setSiderCollapsed: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/tasks/OrganizationConversationPanel', () => ({
  default: () => <div>Organization AI Panel</div>,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    org: {
      organization: {
        get: { invoke: (...args: any[]) => mockOrgGet(...args) },
        getControlState: { invoke: (...args: any[]) => mockOrgControlStateGet(...args) },
        listApprovals: { invoke: (...args: any[]) => mockOrgApprovalList(...args) },
        updated: { on: vi.fn(() => vi.fn()) },
      },
      task: {
        list: { invoke: (...args: any[]) => mockOrgTaskList(...args) },
        create: { invoke: (...args: any[]) => mockOrgTaskCreate(...args) },
        created: { on: vi.fn(() => vi.fn()) },
        updated: { on: vi.fn(() => vi.fn()) },
        deleted: { on: vi.fn(() => vi.fn()) },
        statusChanged: { on: vi.fn(() => vi.fn()) },
      },
      run: {
        list: { invoke: (...args: any[]) => mockOrgRunList(...args) },
        start: { invoke: (...args: any[]) => mockOrgRunStart(...args) },
        created: { on: vi.fn(() => vi.fn()) },
        updated: { on: vi.fn(() => vi.fn()) },
        statusChanged: { on: vi.fn(() => vi.fn()) },
        closed: { on: vi.fn(() => vi.fn()) },
      },
      artifact: {
        list: { invoke: (...args: any[]) => mockOrgArtifactList(...args) },
        created: { on: vi.fn(() => vi.fn()) },
        updated: { on: vi.fn(() => vi.fn()) },
        deleted: { on: vi.fn(() => vi.fn()) },
      },
      memory: {
        list: { invoke: (...args: any[]) => mockOrgMemoryList(...args) },
        promote: { invoke: (...args: any[]) => mockOrgMemoryPromote(...args) },
        promoted: { on: vi.fn(() => vi.fn()) },
        updated: { on: vi.fn(() => vi.fn()) },
        deleted: { on: vi.fn(() => vi.fn()) },
      },
      eval: {
        list: { invoke: (...args: any[]) => mockOrgEvalList(...args) },
        execute: { invoke: (...args: any[]) => mockOrgEvalExecute(...args) },
        created: { on: vi.fn(() => vi.fn()) },
        updated: { on: vi.fn(() => vi.fn()) },
        deleted: { on: vi.fn(() => vi.fn()) },
      },
      skill: {
        list: { invoke: (...args: any[]) => mockOrgSkillList(...args) },
        created: { on: vi.fn(() => vi.fn()) },
        updated: { on: vi.fn(() => vi.fn()) },
        deleted: { on: vi.fn(() => vi.fn()) },
      },
      evolution: {
        list: { invoke: (...args: any[]) => mockOrgEvolutionList(...args) },
        propose: { invoke: (...args: any[]) => mockOrgEvolutionPropose(...args) },
        proposed: { on: vi.fn(() => vi.fn()) },
        statusChanged: { on: vi.fn(() => vi.fn()) },
        adopted: { on: vi.fn(() => vi.fn()) },
        rejected: { on: vi.fn(() => vi.fn()) },
      },
      governance: {
        listPending: { invoke: (...args: any[]) => mockGovernanceListPending(...args) },
      },
    },
  },
}));

import ProjectDetail from '@/renderer/pages/tasks/ProjectDetail';

describe('Organization Object Views', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const now = Date.now();
    mockOrgGet.mockResolvedValue({
      success: true,
      data: {
        id: 'org_alpha',
        name: 'Organization Alpha',
        description: 'Organization workspace',
        workspace: '/tmp/org-alpha',
        user_id: 'system_default_user',
        created_at: now,
        updated_at: now,
      },
    });
    mockOrgTaskList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'task_alpha',
          organization_id: 'org_alpha',
          title: 'Task Contract Alpha',
          objective: 'Ship the first object views',
          scope: ['src/renderer/pages/tasks'],
          done_criteria: ['views visible'],
          budget: { max_runs: 3 },
          risk_tier: 'normal',
          validators: [],
          deliverable_schema: {},
          status: 'ready',
          created_at: now,
          updated_at: now,
        },
      ],
    });
    mockOrgControlStateGet.mockResolvedValue({
      success: true,
      data: {
        organization_id: 'org_alpha',
        phase: 'monitoring',
        needs_human_input: false,
        pending_approval_count: 0,
        auto_drive_enabled: true,
        last_event_at: now,
        created_at: now,
        updated_at: now,
      },
    });
    mockOrgApprovalList.mockResolvedValue({
      success: true,
      data: [],
    });
    mockOrgRunList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'run_alpha',
          organization_id: 'org_alpha',
          task_id: 'task_alpha',
          status: 'reviewing',
          workspace: { mode: 'isolated', type: 'worktree', path: '/tmp/org-alpha/runs/run_alpha' },
          environment: { kind: 'cloud', env_id: 'ts-ci' },
          created_at: now,
          updated_at: now,
        },
      ],
    });
    mockOrgArtifactList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'artifact_alpha',
          organization_id: 'org_alpha',
          task_id: 'task_alpha',
          run_id: 'run_alpha',
          type: 'test_log',
          title: 'Regression Log',
          summary: 'Regression suite output',
          created_at: now,
          updated_at: now,
        },
      ],
    });
    mockOrgMemoryList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'memory_alpha',
          organization_id: 'org_alpha',
          type: 'workflow_hint',
          title: 'Remember the eval gate',
          knowledge_unit: 'Run eval before proposing patch.',
          traceability: { source_run_ids: ['run_alpha'], source_artifact_ids: ['artifact_alpha'] },
          created_at: now,
          updated_at: now,
        },
      ],
    });
    mockOrgEvalList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'eval_alpha',
          organization_id: 'org_alpha',
          name: 'Regression Eval',
          description: 'Runs regression checks',
          test_commands: [{ argv: ['bunx', 'vitest', '--run'] }],
          quality_gates: [{ gate: 'tests', rule: 'must-pass' }],
          thresholds: { min_pass_rate: 1 },
          created_at: now,
          updated_at: now,
        },
      ],
    });
    mockOrgSkillList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'skill_alpha',
          organization_id: 'org_alpha',
          name: 'org-ui-rollout',
          workflow_unit: 'plan -> shell -> views',
          version: 1,
          created_at: now,
          updated_at: now,
        },
      ],
    });
    mockOrgEvolutionList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'patch_alpha',
          organization_id: 'org_alpha',
          mutation_target: 'skill',
          based_on: ['run_alpha'],
          proposal: { skill_name: 'org-ui-rollout', change_type: 'update' },
          status: 'proposed',
          created_at: now,
          updated_at: now,
        },
      ],
    });
    mockGovernanceListPending.mockResolvedValue({
      success: true,
      data: [{ target_type: 'genome_patch', target_id: 'patch_alpha', created_at: now }],
    });

    mockOrgTaskCreate.mockResolvedValue({ success: true, data: { id: 'task_new' } });
    mockOrgRunStart.mockResolvedValue({ success: true, data: { id: 'run_new' } });
    mockOrgEvalExecute.mockResolvedValue({ success: true, data: { task_id: 'task_alpha', run_id: 'run_alpha' } });
    mockOrgMemoryPromote.mockResolvedValue({ success: true, data: { id: 'memory_new' } });
    mockOrgEvolutionPropose.mockResolvedValue({ success: true, data: { id: 'patch_new' } });
  });

  it('switches between organization object views while keeping organization context', async () => {
    render(
      <MemoryRouter initialEntries={['/tasks/org_alpha']}>
        <Routes>
          <Route path='/tasks/:projectId' element={<ProjectDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Organization Alpha').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: /^任务契约/ }));
    expect(screen.getByText('Task Contract Alpha')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^运行实例/ }));
    expect(screen.getByText('run_alpha')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^产物/ }));
    expect(screen.getByText('Regression Log')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^组织记忆/ }));
    expect(screen.getByText('Remember the eval gate')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^评估规范/ }));
    expect(screen.getByText('Regression Eval')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^技能/ }));
    expect(screen.getByText('org-ui-rollout')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^基因补丁/ }));
    expect(screen.getByText('patch_alpha')).toBeInTheDocument();

    expect(screen.getAllByText('Organization Alpha').length).toBeGreaterThan(0);
  });

  it('triggers key organization actions with current organization context', async () => {
    render(
      <MemoryRouter initialEntries={['/tasks/org_alpha']}>
        <Routes>
          <Route path='/tasks/:projectId' element={<ProjectDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Organization Alpha').length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '启动运行' })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: '创建任务契约' }));
    fireEvent.click(screen.getByRole('button', { name: '启动运行' }));
    fireEvent.click(screen.getByRole('button', { name: '执行评估' }));
    fireEvent.click(screen.getByRole('button', { name: '提升记忆' }));
    fireEvent.click(screen.getByRole('button', { name: '提交补丁提案' }));

    await waitFor(() => {
      expect(mockOrgTaskCreate).toHaveBeenCalledTimes(1);
      expect(mockOrgRunStart).toHaveBeenCalledTimes(1);
      expect(mockOrgEvalExecute).toHaveBeenCalledTimes(1);
      expect(mockOrgMemoryPromote).toHaveBeenCalledTimes(1);
      expect(mockOrgEvolutionPropose).toHaveBeenCalledTimes(1);
    });

    expect(mockOrgTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'org_alpha',
      })
    );
    expect(mockOrgRunStart).toHaveBeenCalledWith(
      expect.objectContaining({
        task_id: 'task_alpha',
      })
    );
    expect(mockOrgEvalExecute).toHaveBeenCalledWith({
      task_id: 'task_alpha',
      run_id: 'run_alpha',
      eval_spec_id: 'eval_alpha',
    });
    expect(mockOrgMemoryPromote).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'org_alpha',
        title: '来自 run_alpha 的记忆',
      })
    );
    expect(mockOrgEvolutionPropose).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'org_alpha',
        based_on: ['run_alpha'],
      })
    );
  });
});
