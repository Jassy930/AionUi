/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TTaskWithCount } from '@/common/types/task';
import { Select, Tag } from '@arco-design/web-react';
import { Close, Plus } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

type TaskSelectorProps = {
  selectedTaskId: string | null;
  onTaskChange: (taskId: string | null) => void;
};

const TaskSelector: React.FC<TaskSelectorProps> = ({ selectedTaskId, onTaskChange }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<TTaskWithCount[]>([]);
  const [loading, setLoading] = useState(true);

  // Load tasks
  const loadTasks = useCallback(async () => {
    try {
      setLoading(true);
      const result = await ipcBridge.workTask.list.invoke();
      if (result.success && result.data) {
        // Filter out completed tasks for selection
        setTasks(result.data.filter((task) => task.status !== 'done'));
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

  const selectedTask = tasks.find((task) => task.id === selectedTaskId);

  // If a task is selected, show it as a tag
  if (selectedTask) {
    return (
      <Tag
        closable
        onClose={() => onTaskChange(null)}
        closeIcon={<Close theme='outline' size={12} />}
        color='arcoblue'
        className='cursor-pointer'
        style={{ marginRight: 8 }}
      >
        {selectedTask.name}
      </Tag>
    );
  }

  // Show dropdown to select or create task
  return (
    <Select
      placeholder={t('task.selectOrCreate', { defaultValue: 'Link to Task...' })}
      loading={loading}
      allowClear
      showSearch
      value={selectedTaskId || undefined}
      onChange={(value) => onTaskChange(value || null)}
      style={{ width: 180 }}
      size='small'
      triggerProps={{
        autoAlignPopupWidth: false,
        autoAlignPopupMinWidth: true,
        position: 'bl',
      }}
      dropdownRender={(menu) => (
        <div>
          {menu}
          <div
            className='flex items-center gap-1 px-3 py-2 cursor-pointer hover:bg-fill-2 border-t border-color-border'
            onClick={() => navigate('/tasks')}
          >
            <Plus theme='outline' size={14} />
            <span className='text-sm'>{t('task.createNew', { defaultValue: 'Create new task' })}</span>
          </div>
        </div>
      )}
    >
      {tasks.map((task) => (
        <Select.Option key={task.id} value={task.id}>
          <div className='flex items-center justify-between w-full'>
            <span className='truncate'>{task.name}</span>
            <span className='text-xs text-color-text-3 ml-2'>
              {task.conversation_count > 0 ? `${task.conversation_count}` : ''}
            </span>
          </div>
        </Select.Option>
      ))}
    </Select>
  );
};

export default TaskSelector;
