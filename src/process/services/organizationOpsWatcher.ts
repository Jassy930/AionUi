/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type {
  ArtifactType,
  GenomePatchStatus,
  IOrgGovernanceApproveParams,
  IOrgGovernanceRejectParams,
  OrgApprovalStatus,
  OrganizationControlPhase,
  TOrgArtifact,
  TOrgApprovalRecord,
  TOrgBrief,
  TOrgControlState,
  TOrgEvalExecutionResult,
  TOrgGenomePatch,
  TOrgGovernanceAuditLogRecord,
  TOrgMemoryCard,
  TOrgPlanSnapshot,
  TOrgRun,
  TOrgTask,
} from '@/common/types/organization';
import { getDatabase } from '@process/database';
import { getOrganizationContextDir, syncOrganizationContext } from './organizationContextService';
import { executeOrganizationEval, registerOrganizationArtifact } from './organizationEvalService';
import { promoteMemoryCardFromRun, proposeGenomePatchFromRuns } from './organizationEvolutionService';

type OperationPayload = {
  method?: string;
  operation?: string;
  params: Record<string, unknown>;
};

type OperationResult = {
  success: boolean;
  method: string;
  message: string;
  data?: unknown;
};

type WatcherState = {
  watcher: fs.FSWatcher;
  operationsDir: string;
  processedFiles: Set<string>;
};

const activeWatchers = new Map<string, WatcherState>();
const ALL_APPROVALS_LIMIT = 1_000;

function getLatestRelevantBrief(db: ReturnType<typeof getDatabase>, organizationId: string): TOrgBrief | null {
  const briefs = db.listOrgBriefs(organizationId).data || [];
  return briefs[0] || null;
}

function hasTier1Gap(brief: TOrgBrief | null): boolean {
  if (!brief) {
    return true;
  }

  return brief.status !== 'confirmed' || (brief.tier1_open_questions?.length || 0) > 0;
}

function getLatestRelevantPlanSnapshot(
  db: ReturnType<typeof getDatabase>,
  organizationId: string
): TOrgPlanSnapshot | null {
  return db.getLatestOrgPlanSnapshot(organizationId).data || null;
}

function listPendingApprovals(db: ReturnType<typeof getDatabase>, organizationId: string): TOrgApprovalRecord[] {
  return (
    db.listOrgApprovalRecords({
      organization_id: organizationId,
      status: 'pending',
      limit: ALL_APPROVALS_LIMIT,
    }).data || []
  );
}

function buildControlStateSnapshot(
  organizationId: string,
  phase?: OrganizationControlPhase
): Omit<TOrgControlState, 'id' | 'organization_id'> {
  const db = getDatabase();
  const brief = getLatestRelevantBrief(db, organizationId);
  const planSnapshot = getLatestRelevantPlanSnapshot(db, organizationId);
  const pendingApprovals = listPendingApprovals(db, organizationId);
  const activeRuns = (db.listOrgRuns({ organization_id: organizationId }).data || []).filter(
    (run) => run.status !== 'closed'
  );

  let nextPhase = phase;
  if (!nextPhase) {
    if (activeRuns.length > 0) {
      nextPhase = 'monitoring';
    } else if (hasTier1Gap(brief)) {
      nextPhase = 'awaiting_human_decision';
    } else if (pendingApprovals.some((approval) => approval.scope === 'plan_gate')) {
      nextPhase = 'awaiting_plan_approval';
    } else {
      nextPhase = 'drafting_plan';
    }
  }

  return {
    conversation_id: undefined,
    phase: nextPhase,
    active_brief_id: brief?.id,
    active_plan_id: planSnapshot?.id,
    needs_human_input: nextPhase === 'awaiting_human_decision' || nextPhase === 'awaiting_plan_approval',
    pending_approval_count: pendingApprovals.length,
    last_human_touch_at: undefined,
    updated_at: Date.now(),
  };
}

export function ensureOrganizationControlState(organizationId: string): TOrgControlState | null {
  const db = getDatabase();
  const existing = db.getOrgControlState(organizationId).data;
  if (existing) {
    return existing;
  }

  const snapshot = buildControlStateSnapshot(organizationId);
  const controlState: TOrgControlState = {
    id: `org_control_${nanoid()}`,
    organization_id: organizationId,
    ...snapshot,
  };
  const result = db.createOrgControlState(controlState);
  return result.success ? controlState : null;
}

