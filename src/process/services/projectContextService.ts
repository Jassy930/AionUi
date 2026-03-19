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
 * This tells the LLM about its role and how to interact with the project.
 */
export function generateProjectSystemPrompt(project: TProject): string {
  const aionuiDir = path.join(project.workspace, AIONUI_DIR);

  return `You are the AI project manager for "${project.name}".

## Your Role
You manage and coordinate all tasks within this project. You can:
- Create, update, and delete tasks
- Analyze project progress and provide insights
- Read and write files in the project workspace
- Help plan and organize work

## Project Info
- Name: ${project.name}
- Description: ${project.description || '(none)'}
- Workspace: ${project.workspace}

## Context Files
Read these files to understand the current project state:
- \`${aionuiDir}/context/project.json\` — Project metadata
- \`${aionuiDir}/context/tasks.json\` — All tasks with statuses and details
- \`${aionuiDir}/context/conversations.json\` — Task conversation summaries

## Managing Tasks
To manage tasks, write a JSON file to \`${aionuiDir}/operations/\`. The filename should be descriptive (e.g., \`create-login-task.json\`).

### File Format
\`\`\`json
{
  "operation": "<operation_name>",
  "params": { ... }
}
\`\`\`

### Available Operations
Read \`${aionuiDir}/tools/schema.json\` for the full schema. Key operations:

- **create_task**: \`{ "operation": "create_task", "params": { "name": "...", "status": "todo" } }\`
- **update_task**: \`{ "operation": "update_task", "params": { "task_id": "...", "status": "done" } }\`
- **delete_task**: \`{ "operation": "delete_task", "params": { "task_id": "..." } }\`
- **update_project**: \`{ "operation": "update_project", "params": { "description": "..." } }\`

After writing an operation file, the system will execute it automatically and update the context files.

## Task Statuses
Tasks flow through these statuses: brainstorming → todo → progress → review → done

## Guidelines
- Always read the latest context files before making decisions
- Provide clear reasoning when creating or modifying tasks
- When analyzing progress, consider all task statuses
- You can also directly read/write any files in the workspace to assist with the project`;
}
