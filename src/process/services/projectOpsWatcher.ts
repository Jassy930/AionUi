/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Project Operations Watcher
 *
 * Watches the `.aionui/operations/` directory for JSON command files
 * written by the project-level AI conversation. When a new file appears,
 * it parses the operation, executes it via the database layer, and
 * refreshes the context files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { TTask, TaskStatus } from '@/common/types/task';
import { ipcBridge } from '@/common';
import { getDatabase } from '@process/database';
import { syncProjectContext, getProjectContextDir } from './projectContextService';

type OperationPayload = {
  operation: string;
  params: Record<string, unknown>;
};

type OperationResult = {
  success: boolean;
  operation: string;
  message: string;
  data?: unknown;
};

const VALID_STATUSES: TaskStatus[] = ['brainstorming', 'todo', 'progress', 'review', 'done'];

// Active watchers keyed by projectId
const activeWatchers = new Map<string, fs.FSWatcher>();

// Track processed files to avoid double-processing
const processedFiles = new Set<string>();

// ==================== Operation Handlers ====================

function handleCreateTask(projectId: string, params: Record<string, unknown>): OperationResult {
  const name = params.name as string;
  if (!name) {
    return { success: false, operation: 'create_task', message: 'Missing required param: name' };
  }

  const status = (params.status as TaskStatus) || 'brainstorming';
  if (!VALID_STATUSES.includes(status)) {
    return { success: false, operation: 'create_task', message: `Invalid status: ${status}` };
  }

  const db = getDatabase();
  const now = Date.now();
  const task: TTask = {
    id: `task_${nanoid()}`,
    project_id: projectId,
    name,
    description: (params.description as string) || undefined,
    status,
    sort_order: 0,
    created_at: now,
    updated_at: now,
  };

  const result = db.createTask(task);
  if (!result.success) {
    return { success: false, operation: 'create_task', message: result.error || 'Failed to create task' };
  }

  ipcBridge.workTask.created.emit(task);
  return { success: true, operation: 'create_task', message: `Task "${name}" created`, data: { id: task.id } };
}

function handleUpdateTask(params: Record<string, unknown>): OperationResult {
  const taskId = params.task_id as string;
  if (!taskId) {
    return { success: false, operation: 'update_task', message: 'Missing required param: task_id' };
  }

  const updates: Partial<Pick<TTask, 'name' | 'description' | 'status'>> = {};
  if (params.name !== undefined) updates.name = params.name as string;
  if (params.description !== undefined) updates.description = params.description as string;
  if (params.status !== undefined) {
    const status = params.status as TaskStatus;
    if (!VALID_STATUSES.includes(status)) {
      return { success: false, operation: 'update_task', message: `Invalid status: ${status}` };
    }
    updates.status = status;
  }

  if (Object.keys(updates).length === 0) {
    return { success: false, operation: 'update_task', message: 'No updates provided' };
  }

  const db = getDatabase();
  const result = db.updateTask(taskId, updates);
  if (!result.success) {
    return { success: false, operation: 'update_task', message: result.error || 'Failed to update task' };
  }

  const taskResult = db.getTask(taskId);
  if (taskResult.success && taskResult.data) {
    ipcBridge.workTask.updated.emit(taskResult.data);
  }

  return { success: true, operation: 'update_task', message: `Task ${taskId} updated` };
}

function handleDeleteTask(params: Record<string, unknown>): OperationResult {
  const taskId = params.task_id as string;
  if (!taskId) {
    return { success: false, operation: 'delete_task', message: 'Missing required param: task_id' };
  }

  const db = getDatabase();
  const result = db.deleteTask(taskId);
  if (!result.success) {
    return { success: false, operation: 'delete_task', message: result.error || 'Failed to delete task' };
  }

  ipcBridge.workTask.deleted.emit({ id: taskId });
  return { success: true, operation: 'delete_task', message: `Task ${taskId} deleted` };
}

