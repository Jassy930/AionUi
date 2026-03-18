/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Work Task Bridge Module
 *
 * Handles CRUD operations for both Projects and Tasks
 * Project → Task → Thread (Conversation) hierarchy
 */

import { ipcBridge } from '@/common';
import type { TProject, TTask } from '@/common/types/task';
import { getDatabase } from '../database';
import { nanoid } from 'nanoid';

export function initWorkTaskBridge(): void {
  const db = getDatabase();

  // ==================== Project CRUD ====================

  ipcBridge.project.create.provider(async (params) => {
    try {
      const now = Date.now();
      const proj: TProject = {
        id: `proj_${nanoid()}`,
        name: params.name,
        description: params.description,
        status: params.status || 'brainstorming',
        user_id: db.getSystemUser()?.id || 'system_default_user',
        created_at: now,
        updated_at: now,
      };

      const result = db.createProject(proj);
      if (!result.success) {
        return { success: false, msg: result.error };
      }

      ipcBridge.project.created.emit(proj);
      return { success: true, data: proj };
    } catch (error: any) {
      console.error('[Project] Failed to create project:', error);
      return { success: false, msg: error.message };
    }
  });

  ipcBridge.project.get.provider(async ({ id }) => {
    try {
      const result = db.getProject(id);
      if (!result.success || !result.data) {
        return { success: false, msg: result.error || 'Project not found' };
      }
      return { success: true, data: result.data };
    } catch (error: any) {
      console.error('[Project] Failed to get project:', error);
      return { success: false, msg: error.message };
    }
  });

  ipcBridge.project.list.provider(async () => {
    try {
      const result = db.getUserProjects();
      if (!result.success) {
        return { success: false, msg: result.error, data: [] };
      }
      return { success: true, data: result.data || [] };
    } catch (error: any) {
      console.error('[Project] Failed to list projects:', error);
      return { success: false, msg: error.message, data: [] };
    }
  });

  ipcBridge.project.update.provider(async ({ id, updates }) => {
    try {
      const result = db.updateProject(id, updates);
      if (!result.success) {
        return { success: false, msg: result.error };
      }

      const projResult = db.getProject(id);
      if (projResult.success && projResult.data) {
        ipcBridge.project.updated.emit(projResult.data);
      }

      return { success: true, data: true };
    } catch (error: any) {
      console.error('[Project] Failed to update project:', error);
      return { success: false, msg: error.message };
    }
  });

  ipcBridge.project.delete.provider(async ({ id }) => {
    try {
      const result = db.deleteProject(id);
      if (!result.success) {
        return { success: false, msg: result.error };
      }

      ipcBridge.project.deleted.emit({ id });
      return { success: true, data: true };
    } catch (error: any) {
      console.error('[Project] Failed to delete project:', error);
      return { success: false, msg: error.message };
    }
  });

  // ==================== Task CRUD ====================

  ipcBridge.workTask.create.provider(async (params) => {
    try {
      const now = Date.now();
      const task: TTask = {
        id: `task_${nanoid()}`,
        project_id: params.project_id,
        name: params.name,
        description: params.description,
        status: params.status || 'pending',
        sort_order: 0,
        created_at: now,
        updated_at: now,
      };

      const result = db.createTask(task);
      if (!result.success) {
        return { success: false, msg: result.error };
      }

      ipcBridge.workTask.created.emit(task);
      return { success: true, data: task };
    } catch (error: any) {
      console.error('[WorkTask] Failed to create task:', error);
      return { success: false, msg: error.message };
    }
  });

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

  ipcBridge.workTask.list.provider(async ({ projectId }) => {
    try {
      const result = db.getProjectTasks(projectId);
      if (!result.success) {
        return { success: false, msg: result.error, data: [] };
      }
      return { success: true, data: result.data || [] };
    } catch (error: any) {
      console.error('[WorkTask] Failed to list tasks:', error);
      return { success: false, msg: error.message, data: [] };
    }
  });

  ipcBridge.workTask.update.provider(async ({ id, updates }) => {
    try {
      const result = db.updateTask(id, updates);
      if (!result.success) {
        return { success: false, msg: result.error };
      }

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

  ipcBridge.workTask.delete.provider(async ({ id }) => {
    try {
      const result = db.deleteTask(id);
      if (!result.success) {
        return { success: false, msg: result.error };
      }

      ipcBridge.workTask.deleted.emit({ id });
      return { success: true, data: true };
    } catch (error: any) {
      console.error('[WorkTask] Failed to delete task:', error);
      return { success: false, msg: error.message };
    }
  });

  // Task-Conversation association
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
