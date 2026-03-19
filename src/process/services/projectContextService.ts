/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Project Context Service
 *
 * Manages the `.aionui/` directory inside a project's workspace.
 * This directory provides structured context files for the project-level
 * AI conversation, enabling the LLM to read project state and issue
 * operations via file-based commands.
 *
 * Directory structure:
 *   .aionui/
 *   ├── context/
 *   │   ├── project.json         # Project metadata
 *   │   ├── tasks.json           # All tasks with statuses
 *   │   └── conversations.json   # Task conversation summaries
 *   ├── tools/
 *   │   └── schema.json          # Available operations the LLM can invoke
 *   └── operations/
 *       └── (LLM writes command files here, watcher executes them)
 */

import fs from 'node:fs';
import path from 'node:path';
import type { TProject, TTaskWithCount } from '@/common/types/task';
import type { TChatConversation } from '@/common/storage';
import { getDatabase } from '@process/database';

const AIONUI_DIR = '.aionui';

// ==================== Directory Helpers ====================

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ==================== Context Generation ====================

function buildProjectContext(project: TProject) {
  return {
    id: project.id,
    name: project.name,
    description: project.description || '',
    workspace: project.workspace,
    created_at: project.created_at,
    updated_at: project.updated_at,
  };
}

function buildTasksContext(tasks: TTaskWithCount[]) {
  return tasks.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description || '',
    status: t.status,
    sort_order: t.sort_order,
    conversation_count: t.conversation_count,
    created_at: t.created_at,
    updated_at: t.updated_at,
  }));
}

function buildConversationsContext(taskConversations: Record<string, TChatConversation[]>) {
  const result: Record<string, Array<{ id: string; name: string; status?: string; type: string }>> = {};
  for (const [taskId, convs] of Object.entries(taskConversations)) {
    result[taskId] = convs.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      type: c.type,
    }));
  }
  return result;
}

function buildToolsSchema() {
  return {
    version: 1,
    description: 'Available operations for managing this project. Write a JSON file to .aionui/operations/ to execute.',
    operations: [
      {
        name: 'create_task',
        description: 'Create a new task in this project',
        params: {
          name: { type: 'string', required: true, description: 'Task name' },
          description: { type: 'string', required: false, description: 'Task description' },
          status: {
            type: 'string',
            required: false,
            enum: ['brainstorming', 'todo', 'progress', 'review', 'done'],
            default: 'brainstorming',
            description: 'Initial task status',
          },
        },
      },
      {
        name: 'update_task',
        description: 'Update an existing task',
        params: {
          task_id: { type: 'string', required: true, description: 'Task ID to update' },
          name: { type: 'string', required: false, description: 'New task name' },
          description: { type: 'string', required: false, description: 'New description' },
          status: {
            type: 'string',
            required: false,
            enum: ['brainstorming', 'todo', 'progress', 'review', 'done'],
            description: 'New task status',
          },
        },
      },
      {
        name: 'delete_task',
        description: 'Delete a task',
        params: {
          task_id: { type: 'string', required: true, description: 'Task ID to delete' },
        },
      },
      {
        name: 'list_tasks',
        description: 'Refresh and re-read the current task list (reads from .aionui/context/tasks.json)',
        params: {},
      },
      {
        name: 'update_project',
        description: 'Update project metadata',
        params: {
          name: { type: 'string', required: false, description: 'New project name' },
          description: { type: 'string', required: false, description: 'New project description' },
        },
      },
    ],
    format: {
      description: 'Write a JSON file to .aionui/operations/ with this structure',
      example: {
        operation: 'create_task',
        params: { name: 'Implement login page', status: 'todo' },
      },
    },
  };
}

// ==================== Public API ====================

/**
 * Initialize the .aionui directory structure for a project.
 * Creates all subdirectories and writes initial context files.
 */
export function initProjectContext(project: TProject): void {
  if (!project.workspace) {
    console.warn('[ProjectContext] Cannot init: project has no workspace');
    return;
  }

  const baseDir = path.join(project.workspace, AIONUI_DIR);
  ensureDir(path.join(baseDir, 'context'));
  ensureDir(path.join(baseDir, 'tools'));
  ensureDir(path.join(baseDir, 'operations'));

  // Write tools schema (static)
  writeJson(path.join(baseDir, 'tools', 'schema.json'), buildToolsSchema());

  // Write initial context
  writeJson(path.join(baseDir, 'context', 'project.json'), buildProjectContext(project));

  console.log(`[ProjectContext] Initialized .aionui for project "${project.name}" at ${baseDir}`);
}

/**
 * Sync all context files for a project (project metadata, tasks, conversations).
 * Called when project data changes or before the LLM conversation starts.
 */
