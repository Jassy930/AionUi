/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Input, Modal, Message, Empty, Select, Spin } from '@arco-design/web-react';
import { Plus, Delete, Edit, Time, Left, FolderOpen, MessageOne } from '@icon-park/react';
import classNames from 'classnames';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/storage';
import type { TProject, TTaskWithCount, TaskStatus } from '@/common/types/task';
import './TaskBoard.css';

type TaskColumn = {
  status: TaskStatus;
  titleKey: string;
  tasks: TTaskWithCount[];
};

const ALL_STATUSES: TaskStatus[] = ['brainstorming', 'todo', 'progress', 'review', 'done'];

const ProjectDetail: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();

  const [project, setProject] = useState<TProject | null>(null);
  const [tasks, setTasks] = useState<TTaskWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  // Task conversations map: taskId -> conversations[]
  const [taskConversations, setTaskConversations] = useState<Record<string, TChatConversation[]>>({});
  const [loadingConversations, setLoadingConversations] = useState<Record<string, boolean>>({});

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskStatus, setNewTaskStatus] = useState<TaskStatus>('brainstorming');
  const [editingTask, setEditingTask] = useState<TTaskWithCount | null>(null);

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
      }
    } catch (error) {
      console.error('Failed to load tasks:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Load conversations for a specific task
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

  // Load conversations for all tasks
  const loadAllTaskConversations = useCallback(
    async (taskList: TTaskWithCount[]) => {
      await Promise.all(taskList.map((task) => loadTaskConversations(task.id)));
    },
    [loadTaskConversations]
  );

  useEffect(() => {
    void loadProject();
    void loadTasks();
  }, [loadProject, loadTasks]);

  // When tasks are loaded, load their conversations
  useEffect(() => {
    if (tasks.length > 0) {
      void loadAllTaskConversations(tasks);
    }
  }, [tasks, loadAllTaskConversations]);

  useEffect(() => {
    const unsubs = [
      ipcBridge.workTask.created.on(() => void loadTasks()),
      ipcBridge.workTask.updated.on(() => void loadTasks()),
      ipcBridge.workTask.deleted.on(() => void loadTasks()),
      ipcBridge.project.updated.on(() => void loadProject()),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [loadTasks, loadProject]);

  const handleCreateTask = async () => {
    if (!newTaskName.trim() || !projectId) {
      Message.warning(t('task.nameRequired', { defaultValue: 'Task name is required' }));
      return;
    }
    try {
      const result = await ipcBridge.workTask.create.invoke({
        project_id: projectId,
        name: newTaskName.trim(),
        description: newTaskDesc.trim() || undefined,
        status: newTaskStatus,
      });
      if (result.success) {
        Message.success(t('task.created', { defaultValue: 'Task created' }));
        setCreateModalVisible(false);
        setNewTaskName('');
        setNewTaskDesc('');
        setNewTaskStatus('brainstorming');
      } else {
        Message.error(result.msg || t('task.createFailed', { defaultValue: 'Failed to create task' }));
      }
    } catch (error) {
      console.error('Failed to create task:', error);
      Message.error(t('task.createFailed', { defaultValue: 'Failed to create task' }));
    }
  };

  const handleUpdateStatus = async (taskId: string, newStatus: TaskStatus) => {
    try {
      const result = await ipcBridge.workTask.update.invoke({
        id: taskId,
        updates: { status: newStatus },
      });
      if (!result.success) {
        Message.error(result.msg || t('task.updateFailed', { defaultValue: 'Failed to update task' }));
      }
    } catch (error) {
      console.error('Failed to update task status:', error);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      const result = await ipcBridge.workTask.delete.invoke({ id: taskId });
      if (result.success) {
        Message.success(t('task.deleted', { defaultValue: 'Task deleted' }));
      } else {
        Message.error(result.msg || t('task.deleteFailed', { defaultValue: 'Failed to delete task' }));
      }
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  const handleOpenConversation = (conversationId: string) => {
    void navigate(`/conversation/${conversationId}`);
  };

  const handleNewConversation = async (taskId: string) => {
    try {
      const workspace = project?.workspace || '';
      const conversation = await ipcBridge.conversation.create.invoke({
        type: 'gemini',
        taskId,
        model: {
          id: 'gemini-placeholder',
          name: 'Gemini',
          useModel: 'default',
          platform: 'gemini-with-google-auth' as const,
          baseUrl: '',
          apiKey: '',
        },
        extra: {
          workspace,
          customWorkspace: !!project?.workspace,
        },
      });

      if (!conversation?.id) {
        Message.error(t('task.createConversationFailed', { defaultValue: 'Failed to create conversation' }));
        return;
      }

      // Refresh conversation list for this task
      void loadTaskConversations(taskId);
      void navigate(`/conversation/${conversation.id}`);
    } catch (error) {
      console.error('Failed to create conversation:', error);
      Message.error(t('task.createConversationFailed', { defaultValue: 'Failed to create conversation' }));
    }
  };

  const statusLabel = (status: TaskStatus) => t(`task.status.${status}`, { defaultValue: status });

  const columns: TaskColumn[] = ALL_STATUSES.map((status) => ({
    status,
    titleKey: `task.status.${status}`,
    tasks: tasks.filter((tsk) => tsk.status === status),
  }));

  // Next status mapping for quick-advance buttons
  const nextStatus: Partial<Record<TaskStatus, TaskStatus>> = {
    brainstorming: 'todo',
    todo: 'progress',
    progress: 'review',
    review: 'done',
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

  const renderTaskCard = (task: TTaskWithCount) => {
    const conversations = taskConversations[task.id] || [];
    const isLoadingConvs = loadingConversations[task.id];

    return (
      <div key={task.id} className='task-board__card task-board__card--expanded'>
        <div className='task-board__card-header'>
          <h4 className='task-board__card-title'>{task.name}</h4>
          <div className='task-board__card-actions'>
            <button
              className='task-board__card-action'
              onClick={() => setEditingTask(task)}
              title={t('common.edit', { defaultValue: 'Edit' })}
            >
              <Edit theme='outline' size={14} />
            </button>
            <button
              className='task-board__card-action task-board__card-action--danger'
              onClick={() => void handleDeleteTask(task.id)}
              title={t('common.delete', { defaultValue: 'Delete' })}
            >
              <Delete theme='outline' size={14} />
            </button>
          </div>
        </div>

        {task.description && <p className='task-board__card-description'>{task.description}</p>}

        {/* Conversations list */}
        <div className='task-card__conversations'>
          {isLoadingConvs ? (
            <div className='task-card__conversations-loading'>
              <Spin size={12} />
            </div>
          ) : conversations.length > 0 ? (
            conversations.map((conv) => (
              <div
                key={conv.id}
                className='task-card__conversation-item'
                onClick={() => handleOpenConversation(conv.id)}
                role='button'
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleOpenConversation(conv.id)}
              >
                <MessageOne theme='outline' size={12} style={{ color: getConversationStatusColor(conv.status) }} />
                <span className='task-card__conversation-name'>
                  {conv.name || t('task.unnamedConversation', { defaultValue: 'Untitled' })}
                </span>
                {conv.status === 'running' && (
                  <span className='task-card__conversation-status-dot task-card__conversation-status-dot--running' />
                )}
              </div>
            ))
          ) : (
            <div className='task-card__conversations-empty'>
              {t('task.noConversations', { defaultValue: 'No conversations' })}
            </div>
          )}
        </div>

        {/* Footer with actions */}
        <div className='task-card__footer'>
          <Button
            size='mini'
            type='text'
            icon={<Plus theme='outline' size={12} />}
            onClick={() => handleNewConversation(task.id)}
          >
            {t('task.newConversation', { defaultValue: 'New Conversation' })}
          </Button>

          {nextStatus[task.status] && (
            <Button
              size='mini'
              type='outline'
              onClick={() => void handleUpdateStatus(task.id, nextStatus[task.status]!)}
            >
              {t(`task.action.moveTo.${nextStatus[task.status]}`, {
                defaultValue: statusLabel(nextStatus[task.status]!),
              })}
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className='task-board'>
      <div className='task-board__header'>
        <div className='project-detail__title-area'>
          <Button
            type='text'
            icon={<Left theme='outline' size={18} />}
            onClick={() => void navigate('/tasks')}
            className='project-detail__back-btn'
          />
          <h1 className='task-board__title'>{project?.name || '...'}</h1>
        </div>
        <Button type='primary' icon={<Plus theme='outline' />} onClick={() => setCreateModalVisible(true)}>
          {t('task.create', { defaultValue: 'New Task' })}
        </Button>
      </div>

      {project?.workspace && (
        <div
          className='project-detail__workspace-bar'
          title={project.workspace}
          onClick={() => void ipcBridge.shell.showItemInFolder.invoke(project.workspace)}
        >
          <FolderOpen theme='outline' size={14} />
          <span className='project-detail__workspace-path'>{project.workspace}</span>
        </div>
      )}

      <div className='task-board__columns task-board__columns--5'>
        {columns.map((column) => (
          <div key={column.status} className={classNames('task-board__column', `task-board__column--${column.status}`)}>
            <div className='task-board__column-header'>
              <h3 className='task-board__column-title'>{t(column.titleKey, { defaultValue: column.status })}</h3>
              <span className='task-board__column-count'>{column.tasks.length}</span>
            </div>
            <div className='task-board__column-content'>
              {column.tasks.length === 0 ? (
                <div className='task-board__column-empty'>
                  <Empty description={t('task.noTasks', { defaultValue: 'No tasks' })} />
                </div>
              ) : (
                column.tasks.map(renderTaskCard)
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Create Task Modal */}
      <Modal
        title={t('task.create', { defaultValue: 'New Task' })}
        visible={createModalVisible}
        onOk={handleCreateTask}
        onCancel={() => {
          setCreateModalVisible(false);
          setNewTaskName('');
          setNewTaskDesc('');
          setNewTaskStatus('brainstorming');
        }}
        okText={t('common.create', { defaultValue: 'Create' })}
        cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
      >
        <div className='task-board__modal-form'>
          <div className='task-board__modal-field'>
            <label>{t('task.name', { defaultValue: 'Task Name' })}</label>
            <Input
              value={newTaskName}
              onChange={setNewTaskName}
              placeholder={t('task.namePlaceholder', { defaultValue: 'Enter task name...' })}
              autoFocus
            />
          </div>
          <div className='task-board__modal-field'>
            <label>{t('task.description', { defaultValue: 'Description' })}</label>
            <Input.TextArea
              value={newTaskDesc}
              onChange={setNewTaskDesc}
              placeholder={t('task.descriptionPlaceholder', { defaultValue: 'Enter task description (optional)...' })}
              rows={3}
            />
          </div>
          <div className='task-board__modal-field'>
            <label>{t('task.statusLabel', { defaultValue: 'Status' })}</label>
            <Select value={newTaskStatus} onChange={setNewTaskStatus}>
              {ALL_STATUSES.map((s) => (
                <Select.Option key={s} value={s}>
                  {statusLabel(s)}
                </Select.Option>
              ))}
            </Select>
          </div>
        </div>
      </Modal>

      {/* Edit Task Modal */}
      <Modal
        title={t('task.edit', { defaultValue: 'Edit Task' })}
        visible={!!editingTask}
        onOk={async () => {
          if (editingTask) {
            try {
              await ipcBridge.workTask.update.invoke({
                id: editingTask.id,
                updates: { name: editingTask.name, description: editingTask.description },
              });
              setEditingTask(null);
            } catch (error) {
              console.error('Failed to update task:', error);
              Message.error(t('task.updateFailed', { defaultValue: 'Failed to update task' }));
            }
          }
        }}
        onCancel={() => setEditingTask(null)}
        okText={t('common.save', { defaultValue: 'Save' })}
        cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
      >
        {editingTask && (
          <div className='task-board__modal-form'>
            <div className='task-board__modal-field'>
              <label>{t('task.name', { defaultValue: 'Task Name' })}</label>
              <Input value={editingTask.name} onChange={(v) => setEditingTask({ ...editingTask, name: v })} />
            </div>
            <div className='task-board__modal-field'>
              <label>{t('task.description', { defaultValue: 'Description' })}</label>
              <Input.TextArea
                value={editingTask.description || ''}
                onChange={(v) => setEditingTask({ ...editingTask, description: v })}
                rows={3}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ProjectDetail;
