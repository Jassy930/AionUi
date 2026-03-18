/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Work Task Bridge Module
 * 工作任务桥接模块
 *
 * Handles CRUD operations for the Task-centric work execution system
 * 处理以 Task 为中心的工作执行系统的 CRUD 操作
 */

import { ipcBridge } from '@/common';
import type { TTask, TaskStatus } from '@/common/types/task';
import { getDatabase } from '../database';
import { nanoid } from 'nanoid';

export function initWorkTaskBridge(): void {
  const db = getDatabase();

  // Create task
  ipcBridge.workTask.create.provider(async (params) => {
    try {
      const now = Date.now();
      const task: TTask = {
        id: `task_${nanoid()}`,
        name: params.name,
        description: params.description,
        status: params.status || 'pending',
        user_id: db.getSystemUser()?.id || 'system_default_user',
        created_at: now,
        updated_at: now,
      };

      const result = db.createTask(task);
      if (!result.success) {
        return { success: false, msg: result.error };
      }

      // Emit created event
      ipcBridge.workTask.created.emit(task);

      return { success: true, data: task };
    } catch (error: any) {
      console.error('[WorkTask] Failed to create task:', error);
      return { success: false, msg: error.message };
    }
  });

  // Get task by ID
  ipcBridge.workTask.get.provider(async ({ id }) => {
    try {
      const result = db.getTask(id);
      if (!result.success || !result.data) {
        return { success: false, msg: result.error || 'Task not found' };
      }
      return { success: true, data: result.data };
    } catch (error: any) {
      console.error('[WorkTask] Failed to get task:', error);
      return { success: false, msg: error.message };
    }
  });

  // List all tasks
  ipcBridge.workTask.list.provider(async () => {
    try {
      const result = db.getUserTasks();
      if (!result.success) {
        return { success: false, msg: result.error, data: [] };
      }
      return { success: true, data: result.data || [] };
    } catch (error: any) {
      console.error('[WorkTask] Failed to list tasks:', error);
      return { success: false, msg: error.message, data: [] };
    }
  });

  // List tasks by status
  ipcBridge.workTask.listByStatus.provider(async ({ status }) => {
    try {
      const result = db.getTasksByStatus(status as TaskStatus);
      if (!result.success) {
        return { success: false, msg: result.error, data: [] };
      }
      return { success: true, data: result.data || [] };
    } catch (error: any) {
      console.error('[WorkTask] Failed to list tasks by status:', error);
      return { success: false, msg: error.message, data: [] };
    }
  });

  // Update task
  ipcBridge.workTask.update.provider(async ({ id, updates }) => {
    try {
      const result = db.updateTask(id, updates);
      if (!result.success) {
        return { success: false, msg: result.error };
      }

      // Get updated task and emit event
      const taskResult = db.getTask(id);
      if (taskResult.success && taskResult.data) {
        ipcBridge.workTask.updated.emit(taskResult.data);
      }

      return { success: true, data: true };
    } catch (error: any) {
      console.error('[WorkTask] Failed to update task:', error);
      return { success: false, msg: error.message };
    }
  });

  // Delete task
  ipcBridge.workTask.delete.provider(async ({ id }) => {
    try {
      const result = db.deleteTask(id);
      if (!result.success) {
        return { success: false, msg: result.error };
      }

      // Emit deleted event
      ipcBridge.workTask.deleted.emit({ id });

      return { success: true, data: true };
    } catch (error: any) {
      console.error('[WorkTask] Failed to delete task:', error);
      return { success: false, msg: error.message };
    }
  });

  // Get conversations for a task
  ipcBridge.workTask.getConversations.provider(async ({ taskId }) => {
    try {
      const result = db.getTaskConversations(taskId);
      if (!result.success) {
        return { success: false, msg: result.error, data: [] };
      }
      return { success: true, data: result.data || [] };
    } catch (error: any) {
      console.error('[WorkTask] Failed to get task conversations:', error);
      return { success: false, msg: error.message, data: [] };
    }
  });

  // Associate conversation with task
  ipcBridge.workTask.associateConversation.provider(async ({ conversationId, taskId }) => {
    try {
      const result = db.associateConversationWithTask(conversationId, taskId);
      if (!result.success) {
        return { success: false, msg: result.error };
      }
      return { success: true, data: true };
    } catch (error: any) {
      console.error('[WorkTask] Failed to associate conversation with task:', error);
      return { success: false, msg: error.message };
    }
  });
}
