/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// ==================== Project ====================

/**
 * Project status enum
 * Project 状态枚举
 */
export type ProjectStatus = 'brainstorming' | 'todo' | 'progressing' | 'done';

/**
 * Project entity type (top-level work container)
 * Project 实体类型（顶层工作容器）
 */
export type TProject = {
  id: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  user_id: string;
  created_at: number;
  updated_at: number;
};

/**
 * Project database row type
 */
export type IProjectRow = {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  user_id: string;
  created_at: number;
  updated_at: number;
};

/**
 * Convert TProject to database row
 */
export function projectToRow(project: TProject): IProjectRow {
  return {
    id: project.id,
    name: project.name,
    description: project.description ?? null,
    status: project.status,
    user_id: project.user_id,
    created_at: project.created_at,
    updated_at: project.updated_at,
  };
}

/**
 * Convert database row to TProject
 */
export function rowToProject(row: IProjectRow): TProject {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status,
    user_id: row.user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Create project params
 */
export type ICreateProjectParams = {
  name: string;
  description?: string;
  status?: ProjectStatus;
};

/**
 * Update project params
 */
export type IUpdateProjectParams = {
  id: string;
  updates: Partial<Pick<TProject, 'name' | 'description' | 'status'>>;
};

/**
 * Project with task count
 */
export type TProjectWithCount = TProject & {
  task_count: number;
};

// ==================== Task ====================

/**
 * Task status enum
 * Task 状态枚举
 */
export type TaskStatus = 'pending' | 'in_progress' | 'done';

/**
 * Task entity type (work item within a Project)
 * Task 实体类型（Project 内的工作项）
 */
export type TTask = {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  status: TaskStatus;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

/**
 * Task database row type
 */
export type ITaskRow = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  status: TaskStatus;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

/**
 * Convert TTask to database row
 */
export function taskToRow(task: TTask): ITaskRow {
  return {
    id: task.id,
    project_id: task.project_id,
    name: task.name,
    description: task.description ?? null,
    status: task.status,
    sort_order: task.sort_order,
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
}

/**
 * Convert database row to TTask
 */
export function rowToTask(row: ITaskRow): TTask {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Create task params
 */
export type ICreateTaskParams = {
  project_id: string;
  name: string;
  description?: string;
  status?: TaskStatus;
};

/**
 * Update task params
 */
export type IUpdateTaskParams = {
  id: string;
  updates: Partial<Pick<TTask, 'name' | 'description' | 'status' | 'sort_order'>>;
};

/**
 * Task with conversation count
 */
export type TTaskWithCount = TTask & {
  conversation_count: number;
};
