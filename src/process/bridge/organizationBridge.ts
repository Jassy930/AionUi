/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { nanoid } from 'nanoid';
import { ipcBridge } from '@/common';
import type {
  ICreateOrgEvalSpecParams,
  ICreateOrgSkillParams,
  ICreateOrganizationParams,
  IOrgRespondApprovalParams,
  IStartOrgRunParams,
  TOrgEvalSpec,
  TOrgGenomePatch,
  TOrgMemoryCard,
  TOrgRun,
  TOrgSkill,
  TOrganization,
} from '@/common/types/organization';
import type { AcpBackendAll } from '@/types/acpTypes';
import { getDatabase } from '@process/database';
import { getSystemDir } from '@process/initStorage';
import {
  generateOrganizationSystemPrompt,
  initOrganizationContext,
  syncOrganizationContext,
} from '@process/services/organizationContextService';
import {
  ensureOrganizationControlState,
  executeOrganizationOperation,
  reconcileOrganizationControlState,
  startOrganizationWatcher,
  stopOrganizationWatcher,
} from '@process/services/organizationOpsWatcher';
import {
  executeGenomePatchCanary,
  executeGenomePatchOfflineEval,
} from '@process/services/organizationEvolutionService';
import { ConversationService } from '@process/services/conversationService';

function wrapResult<T>(success: boolean, data?: T, msg?: string) {
  return success ? { success: true, data } : { success: false, msg };
}

function requireOrganization(organizationId: string) {
  const db = getDatabase();
  const result = db.getOrganization(organizationId);
  if (!result.success || !result.data) {
    return null;
  }
  return result.data;
}

function requireTask(taskId: string) {
  const db = getDatabase();
  const result = db.getOrgTask(taskId);
  if (!result.success || !result.data) {
    return null;
  }
  return result.data;
}

function ensureOrganizationRuntime(organization: TOrganization): void {
  initOrganizationContext(organization);
  ensureOrganizationControlState(organization.id);
  syncOrganizationContext(organization.id);
  startOrganizationWatcher(organization.id, organization.workspace);
}

function resolveRunWorkspace(run: TOrgRun, organization: TOrganization): string {
  return (typeof run.workspace?.path === 'string' && run.workspace.path) || organization.workspace;
}

function buildRunExecutorPrompt(organization: TOrganization, task: ReturnType<typeof requireTask>): string {
  const organizationPrompt = generateOrganizationSystemPrompt(organization.id);
  return `${organizationPrompt}

<RUN_EXECUTION>
You are executing organization run work for task "${task?.title}".
Stay within the task contract, produce concrete changes, and leave a concise final summary for run closure.
</RUN_EXECUTION>`;
}

async function createRunExecutionConversation(
  organization: TOrganization,
  task: NonNullable<ReturnType<typeof requireTask>>,
  run: TOrgRun
) {
  const execution = run.execution || {};
  const backend = (execution.backend as AcpBackendAll | undefined) || 'codex';
  const modelId = typeof execution.model === 'string' ? execution.model : undefined;

  return ConversationService.createConversation({
    type: 'acp',
    model: {} as any,
    name: `${task.title} · Run`,
    taskId: task.id,
    extra: {
      workspace: resolveRunWorkspace(run, organization),
      customWorkspace: true,
      backend,
      agentName: `${organization.name} Run Executor`,
      presetContext: buildRunExecutorPrompt(organization, task),
      currentModelId: modelId,
      organizationId: organization.id,
      runId: run.id,
      organizationRole: 'run_executor',
    },
  });
}

function extractConversationSummary(conversationId: string): string {
  const db = getDatabase();
  const result = db.getConversationMessages(conversationId, 0, 50, 'DESC');
  if (!result.data?.length) {
    return 'Run closed without assistant output.';
  }

  const parts: string[] = [];
  for (const message of result.data) {
    if (message.position !== 'left') {
      if (parts.length > 0) {
        break;
      }
      continue;
    }
    if (message.type !== 'text') {
      if (parts.length > 0) {
        break;
      }
      continue;
    }

    const content = (message.content as { content?: string } | undefined)?.content?.trim();
    if (!content) {
      continue;
    }
    parts.push(content);
  }

  return parts.reverse().join('\n').trim() || 'Run closed without assistant output.';
}

