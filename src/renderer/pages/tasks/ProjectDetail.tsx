/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Input, Modal, Message, Empty, Select } from '@arco-design/web-react';
import { Plus, Delete, Edit, Time, Left } from '@icon-park/react';
import classNames from 'classnames';
import { ipcBridge } from '@/common';
import type { TProject, TTaskWithCount, TaskStatus } from '@/common/types/task';
import './TaskBoard.css';

const STATUS_COLORS: Record<TaskStatus, string> = {
  brainstorming: 'var(--color-purple-6, #722ed1)',
  todo: 'var(--color-warning-6)',
  progress: 'var(--color-primary-6)',
  review: 'var(--color-orangered-6, #f77234)',
  done: 'var(--color-success-6)',
};

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

  useEffect(() => {
    void loadProject();
    void loadTasks();
  }, [loadProject, loadTasks]);

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

  const handleOpenTask = (task: TTaskWithCount) => {
    void navigate(`/guid?taskId=${task.id}`);
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

  const renderTaskCard = (task: TTaskWithCount) => (
    <div
      key={task.id}
      className='task-board__card'
      onClick={() => handleOpenTask(task)}
      role='button'
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleOpenTask(task)}
    >
      <div className='task-board__card-header'>
        <h4 className='task-board__card-title'>{task.name}</h4>
        <div className='task-board__card-actions' onClick={(e) => e.stopPropagation()}>
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
      <div className='task-board__card-meta'>
        <span className='task-board__card-conversations'>
          {task.conversation_count} {t('task.conversations', { defaultValue: 'conversations' })}
        </span>
        <span className='task-board__card-time'>
          <Time theme='outline' size={12} />
          {new Date(task.updated_at).toLocaleDateString()}
        </span>
      </div>
      {nextStatus[task.status] && (
        <div className='task-board__card-status-actions' onClick={(e) => e.stopPropagation()}>
          <Button size='mini' type='outline' onClick={() => void handleUpdateStatus(task.id, nextStatus[task.status]!)}>
            {t(`task.action.moveTo.${nextStatus[task.status]}`, {
              defaultValue: statusLabel(nextStatus[task.status]!),
            })}
          </Button>
        </div>
      )}
    </div>
  );

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