export function reconcileOrganizationControlState(
  organizationId: string,
  phase?: OrganizationControlPhase,
  overrides?: Partial<Pick<TOrgControlState, 'last_human_touch_at'>>
): TOrgControlState | null {
  const db = getDatabase();
  const existing = ensureOrganizationControlState(organizationId);
  if (!existing) {
    return null;
  }

  const snapshot = buildControlStateSnapshot(organizationId, phase);
  const result = db.updateOrgControlState(organizationId, {
    conversation_id: existing.conversation_id,
    phase: snapshot.phase,
    active_brief_id: snapshot.active_brief_id,
    active_plan_id: snapshot.active_plan_id,
    needs_human_input: snapshot.needs_human_input,
    pending_approval_count: snapshot.pending_approval_count,
    last_human_touch_at:
      overrides?.last_human_touch_at !== undefined ? overrides.last_human_touch_at : existing.last_human_touch_at,
  });

  return result.success ? db.getOrgControlState(organizationId).data || null : existing;
}

function ensureTier1DecisionReady(organizationId: string): { success: true } | { success: false; message: string } {
  const db = getDatabase();
  const brief = getLatestRelevantBrief(db, organizationId);
  if (!hasTier1Gap(brief)) {
    return { success: true };
  }

  reconcileOrganizationControlState(organizationId, 'awaiting_human_decision');
  return {
    success: false,
    message: 'Missing required tier 1 human decisions before dispatching organization work',
  };
}

function ensurePlanGateApproval(planSnapshot: TOrgPlanSnapshot): void {
  const db = getDatabase();
  const pendingApprovals = listPendingApprovals(db, planSnapshot.organization_id);
  const existing = pendingApprovals.find(
    (approval) => approval.scope === 'plan_gate' && approval.target_id === planSnapshot.id
  );
  if (existing) {
    return;
  }

  const now = Date.now();
  db.createOrgApprovalRecord({
    id: `org_approval_${nanoid()}`,
    organization_id: planSnapshot.organization_id,
    scope: 'plan_gate',
    status: 'pending',
    target_type: 'organization',
    target_id: planSnapshot.id,
    title: `Approve plan snapshot: ${planSnapshot.title}`,
    detail: 'Run dispatch is blocked until a human approves this plan snapshot.',
    requested_by: 'organization_control_plane',
    created_at: now,
    updated_at: now,
  });
}

function ensureApprovedPlanReady(
  organizationId: string
): { success: true; planSnapshot: TOrgPlanSnapshot } | { success: false; message: string } {
  const db = getDatabase();
  const latestPlan = db.getLatestOrgPlanSnapshot(organizationId).data;
  if (latestPlan?.status === 'approved') {
    return { success: true, planSnapshot: latestPlan };
  }

  if (latestPlan?.status === 'draft') {
    ensurePlanGateApproval(latestPlan);
    reconcileOrganizationControlState(organizationId, 'awaiting_plan_approval');
  } else {
    reconcileOrganizationControlState(organizationId, 'drafting_plan');
  }

  return {
    success: false,
    message: 'Organization run dispatch requires an approved plan snapshot',
  };
}

function resolveMethod(payload: OperationPayload): string | null {
  return payload.method || payload.operation || null;
}

function buildTask(params: Record<string, unknown>): TOrgTask {
  const now = Date.now();
  return {
    id: `org_task_${nanoid()}`,
    organization_id: params.organization_id as string,
    title: params.title as string,
    objective: params.objective as string,
    scope: (params.scope as string[]) || [],
    done_criteria: (params.done_criteria as string[]) || [],
    budget: (params.budget as TOrgTask['budget']) || {},
    risk_tier: (params.risk_tier as TOrgTask['risk_tier']) || 'normal',
    validators: (params.validators as TOrgTask['validators']) || [],
    deliverable_schema: (params.deliverable_schema as TOrgTask['deliverable_schema']) || {},
    status: (params.status as TOrgTask['status']) || 'draft',
    created_at: now,
    updated_at: now,
  };
}

function buildRun(task: TOrgTask, params: Record<string, unknown>): TOrgRun {
  const now = Date.now();
  return {
    id: `org_run_${nanoid()}`,
    organization_id: task.organization_id,
    task_id: task.id,
    status: 'active',
    workspace: params.workspace as TOrgRun['workspace'],
    environment: (params.environment as TOrgRun['environment']) || {},
    context_policy: params.context_policy as TOrgRun['context_policy'],
    execution: params.execution as TOrgRun['execution'],
    execution_logs: [
      {
        at: now,
        level: 'info',
        message: 'Run started by Organization OS control plane',
      },
    ],
    started_at: now,
    created_at: now,
    updated_at: now,
  };
}