async function invokeOrganizationOperation<T>(
  organizationId: string,
  workspace: string,
  method: string,
  params: Record<string, unknown>
) {
  const result = await executeOrganizationOperation(organizationId, workspace, { method, params });
  return result.success ? { success: true, data: result.data as T } : { success: false, msg: result.message };
}

export function initOrganizationBridge(): void {
  const db = getDatabase();

  ipcBridge.org.organization.create.provider(async (params: ICreateOrganizationParams) => {
    try {
      const now = Date.now();
      const organization: TOrganization = {
        id: `org_${nanoid()}`,
        name: params.name,
        description: params.description,
        workspace: params.workspace || getSystemDir().workDir,
        user_id: db.getSystemUser()?.id || 'system_default_user',
        created_at: now,
        updated_at: now,
      };

      const result = db.createOrganization(organization);
      if (!result.success) {
        return wrapResult(false, undefined, result.error);
      }

      ensureOrganizationRuntime(organization);
      ipcBridge.org.organization.created.emit(organization);
      return wrapResult(true, organization);
    } catch (error: any) {
      return wrapResult(false, undefined, error.message);
    }
  });

  ipcBridge.org.organization.get.provider(async ({ id }) => {
    const result = db.getOrganization(id);
    return result.success ? wrapResult(true, result.data) : wrapResult(false, undefined, result.error);
  });

  ipcBridge.org.organization.list.provider(async () => {
    const result = db.listOrganizations();
    return result.success ? wrapResult(true, result.data || []) : wrapResult(false, [], result.error);
  });

  ipcBridge.org.organization.update.provider(async (params) => {
    const result = db.updateOrganization(params);
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }

    const organization = requireOrganization(params.id);
    if (organization) {
      ensureOrganizationRuntime(organization);
      ipcBridge.org.organization.updated.emit(organization);
    }

    return wrapResult(true, true);
  });

  ipcBridge.org.organization.initContext.provider(async ({ organizationId }) => {
    const organization = requireOrganization(organizationId);
    if (!organization) {
      return wrapResult(false, undefined, 'Organization not found');
    }

    ensureOrganizationRuntime(organization);
    return wrapResult(true, true);
  });

  ipcBridge.org.organization.syncContext.provider(async ({ organizationId }) => {
    const organization = requireOrganization(organizationId);
    if (!organization) {
      return wrapResult(false, undefined, 'Organization not found');
    }

    syncOrganizationContext(organizationId);
    return wrapResult(true, true);
  });

  ipcBridge.org.organization.getSystemPrompt.provider(async ({ organizationId }) => {
    const organization = requireOrganization(organizationId);
    if (!organization) {
      return wrapResult(false, undefined, 'Organization not found');
    }

    return wrapResult(true, generateOrganizationSystemPrompt(organizationId));
  });

  ipcBridge.org.organization.getControlState.provider(async ({ organizationId }) => {
    const organization = requireOrganization(organizationId);
    if (!organization) {
      return wrapResult(false, undefined, 'Organization not found');
    }

    const controlState = ensureOrganizationControlState(organizationId) || db.getOrgControlState(organizationId).data;
    return controlState
      ? wrapResult(true, controlState)
      : wrapResult(false, undefined, 'Organization control state not found');
  });

  ipcBridge.org.organization.listApprovals.provider(async ({ organizationId, status, limit }) => {
    const organization = requireOrganization(organizationId);
    if (!organization) {
      return wrapResult(false, [], 'Organization not found');
    }

    const result = db.listOrgApprovalRecords({
      organization_id: organizationId,
      status,
      limit,
    });
    return result.success ? wrapResult(true, result.data || []) : wrapResult(false, [], result.error);
  });

  ipcBridge.org.organization.respondApproval.provider(async (params: IOrgRespondApprovalParams) => {
    const organization = requireOrganization(params.organizationId);
    if (!organization) {
      return wrapResult(false, undefined, 'Organization not found');
    }

    const result = await invokeOrganizationOperation<boolean>(
      organization.id,
      organization.workspace,
      'org/approval/respond',
      {
        approval_id: params.approvalId,
        decision: params.decision,
        actor: params.actor,
        comment: params.comment,
      }
    );
    if (result.success) {
      syncOrganizationContext(organization.id);
    }
    return result;
  });

  ipcBridge.org.organization.delete.provider(async ({ id }) => {
    const result = db.deleteOrganization(id);
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }
    stopOrganizationWatcher(id);
    ipcBridge.org.organization.deleted.emit({ id });
    return wrapResult(true, result.data);
  });

  ipcBridge.org.task.create.provider(async (params) => {
    const organization = requireOrganization(params.organization_id);
    if (!organization) {
      return wrapResult(false, undefined, 'Organization not found');
    }

    const result = await invokeOrganizationOperation(
      organization.id,
      organization.workspace,
      'org/task/create',
      params
    );
    if (result.success && result.data) {
      ipcBridge.org.task.created.emit(result.data as any);
      syncOrganizationContext(organization.id);
    }
    return result;
  });

  ipcBridge.org.task.get.provider(async ({ id }) => {
    const result = db.getOrgTask(id);
    return result.success ? wrapResult(true, result.data) : wrapResult(false, undefined, result.error);
  });

  ipcBridge.org.task.list.provider(async (params) => {
    const result = db.getOrganizationTasks(params);
    return result.success ? wrapResult(true, result.data || []) : wrapResult(false, [], result.error);
  });

  ipcBridge.org.task.update.provider(async ({ id, updates }) => {
    const task = requireTask(id);
    if (!task) {
      return wrapResult(false, undefined, 'Organization task not found');
    }

    const result = await invokeOrganizationOperation(
      task.organization_id,
      requireOrganization(task.organization_id)?.workspace || '',
      'org/task/update',
      {
        id,
        updates,
      }
    );
    if (result.success) {
      const updatedTask = db.getOrgTask(id).data;
      if (updatedTask) {
        ipcBridge.org.task.updated.emit(updatedTask);
      }
      syncOrganizationContext(task.organization_id);
    }
    return result;
  });

  ipcBridge.org.task.updateStatus.provider(async ({ id, status }) => {
    const task = requireTask(id);
    if (!task) {
      return wrapResult(false, undefined, 'Organization task not found');
    }

    const result = db.updateOrgTask(id, { status });
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }

    ipcBridge.org.task.statusChanged.emit({ id, status });
    const updatedTask = db.getOrgTask(id).data;
    if (updatedTask) {
      ipcBridge.org.task.updated.emit(updatedTask);
    }
    syncOrganizationContext(task.organization_id);
    return wrapResult(true, true);
  });

  ipcBridge.org.task.delete.provider(async ({ id }) => {
    const task = requireTask(id);
    if (!task) {
      return wrapResult(false, undefined, 'Organization task not found');
    }

    const result = db.deleteOrgTask(id);
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }

    ipcBridge.org.task.deleted.emit({ id });
    syncOrganizationContext(task.organization_id);
    return wrapResult(true, result.data);
  });

  ipcBridge.org.run.start.provider(async (params: IStartOrgRunParams) => {
    const task = requireTask(params.task_id);
    if (!task) {
      return wrapResult(false, undefined, 'Organization task not found');
    }
    const previousTaskStatus = task.status;

    const organization = requireOrganization(task.organization_id);
    if (!organization) {
      return wrapResult(false, undefined, 'Organization not found');
    }

    const result = await invokeOrganizationOperation<TOrgRun>(
      organization.id,
      organization.workspace,
      'org/run/start',
      params as any
    );
    if (result.success && result.data) {
      const conversationResult = await createRunExecutionConversation(organization, task, result.data);
      if (!conversationResult.success || !conversationResult.conversation) {
        db.deleteOrgRun(result.data.id);
        db.updateOrgTask(task.id, { status: previousTaskStatus });
        reconcileOrganizationControlState(organization.id);
        syncOrganizationContext(organization.id);
        return wrapResult(
          false,
          undefined,
          conversationResult.error || 'Failed to create execution conversation for organization run'
        );
      }

      const associationResult = db.associateConversationWithOrgRun(
        conversationResult.conversation.id,
        organization.id,
        result.data.id
      );
      if (!associationResult.success) {
        db.deleteConversation(conversationResult.conversation.id);
        db.deleteOrgRun(result.data.id);
        db.updateOrgTask(task.id, { status: previousTaskStatus });
        reconcileOrganizationControlState(organization.id);
        syncOrganizationContext(organization.id);
        return wrapResult(
          false,
          undefined,
          associationResult.error || 'Failed to persist organization run conversation mapping'
        );
      }

      const bindResult = db.updateOrgRun(result.data.id, { conversation_id: conversationResult.conversation.id });
      if (!bindResult.success) {
        db.deleteConversation(conversationResult.conversation.id);
        db.deleteOrgRun(result.data.id);
        db.updateOrgTask(task.id, { status: previousTaskStatus });
        reconcileOrganizationControlState(organization.id);
        syncOrganizationContext(organization.id);
        return wrapResult(false, undefined, bindResult.error || 'Failed to bind conversation to organization run');
      }

      const updatedRun = db.getOrgRun(result.data.id).data || {
        ...result.data,
        conversation_id: conversationResult.conversation.id,
      };
      ipcBridge.org.run.created.emit(updatedRun);
      ipcBridge.org.run.statusChanged.emit({ id: updatedRun.id, status: updatedRun.status });
      syncOrganizationContext(organization.id);
      return wrapResult(true, updatedRun);
    }
    return result;
  });

  ipcBridge.org.run.get.provider(async ({ id }) => {
    const result = db.getOrgRun(id);
    return result.success ? wrapResult(true, result.data) : wrapResult(false, undefined, result.error);
  });

  ipcBridge.org.run.list.provider(async (params) => {
    const result = db.listOrgRuns(params);
    return result.success ? wrapResult(true, result.data || []) : wrapResult(false, [], result.error);
  });

  ipcBridge.org.run.update.provider(async ({ id, updates }) => {
    const run = db.getOrgRun(id).data;
    if (!run) {
      return wrapResult(false, undefined, 'Organization run not found');
    }

    const result = db.updateOrgRun(id, updates as any);
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }

    const updatedRun = db.getOrgRun(id).data;
    if (updatedRun) {
      ipcBridge.org.run.updated.emit(updatedRun);
      ipcBridge.org.run.statusChanged.emit({ id, status: updatedRun.status });
    }
    syncOrganizationContext(run.organization_id);
    return wrapResult(true, true);
  });

  ipcBridge.org.run.close.provider(async ({ id }) => {
    const run = db.getOrgRun(id).data;
    if (!run) {
      return wrapResult(false, undefined, 'Organization run not found');
    }

    const now = Date.now();
    const summary = run.conversation_id
      ? extractConversationSummary(run.conversation_id)
      : 'Run closed without conversation.';
    const executionLogs = [
      ...(run.execution_logs || []),
      {
        at: now,
        level: 'info' as const,
        message: `Run summary: ${summary}`,
      },
    ];

    const result = db.updateOrgRun(id, { status: 'closed', ended_at: now, execution_logs: executionLogs });
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }

    if (run.conversation_id) {
      const conversationResult = db.getConversation(run.conversation_id);
      if (conversationResult.success && conversationResult.data) {
        const updatedExtra = {
          ...conversationResult.data.extra,
          organizationId: run.organization_id,
          runId: run.id,
          organizationRole: conversationResult.data.extra.organizationRole || 'run_executor',
          runSummary: summary,
          runClosedAt: now,
        };
        db.updateConversation(run.conversation_id, { extra: updatedExtra } as Partial<typeof conversationResult.data>);
      }
    }

    reconcileOrganizationControlState(run.organization_id);

    ipcBridge.org.run.closed.emit({ id });
    ipcBridge.org.run.statusChanged.emit({ id, status: 'closed' });
    syncOrganizationContext(run.organization_id);
    return wrapResult(true, true);
  });

  ipcBridge.org.run.cancel.provider(async ({ id }) => {
    const run = db.getOrgRun(id).data;
    if (!run) {
      return wrapResult(false, undefined, 'Organization run not found');
    }

    const now = Date.now();
    const result = db.updateOrgRun(id, {
      status: 'closed',
      ended_at: now,
      execution_logs: [
        ...(run.execution_logs || []),
        {
          at: now,
          level: 'warn',
          message: 'Run cancelled before completion.',
        },
      ],
    });
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }

    reconcileOrganizationControlState(run.organization_id);

    ipcBridge.org.run.closed.emit({ id });
    ipcBridge.org.run.statusChanged.emit({ id, status: 'closed' });
    syncOrganizationContext(run.organization_id);
    return wrapResult(true, true);
  });

  ipcBridge.org.artifact.create.provider(async (params) => {
    const organization = requireOrganization(params.organization_id);
    if (!organization) {
      return wrapResult(false, undefined, 'Organization not found');
    }

    const result = await invokeOrganizationOperation(
      organization.id,
      organization.workspace,
      'org/artifact/register',
      params as any
    );
    if (result.success && result.data) {
      ipcBridge.org.artifact.created.emit(result.data as any);
      syncOrganizationContext(organization.id);
    }
    return result;
  });

  ipcBridge.org.artifact.register.provider(async (params) => {
    const organization = requireOrganization(params.organization_id);
    if (!organization) {
      return wrapResult(false, undefined, 'Organization not found');
    }

    const result = await invokeOrganizationOperation(
      organization.id,
      organization.workspace,
      'org/artifact/register',
      params as any
    );
    if (result.success && result.data) {
      ipcBridge.org.artifact.created.emit(result.data as any);
      syncOrganizationContext(organization.id);
    }
    return result;
  });

  ipcBridge.org.artifact.get.provider(async ({ id }) => {
    const result = db.getOrgArtifact(id);
    return result.success ? wrapResult(true, result.data) : wrapResult(false, undefined, result.error);
  });

  ipcBridge.org.artifact.list.provider(async (params) => {
    const result = db.listOrgArtifacts(params);
    return result.success ? wrapResult(true, result.data || []) : wrapResult(false, [], result.error);
  });

  ipcBridge.org.artifact.update.provider(async ({ id, updates }) => {
    const artifact = db.getOrgArtifact(id).data;
    if (!artifact) {
      return wrapResult(false, undefined, 'Organization artifact not found');
    }

    const result = db.updateOrgArtifact(id, updates as any);
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }

    const updatedArtifact = db.getOrgArtifact(id).data;
    if (updatedArtifact) {
      ipcBridge.org.artifact.updated.emit(updatedArtifact);
    }
    syncOrganizationContext(artifact.organization_id);
    return wrapResult(true, true);
  });

  ipcBridge.org.artifact.delete.provider(async ({ id }) => {
    const artifact = db.getOrgArtifact(id).data;
    if (!artifact) {
      return wrapResult(false, undefined, 'Organization artifact not found');
    }

    const result = db.deleteOrgArtifact(id);
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }

    ipcBridge.org.artifact.deleted.emit({ id });
    syncOrganizationContext(artifact.organization_id);
    return wrapResult(true, result.data);
  });

  ipcBridge.org.memory.promote.provider(async (params) => {
    const organization = requireOrganization(params.organization_id);
    if (!organization) {
      return wrapResult(false, undefined, 'Organization not found');
    }

    const result = await invokeOrganizationOperation<TOrgMemoryCard>(
      organization.id,
      organization.workspace,
      'org/memory/promote',
      params as any
    );
    if (result.success && result.data) {
      ipcBridge.org.memory.promoted.emit(result.data);
      syncOrganizationContext(organization.id);
    }
    return result;
  });

  ipcBridge.org.memory.get.provider(async ({ id }) => {
    const result = db.getOrgMemoryCard(id);
    return result.success ? wrapResult(true, result.data) : wrapResult(false, undefined, result.error);
  });

  ipcBridge.org.memory.list.provider(async (params) => {
    const result = db.listOrgMemoryCards(params);
    return result.success ? wrapResult(true, result.data || []) : wrapResult(false, [], result.error);
  });

  ipcBridge.org.memory.update.provider(async ({ id, updates }) => {
    const card = db.getOrgMemoryCard(id).data;
    if (!card) {
      return wrapResult(false, undefined, 'Organization memory card not found');
    }

    const result = db.updateOrgMemoryCard(id, updates as any);
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }

    const updatedCard = db.getOrgMemoryCard(id).data;
    if (updatedCard) {
      ipcBridge.org.memory.updated.emit(updatedCard);
    }
    syncOrganizationContext(card.organization_id);
    return wrapResult(true, true);
  });

  ipcBridge.org.memory.delete.provider(async ({ id }) => {
    const card = db.getOrgMemoryCard(id).data;
    if (!card) {
      return wrapResult(false, undefined, 'Organization memory card not found');
    }

    const result = db.deleteOrgMemoryCard(id);
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }

    ipcBridge.org.memory.deleted.emit({ id });
    syncOrganizationContext(card.organization_id);
    return wrapResult(true, result.data);
  });

  ipcBridge.org.eval.create.provider(async (params: ICreateOrgEvalSpecParams) => {
    const now = Date.now();
    const evalSpec: TOrgEvalSpec = {
      id: `org_eval_${nanoid()}`,
      organization_id: params.organization_id,
      name: params.name,
      description: params.description,
      test_commands: params.test_commands,
      quality_gates: params.quality_gates,
      baseline_comparison: params.baseline_comparison,
      thresholds: params.thresholds,
      created_at: now,
      updated_at: now,
    };

    const result = db.createOrgEvalSpec(evalSpec);
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }

    ipcBridge.org.eval.created.emit(evalSpec);
    syncOrganizationContext(evalSpec.organization_id);
    return wrapResult(true, evalSpec);
  });

  ipcBridge.org.eval.get.provider(async ({ id }) => {
    const result = db.getOrgEvalSpec(id);
    return result.success ? wrapResult(true, result.data) : wrapResult(false, undefined, result.error);
  });

  ipcBridge.org.eval.list.provider(async (params) => {
    const result = db.listOrgEvalSpecs(params);
    return result.success ? wrapResult(true, result.data || []) : wrapResult(false, [], result.error);
  });

  ipcBridge.org.eval.update.provider(async ({ id, updates }) => {
    const evalSpec = db.getOrgEvalSpec(id).data;
    if (!evalSpec) {
      return wrapResult(false, undefined, 'Organization eval spec not found');
    }

    const result = db.updateOrgEvalSpec(id, updates as any);
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }

    const updatedEvalSpec = db.getOrgEvalSpec(id).data;
    if (updatedEvalSpec) {
      ipcBridge.org.eval.updated.emit(updatedEvalSpec);
    }
    syncOrganizationContext(evalSpec.organization_id);
    return wrapResult(true, true);
  });

  ipcBridge.org.eval.delete.provider(async ({ id }) => {
    const evalSpec = db.getOrgEvalSpec(id).data;
    if (!evalSpec) {
      return wrapResult(false, undefined, 'Organization eval spec not found');
    }

    const result = db.deleteOrgEvalSpec(id);
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }

    ipcBridge.org.eval.deleted.emit({ id });
    syncOrganizationContext(evalSpec.organization_id);
    return wrapResult(true, result.data);
  });

  ipcBridge.org.eval.execute.provider(async (params) => {
    const task = requireTask(params.task_id);
    if (!task) {
      return wrapResult(false, undefined, 'Organization task not found');
    }

    const organization = requireOrganization(task.organization_id);
    if (!organization) {
      return wrapResult(false, undefined, 'Organization not found');
    }

    const result = await invokeOrganizationOperation(
      organization.id,
      organization.workspace,
      'org/eval/execute',
      params as any
    );
    if (result.success) {
      ipcBridge.org.eval.executed.emit({
        task_id: params.task_id,
        run_id: params.run_id,
        success: true,
      });
    }
    return result;
  });

  ipcBridge.org.skill.create.provider(async (params: ICreateOrgSkillParams) => {
    const now = Date.now();
    const skill: TOrgSkill = {
      id: `org_skill_${nanoid()}`,
      organization_id: params.organization_id,
      name: params.name,
      description: params.description,
      workflow_unit: params.workflow_unit,
      instructions: params.instructions,
      resources: params.resources,
      version: 1,
      created_at: now,
      updated_at: now,
    };

    const result = db.createOrgSkill(skill);
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }

    ipcBridge.org.skill.created.emit(skill);
    syncOrganizationContext(skill.organization_id);
    return wrapResult(true, skill);
  });

  ipcBridge.org.skill.get.provider(async ({ id }) => {
    const result = db.getOrgSkill(id);
    return result.success ? wrapResult(true, result.data) : wrapResult(false, undefined, result.error);
  });

  ipcBridge.org.skill.list.provider(async (params) => {
    const result = db.listOrgSkills(params);
    return result.success ? wrapResult(true, result.data || []) : wrapResult(false, [], result.error);
  });

  ipcBridge.org.skill.update.provider(async ({ id, updates }) => {
    const skill = db.getOrgSkill(id).data;
    if (!skill) {
      return wrapResult(false, undefined, 'Organization skill not found');
    }

    const result = db.updateOrgSkill(id, updates as any);
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }

    const updatedSkill = db.getOrgSkill(id).data;
    if (updatedSkill) {
      ipcBridge.org.skill.updated.emit(updatedSkill);
    }
    syncOrganizationContext(skill.organization_id);
    return wrapResult(true, true);
  });

  ipcBridge.org.skill.delete.provider(async ({ id }) => {
    const skill = db.getOrgSkill(id).data;
    if (!skill) {
      return wrapResult(false, undefined, 'Organization skill not found');
    }

    const result = db.deleteOrgSkill(id);
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }

    ipcBridge.org.skill.deleted.emit({ id });
    syncOrganizationContext(skill.organization_id);
    return wrapResult(true, result.data);
  });

  ipcBridge.org.evolution.propose.provider(async (params) => {
    const organization = requireOrganization(params.organization_id);
    if (!organization) {
      return wrapResult(false, undefined, 'Organization not found');
    }

    const result = await invokeOrganizationOperation<TOrgGenomePatch>(
      organization.id,
      organization.workspace,
      'org/evolution/propose',
      params as any
    );
    if (result.success && result.data) {
      ipcBridge.org.evolution.proposed.emit(result.data);
      ipcBridge.org.evolution.statusChanged.emit({ id: result.data.id, status: result.data.status });
      syncOrganizationContext(organization.id);
    }
    return result;
  });

  ipcBridge.org.evolution.get.provider(async ({ id }) => {
    const result = db.getOrgGenomePatch(id);
    return result.success ? wrapResult(true, result.data) : wrapResult(false, undefined, result.error);
  });

  ipcBridge.org.evolution.list.provider(async (params) => {
    const result = db.listOrgGenomePatches(params);
    return result.success ? wrapResult(true, result.data || []) : wrapResult(false, [], result.error);
  });

  ipcBridge.org.evolution.update.provider(async ({ id, updates }) => {
    const patch = db.getOrgGenomePatch(id).data;
    if (!patch) {
      return wrapResult(false, undefined, 'Organization genome patch not found');
    }

    const result = db.updateOrgGenomePatch(id, updates as any);
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }

    const updatedPatch = db.getOrgGenomePatch(id).data;
    if (updatedPatch) {
      ipcBridge.org.evolution.statusChanged.emit({ id, status: updatedPatch.status });
    }
    syncOrganizationContext(patch.organization_id);
    return wrapResult(true, true);
  });

  ipcBridge.org.evolution.delete.provider(async ({ id }) => {
    const patch = db.getOrgGenomePatch(id).data;
    if (!patch) {
      return wrapResult(false, undefined, 'Organization genome patch not found');
    }

    const result = db.deleteOrgGenomePatch(id);
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }

    syncOrganizationContext(patch.organization_id);
    return wrapResult(true, result.data);
  });

  ipcBridge.org.evolution.offlineEval.provider(async ({ id }) => {
    const patch = db.getOrgGenomePatch(id).data;
    if (!patch) {
      return wrapResult(false, undefined, 'Organization genome patch not found');
    }

    const result = executeGenomePatchOfflineEval({ patch_id: id });
    if (!result.success || !result.data) {
      return wrapResult(false, undefined, result.error);
    }

    ipcBridge.org.evolution.statusChanged.emit({ id, status: 'offline_eval' });
    syncOrganizationContext(patch.organization_id);
    return wrapResult(true, result.data);
  });

  ipcBridge.org.evolution.canary.provider(async ({ id }) => {
    const patch = db.getOrgGenomePatch(id).data;
    if (!patch) {
      return wrapResult(false, undefined, 'Organization genome patch not found');
    }

    const result = executeGenomePatchCanary({ patch_id: id });
    if (!result.success || !result.data) {
      return wrapResult(false, undefined, result.error);
    }

    ipcBridge.org.evolution.statusChanged.emit({ id, status: 'canary' });
    syncOrganizationContext(patch.organization_id);
    return wrapResult(true, result.data);
  });

  ipcBridge.org.evolution.adopt.provider(async ({ id, approved_by, reason }) => {
    const patch = db.getOrgGenomePatch(id).data;
    if (!patch) {
      return wrapResult(false, undefined, 'Organization genome patch not found');
    }

    const result = db.updateOrgGenomePatch(id, {
      status: 'adopted',
      decision: {
        approved: true,
        approved_by,
        reason,
        decided_at: Date.now(),
      },
    });
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }

    ipcBridge.org.evolution.adopted.emit({ id });
    ipcBridge.org.evolution.statusChanged.emit({ id, status: 'adopted' });
    syncOrganizationContext(patch.organization_id);
    return wrapResult(true, true);
  });

  ipcBridge.org.evolution.reject.provider(async ({ id, approved_by, reason }) => {
    const patch = db.getOrgGenomePatch(id).data;
    if (!patch) {
      return wrapResult(false, undefined, 'Organization genome patch not found');
    }

    const result = db.updateOrgGenomePatch(id, {
      status: 'rejected',
      decision: {
        approved: false,
        approved_by,
        reason,
        decided_at: Date.now(),
      },
    });
    if (!result.success) {
      return wrapResult(false, undefined, result.error);
    }

    ipcBridge.org.evolution.rejected.emit({ id });
    ipcBridge.org.evolution.statusChanged.emit({ id, status: 'rejected' });
    syncOrganizationContext(patch.organization_id);
    return wrapResult(true, true);
  });

  ipcBridge.org.governance.approve.provider(async (params) => {
    if (params.target_type !== 'genome_patch') {
      return wrapResult(false, undefined, 'Unsupported governance target type');
    }

    const patch = db.getOrgGenomePatch(params.target_id).data;
    if (!patch) {
      return wrapResult(false, undefined, 'Organization genome patch not found');
    }

    const organization = requireOrganization(patch.organization_id);
    if (!organization) {
      return wrapResult(false, undefined, 'Organization not found');
    }

    const result = await invokeOrganizationOperation<boolean>(
      organization.id,
      organization.workspace,
      'org/governance/approve',
      params as any
    );
    if (result.success) {
      ipcBridge.org.governance.approved.emit({
        target_type: params.target_type,
        target_id: params.target_id,
      });
      const updatedPatch = db.getOrgGenomePatch(params.target_id).data;
      if (updatedPatch) {
        ipcBridge.org.evolution.statusChanged.emit({ id: updatedPatch.id, status: updatedPatch.status });
      }
      syncOrganizationContext(organization.id);
    }
    return result;
  });

  ipcBridge.org.governance.reject.provider(async (params) => {
    if (params.target_type !== 'genome_patch') {
      return wrapResult(false, undefined, 'Unsupported governance target type');
    }

    const patch = db.getOrgGenomePatch(params.target_id).data;
    if (!patch) {
      return wrapResult(false, undefined, 'Organization genome patch not found');
    }

    const organization = requireOrganization(patch.organization_id);
    if (!organization) {
      return wrapResult(false, undefined, 'Organization not found');
    }

    const result = await invokeOrganizationOperation<boolean>(
      organization.id,
      organization.workspace,
      'org/governance/reject',
      params as any
    );
    if (result.success) {
      ipcBridge.org.governance.rejected.emit({
        target_type: params.target_type,
        target_id: params.target_id,
      });
      const updatedPatch = db.getOrgGenomePatch(params.target_id).data;
      if (updatedPatch) {
        ipcBridge.org.evolution.statusChanged.emit({ id: updatedPatch.id, status: updatedPatch.status });
      }
      syncOrganizationContext(organization.id);
    }
    return result;
  });

  ipcBridge.org.governance.listPending.provider(async ({ organization_id }) => {
    const patches = db.listOrgGenomePatches({ organization_id }).data || [];
    const pending = patches
      .filter((patch) => patch.status !== 'adopted' && patch.status !== 'rejected')
      .map((patch) => ({
        target_type: 'genome_patch' as const,
        target_id: patch.id,
        created_at: patch.created_at,
      }));
    return wrapResult(true, pending);
  });

  ipcBridge.org.governance.getAuditLogs.provider(async ({ organization_id, limit }) => {
    const result = db.listOrgAuditLogs({ organization_id, limit });
    return result.success ? wrapResult(true, result.data || []) : wrapResult(false, [], result.error);
  });

  const organizations = db.listOrganizations().data || [];
  for (const organization of organizations) {
    ensureOrganizationRuntime(organization);
  }
}

export { generateOrganizationSystemPrompt };