export function syncProjectContext(projectId: string): void {
  const db = getDatabase();

  const projResult = db.getProject(projectId);
  if (!projResult.success || !projResult.data) {
    console.warn(`[ProjectContext] Cannot sync: project ${projectId} not found`);
    return;
  }

  const project = projResult.data;
  if (!project.workspace) {
    console.warn('[ProjectContext] Cannot sync: project has no workspace');
    return;
  }

  const baseDir = path.join(project.workspace, AIONUI_DIR);
  ensureDir(path.join(baseDir, 'context'));

  // 1. Project metadata
  writeJson(path.join(baseDir, 'context', 'project.json'), buildProjectContext(project));

  // 2. Tasks
  const tasksResult = db.getProjectTasks(projectId);
  const tasks: TTaskWithCount[] = tasksResult.success && tasksResult.data ? tasksResult.data : [];
  writeJson(path.join(baseDir, 'context', 'tasks.json'), buildTasksContext(tasks));

  // 3. Task conversations
  const taskConversations: Record<string, TChatConversation[]> = {};
  for (const task of tasks) {
    const convsResult = db.getTaskConversations(task.id);
    if (convsResult.success && convsResult.data) {
      taskConversations[task.id] = convsResult.data;
    }
  }
  writeJson(path.join(baseDir, 'context', 'conversations.json'), buildConversationsContext(taskConversations));

  // Ensure tools schema is up to date
  ensureDir(path.join(baseDir, 'tools'));
  writeJson(path.join(baseDir, 'tools', 'schema.json'), buildToolsSchema());

  console.log(`[ProjectContext] Synced context for project "${project.name}"`);
}

/**
 * Get the .aionui base directory for a project workspace.
 */
export function getProjectContextDir(workspace: string): string {
  return path.join(workspace, AIONUI_DIR);
}

/**
 * Generate a system prompt for the project-level AI conversation.
 * Includes strict role definition, inline project state snapshot,
 * and operational instructions so the LLM is immediately effective.
 */
export function generateProjectSystemPrompt(projectId: string): string {
  const db = getDatabase();

  const projResult = db.getProject(projectId);
  if (!projResult.success || !projResult.data) {
    return '';
  }
  const project = projResult.data;
  if (!project.workspace) {
    return '';
  }

  const aionuiDir = path.join(project.workspace, AIONUI_DIR);

  // Gather live task state for inline snapshot
  const tasksResult = db.getProjectTasks(projectId);
  const tasks: TTaskWithCount[] = tasksResult.success && tasksResult.data ? tasksResult.data : [];

  const statusCounts: Record<string, number> = {};
  for (const t of tasks) {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  }

  const taskListLines = tasks.map((t) => `  - [${t.status}] ${t.name} (id: ${t.id})`);
  const taskSnapshot =
    tasks.length > 0
      ? `Total: ${tasks.length} task(s) — ${Object.entries(statusCounts)
          .map(([s, c]) => `${s}: ${c}`)
          .join(', ')}\n${taskListLines.join('\n')}`
      : 'No tasks yet.';

  return `<SYSTEM_ROLE>
You are the **Project Manager AI** for the project "${project.name}".
This is a STRICT role — you are responsible for managing all tasks, tracking progress, and coordinating work within this project. You are NOT a general-purpose chatbot.
</SYSTEM_ROLE>

<PROJECT>
Name: ${project.name}
Description: ${project.description || '(not set)'}
Workspace: ${project.workspace}
</PROJECT>

<CURRENT_STATE>
${taskSnapshot}
</CURRENT_STATE>

<CONTEXT_FILES>
The \`.aionui/\` directory in the workspace contains live project state.
Always read these files to get the LATEST data before making decisions or answering questions:

- \`${aionuiDir}/context/project.json\`  — Project metadata
- \`${aionuiDir}/context/tasks.json\`    — All tasks (id, name, description, status)
- \`${aionuiDir}/context/conversations.json\` — Conversations linked to each task
- \`${aionuiDir}/tools/schema.json\`     — Full operation schema reference
</CONTEXT_FILES>

<TASK_OPERATIONS>
You manage tasks by writing a JSON file to \`${aionuiDir}/operations/\`.
The system watches this directory and executes commands automatically, then updates context files.

File format — each file must contain exactly one operation:
\`\`\`json
{ "operation": "<name>", "params": { ... } }
\`\`\`

Available operations:

1. **create_task** — Create a new task
   params: { "name": string (required), "description": string, "status": "brainstorming"|"todo"|"progress"|"review"|"done" }

2. **update_task** — Update an existing task
   params: { "task_id": string (required), "name": string, "description": string, "status": string }

3. **delete_task** — Delete a task
   params: { "task_id": string (required) }

4. **update_project** — Update project metadata
   params: { "name": string, "description": string }

Filename must be unique and descriptive, e.g. \`create-auth-module.json\`, \`mark-task-done-xxx.json\`.
</TASK_OPERATIONS>

<TASK_WORKFLOW>
Tasks flow through five stages:  brainstorming → todo → progress → review → done
- **brainstorming**: Ideas and proposals, not yet committed
- **todo**: Accepted and planned, ready to start
- **progress**: Actively being worked on
- **review**: Implementation done, under review
- **done**: Completed and verified
</TASK_WORKFLOW>

<BEHAVIORAL_RULES>
1. **Read before act**: Always read \`${aionuiDir}/context/tasks.json\` before creating, updating, or analyzing tasks. Never rely solely on the snapshot above — it may be stale.
2. **Explain before operate**: When creating or modifying tasks, explain your reasoning first, then perform the operation.
3. **Stay in scope**: You manage THIS project only. Do not discuss unrelated topics. If the user asks something outside your role, politely redirect to project management.
4. **Be structured**: When reporting progress, use clear tables or lists organized by status.
5. **Proactive analysis**: When asked about project status, provide completion percentages, blockers, and suggested next steps.
6. **File access**: You can read and write any files in \`${project.workspace}\` to assist with the project (e.g., reviewing code, writing specs, updating documentation). Use this capability to provide informed task management.
7. **Language**: Respond in the same language the user uses.
</BEHAVIORAL_RULES>`;
}