function buildArtifact(params: Record<string, unknown>): TOrgArtifact {
  const now = Date.now();
  return {
    id: `org_artifact_${nanoid()}`,
    organization_id: params.organization_id as string,
    task_id: params.task_id as string,
    run_id: params.run_id as string,
    type: ((params.type as ArtifactType) || 'other') as ArtifactType,
    title: params.title as string,
    summary: params.summary as string | undefined,
    content_ref: params.content_ref as string | undefined,
    metadata: params.metadata as Record<string, unknown> | undefined,
    created_at: now,
    updated_at: now,
  };
}

function buildMemoryCard(params: Record<string, unknown>): TOrgMemoryCard {
  const now = Date.now();
  return {
    id: `org_memory_${nanoid()}`,
    organization_id: params.organization_id as string,
    type: params.type as TOrgMemoryCard['type'],
    title: params.title as string,
    knowledge_unit: params.knowledge_unit as string,
    traceability: (params.traceability as TOrgMemoryCard['traceability']) || { source_run_ids: [] },
    tags: params.tags as string[] | undefined,
    created_at: now,
    updated_at: now,
  };
}

function buildGenomePatch(params: Record<string, unknown>): TOrgGenomePatch {
  const now = Date.now();
  return {
    id: `org_patch_${nanoid()}`,
    organization_id: params.organization_id as string,
    mutation_target: params.mutation_target as TOrgGenomePatch['mutation_target'],
    based_on: (params.based_on as string[]) || [],
    proposal: (params.proposal as Record<string, unknown>) || {},
    status: ((params.status as GenomePatchStatus) || 'proposed') as GenomePatchStatus,
    created_at: now,
    updated_at: now,
  };
}

function buildAuditLog(params: {
  organization_id: string;
  action: TOrgGovernanceAuditLogRecord['action'];
  actor?: string;
  target_id: string;
  target_type: TOrgGovernanceAuditLogRecord['target_type'];
  detail?: string;
}): TOrgGovernanceAuditLogRecord {
  return {
    id: `org_audit_${nanoid()}`,
    organization_id: params.organization_id,
    action: params.action,
    actor: params.actor || 'organization_control_plane',
    target_id: params.target_id,
    target_type: params.target_type,
    detail: params.detail,
    at: Date.now(),
  };
}

async function handleCreateTask(
  currentOrganizationId: string,
  params: Record<string, unknown>
): Promise<OperationResult> {
  const organizationId = params.organization_id as string;
  if (!organizationId || !params.title || !params.objective) {
    return {
      success: false,
      method: 'org/task/create',
      message: 'Missing required organization_id, title or objective',
    };
  }
  if (organizationId !== currentOrganizationId) {
    return { success: false, method: 'org/task/create', message: 'Cross-organization task creation is not allowed' };
  }

  const db = getDatabase();
  const organizationResult = db.getOrganization(organizationId);
  if (!organizationResult.success || !organizationResult.data) {
    return { success: false, method: 'org/task/create', message: 'Organization not found' };
  }

  const tier1Result = ensureTier1DecisionReady(organizationId);
  if (!tier1Result.success) {
    return {
      success: false,
      method: 'org/task/create',
      message: 'message' in tier1Result ? tier1Result.message : 'Tier 1 gate failed',
    };
  }

  const planGateResult = ensureApprovedPlanReady(organizationId);
  if (!planGateResult.success) {
    return {
      success: false,
      method: 'org/task/create',
      message: 'message' in planGateResult ? planGateResult.message : 'Plan approval gate failed',
    };
  }

  const task = buildTask(params);
  const result = db.createOrgTask(task);
  if (!result.success) {
    return { success: false, method: 'org/task/create', message: result.error || 'Failed to create task' };
  }

  reconcileOrganizationControlState(organizationId, 'dispatching');

  return { success: true, method: 'org/task/create', message: 'Organization task created', data: task };
}

