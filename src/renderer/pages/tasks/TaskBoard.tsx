/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Modal, Message, Empty } from '@arco-design/web-react';
import { Plus, Delete, Edit, Time, CheckOne } from '@icon-park/react';
import classNames from 'classnames';
import { ipcBridge } from '@/common';
import type { TTaskWithCount, TaskStatus } from '@/common/types/task';
import './TaskBoard.css';

type TaskColumn = {
  status: TaskStatus;
  titleKey: string;
  tasks: TTaskWithCount[];
};

const TaskBoard: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<TTaskWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [editingTask, setEditingTask] = useState<TTaskWithCount | null>(null);

  // Load tasks
  const loadTasks = useCallback(async () => {
    try {
      setLoading(true);
      const result = await ipcBridge.workTask.list.invoke();
      if (result.success && result.data) {
        setTasks(result.data);
      }
    } catch (error) {
      console.error('Failed to load tasks:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  // Subscribe to task events
  useEffect(() => {
    const unsubCreated = ipcBridge.workTask.created.on(() => {
      void loadTasks();
    });
    const unsubUpdated = ipcBridge.workTask.updated.on(() => {
      void loadTasks();
    });
    const unsubDeleted = ipcBridge.workTask.deleted.on(() => {
      void loadTasks();
    });

    return () => {
      unsubCreated();
      unsubUpdated();
      unsubDeleted();
    };
  }, [loadTasks]);

  // Create task
  const handleCreateTask = async () => {
    if (!newTaskName.trim()) {
      Message.warning(t('task.nameRequired', { defaultValue: 'Task name is required' }));
      return;
    }

    try {
      const result = await ipcBridge.workTask.create.invoke({
        name: newTaskName.trim(),
        description: newTaskDescription.trim() || undefined,
      });
      if (result.success) {
        Message.success(t('task.created', { defaultValue: 'Task created' }));
        setCreateModalVisible(false);
        setNewTaskName('');
        setNewTaskDescription('');
      } else {
        Message.error(result.msg || t('task.createFailed', { defaultValue: 'Failed to create task' }));
      }
    } catch (error) {
      console.error('Failed to create task:', error);
      Message.error(t('task.createFailed', { defaultValue: 'Failed to create task' }));
    }
  };

  // Update task status
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
      Message.error(t('task.updateFailed', { defaultValue: 'Failed to update task' }));
    }
  };

  // Delete task
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
      Message.error(t('task.deleteFailed', { defaultValue: 'Failed to delete task' }));
    }
  };

  // Open task (navigate to task detail or create conversation)
  const handleOpenTask = (task: TTaskWithCount) => {
    // For now, just navigate to guid page with task context
    // In the future, this could open a task detail view
    void navigate(`/guid?taskId=${task.id}`);
  };

  // Organize tasks into columns
  const columns: TaskColumn[] = [
    {
      status: 'pending',
      titleKey: 'task.status.pending',
      tasks: tasks.filter((t) => t.status === 'pending'),
    },
    {
      status: 'in_progress',
      titleKey: 'task.status.inProgress',
      tasks: tasks.filter((t) => t.status === 'in_progress'),
    },
    {
      status: 'done',
      titleKey: 'task.status.done',
      tasks: tasks.filter((t) => t.status === 'done'),
    },
  ];

  const renderTaskCard = (task: TTaskWithCount) => {
    const statusLabels: Record<TaskStatus, string> = {
      pending: t('task.status.pending', { defaultValue: 'Pending' }),
      in_progress: t('task.status.inProgress', { defaultValue: 'In Progress' }),
      done: t('task.status.done', { defaultValue: 'Done' }),
    };

    return (
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
              onClick={() => handleDeleteTask(task.id)}
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
              <Button size='mini' type='outline' onClick={() => handleUpdateStatus(task.id, 'in_progress')}>
                {t('task.action.start', { defaultValue: 'Start' })}
              </Button>
            )}
            {task.status === 'in_progress' && (
              <Button
                size='mini'
                type='primary'
                icon={<CheckOne theme='outline' size={12} />}
                onClick={() => handleUpdateStatus(task.id, 'done')}
              >
                {t('task.action.complete', { defaultValue: 'Complete' })}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className='task-board'>
      <div className='task-board__header'>
        <h1 className='task-board__title'>{t('task.board.title', { defaultValue: 'Task Board' })}</h1>
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
          setNewTaskDescription('');
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
              value={newTaskDescription}
              onChange={setNewTaskDescription}
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
                updates: {
                  name: editingTask.name,
                  description: editingTask.description,
                },
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

export default TaskBoard;
