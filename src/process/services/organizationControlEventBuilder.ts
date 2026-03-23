/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TOrgRun, TOrgTask } from '@/common/types/organization';

export type TOrganizationControlEventBuildResult = {
  summary: string;
  payload: Record<string, unknown>;
  taskId?: string;
  runId?: string;
};

type TTaskCreatedControlEventInput = {
  organizationId: string;
  task: Pick<TOrgTask, 'id' | 'title' | 'objective' | 'risk_tier' | 'status'>;
};

type TRunStartedControlEventInput = {
  organizationId: string;
  task: Pick<TOrgTask, 'id' | 'title'>;
  run: Pick<TOrgRun, 'id' | 'status' | 'conversation_id'>;
  workspace: string;
};

export function buildTaskCreatedControlEventPayload(
  input: TTaskCreatedControlEventInput
): TOrganizationControlEventBuildResult {
  return {
    taskId: input.task.id,
    summary: `Task ${input.task.id} created: ${input.task.title}.`,
    payload: {
      organization_id: input.organizationId,
      task_id: input.task.id,
      title: input.task.title,
      objective: input.task.objective,
      risk_tier: input.task.risk_tier,
      status: input.task.status,
      object_ids: {
        organization_id: input.organizationId,
        task_id: input.task.id,
      },
    },
  };
}

export function buildRunStartedControlEventPayload(
  input: TRunStartedControlEventInput
): TOrganizationControlEventBuildResult {
  return {
    taskId: input.task.id,
    runId: input.run.id,
    summary: `Run ${input.run.id} started for task ${input.task.id}.`,
    payload: {
      organization_id: input.organizationId,
      task_id: input.task.id,
      task_title: input.task.title,
      run_id: input.run.id,
      status: input.run.status,
      workspace: input.workspace,
      conversation_id: input.run.conversation_id,
      object_ids: {
        organization_id: input.organizationId,
        task_id: input.task.id,
        run_id: input.run.id,
      },
    },
  };
}