async function handleUpdateTask(
  currentOrganizationId: string,
  params: Record<string, unknown>
): Promise<OperationResult> {
  const taskId = params.id as string;
  if (!taskId) {
    return { success: false, method: 'org/task/update', message: 'Missing required id' };
  }

  const updates = (params.updates as Record<string, unknown> | undefined) || params;
  const db = getDatabase();
  const taskResult = db.getOrgTask(taskId);
  if (!taskResult.success || !taskResult.data) {
    return { success: false, method: 'org/task/update', message: 'Organization task not found' };
  }
  if (taskResult.data.organization_id !== currentOrganizationId) {
    return { success: false, method: 'org/task/update', message: 'Task does not belong to this organization' };
  }

  const result = db.updateOrgTask(taskId, {
    title: updates.title as TOrgTask['title'] | undefined,
    objective: updates.objective as TOrgTask['objective'] | undefined,
    scope: updates.scope as TOrgTask['scope'] | undefined,
    done_criteria: updates.done_criteria as TOrgTask['done_criteria'] | undefined,
    budget: updates.budget as TOrgTask['budget'] | undefined,
    risk_tier: updates.risk_tier as TOrgTask['risk_tier'] | undefined,
    validators: updates.validators as TOrgTask['validators'] | undefined,
    deliverable_schema: updates.deliverable_schema as TOrgTask['deliverable_schema'] | undefined,
    status: updates.status as TOrgTask['status'] | undefined,
  });

  if (!result.success) {
    return { success: false, method: 'org/task/update', message: result.error || 'Failed to update task' };
  }

  return { success: true, method: 'org/task/update', message: 'Organization task updated', data: { id: taskId } };
}

async function handleStartRun(
  currentOrganizationId: string,
  params: Record<string, unknown>
): Promise<OperationResult> {
  const taskId = params.task_id as string;
  if (!taskId) {
    return { success: false, method: 'org/run/start', message: 'Missing required task_id' };
  }

  const db = getDatabase();
  const taskResult = db.getOrgTask(taskId);
  if (!taskResult.success || !taskResult.data) {
    return { success: false, method: 'org/run/start', message: 'Organization task not found' };
  }
  if (taskResult.data.organization_id !== currentOrganizationId) {
    return { success: false, method: 'org/run/start', message: 'Task does not belong to this organization' };
  }

  const tier1Result = ensureTier1DecisionReady(currentOrganizationId);
  if (!tier1Result.success) {
    return {
      success: false,
      method: 'org/run/start',
      message: 'message' in tier1Result ? tier1Result.message : 'Tier 1 gate failed',
    };
  }

  const planGateResult = ensureApprovedPlanReady(currentOrganizationId);
  if (!planGateResult.success) {
    return {
      success: false,
      method: 'org/run/start',
      message: 'message' in planGateResult ? planGateResult.message : 'Plan approval gate failed',
    };
  }

  const run = buildRun(taskResult.data, params);
  const runResult = db.createOrgRun(run);
  if (!runResult.success) {
    return { success: false, method: 'org/run/start', message: runResult.error || 'Failed to create run' };
  }

  const taskUpdateResult = db.updateOrgTask(taskId, { status: 'running' });
  if (!taskUpdateResult.success) {
    db.deleteOrgRun(run.id);
    return {
      success: false,
      method: 'org/run/start',
      message: taskUpdateResult.error || 'Failed to update task status after run creation',
    };
  }

  reconcileOrganizationControlState(currentOrganizationId, 'monitoring');
  return { success: true, method: 'org/run/start', message: 'Organization run started', data: run };
}

