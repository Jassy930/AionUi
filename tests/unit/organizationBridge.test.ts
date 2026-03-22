/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  TOrgApprovalRecord,
  TOrgBrief,
  TOrganization,
  TOrgEvalSpec,
  TOrgPlanSnapshot,
  TOrgTask,
} from '@/common/types/organization';

const { safeExecFileMock } = vi.hoisted(() => ({
  safeExecFileMock: vi.fn(),
}));

const TEST_DATA_PATH = path.join(os.tmpdir(), `aionui-org-bridge-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const DB_PATH = path.join(TEST_DATA_PATH, 'aionui.db');

vi.mock('@process/utils', async () => {
  const fsModule = await import('node:fs');
  return {
    ensureDirectory: (dir: string) => fsModule.mkdirSync(dir, { recursive: true }),
    getDataPath: () => TEST_DATA_PATH,
  };
});

vi.mock('@process/utils/safeExec', () => ({
  safeExecFile: safeExecFileMock,
}));

import { AionUIDatabase } from '@/process/database';

type ProviderHandler = (payload: any) => Promise<any> | any;

async function waitFor(check: () => boolean, timeoutMs = 1500): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error('Timed out waiting for condition');
}

function createOrgIpcMock(handlers: Record<string, ProviderHandler>) {
  const createCommandMock = (channel: string) => ({
    provider: vi.fn((fn: ProviderHandler) => {
      handlers[channel] = fn;
    }),
    invoke: vi.fn((payload: unknown) => handlers[channel]?.(payload)),
    emit: vi.fn(),
  });

  return {
    organization: {
      create: createCommandMock('org.organization.create'),
      get: createCommandMock('org.organization.get'),
      list: createCommandMock('org.organization.list'),
      update: createCommandMock('org.organization.update'),
      delete: createCommandMock('org.organization.delete'),
      initContext: createCommandMock('org.organization.init-context'),
      syncContext: createCommandMock('org.organization.sync-context'),
      getSystemPrompt: createCommandMock('org.organization.get-system-prompt'),
      getControlState: createCommandMock('org.organization.get-control-state'),
      listApprovals: createCommandMock('org.organization.list-approvals'),
      respondApproval: createCommandMock('org.organization.respond-approval'),
      created: { emit: vi.fn() },
      updated: { emit: vi.fn() },
      deleted: { emit: vi.fn() },
    },
    task: {
      create: createCommandMock('org.task.create'),
      get: createCommandMock('org.task.get'),
      list: createCommandMock('org.task.list'),
      update: createCommandMock('org.task.update'),
      updateStatus: createCommandMock('org.task.update-status'),
      delete: createCommandMock('org.task.delete'),
      created: { emit: vi.fn() },
      updated: { emit: vi.fn() },
      statusChanged: { emit: vi.fn() },
      deleted: { emit: vi.fn() },
    },
    run: {
      start: createCommandMock('org.run.start'),
      get: createCommandMock('org.run.get'),
      list: createCommandMock('org.run.list'),
      update: createCommandMock('org.run.update'),
      close: createCommandMock('org.run.close'),
      cancel: createCommandMock('org.run.cancel'),
      created: { emit: vi.fn() },
      updated: { emit: vi.fn() },
      statusChanged: { emit: vi.fn() },
      closed: { emit: vi.fn() },
    },
    artifact: {
      create: createCommandMock('org.artifact.create'),
      register: createCommandMock('org.artifact.register'),
      get: createCommandMock('org.artifact.get'),
      list: createCommandMock('org.artifact.list'),
      update: createCommandMock('org.artifact.update'),
      delete: createCommandMock('org.artifact.delete'),
      created: { emit: vi.fn() },
      updated: { emit: vi.fn() },
      deleted: { emit: vi.fn() },
    },
    memory: {
      promote: createCommandMock('org.memory.promote'),
      get: createCommandMock('org.memory.get'),
      list: createCommandMock('org.memory.list'),
      update: createCommandMock('org.memory.update'),
      delete: createCommandMock('org.memory.delete'),
      promoted: { emit: vi.fn() },
      updated: { emit: vi.fn() },
      deleted: { emit: vi.fn() },
    },
    eval: {
      create: createCommandMock('org.eval.create'),
      get: createCommandMock('org.eval.get'),
      list: createCommandMock('org.eval.list'),
      update: createCommandMock('org.eval.update'),
      delete: createCommandMock('org.eval.delete'),
      execute: createCommandMock('org.eval.execute'),
      created: { emit: vi.fn() },
      updated: { emit: vi.fn() },
      deleted: { emit: vi.fn() },
      executed: { emit: vi.fn() },
    },
    skill: {
      create: createCommandMock('org.skill.create'),
      get: createCommandMock('org.skill.get'),
      list: createCommandMock('org.skill.list'),
      update: createCommandMock('org.skill.update'),
      delete: createCommandMock('org.skill.delete'),
      created: { emit: vi.fn() },
      updated: { emit: vi.fn() },
      deleted: { emit: vi.fn() },
    },
    evolution: {
      propose: createCommandMock('org.evolution.propose'),
      get: createCommandMock('org.evolution.get'),
      list: createCommandMock('org.evolution.list'),
      update: createCommandMock('org.evolution.update'),
      delete: createCommandMock('org.evolution.delete'),
      offlineEval: createCommandMock('org.evolution.offline-eval'),
      canary: createCommandMock('org.evolution.canary'),
      adopt: createCommandMock('org.evolution.adopt'),
      reject: createCommandMock('org.evolution.reject'),
      proposed: { emit: vi.fn() },
      statusChanged: { emit: vi.fn() },
      adopted: { emit: vi.fn() },
      rejected: { emit: vi.fn() },
    },
    governance: {
      approve: createCommandMock('org.governance.approve'),
      reject: createCommandMock('org.governance.reject'),
      listPending: createCommandMock('org.governance.list-pending'),
      getAuditLogs: createCommandMock('org.governance.get-audit-logs'),
      approved: { emit: vi.fn() },
      rejected: { emit: vi.fn() },
    },
  };
}

function seedConfirmedBrief(db: AionUIDatabase, organizationId: string, overrides: Partial<TOrgBrief> = {}) {
  const now = Date.now();
  const brief: TOrgBrief = {
    id: overrides.id || `org_bridge_brief_${now}`,
    organization_id: organizationId,
    title: overrides.title || 'Confirmed brief',
    summary: overrides.summary || 'Tier 1 decisions are confirmed.',
    status: overrides.status || 'confirmed',
    tier1_open_questions: overrides.tier1_open_questions || [],
    tier2_pending_items: overrides.tier2_pending_items || [],
    constraints: overrides.constraints,
    risk_notes: overrides.risk_notes,
    created_at: overrides.created_at || now,
    updated_at: overrides.updated_at || now,
  };
  expect(db.createOrgBrief(brief).success).toBe(true);
  return brief;
}

function seedPlanSnapshot(
  db: AionUIDatabase,
  organizationId: string,
  briefId: string,
  overrides: Partial<TOrgPlanSnapshot> = {}
) {
  const now = Date.now();
  const snapshot: TOrgPlanSnapshot = {
    id: overrides.id || `org_bridge_plan_${now}`,
    organization_id: organizationId,
    brief_id: overrides.brief_id === undefined ? briefId : overrides.brief_id,
    title: overrides.title || 'Approved execution plan',
    objective: overrides.objective || 'Dispatch approved work',
    content: overrides.content || {
      milestones: [{ id: 'm1', title: 'Create task contracts' }],
    },
    status: overrides.status || 'approved',
    approved_by: overrides.approved_by || 'human_reviewer',
    approved_at: overrides.approved_at || now,
    created_at: overrides.created_at || now,
    updated_at: overrides.updated_at || now,
  };
  expect(db.createOrgPlanSnapshot(snapshot).success).toBe(true);
  return snapshot;
}

function seedApprovalRecord(db: AionUIDatabase, organizationId: string, overrides: Partial<TOrgApprovalRecord> = {}) {
  const now = Date.now();
  const record: TOrgApprovalRecord = {
    id: overrides.id || `org_bridge_approval_${now}`,
    organization_id: organizationId,
    scope: overrides.scope || 'plan_gate',
    status: overrides.status || 'pending',
    target_type: overrides.target_type || 'organization',
    target_id: overrides.target_id,
    title: overrides.title || 'Approve execution plan',
    detail: overrides.detail,
    requested_by: overrides.requested_by || 'organization_control_plane',
    decided_by: overrides.decided_by,
    decided_at: overrides.decided_at,
    decision_comment: overrides.decision_comment,
    created_at: overrides.created_at || now,
    updated_at: overrides.updated_at || now,
  };
  expect(db.createOrgApprovalRecord(record).success).toBe(true);
  return record;
}

describe('organizationBridge', () => {
  let db: AionUIDatabase;
  let handlers: Record<string, ProviderHandler>;
  let organization: TOrganization;
  let task: TOrgTask;
  let evalSpec: TOrgEvalSpec;
  let conversationSeq = 0;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    safeExecFileMock.mockReset();
    safeExecFileMock.mockResolvedValue({ stdout: 'ok\n', stderr: '' });

    fs.mkdirSync(TEST_DATA_PATH, { recursive: true });
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
    }

    db = new AionUIDatabase();
    handlers = {};
    conversationSeq = 0;

    const now = Date.now();
    organization = {
      id: 'org_bridge_alpha',
      name: 'Org Bridge Alpha',
      description: 'Bridge test workspace',
      workspace: path.join(TEST_DATA_PATH, 'workspace'),
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    fs.mkdirSync(organization.workspace, { recursive: true });
    expect(db.createOrganization(organization).success).toBe(true);

    task = {
      id: 'org_bridge_task_1',
      organization_id: organization.id,
      title: 'Bridge seed task',
      objective: 'Seed bridge state',
      scope: ['src/process/bridge/'],
      done_criteria: ['bridge handlers registered'],
      budget: { max_runs: 3 },
      risk_tier: 'normal',
      validators: [],
      deliverable_schema: {},
      status: 'ready',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgTask(task).success).toBe(true);

    evalSpec = {
      id: 'org_bridge_eval_1',
      organization_id: organization.id,
      name: 'Bridge Eval',
      description: 'Bridge eval',
      test_commands: [{ argv: ['bunx', 'vitest', '--run', 'tests/unit/organizationBridge.test.ts'] }],
      quality_gates: [{ gate: 'bridge', rule: 'must-pass' }],
      thresholds: { min_pass_rate: 1 },
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgEvalSpec(evalSpec).success).toBe(true);

    vi.doMock('@/common', () => ({
      ipcBridge: {
        org: createOrgIpcMock(handlers),
      },
    }));
    vi.doMock('@process/database', () => ({
      getDatabase: vi.fn(() => db),
    }));
    vi.doMock('@process/initStorage', () => ({
      getSystemDir: vi.fn(() => ({
        workDir: organization.workspace,
      })),
    }));
    vi.doMock('@process/services/conversationService', () => ({
      ConversationService: {
        createConversation: vi.fn(
          async (params: { name?: string; taskId?: string; extra: Record<string, unknown> }) => {
            conversationSeq += 1;
            const conversation = {
              id: `conv_org_bridge_${conversationSeq}`,
              name: params.name || `Org Bridge Conversation ${conversationSeq}`,
              type: 'acp',
              extra: {
                workspace: params.extra.workspace as string,
                customWorkspace: true,
                backend: (params.extra.backend as string) || 'codex',
                taskId: params.taskId,
                organizationId: params.extra.organizationId as string | undefined,
                runId: params.extra.runId as string | undefined,
                organizationRole: params.extra.organizationRole as string | undefined,
              },
              createTime: Date.now(),
              modifyTime: Date.now(),
              status: 'pending',
            } as const;
            const result = db.createConversation(conversation);
            return result.success
              ? { success: true, conversation }
              : { success: false, error: result.error || 'Failed to create conversation' };
          }
        ),
      },
    }));
  });

  afterEach(async () => {
    try {
      const { stopAllOrganizationWatchers } = await import('@/process/services/organizationOpsWatcher');
      stopAllOrganizationWatchers();
    } catch {
      // Ignore before implementation exists.
    }

    db?.close();
  });

  afterAll(() => {
    fs.rmSync(TEST_DATA_PATH, { recursive: true, force: true });
  });

  it('registers org providers and wires core control plane flows to the database', async () => {
    const { initOrganizationBridge } = await import('@/process/bridge/organizationBridge');
    const brief = seedConfirmedBrief(db, organization.id);
    seedPlanSnapshot(db, organization.id, brief.id);
    initOrganizationBridge();

    expect(handlers['org.task.create']).toBeTypeOf('function');
    expect(handlers['org.run.start']).toBeTypeOf('function');
    expect(handlers['org.organization.get-control-state']).toBeTypeOf('function');
    expect(handlers['org.organization.list-approvals']).toBeTypeOf('function');
    expect(handlers['org.organization.respond-approval']).toBeTypeOf('function');
    expect(handlers['org.artifact.create']).toBeTypeOf('function');
    expect(handlers['org.artifact.register']).toBeTypeOf('function');
    expect(handlers['org.eval.execute']).toBeTypeOf('function');
    expect(handlers['org.memory.promote']).toBeTypeOf('function');
    expect(handlers['org.evolution.propose']).toBeTypeOf('function');
    expect(handlers['org.governance.approve']).toBeTypeOf('function');
    expect(handlers['org.organization.get-system-prompt']).toBeTypeOf('function');

    const createdTaskResult = await handlers['org.task.create']({
      organization_id: organization.id,
      title: 'Created by bridge',
      objective: 'Create a task through org bridge',
      scope: ['src/common/'],
      done_criteria: ['task exists'],
      budget: { max_runs: 2 },
      risk_tier: 'low',
      validators: [],
      deliverable_schema: {},
    });
    expect(createdTaskResult.success).toBe(true);
    const createdTaskId = createdTaskResult.data.id as string;

    const createdRunResult = await handlers['org.run.start']({
      task_id: createdTaskId,
      workspace: { mode: 'isolated', type: 'worktree', path: path.join(organization.workspace, 'runs/run-1') },
      environment: { kind: 'cloud', env_id: 'ts-ci' },
      execution: { model: 'gpt-5.4', effort: 'medium' },
    });
    expect(createdRunResult.success).toBe(true);
    const createdRunId = createdRunResult.data.id as string;

    const createdArtifactResult = await handlers['org.artifact.create']({
      organization_id: organization.id,
      task_id: createdTaskId,
      run_id: createdRunId,
      type: 'test_log',
      title: 'Bridge artifact',
      summary: 'Created through bridge provider',
    });
    expect(createdArtifactResult.success).toBe(true);

    const evalResult = await handlers['org.eval.execute']({
      task_id: createdTaskId,
      run_id: createdRunId,
      eval_spec_id: evalSpec.id,
    });
    expect(evalResult.success).toBe(true);
    expect(evalResult.data.passed).toBe(true);

    const memoryResult = await handlers['org.memory.promote']({
      organization_id: organization.id,
      type: 'workflow_hint',
      title: 'Bridge memory',
      knowledge_unit: 'Bridge flow works.',
      traceability: { source_run_ids: [createdRunId] },
      tags: ['bridge'],
    });
    expect(memoryResult.success).toBe(true);

    const patchResult = await handlers['org.evolution.propose']({
      organization_id: organization.id,
      mutation_target: 'skill',
      based_on: [createdRunId],
      proposal: { skill_name: 'bridge-rollout', change_type: 'create' },
    });
    expect(patchResult.success).toBe(true);

    const governanceResult = await handlers['org.governance.approve']({
      target_type: 'genome_patch',
      target_id: patchResult.data.id,
      comment: 'Approved in bridge test',
    });
    expect(governanceResult.success).toBe(true);

    expect(db.getOrgTask(createdTaskId).data?.title).toBe('Created by bridge');
    expect(db.getOrgRun(createdRunId).data?.status).toBe('reviewing');
    expect(db.listOrgArtifacts({ run_id: createdRunId }).data).toHaveLength(1);
    expect(db.listOrgMemoryCards({ organization_id: organization.id }).data).toHaveLength(1);
    expect(db.getOrgGenomePatch(patchResult.data.id).data?.status).toBe('adopted');

    const promptResult = await handlers['org.organization.get-system-prompt']({
      organizationId: organization.id,
    });
    expect(promptResult.success).toBe(true);
    expect(promptResult.data).toContain('Organization Control Plane AI');
  });

  it('initializes a persisted control state for existing organizations', async () => {
    const { initOrganizationBridge } = await import('@/process/bridge/organizationBridge');
    initOrganizationBridge();

    const result = await handlers['org.organization.get-control-state']({
      organizationId: organization.id,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        organization_id: organization.id,
        phase: 'awaiting_human_decision',
        needs_human_input: true,
        pending_approval_count: 0,
      })
    );
    expect(db.getOrgControlState(organization.id).data?.phase).toBe('awaiting_human_decision');
  });

  it('lists approvals and applies approval responses through the bridge', async () => {
    const brief = seedConfirmedBrief(db, organization.id);
    const plan = seedPlanSnapshot(db, organization.id, brief.id, {
      status: 'draft',
      approved_by: undefined,
      approved_at: undefined,
    });
    const approval = seedApprovalRecord(db, organization.id, {
      target_id: plan.id,
      detail: 'Need explicit human approval before dispatch.',
    });
    const staleApproval = seedApprovalRecord(db, organization.id, {
      id: 'org_bridge_approval_stale',
      target_id: 'org_bridge_plan_stale',
      detail: 'Stale plan approval should be superseded.',
    });

    const { initOrganizationBridge } = await import('@/process/bridge/organizationBridge');
    initOrganizationBridge();

    const approvalsResult = await handlers['org.organization.list-approvals']({
      organizationId: organization.id,
      status: 'pending',
      limit: 10,
    });
    expect(approvalsResult.success).toBe(true);
    expect(approvalsResult.data).toHaveLength(2);
    expect(approvalsResult.data.map((item: { id: string }) => item.id)).toContain(approval.id);

    const respondResult = await handlers['org.organization.respond-approval']({
      organizationId: organization.id,
      approvalId: approval.id,
      decision: 'approved',
      actor: 'human_reviewer',
      comment: 'Proceed with this plan.',
    });
    expect(respondResult.success).toBe(true);

    expect(db.getOrgApprovalRecord(approval.id).data).toEqual(
      expect.objectContaining({
        status: 'approved',
        decided_by: 'human_reviewer',
        decision_comment: 'Proceed with this plan.',
      })
    );
    expect(db.getOrgApprovalRecord(staleApproval.id).data).toEqual(
      expect.objectContaining({
        status: 'rejected',
        decided_by: 'human_reviewer',
      })
    );
    expect(db.getOrgPlanSnapshot(plan.id).data).toEqual(
      expect.objectContaining({
        status: 'approved',
        approved_by: 'human_reviewer',
      })
    );
    const auditLogs = db.listOrgAuditLogs({ organization_id: organization.id }).data || [];
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toEqual(
      expect.objectContaining({
        action: 'approve',
        actor: 'human_reviewer',
      })
    );

    const controlState = await handlers['org.organization.get-control-state']({
      organizationId: organization.id,
    });
    expect(controlState.success).toBe(true);
    expect(controlState.data).toEqual(
      expect.objectContaining({
        phase: 'drafting_plan',
        pending_approval_count: 0,
      })
    );
  });

  it('records needs_more_info approval responses in the audit log', async () => {
    const brief = seedConfirmedBrief(db, organization.id);
    const plan = seedPlanSnapshot(db, organization.id, brief.id, {
      status: 'draft',
      approved_by: undefined,
      approved_at: undefined,
    });
    const approval = seedApprovalRecord(db, organization.id, {
      target_id: plan.id,
    });

    const { initOrganizationBridge } = await import('@/process/bridge/organizationBridge');
    initOrganizationBridge();

    const respondResult = await handlers['org.organization.respond-approval']({
      organizationId: organization.id,
      approvalId: approval.id,
      decision: 'needs_more_info',
      actor: 'human_reviewer',
      comment: 'Need more detail on rollback strategy.',
    });
    expect(respondResult.success).toBe(true);

    const auditLogs = db.listOrgAuditLogs({ organization_id: organization.id }).data || [];
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toEqual(
      expect.objectContaining({
        action: 'needs_more_info',
        actor: 'human_reviewer',
      })
    );
  });

  it('rejects repeated responses for the same approval record', async () => {
    const brief = seedConfirmedBrief(db, organization.id);
    const plan = seedPlanSnapshot(db, organization.id, brief.id, {
      status: 'draft',
      approved_by: undefined,
      approved_at: undefined,
    });
    const approval = seedApprovalRecord(db, organization.id, {
      target_id: plan.id,
    });

    const { initOrganizationBridge } = await import('@/process/bridge/organizationBridge');
    initOrganizationBridge();

    const firstResponse = await handlers['org.organization.respond-approval']({
      organizationId: organization.id,
      approvalId: approval.id,
      decision: 'approved',
      actor: 'human_reviewer',
      comment: 'First decision.',
    });
    expect(firstResponse.success).toBe(true);

    const secondResponse = await handlers['org.organization.respond-approval']({
      organizationId: organization.id,
      approvalId: approval.id,
      decision: 'rejected',
      actor: 'human_reviewer',
      comment: 'Should be blocked.',
    });
    expect(secondResponse.success).toBe(false);

    expect(db.getOrgApprovalRecord(approval.id).data).toEqual(
      expect.objectContaining({
        status: 'approved',
        decision_comment: 'First decision.',
      })
    );
    expect(db.listOrgAuditLogs({ organization_id: organization.id }).data).toHaveLength(1);
  });

  it('moves control phase from monitoring back to planning when a run is closed', async () => {
    const brief = seedConfirmedBrief(db, organization.id);
    seedPlanSnapshot(db, organization.id, brief.id);

    const { initOrganizationBridge } = await import('@/process/bridge/organizationBridge');
    initOrganizationBridge();

    const createdTaskResult = await handlers['org.task.create']({
      organization_id: organization.id,
      title: 'Bridge close loop task',
      objective: 'Verify control phase rollback after run close',
      scope: ['src/process/bridge/'],
      done_criteria: ['run closes'],
      budget: { max_runs: 1 },
      risk_tier: 'low',
      validators: [],
      deliverable_schema: {},
    });
    expect(createdTaskResult.success).toBe(true);

    const createdRunResult = await handlers['org.run.start']({
      task_id: createdTaskResult.data.id,
      workspace: { mode: 'isolated', type: 'worktree', path: path.join(organization.workspace, 'runs/run-close') },
      environment: { kind: 'cloud', env_id: 'ts-ci' },
      execution: { model: 'gpt-5.4', effort: 'medium' },
    });
    expect(createdRunResult.success).toBe(true);

    const monitoringState = await handlers['org.organization.get-control-state']({
      organizationId: organization.id,
    });
    expect(monitoringState.data.phase).toBe('monitoring');

    const closeResult = await handlers['org.run.close']({
      id: createdRunResult.data.id,
    });
    expect(closeResult.success).toBe(true);

    const closedState = await handlers['org.organization.get-control-state']({
      organizationId: organization.id,
    });
    expect(closedState.success).toBe(true);
    expect(closedState.data).toEqual(
      expect.objectContaining({
        phase: 'drafting_plan',
        needs_human_input: false,
        pending_approval_count: 0,
      })
    );
  });

  it('reconciles control phase when run setup rolls back after watcher success', async () => {
    const brief = seedConfirmedBrief(db, organization.id);
    seedPlanSnapshot(db, organization.id, brief.id);

    const { ConversationService } = await import('@process/services/conversationService');
    vi.mocked(ConversationService.createConversation).mockResolvedValueOnce({
      success: false,
      error: 'conversation bootstrap failed',
    } as never);

    const { initOrganizationBridge } = await import('@/process/bridge/organizationBridge');
    initOrganizationBridge();

    const createdTaskResult = await handlers['org.task.create']({
      organization_id: organization.id,
      title: 'Rollback task',
      objective: 'Ensure monitoring phase rolls back when run setup fails',
      scope: ['src/process/bridge/'],
      done_criteria: ['state reconciled'],
      budget: { max_runs: 1 },
      risk_tier: 'low',
      validators: [],
      deliverable_schema: {},
    });
    expect(createdTaskResult.success).toBe(true);

    const createdRunResult = await handlers['org.run.start']({
      task_id: createdTaskResult.data.id,
      workspace: { mode: 'isolated', type: 'worktree', path: path.join(organization.workspace, 'runs/run-rollback') },
      environment: { kind: 'cloud', env_id: 'ts-ci' },
      execution: { model: 'gpt-5.4', effort: 'medium' },
    });
    expect(createdRunResult.success).toBe(false);

    const controlState = await handlers['org.organization.get-control-state']({
      organizationId: organization.id,
    });
    expect(controlState.success).toBe(true);
    expect(controlState.data.phase).toBe('drafting_plan');
    expect(db.listOrgRuns({ organization_id: organization.id, status: 'active' }).data).toHaveLength(0);
  });

  it('moves watcher activity to the new workspace after organization workspace update', async () => {
    const { initOrganizationBridge } = await import('@/process/bridge/organizationBridge');
    const brief = seedConfirmedBrief(db, organization.id);
    seedPlanSnapshot(db, organization.id, brief.id);
    initOrganizationBridge();

    const nextWorkspace = path.join(TEST_DATA_PATH, 'workspace-next');
    fs.mkdirSync(nextWorkspace, { recursive: true });

    const updateResult = await handlers['org.organization.update']({
      id: organization.id,
      updates: {
        workspace: nextWorkspace,
      },
    });
    expect(updateResult.success).toBe(true);

    const operationsDir = path.join(nextWorkspace, '.aionui-org', 'control', 'operations');
    fs.mkdirSync(operationsDir, { recursive: true });
    const operationPath = path.join(operationsDir, 'workspace-move-task.json');
    fs.writeFileSync(
      operationPath,
      JSON.stringify({
        method: 'org/task/create',
        params: {
          organization_id: organization.id,
          title: 'Moved workspace task',
          objective: 'Watcher should follow workspace updates',
          scope: ['docs/'],
          done_criteria: ['watcher moved'],
          budget: {},
          risk_tier: 'low',
          validators: [],
          deliverable_schema: {},
        },
      }),
      'utf-8'
    );

    await waitFor(() => fs.existsSync(operationPath.replace(/\.json$/, '.result.json')));
    expect(db.getOrganizationTasks(organization.id).data?.some((item) => item.title === 'Moved workspace task')).toBe(
      true
    );
  });
});
