/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Input, Modal, Message, Empty } from '@arco-design/web-react';
import { Plus, Delete, Edit, Time, CheckOne, Left } from '@icon-park/react';
import classNames from 'classnames';
import { ipcBridge } from '@/common';
import type { TProject, ProjectStatus, TTaskWithCount, TaskStatus } from '@/common/types/task';
import './TaskBoard.css';

const STATUS_COLORS: Record<ProjectStatus, string> = {
  brainstorming: 'var(--color-purple-6, #722ed1)',
  todo: 'var(--color-warning-6)',
  progressing: 'var(--color-primary-6)',
  done: 'var(--color-success-6)',
};

type TaskColumn = {
  status: TaskStatus;
  titleKey: string;
  tasks: TTaskWithCount[];
};

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
      });
      if (result.success) {
        Message.success(t('task.created', { defaultValue: 'Task created' }));
        setCreateModalVisible(false);
        setNewTaskName('');
        setNewTaskDesc('');
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

  const columns: TaskColumn[] = [
    { status: 'pending', titleKey: 'task.status.pending', tasks: tasks.filter((t) => t.status === 'pending') },
    {
      status: 'in_progress',
      titleKey: 'task.status.inProgress',
      tasks: tasks.filter((t) => t.status === 'in_progress'),
    },
    { status: 'done', titleKey: 'task.status.done', tasks: tasks.filter((t) => t.status === 'done') },
  ];

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
      {task.status !== 'done' && (
        <div className='task-board__card-status-actions' onClick={(e) => e.stopPropagation()}>
          {task.status === 'pending' && (
            <Button size='mini' type='outline' onClick={() => void handleUpdateStatus(task.id, 'in_progress')}>
              {t('task.action.start', { defaultValue: 'Start' })}
            </Button>
          )}
          {task.status === 'in_progress' && (
            <Button
              size='mini'
              type='primary'
              icon={<CheckOne theme='outline' size={12} />}
              onClick={() => void handleUpdateStatus(task.id, 'done')}
            >
              {t('task.action.complete', { defaultValue: 'Complete' })}
            </Button>
          )}
        </div>
      )}
    </div>
  );

  const statusColor = project ? STATUS_COLORS[project.status] : undefined;

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
          {project && (
            <span className='project-card__status-badge' style={{ color: statusColor, borderColor: statusColor }}>
              {t(`project.status.${project.status}`, { defaultValue: project.status })}
            </span>
          )}
        </div>
        <Button type='primary' icon={<Plus theme='outline' />} onClick={() => setCreateModalVisible(true)}>
          {t('task.create', { defaultValue: 'New Task' })}
        </Button>
      </div>

      <div className='task-board__columns'>
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