function handleUpdateProject(projectId: string, params: Record<string, unknown>): OperationResult {
  const updates: Record<string, string> = {};
  if (params.name !== undefined) updates.name = params.name as string;
  if (params.description !== undefined) updates.description = params.description as string;

  if (Object.keys(updates).length === 0) {
    return { success: false, operation: 'update_project', message: 'No updates provided' };
  }

  const db = getDatabase();
  const result = db.updateProject(projectId, updates);
  if (!result.success) {
    return { success: false, operation: 'update_project', message: result.error || 'Failed to update project' };
  }

  const projResult = db.getProject(projectId);
  if (projResult.success && projResult.data) {
    ipcBridge.project.updated.emit(projResult.data);
  }

  return { success: true, operation: 'update_project', message: 'Project updated' };
}

// ==================== Operation Dispatcher ====================

function executeOperation(projectId: string, payload: OperationPayload): OperationResult {
  switch (payload.operation) {
    case 'create_task':
      return handleCreateTask(projectId, payload.params);
    case 'update_task':
      return handleUpdateTask(payload.params);
    case 'delete_task':
      return handleDeleteTask(payload.params);
    case 'update_project':
      return handleUpdateProject(projectId, payload.params);
    case 'list_tasks':
      // Just sync context - the LLM reads the files
      return { success: true, operation: 'list_tasks', message: 'Context synced. Read .aionui/context/tasks.json' };
    default:
      return { success: false, operation: payload.operation, message: `Unknown operation: ${payload.operation}` };
  }
}

// ==================== File Processing ====================

function processOperationFile(projectId: string, workspace: string, filePath: string): void {
  if (processedFiles.has(filePath)) return;
  processedFiles.add(filePath);

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const payload = JSON.parse(content) as OperationPayload;

    if (!payload.operation) {
      console.warn(`[ProjectOps] Invalid operation file (no "operation" field): ${filePath}`);
      return;
    }

    console.log(`[ProjectOps] Executing operation: ${payload.operation} from ${path.basename(filePath)}`);
    const result = executeOperation(projectId, payload);
    console.log(`[ProjectOps] Result: ${result.success ? 'OK' : 'FAIL'} - ${result.message}`);

    // Write result next to the operation file
    const resultPath = filePath.replace('.json', '.result.json');
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf-8');

    // Sync context files after operation
    syncProjectContext(projectId);

    // Remove the operation file after processing
    fs.unlinkSync(filePath);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[ProjectOps] Failed to process operation file ${filePath}:`, msg);
  }
}

// ==================== Watcher Management ====================

/**
 * Start watching the .aionui/operations/ directory for a project.
 * When a new .json file appears, it will be parsed and executed.
 */
export function startProjectWatcher(projectId: string, workspace: string): void {
  if (activeWatchers.has(projectId)) {
    console.log(`[ProjectOps] Watcher already active for project ${projectId}`);
    return;
  }

  const opsDir = path.join(getProjectContextDir(workspace), 'operations');
  if (!fs.existsSync(opsDir)) {
    fs.mkdirSync(opsDir, { recursive: true });
  }

  // Process any existing operation files
  const existingFiles = fs.readdirSync(opsDir).filter((f) => f.endsWith('.json') && !f.endsWith('.result.json'));
  for (const file of existingFiles) {
    processOperationFile(projectId, workspace, path.join(opsDir, file));
  }

  try {
    const watcher = fs.watch(opsDir, (eventType, filename) => {
      if (!filename || !filename.endsWith('.json') || filename.endsWith('.result.json')) return;

      const filePath = path.join(opsDir, filename);

      // Debounce: wait for file to be fully written
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          processOperationFile(projectId, workspace, filePath);
        }
      }, 200);
    });

    activeWatchers.set(projectId, watcher);
    console.log(`[ProjectOps] Started watcher for project ${projectId} at ${opsDir}`);
  } catch (error) {
    console.error(`[ProjectOps] Failed to start watcher for project ${projectId}:`, error);
  }
}

/**
 * Stop watching the operations directory for a project.
 */
export function stopProjectWatcher(projectId: string): void {
  const watcher = activeWatchers.get(projectId);
  if (watcher) {
    watcher.close();
    activeWatchers.delete(projectId);
    processedFiles.clear();
    console.log(`[ProjectOps] Stopped watcher for project ${projectId}`);
  }
}

/**
 * Stop all active project watchers.
 */
export function stopAllProjectWatchers(): void {
  for (const [projectId, watcher] of activeWatchers) {
    watcher.close();
    console.log(`[ProjectOps] Stopped watcher for project ${projectId}`);
  }
  activeWatchers.clear();
  processedFiles.clear();
}