async function handleRespondApproval(
  currentOrganizationId: string,
  params: {
    approval_id?: string;
    decision?: OrgApprovalStatus;
    actor?: string;
    comment?: string;
  }
): Promise<OperationResult> {
  if (!params.approval_id || !params.decision || !params.actor) {
    return {
      success: false,
      method: 'org/approval/respond',
      message: 'Missing required approval_id, decision or actor',
    };
  }

  const db = getDatabase();
  const approvalResult = db.getOrgApprovalRecord(params.approval_id);
  if (
    !approvalResult.success ||
    !approvalResult.data ||
    approvalResult.data.organization_id !== currentOrganizationId
  ) {
    return { success: false, method: 'org/approval/respond', message: 'Organization approval record not found' };
  }

  const approval = approvalResult.data;
  if (approval.status !== 'pending') {
    return {
      success: false,
      method: 'org/approval/respond',
      message: 'Only pending approvals can be responded to',
    };
  }

  const now = Date.now();
  const previousPlan = approval.target_id ? db.getOrgPlanSnapshot(approval.target_id).data : undefined;
  const supersededPendingApprovals =
    params.decision === 'approved' && approval.scope === 'plan_gate'
      ? (
          db.listOrgApprovalRecords({
            organization_id: currentOrganizationId,
            status: 'pending',
            scope: 'plan_gate',
            limit: ALL_APPROVALS_LIMIT,
          }).data || []
        ).filter((record) => record.id !== approval.id)
      : [];
  const previousApprovedPlans =
    params.decision === 'approved'
      ? (db.listOrgPlanSnapshots({ organization_id: currentOrganizationId, status: 'approved' }).data || []).filter(
          (plan) => plan.id !== approval.target_id
        )
      : [];

  const updateApprovalResult = db.updateOrgApprovalRecord(approval.id, {
    status: params.decision,
    decided_by: params.actor,
    decided_at: now,
    decision_comment: params.comment,
  });
  if (!updateApprovalResult.success) {
    return {
      success: false,
      method: 'org/approval/respond',
      message: updateApprovalResult.error || 'Failed to persist approval response',
    };
  }

  if (approval.scope === 'plan_gate' && previousPlan) {
    if (params.decision === 'approved') {
      for (const pendingApproval of supersededPendingApprovals) {
        db.updateOrgApprovalRecord(pendingApproval.id, {
          status: 'rejected',
          decided_by: params.actor,
          decided_at: now,
          decision_comment: `Superseded by approved plan ${previousPlan.id}`,
        });
      }
      for (const plan of previousApprovedPlans) {
        db.updateOrgPlanSnapshot(plan.id, {
          status: 'superseded',
        });
      }
      db.updateOrgPlanSnapshot(previousPlan.id, {
        status: 'approved',
        approved_by: params.actor,
        approved_at: now,
      });
    }
  }

  if (params.decision === 'approved' || params.decision === 'rejected' || params.decision === 'needs_more_info') {
    const auditResult = db.createOrgAuditLog(
      buildAuditLog({
        organization_id: currentOrganizationId,
        action:
          params.decision === 'approved' ? 'approve' : params.decision === 'rejected' ? 'reject' : 'needs_more_info',
        actor: params.actor,
        target_type: approval.target_type || 'organization',
        target_id: approval.target_id || approval.id,
        detail: params.comment,
      })
    );

    if (!auditResult.success) {
      db.updateOrgApprovalRecord(approval.id, {
        status: approval.status,
        decided_by: approval.decided_by,
        decided_at: approval.decided_at,
        decision_comment: approval.decision_comment,
      });
      if (approval.scope === 'plan_gate' && previousPlan) {
        for (const pendingApproval of supersededPendingApprovals) {
          db.updateOrgApprovalRecord(pendingApproval.id, {
            status: pendingApproval.status,
            decided_by: pendingApproval.decided_by,
            decided_at: pendingApproval.decided_at,
            decision_comment: pendingApproval.decision_comment,
          });
        }
        db.updateOrgPlanSnapshot(previousPlan.id, {
          status: previousPlan.status,
          approved_by: previousPlan.approved_by,
          approved_at: previousPlan.approved_at,
        });
        for (const plan of previousApprovedPlans) {
          db.updateOrgPlanSnapshot(plan.id, {
            status: 'approved',
          });
        }
      }
      return {
        success: false,
        method: 'org/approval/respond',
        message: auditResult.error || 'Failed to persist organization approval audit log',
      };
    }
  }

  reconcileOrganizationControlState(currentOrganizationId, undefined, {
    last_human_touch_at: now,
  });

  return { success: true, method: 'org/approval/respond', message: 'Approval response recorded', data: true };
}

async function handleRegisterArtifact(
  currentOrganizationId: string,
  params: Record<string, unknown>
): Promise<OperationResult> {
  if (!params.organization_id || !params.task_id || !params.run_id || !params.title) {
    return {
      success: false,
      method: 'org/artifact/register',
      message: 'Missing required organization_id, task_id, run_id or title',
    };
  }
  if ((params.organization_id as string) !== currentOrganizationId) {
    return {
      success: false,
      method: 'org/artifact/register',
      message: 'Cross-organization artifact registration is not allowed',
    };
  }

  const db = getDatabase();
  const taskResult = db.getOrgTask(params.task_id as string);
  if (!taskResult.success || !taskResult.data || taskResult.data.organization_id !== currentOrganizationId) {
    return { success: false, method: 'org/artifact/register', message: 'Organization task not found' };
  }
  const runResult = db.getOrgRun(params.run_id as string);
  if (!runResult.success || !runResult.data || runResult.data.organization_id !== currentOrganizationId) {
    return { success: false, method: 'org/artifact/register', message: 'Organization run not found' };
  }
  if (runResult.data.task_id !== params.task_id) {
    return { success: false, method: 'org/artifact/register', message: 'Run does not belong to the provided task' };
  }

  const result = registerOrganizationArtifact({
    organization_id: params.organization_id as string,
    task_id: params.task_id as string,
    run_id: params.run_id as string,
    type: ((params.type as ArtifactType) || 'other') as ArtifactType,
    title: params.title as string,
    summary: params.summary as string | undefined,
    content_ref: params.content_ref as string | undefined,
    metadata: params.metadata as Record<string, unknown> | undefined,
  });
  if (!result.success || !result.data) {
    return { success: false, method: 'org/artifact/register', message: result.error || 'Failed to create artifact' };
  }

  return {
    success: true,
    method: 'org/artifact/register',
    message: 'Organization artifact registered',
    data: result.data,
  };
}

