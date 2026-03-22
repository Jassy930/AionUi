/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockGetUserConversations = vi.fn();
const mockCreateConversation = vi.fn();
const mockRemoveConversation = vi.fn();
const mockInitContext = vi.fn();
const mockSyncContext = vi.fn();
const mockGetSystemPrompt = vi.fn();
const mockGetControlState = vi.fn();
const mockBuildCliAgentParams = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
    i18n: { language: 'zh-CN' },
  }),
}));

vi.mock('@/renderer/pages/conversation/hooks/useConversationAgents', () => ({
  useConversationAgents: () => ({
    cliAgents: [{ backend: 'codex', name: 'Codex' }],
    presetAssistants: [],
    isLoading: false,
  }),
}));

vi.mock('@/renderer/pages/conversation/utils/createConversationParams', () => ({
  buildCliAgentParams: (...args: any[]) => mockBuildCliAgentParams(...args),
  buildPresetAssistantParams: vi.fn(),
}));

vi.mock('@/renderer/utils/agentLogo', () => ({
  getAgentLogo: vi.fn(() => ''),
}));

vi.mock('@/renderer/pages/guid/constants', () => ({
  CUSTOM_AVATAR_IMAGE_MAP: {},
}));

vi.mock('@/renderer/pages/conversation/acp/AcpChat', () => ({
  default: ({ conversation_id }: { conversation_id: string }) => <div>Chat:{conversation_id}</div>,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    database: {
      getUserConversations: { invoke: (...args: any[]) => mockGetUserConversations(...args) },
    },
    conversation: {
      create: { invoke: (...args: any[]) => mockCreateConversation(...args) },
      remove: { invoke: (...args: any[]) => mockRemoveConversation(...args) },
    },
    org: {
      organization: {
        initContext: { invoke: (...args: any[]) => mockInitContext(...args) },
        syncContext: { invoke: (...args: any[]) => mockSyncContext(...args) },
        getSystemPrompt: { invoke: (...args: any[]) => mockGetSystemPrompt(...args) },
        getControlState: { invoke: (...args: any[]) => mockGetControlState(...args) },
      },
    },
  },
}));

import OrganizationConversationPanel from '@/renderer/pages/tasks/OrganizationConversationPanel';

describe('OrganizationConversationPanel', () => {
  const organization = {
    id: 'org_alpha',
    name: 'Organization Alpha',
    workspace: '/tmp/org-alpha',
    user_id: 'system_default_user',
    created_at: 1,
    updated_at: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserConversations.mockResolvedValue([]);
    mockCreateConversation.mockResolvedValue(null);
    mockRemoveConversation.mockResolvedValue(true);
    mockInitContext.mockResolvedValue({ success: true });
    mockSyncContext.mockResolvedValue({ success: true });
    mockGetSystemPrompt.mockResolvedValue({ success: true, data: 'ORG_PROMPT' });
    mockGetControlState.mockResolvedValue({
      success: true,
      data: {
        organization_id: 'org_alpha',
        phase: 'drafting_plan',
        needs_human_input: false,
        pending_approval_count: 0,
      },
    });
    mockBuildCliAgentParams.mockResolvedValue({
      type: 'acp',
      model: {} as any,
      extra: {
        backend: 'codex',
        agentName: 'Codex',
      },
    });
  });

  it('creates the organization control conversation in a safer planning mode', async () => {
    mockCreateConversation.mockResolvedValue({
      id: 'conv_created',
      type: 'acp',
      name: 'Organization Alpha - Organization AI',
      createTime: 1,
      modifyTime: 2,
      extra: {
        backend: 'codex',
        workspace: '/tmp/org-alpha',
        agentName: 'Codex',
        organizationId: 'org_alpha',
        organizationRole: 'control_plane',
      },
    });

    render(<OrganizationConversationPanel organization={organization} />);

    await waitFor(() => {
      expect(screen.getByText('Select an agent for the organization AI manager')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));

    await waitFor(() => {
      expect(mockCreateConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          extra: expect.objectContaining({
            sessionMode: 'default',
          }),
        })
      );
    });
  });

  it('reuses the latest control-plane conversation for the organization', async () => {
    mockGetUserConversations.mockResolvedValue([
      {
        id: 'conv_org',
        type: 'acp',
        name: 'Organization Alpha - Organization AI',
        createTime: 1,
        modifyTime: 2,
        extra: {
          backend: 'codex',
          workspace: '/tmp/org-alpha',
          agentName: 'Ops Lead',
          organizationId: 'org_alpha',
          organizationRole: 'control_plane',
        },
      },
    ]);

    const { container } = render(<OrganizationConversationPanel organization={organization} />);

    await waitFor(() => {
      expect(screen.getByText('Ops Lead')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('Chat:conv_org')).toBeInTheDocument();
    });
    expect(container.querySelector('.project-conv-panel__header')).toBeNull();
    expect(container.querySelector('.organization-conv-panel__toolbar')).toBeInTheDocument();
    expect(screen.getByTitle('Switch agent')).toBeInTheDocument();
    expect(mockInitContext).toHaveBeenCalledWith({ organizationId: 'org_alpha' });
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it('creates a control-plane conversation with organization context', async () => {
    mockCreateConversation.mockResolvedValue({
      id: 'conv_created',
      type: 'acp',
      name: 'Organization Alpha - Organization AI',
      createTime: 1,
      modifyTime: 2,
      extra: {
        backend: 'codex',
        workspace: '/tmp/org-alpha',
        agentName: 'Codex',
        organizationId: 'org_alpha',
        organizationRole: 'control_plane',
      },
    });

    const { container } = render(<OrganizationConversationPanel organization={organization} />);

    await waitFor(() => {
      expect(screen.getByText('Select an agent for the organization AI manager')).toBeInTheDocument();
    });
    expect(container.querySelector('.project-conv-panel__header')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));

    await waitFor(() => {
      expect(mockCreateConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'acp',
          name: 'Organization Alpha - Organization AI',
          extra: expect.objectContaining({
            workspace: '/tmp/org-alpha',
            customWorkspace: true,
            backend: 'codex',
            organizationId: 'org_alpha',
            organizationRole: 'control_plane',
            presetContext: 'ORG_PROMPT',
            presetRules: 'ORG_PROMPT',
          }),
        })
      );
    });

    expect(mockSyncContext).toHaveBeenCalledWith({ organizationId: 'org_alpha' });
    expect(mockGetSystemPrompt).toHaveBeenCalledWith({ organizationId: 'org_alpha' });

    await waitFor(() => {
      expect(screen.getByText('Chat:conv_created')).toBeInTheDocument();
    });
  });
});
