/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Project Conversation Panel
 *
 * An inline panel that embeds the project-level AI conversation.
 * - First open: shows agent picker to create the conversation.
 * - After creation: embeds the full chat view (AcpChat).
 * - Conversation persists in project.conversation_id.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Spin, Empty, Message } from '@arco-design/web-react';
import { Robot, RefreshOne } from '@icon-park/react';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/storage';
import type { TProject } from '@/common/types/task';
import type { AvailableAgent } from '@/renderer/shared/agents/types';
import type { AcpBackend } from '@/types/acpTypes';
import { useConversationAgents } from '@/renderer/pages/conversation/hooks/useConversationAgents';
import {
  buildCliAgentParams,
  buildPresetAssistantParams,
} from '@/renderer/pages/conversation/utils/createConversationParams';
import { getAgentLogo } from '@/renderer/utils/agentLogo';
import { CUSTOM_AVATAR_IMAGE_MAP } from '@/renderer/pages/guid/constants';
import './ProjectConversationPanel.css';

// Lazy load chat components
const AcpChat = React.lazy(() => import('@/renderer/pages/conversation/acp/AcpChat'));

type ProjectConversationPanelProps = {
  project: TProject | null;
  onProjectUpdate?: () => void;
};

const ProjectConversationPanel: React.FC<ProjectConversationPanelProps> = ({ project, onProjectUpdate }) => {
  const { t, i18n } = useTranslation();
  const { cliAgents, presetAssistants, isLoading: isAgentsLoading } = useConversationAgents();

  const [conversation, setConversation] = useState<TChatConversation | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  // Load existing conversation
  useEffect(() => {
    if (!project?.conversation_id) {
      setConversation(null);
      return;
    }

    setLoading(true);
    ipcBridge.conversation.get
      .invoke({ id: project.conversation_id })
      .then((conv) => {
        if (conv?.id) {
          setConversation(conv);
        } else {
          setConversation(null);
        }
      })
      .catch(() => setConversation(null))
      .finally(() => setLoading(false));
  }, [project?.conversation_id]);

  // Initialize .aionui context
  useEffect(() => {
    if (!project?.id || !project?.workspace) return;
    void ipcBridge.project.initContext.invoke({ projectId: project.id });
  }, [project?.id, project?.workspace]);

  const handleSelectAgent = useCallback(
    async (agent: AvailableAgent, isPreset: boolean) => {
      if (!project?.workspace || creating) return;

      setCreating(true);
      try {
        let params;
        if (isPreset) {
          params = await buildPresetAssistantParams(agent, project.workspace, i18n.language);
        } else {
          params = await buildCliAgentParams(agent, project.workspace);
        }

        // Sync project context
        const syncResult = await ipcBridge.project.syncContext.invoke({ projectId: project.id });
        if (!syncResult.success) {
          console.warn('[ProjectConversation] Failed to sync context');
        }

        params.extra = { ...params.extra, workspace: project.workspace, customWorkspace: true };

        const conv = await ipcBridge.conversation.create.invoke({
          ...params,
          name: `${project.name} - AI Manager`,
        });

        if (!conv?.id) {
          Message.error(t('task.createConversationFailed', { defaultValue: 'Failed to create conversation' }));
          return;
        }

        await ipcBridge.project.update.invoke({
          id: project.id,
          updates: { conversation_id: conv.id },
        });

        setConversation(conv);
        onProjectUpdate?.();
      } catch (error) {
        console.error('[ProjectConversation] Failed to create conversation:', error);
        Message.error(t('task.createConversationFailed', { defaultValue: 'Failed to create conversation' }));
      } finally {
        setCreating(false);
      }
    },
    [project, creating, i18n.language, t, onProjectUpdate]
  );

  const handleResetConversation = useCallback(async () => {
    if (!project || !conversation) return;

    try {
      await ipcBridge.conversation.remove.invoke({ id: conversation.id });
      await ipcBridge.project.update.invoke({
        id: project.id,
        updates: { conversation_id: undefined },
      });
      setConversation(null);
      onProjectUpdate?.();
    } catch (error) {
      console.error('[ProjectConversation] Failed to reset conversation:', error);
    }
  }, [project, conversation, onProjectUpdate]);

  if (loading) {
    return (
      <div className='project-conv-panel'>
        <div className='project-conv-panel__loading'>
          <Spin />
        </div>
      </div>
    );
  }

  // Agent picker when no conversation exists
  if (!conversation) {
    return (
      <div className='project-conv-panel'>
        <div className='project-conv-panel__header'>
          <Robot theme='outline' size={16} />
          <span>{t('task.projectAI', { defaultValue: 'Project AI' })}</span>
        </div>
        <div className='project-conv-panel__body'>
          {isAgentsLoading ? (
            <div className='project-conv-panel__loading'>
              <Spin />
            </div>
          ) : !cliAgents.length && !presetAssistants.length ? (
            <Empty description={t('conversation.dropdown.noAgents', { defaultValue: 'No agents available' })} />
          ) : (
            <div className='project-conv-panel__agent-picker'>
              <p className='project-conv-panel__agent-hint'>
                {t('task.selectProjectAgent', { defaultValue: 'Select an agent for the project AI manager' })}
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

  // Conversation view
  const extra = conversation.extra as Record<string, unknown>;

  return (
    <div className='project-conv-panel'>
      <div className='project-conv-panel__header'>
        <Robot theme='outline' size={16} />
        <span className='project-conv-panel__header-name'>
          {(extra?.agentName as string) || t('task.projectAI', { defaultValue: 'Project AI' })}
        </span>
        <button
          className='project-conv-panel__reset-btn'
          onClick={() => void handleResetConversation()}
          title={t('task.resetConversation', { defaultValue: 'Switch agent' })}
        >
          <RefreshOne theme='outline' size={14} />
        </button>
      </div>
      <div className='project-conv-panel__chat'>
        {conversation.type === 'acp' ? (
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
          <div className='project-conv-panel__unsupported'>
            <p>
              {t('task.unsupportedAgentType', {
                defaultValue: 'This agent type is not yet supported in project mode',
              })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectConversationPanel;
