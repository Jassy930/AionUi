/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Empty, Message, Spin } from '@arco-design/web-react';
import { RefreshOne, Robot } from '@icon-park/react';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/storage';
import type { TOrganization } from '@/common/types/organization';
import type { AvailableAgent } from '@/renderer/shared/agents/types';
import type { AcpBackend } from '@/types/acpTypes';
import { useConversationAgents } from '@/renderer/pages/conversation/hooks/useConversationAgents';
import {
  buildCliAgentParams,
  buildPresetAssistantParams,
} from '@/renderer/pages/conversation/utils/createConversationParams';
import { CUSTOM_AVATAR_IMAGE_MAP } from '@/renderer/pages/guid/constants';
import { getAgentLogo } from '@/renderer/utils/agentLogo';
import './ProjectConversationPanel.css';
import './OrganizationConversationPanel.css';

const AcpChat = React.lazy(() => import('@/renderer/pages/conversation/acp/AcpChat'));

type OrganizationConversationPanelProps = {
  organization: TOrganization | null;
};

const isOrganizationControlConversation = (conversation: TChatConversation, organizationId: string) => {
  const extra = conversation.extra as Record<string, unknown> | undefined;
  return extra?.organizationId === organizationId && extra?.organizationRole === 'control_plane';
};

const OrganizationConversationPanel: React.FC<OrganizationConversationPanelProps> = ({ organization }) => {
  const { t, i18n } = useTranslation();
  const { cliAgents, presetAssistants, isLoading: isAgentsLoading } = useConversationAgents();

  const [conversation, setConversation] = useState<TChatConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!organization?.id || !organization.workspace) {
      return;
    }
    void ipcBridge.org.organization.initContext.invoke({ organizationId: organization.id });
  }, [organization?.id, organization?.workspace]);

  useEffect(() => {
    if (!organization?.id) {
      setConversation(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    ipcBridge.database.getUserConversations
      .invoke({ page: 0, pageSize: 10000 })
      .then((data) => {
        if (cancelled) {
          return;
        }

        const conversations = Array.isArray(data) ? data : [];
        const existingConversation =
          conversations.find((item) => isOrganizationControlConversation(item, organization.id)) || null;
        setConversation(existingConversation);
      })
      .catch(() => {
        if (!cancelled) {
          setConversation(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [organization?.id]);

  const handleSelectAgent = useCallback(
    async (agent: AvailableAgent, isPreset: boolean) => {
      if (!organization?.id || !organization.workspace || creating) {
        return;
      }

      setCreating(true);
      try {
        const params = isPreset
          ? await buildPresetAssistantParams(agent, organization.workspace, i18n.language)
          : await buildCliAgentParams(agent, organization.workspace);

        const [syncResult, promptResult] = await Promise.all([
          ipcBridge.org.organization.syncContext.invoke({ organizationId: organization.id }),
          ipcBridge.org.organization.getSystemPrompt.invoke({ organizationId: organization.id }),
        ]);
        if (!syncResult.success) {
          console.warn('[OrganizationConversationPanel] Failed to sync context');
        }

        const systemPrompt = promptResult.success && promptResult.data ? promptResult.data : '';
        if (systemPrompt) {
          const existing = params.extra.presetContext || params.extra.presetRules || '';
          const merged = existing ? `${systemPrompt}\n\n${existing}` : systemPrompt;
          params.extra = { ...params.extra, presetContext: merged, presetRules: merged };
        }

        params.extra = {
          ...params.extra,
          workspace: organization.workspace,
          customWorkspace: true,
          sessionMode: params.extra.sessionMode || 'default',
          organizationId: organization.id,
          organizationRole: 'control_plane',
        };

        const nextConversation = await ipcBridge.conversation.create.invoke({
          ...params,
          name: `${organization.name} - Organization AI`,
        });

        if (!nextConversation?.id) {
          Message.error(t('task.createConversationFailed', { defaultValue: 'Failed to create conversation' }));
          return;
        }

        setConversation(nextConversation);
      } catch (error) {
        console.error('[OrganizationConversationPanel] Failed to create conversation:', error);
        Message.error(t('task.createConversationFailed', { defaultValue: 'Failed to create conversation' }));
      } finally {
        setCreating(false);
      }
    },
    [creating, i18n.language, organization, t]
  );

  const handleSwitchAgent = useCallback(async () => {
    if (!conversation) {
      return;
    }
    try {
      await ipcBridge.conversation.remove.invoke({ id: conversation.id });
    } catch (error) {
      console.error('[OrganizationConversationPanel] Failed to remove conversation:', error);
    }
    setConversation(null);
  }, [conversation]);

  const panelTitle = t('project.console.tower.aiTitle', { defaultValue: 'Organization AI' });

  if (!conversation && !loading) {
    return (
      <div className='organization-conv-panel'>
        <div className='organization-conv-panel__content organization-conv-panel__content--picker'>
          {isAgentsLoading ? (
            <div className='project-conv-panel__loading'>
              <Spin />
            </div>
          ) : !cliAgents.length && !presetAssistants.length ? (
            <Empty description={t('conversation.dropdown.noAgents', { defaultValue: 'No agents available' })} />
          ) : (
            <div className='project-conv-panel__agent-picker'>
              <p className='project-conv-panel__agent-hint'>
                {t('project.console.tower.aiAgentHint', {
                  defaultValue: 'Select an agent for the organization AI manager',
                })}
              </p>
              <div className='project-conv-panel__agent-grid'>
                {cliAgents.map((agent) => {
                  const logo = getAgentLogo(agent.backend);
                  return (
                    <button
                      key={`cli:${agent.backend}`}
                      className='project-conv-panel__agent-card'
                      onClick={() => void handleSelectAgent(agent, false)}
                      disabled={creating}
                    >
                      {logo ? (
                        <img src={logo} alt={agent.name} className='project-conv-panel__agent-logo' />
                      ) : (
                        <Robot size='20' />
                      )}
                      <span className='project-conv-panel__agent-name'>{agent.name}</span>
                    </button>
                  );
                })}
                {presetAssistants.map((agent) => {
                  const avatarImage = agent.avatar ? CUSTOM_AVATAR_IMAGE_MAP[agent.avatar] : undefined;
                  const isEmoji = agent.avatar && !avatarImage && !agent.avatar.endsWith('.svg');
                  return (
                    <button
                      key={`preset:${agent.customAgentId}`}
                      className='project-conv-panel__agent-card'
                      onClick={() => void handleSelectAgent(agent, true)}
                      disabled={creating}
                    >
                      {avatarImage ? (
                        <img src={avatarImage} alt={agent.name} className='project-conv-panel__agent-logo' />
                      ) : isEmoji ? (
                        <span className='project-conv-panel__agent-emoji'>{agent.avatar}</span>
                      ) : (
                        <Robot size='20' />
                      )}
                      <span className='project-conv-panel__agent-name'>{agent.name}</span>
                    </button>
                  );
                })}
              </div>
              {creating && (
                <div className='project-conv-panel__creating'>
                  <Spin size={16} />
                  <span>{t('task.creatingConversation', { defaultValue: 'Creating conversation...' })}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className='organization-conv-panel'>
        <div className='project-conv-panel__loading'>
          <Spin />
        </div>
      </div>
    );
  }

  const extra = conversation?.extra as Record<string, unknown> | undefined;

  return (
    <div className='organization-conv-panel'>
      <div className='organization-conv-panel__toolbar'>
        <div className='organization-conv-panel__agent'>
          <Robot theme='outline' size={16} />
          <span className='organization-conv-panel__agent-name'>{(extra?.agentName as string) || panelTitle}</span>
        </div>
        <button
          className='organization-conv-panel__switch-btn'
          onClick={() => void handleSwitchAgent()}
          title={t('task.resetConversation', { defaultValue: 'Switch agent' })}
        >
          <RefreshOne theme='outline' size={14} />
        </button>
      </div>
      <div className='organization-conv-panel__chat'>
        {conversation?.type === 'acp' ? (
          <React.Suspense fallback={<Spin className='m-auto' />}>
            <AcpChat
              key={conversation.id}
              conversation_id={conversation.id}
              workspace={extra?.workspace as string}
              backend={((extra?.backend as string) || 'claude') as AcpBackend}
              sessionMode={extra?.sessionMode as string}
              agentName={extra?.agentName as string}
            />
          </React.Suspense>
        ) : (
          <div className='organization-conv-panel__unsupported'>
            <p>
              {t('project.console.tower.unsupportedAgentType', {
                defaultValue: 'This agent type is not yet supported in organization mode',
              })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrganizationConversationPanel;
