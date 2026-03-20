/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mockProjectList = vi.fn();
const mockProjectGet = vi.fn();
const mockTaskList = vi.fn();
const mockOrgList = vi.fn();
const mockOrgGet = vi.fn();
const mockOrgTaskList = vi.fn();
const mockOrgRunList = vi.fn();
const mockOrgArtifactList = vi.fn();
const mockOrgMemoryList = vi.fn();
const mockOrgEvalList = vi.fn();
const mockOrgSkillList = vi.fn();
const mockOrgEvolutionList = vi.fn();

const translations: Record<string, string> = {
  'project.listTitle': '组织列表',
  'project.create': '新建组织',
  'project.console.nav.overview': '概览',
  'project.console.nav.tasks': '任务契约',
  'project.console.nav.runs': '运行实例',
  'project.console.nav.artifacts': '产物',
  'project.console.nav.memory': '组织记忆',
  'project.console.nav.evalSpecs': '评估规范',
  'project.console.nav.skills': '技能',
  'project.console.nav.genomePatches': '基因补丁',
  'project.console.nav.governance': '治理',
  'project.console.overview.stats.tasks': '任务契约',
  'project.console.overview.stats.runs': '运行实例',
  'project.console.overview.stats.artifacts': '产物',
  'project.console.overview.stats.pendingGovernance': '待处理治理',
  'project.console.overview.controlLoopTitle': '控制闭环',
  'project.console.tower.aiTitle': '组织 AI',
  'project.console.tower.actionsTitle': '结构化动作',
  'project.console.empty.tasks': '暂无任务契约',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => translations[key] || options?.defaultValue || key,
    i18n: { language: 'zh-CN' },
  }),
}));

vi.mock('@icon-park/react', () => ({
  Plus: () => <span data-testid='icon-plus' />,
  Delete: () => <span data-testid='icon-delete' />,
  Edit: () => <span data-testid='icon-edit' />,
  Left: () => <span data-testid='icon-left' />,
  FolderOpen: () => <span data-testid='icon-folder-open' />,
  MessageOne: () => <span data-testid='icon-message-one' />,
  Robot: () => <span data-testid='icon-robot' />,
  Time: () => <span data-testid='icon-time' />,
  DocumentFolder: () => <span data-testid='icon-document-folder' />,
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PointerSensor: class PointerSensor {},
  useSensor: () => ({}),
  useSensors: () => [],
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
  }),
}));

