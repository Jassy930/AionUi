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
 *
 * Supports both synchronous operations (task CRUD) and asynchronous
 * sub-agent operations (create_conversation, send_message).
 */

import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { TTask, TaskStatus } from '@/common/types/task';
import type { TMessage } from '@/common/chatLib';
import { ipcBridge } from '@/common';
import { uuid } from '@/common/utils';
import { getDatabase } from '@process/database';
import { ConversationService } from '@process/services/conversationService';
import { cronBusyGuard } from '@process/services/cron/CronBusyGuard';
import WorkerManage from '@process/WorkerManage';
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

// Default timeout for sub-agent responses (5 minutes)
const SUBAGENT_TIMEOUT_MS = 300_000;

// ==================== Task Operation Handlers ====================

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

// ==================== Sub-Agent Operation Handlers ====================

/**
 * Create a sub-conversation (sub-agent) for a task.
 * The conversation is created with the specified backend and associated with the task.
 */
async function handleCreateConversation(
  projectId: string,
  workspace: string,
  params: Record<string, unknown>
): Promise<OperationResult> {
  const taskId = params.task_id as string;
  if (!taskId) {
    return { success: false, operation: 'create_conversation', message: 'Missing required param: task_id' };
  }

  const db = getDatabase();
  const taskResult = db.getTask(taskId);
  if (!taskResult.success || !taskResult.data) {
    return { success: false, operation: 'create_conversation', message: `Task ${taskId} not found` };
  }
  if (taskResult.data.project_id !== projectId) {
    return { success: false, operation: 'create_conversation', message: 'Task does not belong to this project' };
  }

  const backend = (params.backend as string) || 'claude';
  const name = (params.name as string) || `Sub-agent: ${taskResult.data.name}`;
  const systemPrompt = (params.system_prompt as string) || '';

  try {
    const result = await ConversationService.createConversation({
      type: 'acp',
      model: {} as any,
      name,
      taskId,
      extra: {
        workspace,
        customWorkspace: true,
        backend: backend as any,
        agentName: backend,
        presetContext: systemPrompt || undefined,
      },
    });

    if (!result.success || !result.conversation) {
      return {
        success: false,
        operation: 'create_conversation',
        message: result.error || 'Failed to create conversation',
      };
    }

    // Notify UI so the task card updates its conversation list
    ipcBridge.workTask.conversationsChanged.emit({ taskId });

    return {
      success: true,
      operation: 'create_conversation',
      message: `Conversation created for task "${taskResult.data.name}"`,
      data: { conversation_id: result.conversation.id, task_id: taskId, backend },
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, operation: 'create_conversation', message: `Error: ${msg}` };
  }
}

/**
 * Extract the last assistant response text from conversation messages.
 */
function extractLastResponse(conversationId: string): string {
  const db = getDatabase();
  const msgs = db.getConversationMessages(conversationId, 0, 50, 'DESC');
  if (!msgs?.data?.length) return '(no response)';

  // Collect all consecutive assistant text messages (they arrive in DESC order)
  const parts: string[] = [];
  for (const msg of msgs.data) {
    if (msg.position !== 'left') {
      if (parts.length > 0) break; // reached user message after assistant messages
      continue;
    }
    if (msg.type === 'text') {
      const content = (msg.content as { content?: string })?.content || '';
      if (content) parts.push(content);
    }
  }

  // parts are in DESC order, reverse to get chronological
  return parts.reverse().join('\n') || '(no response)';
}

/**
 * Send a message to an existing sub-conversation and wait for the full response.
 * Uses cronBusyGuard.onceIdle() to detect when the agent finishes its turn.
 */