async function handleExecuteEval(
  currentOrganizationId: string,
  params: Record<string, unknown>
): Promise<OperationResult> {
  const taskId = params.task_id as string;
  if (!taskId) {
    return { success: false, method: 'org/eval/execute', message: 'Missing required task_id' };
  }

  const db = getDatabase();
  const taskResult = db.getOrgTask(taskId);
  if (!taskResult.success || !taskResult.data || taskResult.data.organization_id !== currentOrganizationId) {
    return { success: false, method: 'org/eval/execute', message: 'Organization task not found' };
  }

  if (params.run_id) {
    const runResult = db.getOrgRun(params.run_id as string);
    if (!runResult.success || !runResult.data || runResult.data.organization_id !== currentOrganizationId) {
      return { success: false, method: 'org/eval/execute', message: 'Organization run not found' };
    }
    if (runResult.data.task_id !== taskId) {
      return { success: false, method: 'org/eval/execute', message: 'Run does not belong to the provided task' };
    }
  }

  if (params.eval_spec_id) {
    const evalSpecResult = db.getOrgEvalSpec(params.eval_spec_id as string);
    if (
      !evalSpecResult.success ||
      !evalSpecResult.data ||
      evalSpecResult.data.organization_id !== currentOrganizationId
    ) {
      return { success: false, method: 'org/eval/execute', message: 'Organization eval spec not found' };
    }
  }

  const result = await executeOrganizationEval({
    task_id: taskId,
    run_id: params.run_id as string | undefined,
    eval_spec_id: params.eval_spec_id as string | undefined,
  });
  return result.success
    ? { success: true, method: 'org/eval/execute', message: 'Organization eval executed', data: result.data }
    : { success: false, method: 'org/eval/execute', message: result.error || 'Organization eval failed' };
}

async function handlePromoteMemory(
  currentOrganizationId: string,
  params: Record<string, unknown>
): Promise<OperationResult> {
  if (!params.organization_id || !params.type || !params.title || !params.knowledge_unit) {
    return {
      success: false,
      method: 'org/memory/promote',
      message: 'Missing required organization_id, type, title or knowledge_unit',
    };
  }
  if ((params.organization_id as string) !== currentOrganizationId) {
    return {
      success: false,
      method: 'org/memory/promote',
      message: 'Cross-organization memory promotion is not allowed',
    };
  }

  const db = getDatabase();
  const traceability = (params.traceability as TOrgMemoryCard['traceability'] | undefined) || { source_run_ids: [] };
  for (const runId of traceability.source_run_ids || []) {
    const runResult = db.getOrgRun(runId);
    if (!runResult.success || !runResult.data || runResult.data.organization_id !== currentOrganizationId) {
      return {
        success: false,
        method: 'org/memory/promote',
        message: 'Traceability run does not belong to this organization',
      };
    }
  }

  if (params.run_id) {
    const result = promoteMemoryCardFromRun({
      organization_id: params.organization_id as string,
      run_id: params.run_id as string,
      artifact_ids: params.artifact_ids as string[] | undefined,
      type: params.type as TOrgMemoryCard['type'],
      title: params.title as string,
      tags: params.tags as string[] | undefined,
    });
    return result.success
      ? { success: true, method: 'org/memory/promote', message: 'Organization memory promoted', data: result.data }
      : { success: false, method: 'org/memory/promote', message: result.error || 'Failed to create memory card' };
  }

  const memoryCard = buildMemoryCard(params);
  const result = db.createOrgMemoryCard(memoryCard);
  if (!result.success) {
    return { success: false, method: 'org/memory/promote', message: result.error || 'Failed to create memory card' };
  }

  return { success: true, method: 'org/memory/promote', message: 'Organization memory promoted', data: memoryCard };
}

