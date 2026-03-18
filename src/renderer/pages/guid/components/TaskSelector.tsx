/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TTask } from '@/common/types/task';
import { Tag } from '@arco-design/web-react';
import { Close } from '@icon-park/react';
import React, { useEffect, useState } from 'react';

type TaskSelectorProps = {
  selectedTaskId: string | null;
  onTaskChange: (taskId: string | null) => void;
};

/**
 * Displays the currently selected task as a tag.
 * Task selection happens in the Project detail page; this just shows/clears the context.
 */
const TaskSelector: React.FC<TaskSelectorProps> = ({ selectedTaskId, onTaskChange }) => {
  const [taskName, setTaskName] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedTaskId) {
      setTaskName(null);
      return;
    }

    const loadTask = async () => {
      try {
        const result = await ipcBridge.workTask.get.invoke({ id: selectedTaskId });
        if (result.success && result.data) {
          setTaskName(result.data.name);
        } else {
          setTaskName(null);
          onTaskChange(null);
        }
      } catch {
        setTaskName(null);
      }
    };

    void loadTask();
  }, [selectedTaskId, onTaskChange]);

  if (!selectedTaskId || !taskName) return null;

  return (
    <Tag
      closable
      onClose={() => onTaskChange(null)}
      closeIcon={<Close theme='outline' size={12} />}
      color='arcoblue'
      className='cursor-pointer'
      style={{ marginRight: 8 }}
    >
      {taskName}
    </Tag>
  );
};

export default TaskSelector;