async function handleSendMessage(params: Record<string, unknown>): Promise<OperationResult> {
  const conversationId = params.conversation_id as string;
  if (!conversationId) {
    return { success: false, operation: 'send_message', message: 'Missing required param: conversation_id' };
  }

  const message = params.message as string;
  if (!message) {
    return { success: false, operation: 'send_message', message: 'Missing required param: message' };
  }

  const timeoutMs = (params.timeout as number) || SUBAGENT_TIMEOUT_MS;

  // Look up associated task for UI notifications
  const db = getDatabase();
  const convResult = db.getConversation(conversationId);
  const taskId = (convResult?.data?.extra as Record<string, unknown> | undefined)?.taskId as string | undefined;

  try {
    // Build/get the agent task
    const task = await WorkerManage.getTaskByIdRollbackBuild(conversationId);
    if (!task) {
      return { success: false, operation: 'send_message', message: 'Conversation agent not found' };
    }

    const msgId = uuid();

    // Notify UI that sub-agent is now active
    if (taskId) ipcBridge.workTask.conversationsChanged.emit({ taskId });

    // Send the message
    const sendResult = await (task as any).sendMessage({
      content: message,
      msg_id: msgId,
    });

    if (sendResult && !sendResult.success) {
      if (taskId) ipcBridge.workTask.conversationsChanged.emit({ taskId });
      return {
        success: false,
        operation: 'send_message',
        message: sendResult.msg || sendResult.message || 'sendMessage failed',
      };
    }

    // Wait for the agent to finish processing (turn complete)
    await waitForTurnComplete(conversationId, timeoutMs);

    // Extract the response from the database
    const response = extractLastResponse(conversationId);

    return {
      success: true,
      operation: 'send_message',
      message: 'Response received',
      data: { conversation_id: conversationId, response },
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, operation: 'send_message', message: `Error: ${msg}` };
  } finally {
    // Notify UI that sub-agent turn is done (status may have changed)
    if (taskId) ipcBridge.workTask.conversationsChanged.emit({ taskId });
  }
}

/**
 * Wait for a sub-agent to finish its current turn.
 * Combines cronBusyGuard.onceIdle with a timeout.
 */
function waitForTurnComplete(conversationId: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Sub-agent response timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    cronBusyGuard.onceIdle(conversationId, () => {
      clearTimeout(timeout);
      // Small delay to let final DB writes flush
      setTimeout(resolve, 500);
    });
  });
}

/**
 * Get messages from an existing sub-conversation.
 */
function handleGetMessages(params: Record<string, unknown>): OperationResult {
  const conversationId = params.conversation_id as string;
  if (!conversationId) {
    return { success: false, operation: 'get_messages', message: 'Missing required param: conversation_id' };
  }

  const limit = (params.limit as number) || 20;

  const db = getDatabase();
  const msgs = db.getConversationMessages(conversationId, 0, limit, 'DESC');
  if (!msgs?.data) {
    return { success: false, operation: 'get_messages', message: 'Failed to read messages' };
  }

  const simplified = msgs.data.reverse().map((m: TMessage) => ({
    id: m.id,
    role: m.position === 'right' ? 'user' : 'assistant',
    type: m.type,
    content: m.type === 'text' ? (m.content as { content?: string })?.content || '' : `[${m.type}]`,
    created_at: m.createdAt,
  }));

  return {
    success: true,
    operation: 'get_messages',
    message: `${simplified.length} message(s)`,
    data: { conversation_id: conversationId, messages: simplified },
  };
}

// ==================== Operation Dispatcher ====================

async function executeOperation(
  projectId: string,
  workspace: string,
  payload: OperationPayload
): Promise<OperationResult> {
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
      return { success: true, operation: 'list_tasks', message: 'Context synced. Read .aionui/context/tasks.json' };

    // Sub-agent operations (async)
    case 'create_conversation':
      return handleCreateConversation(projectId, workspace, payload.params);
    case 'send_message':
      return handleSendMessage(payload.params);
    case 'get_messages':
      return handleGetMessages(payload.params);

    default:
      return { success: false, operation: payload.operation, message: `Unknown operation: ${payload.operation}` };
  }
}

// ==================== File Processing ====================

async function processOperationFile(projectId: string, workspace: string, filePath: string): Promise<void> {
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
    const result = await executeOperation(projectId, workspace, payload);
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
    void processOperationFile(projectId, workspace, path.join(opsDir, file));
  }

  try {
    const watcher = fs.watch(opsDir, (eventType, filename) => {
      if (!filename || !filename.endsWith('.json') || filename.endsWith('.result.json')) return;

      const filePath = path.join(opsDir, filename);

      // Debounce: wait for file to be fully written
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          void processOperationFile(projectId, workspace, filePath);
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