async function handleProposeEvolution(
  currentOrganizationId: string,
  params: Record<string, unknown>
): Promise<OperationResult> {
  if (!params.organization_id || !params.mutation_target) {
    return {
      success: false,
      method: 'org/evolution/propose',
      message: 'Missing required organization_id or mutation_target',
    };
  }
  if ((params.organization_id as string) !== currentOrganizationId) {
    return {
      success: false,
      method: 'org/evolution/propose',
      message: 'Cross-organization evolution proposal is not allowed',
    };
  }

  const result = proposeGenomePatchFromRuns({
    organization_id: params.organization_id as string,
    mutation_target: params.mutation_target as TOrgGenomePatch['mutation_target'],
    based_on: (params.based_on as string[]) || [],
    proposal: (params.proposal as Record<string, unknown>) || {},
    status: (params.status as GenomePatchStatus | undefined) || undefined,
  });
  return result.success
    ? { success: true, method: 'org/evolution/propose', message: 'Genome patch proposed', data: result.data }
    : { success: false, method: 'org/evolution/propose', message: result.error || 'Failed to create genome patch' };
}

async function handleGovernanceApprove(
  currentOrganizationId: string,
  params: IOrgGovernanceApproveParams
): Promise<OperationResult> {
  const db = getDatabase();
  if (params.target_type === 'genome_patch') {
    const patchResult = db.getOrgGenomePatch(params.target_id);
    if (!patchResult.success || !patchResult.data || patchResult.data.organization_id !== currentOrganizationId) {
      return { success: false, method: 'org/governance/approve', message: 'Genome patch not found' };
    }

    const previousPatch = patchResult.data;
    const decision = {
      approved: true,
      approved_by: 'organization_control_plane',
      reason: params.comment,
      decided_at: Date.now(),
    };
    const patchUpdateResult = db.updateOrgGenomePatch(params.target_id, { status: 'adopted', decision });
    if (!patchUpdateResult.success) {
      return {
        success: false,
        method: 'org/governance/approve',
        message: patchUpdateResult.error || 'Failed to adopt genome patch',
      };
    }
    const auditResult = db.createOrgAuditLog(
      buildAuditLog({
        organization_id: previousPatch.organization_id,
        action: 'approve',
        target_type: params.target_type,
        target_id: params.target_id,
        detail: params.comment,
      })
    );
    if (!auditResult.success) {
      db.updateOrgGenomePatch(params.target_id, {
        status: previousPatch.status,
        decision: previousPatch.decision,
      });
      return {
        success: false,
        method: 'org/governance/approve',
        message: auditResult.error || 'Failed to persist governance audit log',
      };
    }

    return { success: true, method: 'org/governance/approve', message: 'Governance approval applied', data: true };
  }

  return { success: false, method: 'org/governance/approve', message: 'Unsupported governance target type' };
}

async function handleGovernanceReject(
  currentOrganizationId: string,
  params: IOrgGovernanceRejectParams
): Promise<OperationResult> {
  const db = getDatabase();
  if (params.target_type === 'genome_patch') {
    const patchResult = db.getOrgGenomePatch(params.target_id);
    if (!patchResult.success || !patchResult.data || patchResult.data.organization_id !== currentOrganizationId) {
      return { success: false, method: 'org/governance/reject', message: 'Genome patch not found' };
    }

    const previousPatch = patchResult.data;
    const decision = {
      approved: false,
      approved_by: 'organization_control_plane',
      reason: params.reason,
      decided_at: Date.now(),
    };
    const patchUpdateResult = db.updateOrgGenomePatch(params.target_id, { status: 'rejected', decision });
    if (!patchUpdateResult.success) {
      return {
        success: false,
        method: 'org/governance/reject',
        message: patchUpdateResult.error || 'Failed to reject genome patch',
      };
    }
    const auditResult = db.createOrgAuditLog(
      buildAuditLog({
        organization_id: previousPatch.organization_id,
        action: 'reject',
        target_type: params.target_type,
        target_id: params.target_id,
        detail: params.reason,
      })
    );
    if (!auditResult.success) {
      db.updateOrgGenomePatch(params.target_id, {
        status: previousPatch.status,
        decision: previousPatch.decision,
      });
      return {
        success: false,
        method: 'org/governance/reject',
        message: auditResult.error || 'Failed to persist governance audit log',
      };
    }

    return { success: true, method: 'org/governance/reject', message: 'Governance rejection applied', data: true };
  }

  return { success: false, method: 'org/governance/reject', message: 'Unsupported governance target type' };
}

