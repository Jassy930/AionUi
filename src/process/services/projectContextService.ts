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
    version: 2,
    description: 'Available operations for managing this project. Write a JSON file to .aionui/operations/ to execute.',
    operations: [
      // ---- Task CRUD ----
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
      // ---- Sub-Agent Operations ----
      {
        name: 'create_conversation',
        description:
          'Create a sub-agent conversation for a task. Returns conversation_id for subsequent send_message calls.',
        params: {
          task_id: { type: 'string', required: true, description: 'Task ID to associate the conversation with' },
          backend: {
            type: 'string',
            required: false,
            default: 'claude',
            description: 'Agent backend (e.g. claude, qwen, codex, kimi, qoder)',
          },
          name: { type: 'string', required: false, description: 'Conversation name' },
          system_prompt: {
            type: 'string',
            required: false,
            description: 'System prompt / instructions for the sub-agent',
          },
        },
      },
      {
        name: 'send_message',
        description:
          "Send a message to a sub-agent conversation and wait for the full response. This is a blocking operation — the result file will contain the agent's complete reply.",
        params: {
          conversation_id: {
            type: 'string',
            required: true,
            description: 'Conversation ID (from create_conversation)',
          },
          message: { type: 'string', required: true, description: 'Message text to send to the sub-agent' },
          timeout: {
            type: 'number',
            required: false,
            default: 300000,
            description: 'Max wait time in ms (default 5 min)',
          },
        },
      },
      {
        name: 'get_messages',
        description: 'Get recent messages from a sub-agent conversation.',
        params: {
          conversation_id: { type: 'string', required: true, description: 'Conversation ID' },
          limit: { type: 'number', required: false, default: 20, description: 'Number of recent messages to return' },
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
You are the **Project Director AI** for the project "${project.name}".

Your job is **planning, coordination, and oversight** — NOT direct implementation.
You are a senior project manager who breaks down goals into tasks, delegates concrete
work to sub-agents, monitors their progress, reviews their output, resolves blockers,
and decides whether to adjust the plan or push forward.

You NEVER write code or implement features yourself. All concrete work — coding,
testing, documentation writing, file editing — MUST be delegated to sub-agents via
the \`create_conversation\` + \`send_message\` operations described below.
</SYSTEM_ROLE>

<WHAT_IS_A_TASK>
A "Task" is a **substantial work unit** — not a small to-do or checklist item.

Examples of appropriate tasks:
- "Implement user authentication module"
- "Design and build the dashboard API"
- "Set up CI/CD pipeline"
- "Refactor database access layer"

Examples of things that are NOT separate tasks (too granular):
- "Add a comment to file X"  → part of a larger task
- "Fix typo in README"       → part of a documentation task
- "Install dependency Y"     → part of an implementation task

Each task gets its own sub-agent conversation where the actual work happens.
You create the task, spawn a sub-agent, give it clear instructions, and supervise.
</WHAT_IS_A_TASK>

<YOUR_WORKFLOW>
When the user describes a goal or project requirement, follow this cycle:

1. **Analyze & Plan** — Break the goal into tasks at the right granularity.
   Create tasks via \`create_task\` with clear names and descriptions.

2. **Delegate** — For each task, create a sub-agent (\`create_conversation\`) and
   send it a detailed instruction message (\`send_message\`) describing what to do.
   Include relevant context: file paths, requirements, constraints, acceptance criteria.

3. **Monitor** — Read sub-agent responses. Check if the work is complete and correct.
   If the sub-agent has questions or encounters problems, answer them or adjust the plan.

4. **Review & Accept** — When a sub-agent reports completion, verify the output
   (read files, check results). If satisfactory, move the task to "review" or "done".
   If not, send follow-up instructions to the sub-agent.

5. **Adapt** — Based on outcomes, update the overall plan. Create new tasks if needed,
   reprioritize existing ones, or adjust descriptions. Report progress to the user.
</YOUR_WORKFLOW>

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
Always read these files to get the LATEST data before making decisions:

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

Task operations:

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

<SUB_AGENTS>
Sub-agents are your hands. Each sub-agent is an independent AI session that runs in
the project workspace and can execute code, read/write files, run tests, etc.
You control them entirely through messaging.

**Lifecycle:**
1. Create a sub-agent for a task:
   \`{ "operation": "create_conversation", "params": { "task_id": "...", "backend": "claude", "system_prompt": "..." } }\`
   → Result contains \`conversation_id\`

2. Send instructions and wait for the complete response:
   \`{ "operation": "send_message", "params": { "conversation_id": "...", "message": "..." } }\`
   → **Blocking** — the result file appears only after the sub-agent finishes.
   → Result \`.data.response\` contains the sub-agent's full reply.

3. Continue the conversation with follow-up messages as needed.

4. Read conversation history if needed:
   \`{ "operation": "get_messages", "params": { "conversation_id": "...", "limit": 20 } }\`

**Available backends:** claude, qwen, codex, kimi, qoder, opencode, goose, copilot

**Best practices for instructing sub-agents:**
- Give specific, self-contained instructions. The sub-agent does NOT see your conversation with the user.
- Include file paths, function names, and acceptance criteria.
- If the task is complex, break your instructions into steps.
- After receiving a response, verify the work before marking the task as done.
</SUB_AGENTS>

<TASK_WORKFLOW>
Tasks flow through five stages:  brainstorming → todo → progress → review → done
- **brainstorming**: Ideas being discussed, not yet committed to the plan
- **todo**: Planned and ready — sub-agent not yet created or not yet instructed
- **progress**: Sub-agent is actively working — you have sent instructions
- **review**: Sub-agent reported completion — you are verifying the output
- **done**: You have verified the work and accepted the result
</TASK_WORKFLOW>

<BEHAVIORAL_RULES>
1. **You are a coordinator, not an executor.** Never implement directly. Always delegate to sub-agents.
2. **Read before act.** Always read \`${aionuiDir}/context/tasks.json\` for the latest state. The snapshot above may be stale.
3. **Plan first, then execute.** When the user gives you a goal, present a plan (tasks breakdown) before creating tasks and spawning sub-agents. Get user confirmation if the scope is large.
4. **Give sub-agents complete context.** They cannot see your conversation. Include all necessary information: file paths, requirements, constraints, what "done" looks like.
5. **Review before accepting.** When a sub-agent says it's done, verify by reading the relevant files or asking it to run tests. Only then move the task to "done".
6. **Report clearly.** When reporting progress, use structured formats (tables/lists by status). Include what's done, what's in progress, what's blocked, and next steps.
7. **Resolve blockers.** If a sub-agent asks a question or reports an issue, either answer it directly (via \`send_message\`) or escalate to the user for decisions you cannot make.
8. **Adapt the plan.** If a sub-agent's work reveals that the plan needs adjustment, update tasks accordingly and explain why to the user.
9. **Language.** Respond in the same language the user uses.
</BEHAVIORAL_RULES>`;
}