vi.mock('@/renderer/pages/conversation/hooks/useConversationAgents', () => ({
  useConversationAgents: () => ({
    cliAgents: [],
    presetAssistants: [],
    isLoading: false,
  }),
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

vi.mock('@/renderer/pages/conversation/utils/createConversationParams', () => ({
  buildCliAgentParams: vi.fn(),
  buildPresetAssistantParams: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/utils/newConversationName', () => ({
  applyDefaultConversationName: vi.fn((value: string) => value),
}));

vi.mock('@/renderer/utils/agentLogo', () => ({
  getAgentLogo: vi.fn(() => ''),
}));

vi.mock('@/renderer/pages/guid/constants', () => ({
  CUSTOM_AVATAR_IMAGE_MAP: {},
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    project: {
      list: { invoke: (...args: any[]) => mockProjectList(...args) },
      get: { invoke: (...args: any[]) => mockProjectGet(...args) },
      created: { on: vi.fn(() => vi.fn()) },
      updated: { on: vi.fn(() => vi.fn()) },
      deleted: { on: vi.fn(() => vi.fn()) },
    },
    workTask: {
      list: { invoke: (...args: any[]) => mockTaskList(...args) },
      created: { on: vi.fn(() => vi.fn()) },
      updated: { on: vi.fn(() => vi.fn()) },
      deleted: { on: vi.fn(() => vi.fn()) },
      conversationsChanged: { on: vi.fn(() => vi.fn()) },
      getConversations: { invoke: vi.fn().mockResolvedValue({ success: true, data: [] }) },
    },
    org: {
      organization: {
        list: { invoke: (...args: any[]) => mockOrgList(...args) },
        get: { invoke: (...args: any[]) => mockOrgGet(...args) },
        created: { on: vi.fn(() => vi.fn()) },
        updated: { on: vi.fn(() => vi.fn()) },
        deleted: { on: vi.fn(() => vi.fn()) },
      },
      task: {
        list: { invoke: (...args: any[]) => mockOrgTaskList(...args) },
        created: { on: vi.fn(() => vi.fn()) },
        updated: { on: vi.fn(() => vi.fn()) },
        deleted: { on: vi.fn(() => vi.fn()) },
        statusChanged: { on: vi.fn(() => vi.fn()) },
      },
      run: {
        list: { invoke: (...args: any[]) => mockOrgRunList(...args) },
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
        promoted: { on: vi.fn(() => vi.fn()) },
        updated: { on: vi.fn(() => vi.fn()) },
        deleted: { on: vi.fn(() => vi.fn()) },
      },
      eval: {
        list: { invoke: (...args: any[]) => mockOrgEvalList(...args) },
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
        proposed: { on: vi.fn(() => vi.fn()) },
        statusChanged: { on: vi.fn(() => vi.fn()) },
        adopted: { on: vi.fn(() => vi.fn()) },
        rejected: { on: vi.fn(() => vi.fn()) },
      },
      governance: {
        listPending: { invoke: vi.fn().mockResolvedValue({ success: true, data: [] }) },
      },
    },
    dialog: {
      showOpen: { invoke: vi.fn() },
    },
  },
}));

import ProjectList from '@/renderer/pages/tasks/ProjectList';
import ProjectDetail from '@/renderer/pages/tasks/ProjectDetail';

describe('Organization Console Shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockProjectList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'org_alpha',
          name: 'Organization Alpha',
          description: 'Organization workspace',
          workspace: '/tmp/org-alpha',
          task_count: 3,
          updated_at: Date.now(),
        },
      ],
    });
    mockProjectGet.mockResolvedValue({
      success: true,
      data: {
        id: 'org_alpha',
        name: 'Organization Alpha',
        description: 'Organization workspace',
        workspace: '/tmp/org-alpha',
        updated_at: Date.now(),
      },
    });
    mockTaskList.mockResolvedValue({ success: true, data: [] });

    mockOrgList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'org_alpha',
          name: 'Organization Alpha',
          description: 'Organization workspace',
          workspace: '/tmp/org-alpha',
          user_id: 'system_default_user',
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ],
    });
    mockOrgGet.mockResolvedValue({
      success: true,
      data: {
        id: 'org_alpha',
        name: 'Organization Alpha',
        description: 'Organization workspace',
        workspace: '/tmp/org-alpha',
        user_id: 'system_default_user',
        created_at: Date.now(),
        updated_at: Date.now(),
      },
    });
    mockOrgTaskList.mockResolvedValue({ success: true, data: [] });
    mockOrgRunList.mockResolvedValue({ success: true, data: [] });
    mockOrgArtifactList.mockResolvedValue({ success: true, data: [] });
    mockOrgMemoryList.mockResolvedValue({ success: true, data: [] });
    mockOrgEvalList.mockResolvedValue({ success: true, data: [] });
    mockOrgSkillList.mockResolvedValue({ success: true, data: [] });
    mockOrgEvolutionList.mockResolvedValue({ success: true, data: [] });
  });

  it('renders organization list semantics instead of legacy project wording', async () => {
    render(
      <MemoryRouter>
        <ProjectList />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('组织列表')).toBeInTheDocument();
    });

    expect(screen.getByText('新建组织')).toBeInTheDocument();
    expect(screen.getByText('Organization Alpha')).toBeInTheDocument();
  });

  it('renders organization console navigation and control tower sections', async () => {
    render(
      <MemoryRouter initialEntries={['/tasks/org_alpha']}>
        <Routes>
          <Route path='/tasks/:projectId' element={<ProjectDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('概览').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('任务契约').length).toBeGreaterThan(0);
    expect(screen.getAllByText('运行实例').length).toBeGreaterThan(0);
    expect(screen.getAllByText('产物').length).toBeGreaterThan(0);
    expect(screen.getAllByText('组织记忆').length).toBeGreaterThan(0);
    expect(screen.getAllByText('评估规范').length).toBeGreaterThan(0);
    expect(screen.getAllByText('技能').length).toBeGreaterThan(0);
    expect(screen.getAllByText('基因补丁').length).toBeGreaterThan(0);
    expect(screen.getAllByText('治理').length).toBeGreaterThan(0);
    expect(screen.getAllByText('任务契约').length).toBeGreaterThan(1);
    expect(screen.getAllByText('运行实例').length).toBeGreaterThan(1);
    expect(screen.getAllByText('产物').length).toBeGreaterThan(1);
    expect(screen.getByText('待处理治理')).toBeInTheDocument();
    expect(screen.getByText('控制闭环')).toBeInTheDocument();
    expect(screen.getByText('组织 AI')).toBeInTheDocument();
    expect(screen.getByText('Organization AI Panel')).toBeInTheDocument();
    expect(
      screen.queryByText('Organization-level control conversation will be connected in the next iteration.')
    ).not.toBeInTheDocument();
    expect(screen.getByText('结构化动作')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^任务契约/ }));
    await waitFor(() => {
      expect(screen.getByText('暂无任务契约')).toBeInTheDocument();
    });
  });
});