export async function executeOrganizationOperation(
  organizationId: string,
  workspace: string,
  payload: OperationPayload
): Promise<OperationResult> {
  const method = resolveMethod(payload);
  if (!method) {
    return { success: false, method: 'unknown', message: 'Missing required method field' };
  }

  switch (method) {
    case 'org/task/create':
      return handleCreateTask(organizationId, payload.params);
    case 'org/task/update':
      return handleUpdateTask(organizationId, payload.params);
    case 'org/run/start':
      return handleStartRun(organizationId, payload.params);
    case 'org/artifact/register':
    case 'org/artifact/create':
      return handleRegisterArtifact(organizationId, payload.params);
    case 'org/eval/execute':
      return handleExecuteEval(organizationId, payload.params);
    case 'org/memory/promote':
      return handlePromoteMemory(organizationId, payload.params);
    case 'org/evolution/propose':
      return handleProposeEvolution(organizationId, payload.params);
    case 'org/approval/respond':
      return handleRespondApproval(organizationId, {
        approval_id: payload.params.approval_id as string | undefined,
        decision: payload.params.decision as OrgApprovalStatus | undefined,
        actor: payload.params.actor as string | undefined,
        comment: payload.params.comment as string | undefined,
      });
    case 'org/governance/approve':
      return handleGovernanceApprove(organizationId, payload.params as unknown as IOrgGovernanceApproveParams);
    case 'org/governance/reject':
      return handleGovernanceReject(organizationId, payload.params as unknown as IOrgGovernanceRejectParams);
    default:
      return { success: false, method, message: `Unknown operation: ${method}` };
  }
}

export async function processOrganizationOperationFile(
  organizationId: string,
  workspace: string,
  filePath: string
): Promise<void> {
  const watcherState = activeWatchers.get(organizationId);
  if (watcherState?.processedFiles.has(filePath)) {
    return;
  }
  watcherState?.processedFiles.add(filePath);

  const resultPath = filePath.replace(/\.json$/, '.result.json');

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const payload = JSON.parse(content) as OperationPayload;
    const result = await executeOrganizationOperation(organizationId, workspace, payload);
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf-8');
    syncOrganizationContext(organizationId);
    fs.unlinkSync(filePath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const result: OperationResult = {
      success: false,
      method: 'unknown',
      message,
    };
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf-8');
  } finally {
    watcherState?.processedFiles.delete(filePath);
  }
}

export function startOrganizationWatcher(organizationId: string, workspace: string): void {
  const operationsDir = path.join(getOrganizationContextDir(workspace), 'control', 'operations');
  if (!fs.existsSync(operationsDir)) {
    fs.mkdirSync(operationsDir, { recursive: true });
  }

  const existingWatcher = activeWatchers.get(organizationId);
  if (existingWatcher) {
    if (existingWatcher.operationsDir === operationsDir) {
      return;
    }

    existingWatcher.watcher.close();
    activeWatchers.delete(organizationId);
  }

  const state: WatcherState = {
    watcher: fs.watch(operationsDir, (eventType, filename) => {
      if (eventType !== 'rename' || !filename || !filename.endsWith('.json') || filename.endsWith('.result.json')) {
        return;
      }

      const filePath = path.join(operationsDir, filename);
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          void processOrganizationOperationFile(organizationId, workspace, filePath);
        }
      }, 100);
    }),
    operationsDir,
    processedFiles: new Set<string>(),
  };

  activeWatchers.set(organizationId, state);

  const existingFiles = fs
    .readdirSync(operationsDir)
    .filter((entry) => entry.endsWith('.json') && !entry.endsWith('.result.json'));
  for (const fileName of existingFiles) {
    void processOrganizationOperationFile(organizationId, workspace, path.join(operationsDir, fileName));
  }
}

export function stopOrganizationWatcher(organizationId: string): void {
  const watcherState = activeWatchers.get(organizationId);
  if (!watcherState) {
    return;
  }

  watcherState.watcher.close();
  activeWatchers.delete(organizationId);
}

export function stopAllOrganizationWatchers(): void {
  for (const [organizationId, watcherState] of activeWatchers.entries()) {
    watcherState.watcher.close();
    activeWatchers.delete(organizationId);
  }
}
