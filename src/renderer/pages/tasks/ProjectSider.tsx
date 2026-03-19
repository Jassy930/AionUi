/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Empty, Spin, Tooltip, Collapse } from '@arco-design/web-react';
import { Left, FolderOpen, MessageOne, Plus } from '@icon-park/react';
import classNames from 'classnames';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/storage';
import type { TProject, TTaskWithCount, TaskStatus } from '@/common/types/task';
import { useProjectMode } from '@/renderer/context/ProjectModeContext';
import { useLayoutContext } from '@/renderer/context/LayoutContext';
import { cleanupSiderTooltips, getSiderTooltipProps } from '@/renderer/utils/siderTooltip';
import { blurActiveElement } from '@/renderer/utils/focus';
import './ProjectSider.css';

type ProjectSiderProps = {
  collapsed?: boolean;
  onSessionClick?: () => void;
};

const ALL_STATUSES: TaskStatus[] = ['brainstorming', 'todo', 'progress', 'review', 'done'];

const ProjectSider: React.FC<ProjectSiderProps> = ({ collapsed = false, onSessionClick }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const { projectId, exitProjectMode } = useProjectMode();

  const [project, setProject] = useState<TProject | null>(null);
  const [tasks, setTasks] = useState<TTaskWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskConversations, setTaskConversations] = useState<Record<string, TChatConversation[]>>({});
  const [loadingConversations, setLoadingConversations] = useState<Record<string, boolean>>({});
  const [expandedTasks, setExpandedTasks] = useState<string[]>([]);

  const tooltipEnabled = collapsed && !isMobile;
  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);

  const loadProject = useCallback(async () => {
    if (!projectId) return;
    try {
      const result = await ipcBridge.project.get.invoke({ id: projectId });
      if (result.success && result.data) {
        setProject(result.data);
      }
    } catch (error) {
      console.error('Failed to load project:', error);
    }
  }, [projectId]);

  const loadTasks = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      const result = await ipcBridge.workTask.list.invoke({ projectId });
      if (result.success && result.data) {
        setTasks(result.data);
        // Auto-expand tasks with conversations
        const tasksWithConvs = result.data.filter((t) => t.conversation_count > 0).map((t) => t.id);
        setExpandedTasks(tasksWithConvs);
      }
    } catch (error) {
      console.error('Failed to load tasks:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const loadTaskConversations = useCallback(async (taskId: string) => {
    setLoadingConversations((prev) => ({ ...prev, [taskId]: true }));
    try {
      const result = await ipcBridge.workTask.getConversations.invoke({ taskId });
      if (result.success && result.data) {
        setTaskConversations((prev) => ({ ...prev, [taskId]: result.data }));
      }
    } catch (error) {
      console.error('Failed to load task conversations:', error);
    } finally {
      setLoadingConversations((prev) => ({ ...prev, [taskId]: false }));
    }
  }, []);

  useEffect(() => {
    if (projectId) {
      void loadProject();
      void loadTasks();
    }
  }, [projectId, loadProject, loadTasks]);

  // Load conversations for expanded tasks
  useEffect(() => {
    expandedTasks.forEach((taskId) => {
      if (!taskConversations[taskId] && !loadingConversations[taskId]) {
        void loadTaskConversations(taskId);
      }
    });
  }, [expandedTasks, taskConversations, loadingConversations, loadTaskConversations]);

  // Listen for task/conversation updates
  useEffect(() => {
    const unsubs = [
      ipcBridge.workTask.created.on(() => void loadTasks()),
      ipcBridge.workTask.updated.on(() => void loadTasks()),
      ipcBridge.workTask.deleted.on(() => void loadTasks()),
      ipcBridge.project.updated.on(() => void loadProject()),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [loadTasks, loadProject]);

  const handleBackToProject = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    exitProjectMode();
    void navigate(`/tasks/${projectId}`);
    if (onSessionClick) onSessionClick();
  };

  const handleOpenConversation = (conversationId: string) => {
    cleanupSiderTooltips();
    blurActiveElement();
    void navigate(`/conversation/${conversationId}`);
    if (onSessionClick) onSessionClick();
  };

  const handleToggleTask = (taskId: string) => {
    setExpandedTasks((prev) => (prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]));
  };

  const getStatusColor = (status: TaskStatus) => {
    switch (status) {
      case 'brainstorming':
        return 'var(--color-purple-6, #722ed1)';
      case 'todo':
        return 'var(--color-warning-6)';
      case 'progress':
        return 'var(--color-primary-6)';
      case 'review':
        return 'var(--color-orangered-6, #f77234)';
      case 'done':
        return 'var(--color-success-6)';
      default:
        return 'var(--color-text-3)';
    }
  };

  const getConversationStatusColor = (status?: string) => {
    switch (status) {
      case 'running':
        return 'var(--color-primary-6)';
      case 'finished':
        return 'var(--color-success-6)';
      default:
        return 'var(--color-text-4)';
    }
  };

  // Group tasks by status
  const tasksByStatus = ALL_STATUSES.reduce(
    (acc, status) => {
      acc[status] = tasks.filter((t) => t.status === status);
      return acc;
    },
    {} as Record<TaskStatus, TTaskWithCount[]>
  );

  if (!projectId) {
    return null;
  }

  return (
    <div className='project-sider size-full flex flex-col'>
      {/* Header with project name */}
      <div className='project-sider__header'>
        <Tooltip {...siderTooltipProps} content={t('common.back')} position='right'>
          <Button
            type='text'
            size='small'
            icon={<Left theme='outline' size={16} />}
            onClick={handleBackToProject}
            className='project-sider__back-btn'
          />
        </Tooltip>
        <div className='project-sider__title collapsed-hidden' onClick={handleBackToProject} title={project?.name}>
          {project?.name || '...'}
        </div>
      </div>

      {/* Workspace info */}
      {project?.workspace && !collapsed && (
        <div
          className='project-sider__workspace'
          title={project.workspace}
          onClick={() => void ipcBridge.shell.showItemInFolder.invoke(project.workspace)}
        >
          <FolderOpen theme='outline' size={12} />
          <span className='project-sider__workspace-path'>{project.workspace.split('/').pop()}</span>
        </div>
      )}

      {/* Task kanban */}
      <div className='project-sider__content flex-1 min-h-0 overflow-y-auto'>
        {loading ? (
          <div className='project-sider__loading'>
            <Spin size={20} />
          </div>
        ) : tasks.length === 0 ? (
          <div className='project-sider__empty'>
            <Empty description={t('task.noTasks', { defaultValue: 'No tasks' })} />
          </div>
        ) : (
          <div className='project-sider__kanban'>
            {ALL_STATUSES.map((status) => {
              const statusTasks = tasksByStatus[status];
              if (statusTasks.length === 0) return null;

              return (
                <div key={status} className='project-sider__status-group'>
                  <div className='project-sider__status-header'>
                    <span className='project-sider__status-dot' style={{ backgroundColor: getStatusColor(status) }} />
                    <span className='project-sider__status-label collapsed-hidden'>
                      {t(`task.status.${status}`, { defaultValue: status })}
                    </span>
                    <span className='project-sider__status-count'>{statusTasks.length}</span>
                  </div>

                  <div className='project-sider__task-list collapsed-hidden'>
                    {statusTasks.map((task) => {
                      const conversations = taskConversations[task.id] || [];
                      const isExpanded = expandedTasks.includes(task.id);
                      const isLoadingConvs = loadingConversations[task.id];

                      return (
                        <div key={task.id} className='project-sider__task'>
                          <div
                            className={classNames('project-sider__task-header', {
                              'project-sider__task-header--expandable': task.conversation_count > 0,
                            })}
                            onClick={() => task.conversation_count > 0 && handleToggleTask(task.id)}
                          >
                            <span className='project-sider__task-name' title={task.name}>
                              {task.name}
                            </span>
                            {task.conversation_count > 0 && (
                              <span className='project-sider__task-conv-count'>{task.conversation_count}</span>
                            )}
                          </div>

                          {isExpanded && (
                            <div className='project-sider__conversations'>
                              {isLoadingConvs ? (
                                <div className='project-sider__conv-loading'>
                                  <Spin size={12} />
                                </div>
                              ) : conversations.length > 0 ? (
                                conversations.map((conv) => (
                                  <div
                                    key={conv.id}
                                    className='project-sider__conversation'
                                    onClick={() => handleOpenConversation(conv.id)}
                                  >
                                    <MessageOne
                                      theme='outline'
                                      size={12}
                                      style={{ color: getConversationStatusColor(conv.status) }}
                                    />
                                    <span className='project-sider__conv-name'>
                                      {conv.name || t('task.unnamedConversation', { defaultValue: 'Untitled' })}
                                    </span>
                                    {conv.status === 'running' && <span className='project-sider__conv-running-dot' />}
                                  </div>
                                ))
                              ) : (
                                <div className='project-sider__conv-empty'>
                                  {t('task.noConversations', { defaultValue: 'No conversations' })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectSider;
