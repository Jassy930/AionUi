/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Task status enum
 * Task 状态枚举
 */
export type TaskStatus = 'pending' | 'in_progress' | 'done';

/**
 * Task entity type
 * Task 实体类型
 */
export type TTask = {
  id: string;
  name: string;
  description?: string;
  status: TaskStatus;
  user_id: string;
  created_at: number;
  updated_at: number;
};

/**
 * Task database row type
 * Task 数据库行类型
 */
export type ITaskRow = {
  id: string;
  name: string;
  description: string | null;
  status: TaskStatus;
  user_id: string;
  created_at: number;
  updated_at: number;
};

/**
 * Convert TTask to database row
 */
export function taskToRow(task: TTask): ITaskRow {
  return {
    id: task.id,
    name: task.name,
    description: task.description ?? null,
    status: task.status,
    user_id: task.user_id,
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
    name: row.name,
    description: row.description ?? undefined,
    status: row.status,
    user_id: row.user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Create task params
 */
export type ICreateTaskParams = {
  name: string;
  description?: string;
  status?: TaskStatus;
};

/**
 * Update task params
 */
export type IUpdateTaskParams = {
  id: string;
  updates: Partial<Pick<TTask, 'name' | 'description' | 'status'>>;
};

/**
 * Task with conversation count
 */
export type TTaskWithCount = TTask & {
  conversation_count: number;
};
