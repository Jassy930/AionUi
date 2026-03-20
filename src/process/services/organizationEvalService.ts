/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { nanoid } from 'nanoid';
import type {
  ICreateOrgArtifactParams,
  IOrgEvalExecuteParams,
  TOrgArtifact,
  TOrgEvalExecutionResult,
  TOrgEvalSpec,
  TOrgRun,
  TOrgTask,
} from '@/common/types/organization';
import type { IQueryResult } from '@process/database/types';
import { getDatabase } from '@process/database';
import { safeExecFile } from '@process/utils/safeExec';

function getTaskAndRun(params: IOrgEvalExecuteParams): IQueryResult<{
  task: TOrgTask;
  run?: TOrgRun;
  evalSpec?: TOrgEvalSpec;
}> {
  const db = getDatabase();
  const taskResult = db.getOrgTask(params.task_id);
  if (!taskResult.success || !taskResult.data) {
    return { success: false, error: 'Organization task not found' };
  }

  let run: TOrgRun | undefined;
  if (params.run_id) {
    const runResult = db.getOrgRun(params.run_id);
    if (!runResult.success || !runResult.data) {
      return { success: false, error: 'Organization run not found' };
    }
    if (runResult.data.task_id !== params.task_id) {
      return { success: false, error: 'Run does not belong to the provided task' };
    }
    run = runResult.data;
  }

  let evalSpec: TOrgEvalSpec | undefined;
  if (params.eval_spec_id) {
    const evalSpecResult = db.getOrgEvalSpec(params.eval_spec_id);
    if (!evalSpecResult.success || !evalSpecResult.data) {
      return { success: false, error: 'Organization eval spec not found' };
    }
    if (evalSpecResult.data.organization_id !== taskResult.data.organization_id) {
      return { success: false, error: 'Eval spec does not belong to the task organization' };
    }
    evalSpec = evalSpecResult.data;
  }

  return {
    success: true,
    data: {
      task: taskResult.data,
      run,
      evalSpec,
    },
  };
}

export function registerOrganizationArtifact(params: ICreateOrgArtifactParams): IQueryResult<TOrgArtifact> {
  const db = getDatabase();
  const taskResult = db.getOrgTask(params.task_id);
  if (!taskResult.success || !taskResult.data) {
    return { success: false, error: 'Organization task not found' };
  }
  if (taskResult.data.organization_id !== params.organization_id) {
    return { success: false, error: 'Task does not belong to this organization' };
  }

  const runResult = db.getOrgRun(params.run_id);
  if (!runResult.success || !runResult.data) {
    return { success: false, error: 'Organization run not found' };
  }
  if (runResult.data.organization_id !== params.organization_id) {
    return { success: false, error: 'Run does not belong to this organization' };
  }
  if (runResult.data.task_id !== params.task_id) {
    return { success: false, error: 'Run does not belong to the provided task' };
  }

  const now = Date.now();
  const artifact: TOrgArtifact = {
    id: `org_artifact_${nanoid()}`,
    ...params,
    created_at: now,
    updated_at: now,
  };
  return db.createOrgArtifact(artifact);
}

export async function executeOrganizationEval(
  params: IOrgEvalExecuteParams
): Promise<IQueryResult<TOrgEvalExecutionResult>> {
  const db = getDatabase();
  const resolved = getTaskAndRun(params);
  if (!resolved.success || !resolved.data) {
    return { success: false, error: resolved.error };
  }

  const { task, run, evalSpec } = resolved.data;
  const commands = evalSpec?.test_commands || [];
  const commandResults: Array<{ argv: string[]; passed: boolean; stdout?: string; stderr?: string; error?: string }> =
    [];

  for (const command of commands) {
    const [file, ...args] = command.argv;
    if (!file) {
      commandResults.push({
        argv: command.argv,
        passed: false,
        error: 'Missing executable',
      });
      continue;
    }

    try {
      const result = await safeExecFile(file, args, {
        timeout: command.timeout_ms,
        cwd: command.cwd || run?.workspace.path,
      });
      commandResults.push({
        argv: command.argv,
        passed: true,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    } catch (error: any) {
      commandResults.push({
        argv: command.argv,
        passed: false,
        stdout: error?.stdout,
        stderr: error?.stderr,
        error: error?.message || 'Command execution failed',
      });
    }
  }

  const passedCount = commandResults.filter((item) => item.passed).length;
  const totalCount = commandResults.length || 1;
  const score = passedCount / totalCount;
  const thresholdViolations: string[] = [];

  if ((evalSpec?.thresholds?.min_pass_rate ?? 0) > score) {
    thresholdViolations.push(`min_pass_rate:${evalSpec?.thresholds?.min_pass_rate}`);
  }
  if (commandResults.some((item) => !item.passed)) {
    thresholdViolations.push('command_failure');
  }

  const passed = thresholdViolations.length === 0;
  const summary = `${passedCount}/${commandResults.length} commands passed for ${evalSpec?.name || 'implicit eval'}.`;

  if (run) {
    const nextLogs = [
      ...(run.execution_logs || []),
      {
        at: Date.now(),
        level: passed ? ('info' as const) : ('warn' as const),
        message: `Eval result: ${summary}`,
      },
    ];
    db.updateOrgRun(run.id, {
      status: passed ? 'reviewing' : 'verifying',
      execution_logs: nextLogs,
    });
  }

  return {
    success: true,
    data: {
      task_id: task.id,
      run_id: run?.id,
      eval_spec_id: evalSpec?.id,
      passed,
      score,
      threshold_violations: thresholdViolations,
      summary,
    },
  };
}
