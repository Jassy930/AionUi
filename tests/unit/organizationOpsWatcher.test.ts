/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TOrgBrief, TOrganization, TOrgEvalSpec, TOrgPlanSnapshot, TOrgTask } from '@/common/types/organization';

let currentDb: import('@/process/database').AionUIDatabase;
const { safeExecFileMock } = vi.hoisted(() => ({
  safeExecFileMock: vi.fn(),
}));

const TEST_DATA_PATH = path.join(
  os.tmpdir(),
  `aionui-org-watcher-${Date.now()}-${Math.random().toString(16).slice(2)}`
);
const DB_PATH = path.join(TEST_DATA_PATH, 'aionui.db');
const WORKSPACE_PATH = path.join(TEST_DATA_PATH, 'workspace');

vi.mock('@process/utils', async () => {
  const fsModule = await import('node:fs');
  return {
    ensureDirectory: (dir: string) => fsModule.mkdirSync(dir, { recursive: true }),
    getDataPath: () => TEST_DATA_PATH,
  };
});

vi.mock('@process/database', async () => {
  const actual = await vi.importActual<typeof import('@/process/database')>('@/process/database');
  return {
    ...actual,
    getDatabase: vi.fn(() => currentDb),
  };
});

vi.mock('@process/utils/safeExec', () => ({
  safeExecFile: safeExecFileMock,
}));

import { AionUIDatabase } from '@/process/database';
import { getOrganizationContextDir, initOrganizationContext } from '@/process/services/organizationContextService';
import {
  executeOrganizationOperation,
  processOrganizationOperationFile,
} from '@/process/services/organizationOpsWatcher';

function seedConfirmedBrief(db: AionUIDatabase, organizationId: string, overrides: Partial<TOrgBrief> = {}) {
  const now = Date.now();
  const brief: TOrgBrief = {
    id: overrides.id || `org_watcher_brief_${now}`,
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
    id: overrides.id || `org_watcher_plan_${now}`,
    organization_id: organizationId,
    brief_id: overrides.brief_id === undefined ? briefId : overrides.brief_id,
    title: overrides.title || 'Watcher execution plan',
    objective: overrides.objective || 'Dispatch approved watcher work',
    content: overrides.content || {
      milestones: [{ id: 'm1', title: 'Dispatch task contracts' }],
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

describe('organizationOpsWatcher', () => {
  let db: AionUIDatabase;
  let organization: TOrganization;
  let task: TOrgTask;
  let evalSpec: TOrgEvalSpec;

  beforeEach(() => {
    safeExecFileMock.mockReset();
    safeExecFileMock.mockResolvedValue({ stdout: 'ok\n', stderr: '' });
    fs.mkdirSync(TEST_DATA_PATH, { recursive: true });
    fs.mkdirSync(WORKSPACE_PATH, { recursive: true });
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
    }

    db = new AionUIDatabase();
    currentDb = db;
    const now = Date.now();
    organization = {
      id: 'org_watcher_alpha',
      name: 'Org Watcher Alpha',
      description: 'Watcher test workspace',
      workspace: WORKSPACE_PATH,
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrganization(organization).success).toBe(true);

    task = {
      id: 'org_watcher_task_1',
      organization_id: organization.id,
      title: 'Existing task',
      objective: 'Seed watcher paths',
      scope: ['src/process/'],
      done_criteria: ['operations can run'],
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
      id: 'org_watcher_eval_1',
      organization_id: organization.id,
      name: 'Watcher Eval',
      description: 'Watcher eval spec',
      test_commands: [{ argv: ['bunx', 'vitest', '--run', 'tests/unit/organizationOpsWatcher.test.ts'] }],
      quality_gates: [{ gate: 'watcher', rule: 'must-pass' }],
      thresholds: { min_pass_rate: 1 },
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgEvalSpec(evalSpec).success).toBe(true);

    initOrganizationContext(organization);
  });

  afterEach(() => {
    db?.close();
  });

  afterAll(() => {
    fs.rmSync(TEST_DATA_PATH, { recursive: true, force: true });
  });

  it('executes core org operations against the database', async () => {
    const brief = seedConfirmedBrief(db, organization.id);
    seedPlanSnapshot(db, organization.id, brief.id);

    const taskCreateResult = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/task/create',
      params: {
        organization_id: organization.id,
        title: 'Bridge task',
        objective: 'Create task from watcher',
        scope: ['src/common/'],
        done_criteria: ['task created'],
        budget: { max_runs: 2 },
        risk_tier: 'low',
        validators: [],
        deliverable_schema: {},
      },
    });
    expect(taskCreateResult.success).toBe(true);
    const createdTaskId = (taskCreateResult.data as { id: string }).id;

    const runStartResult = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/run/start',
      params: {
        task_id: createdTaskId,
        workspace: { mode: 'isolated', type: 'worktree', path: path.join(WORKSPACE_PATH, 'runs/run-1') },
        environment: { kind: 'cloud', env_id: 'ts-ci' },
        context_policy: { project_memory: 'strict', episodic_top_k: 5 },
        execution: { model: 'gpt-5.4', effort: 'medium' },
      },
    });
    expect(runStartResult.success).toBe(true);
    const createdRunId = (runStartResult.data as { id: string }).id;

    const artifactResult = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/artifact/register',
      params: {
        organization_id: organization.id,
        task_id: createdTaskId,
        run_id: createdRunId,
        type: 'test_log',
        title: 'Watcher test log',
        summary: 'Generated by org watcher test',
      },
    });
    expect(artifactResult.success).toBe(true);

    const evalResult = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/eval/execute',
      params: {
        task_id: createdTaskId,
        run_id: createdRunId,
        eval_spec_id: evalSpec.id,
      },
    });
    expect(evalResult.success).toBe(true);
    expect(evalResult.data).toEqual(
      expect.objectContaining({
        task_id: createdTaskId,
        run_id: createdRunId,
        eval_spec_id: evalSpec.id,
        passed: true,
      })
    );

    const memoryResult = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/memory/promote',
      params: {
        organization_id: organization.id,
        type: 'workflow_hint',
        title: 'Watcher lesson',
        knowledge_unit: 'Keep org operations structured.',
        traceability: { source_run_ids: [createdRunId] },
        tags: ['watcher'],
      },
    });
    expect(memoryResult.success).toBe(true);

    const evolutionResult = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/evolution/propose',
      params: {
        organization_id: organization.id,
        mutation_target: 'skill',
        based_on: [createdRunId],
        proposal: { skill_name: 'watcher-triage', change_type: 'create' },
      },
    });
    expect(evolutionResult.success).toBe(true);
    const patchId = (evolutionResult.data as { id: string }).id;

    const governanceResult = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/governance/approve',
      params: {
        target_type: 'genome_patch',
        target_id: patchId,
        comment: 'Can proceed',
      },
    });
    expect(governanceResult.success).toBe(true);

    expect(db.getOrgRun(createdRunId).data?.status).toBe('reviewing');
    expect(db.getOrgTask(createdTaskId).data?.status).toBe('running');
    expect(db.listOrgArtifacts({ run_id: createdRunId }).data).toHaveLength(1);
    expect(db.listOrgMemoryCards({ organization_id: organization.id }).data).toHaveLength(1);
    expect(db.getOrgGenomePatch(patchId).data?.status).toBe('adopted');
    expect(db.listOrgAuditLogs({ organization_id: organization.id }).data).toHaveLength(1);
  });

  it('moves control state to awaiting_human_decision when tier 1 information is missing', async () => {
    const taskCreateResult = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/task/create',
      params: {
        organization_id: organization.id,
        title: 'Blocked task',
        objective: 'Should require human clarification first',
        scope: ['docs/'],
        done_criteria: ['blocked'],
        budget: {},
        risk_tier: 'low',
        validators: [],
        deliverable_schema: {},
      },
    });

    expect(taskCreateResult.success).toBe(false);
    expect(taskCreateResult.message).toContain('tier 1');
    expect(db.getOrgControlState(organization.id).data).toEqual(
      expect.objectContaining({
        phase: 'awaiting_human_decision',
        needs_human_input: true,
      })
    );
  });

  it('blocks dispatch when a newer brief reopens tier 1 questions', async () => {
    const now = Date.now();
    seedConfirmedBrief(db, organization.id, {
      id: 'org_watcher_brief_confirmed_old',
      created_at: now - 1000,
      updated_at: now - 1000,
    });
    seedPlanSnapshot(db, organization.id, 'org_watcher_brief_confirmed_old');
    seedConfirmedBrief(db, organization.id, {
      id: 'org_watcher_brief_latest_draft',
      status: 'draft',
      tier1_open_questions: ['Who is the real target user for this workflow?'],
      created_at: now,
      updated_at: now,
    });

    const taskCreateResult = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/task/create',
      params: {
        organization_id: organization.id,
        title: 'Should be blocked by latest brief',
        objective: 'Latest draft brief must reopen tier 1 gate',
        scope: ['docs/'],
        done_criteria: ['blocked'],
        budget: {},
        risk_tier: 'low',
        validators: [],
        deliverable_schema: {},
      },
    });

    expect(taskCreateResult.success).toBe(false);
    expect(db.getOrgControlState(organization.id).data).toEqual(
      expect.objectContaining({
        phase: 'awaiting_human_decision',
        active_brief_id: 'org_watcher_brief_latest_draft',
      })
    );
  });

  it('rejects run start without an approved plan snapshot and creates a plan approval gate', async () => {
    const brief = seedConfirmedBrief(db, organization.id);
    const plan = seedPlanSnapshot(db, organization.id, brief.id, {
      status: 'draft',
      approved_by: undefined,
      approved_at: undefined,
    });

    const runStartResult = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/run/start',
      params: {
        task_id: task.id,
        workspace: { mode: 'isolated', type: 'worktree', path: path.join(WORKSPACE_PATH, 'runs/run-gated') },
        environment: { kind: 'cloud', env_id: 'ts-ci' },
      },
    });

    expect(runStartResult.success).toBe(false);
    expect(runStartResult.message).toContain('approved plan snapshot');
    expect(db.getOrgControlState(organization.id).data).toEqual(
      expect.objectContaining({
        phase: 'awaiting_plan_approval',
        active_plan_id: plan.id,
        needs_human_input: true,
        pending_approval_count: 1,
      })
    );
    expect(db.listOrgApprovalRecords({ organization_id: organization.id, status: 'pending', limit: 10 }).data).toEqual([
      expect.objectContaining({
        scope: 'plan_gate',
        status: 'pending',
        target_type: 'organization',
        target_id: plan.id,
      }),
    ]);
  });

  it('blocks dispatch when a newer draft plan exists after an older approved plan', async () => {
    const brief = seedConfirmedBrief(db, organization.id);
    seedPlanSnapshot(db, organization.id, brief.id, {
      id: 'org_watcher_plan_old_approved',
      status: 'approved',
      created_at: Date.now() - 1000,
      updated_at: Date.now() - 1000,
    });
    const latestDraftPlan = seedPlanSnapshot(db, organization.id, brief.id, {
      id: 'org_watcher_plan_latest_draft',
      status: 'draft',
      approved_by: undefined,
      approved_at: undefined,
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const runStartResult = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/run/start',
      params: {
        task_id: task.id,
        workspace: { mode: 'isolated', type: 'worktree', path: path.join(WORKSPACE_PATH, 'runs/run-latest-draft') },
        environment: { kind: 'cloud', env_id: 'ts-ci' },
      },
    });

    expect(runStartResult.success).toBe(false);
    expect(db.getOrgControlState(organization.id).data).toEqual(
      expect.objectContaining({
        phase: 'awaiting_plan_approval',
        active_plan_id: latestDraftPlan.id,
      })
    );
    expect(db.listOrgApprovalRecords({ organization_id: organization.id, status: 'pending', limit: 10 }).data).toEqual([
      expect.objectContaining({
        target_id: latestDraftPlan.id,
      }),
    ]);
  });

  it('updates control phase to dispatching and monitoring for task and run execution', async () => {
    const brief = seedConfirmedBrief(db, organization.id);
    seedPlanSnapshot(db, organization.id, brief.id);

    const taskCreateResult = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/task/create',
      params: {
        organization_id: organization.id,
        title: 'Dispatch task',
        objective: 'Advance control state into dispatching',
        scope: ['src/process/'],
        done_criteria: ['task dispatched'],
        budget: {},
        risk_tier: 'low',
        validators: [],
        deliverable_schema: {},
      },
    });
    expect(taskCreateResult.success).toBe(true);
    expect(db.getOrgControlState(organization.id).data?.phase).toBe('dispatching');

    const runStartResult = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/run/start',
      params: {
        task_id: (taskCreateResult.data as { id: string }).id,
        workspace: { mode: 'isolated', type: 'worktree', path: path.join(WORKSPACE_PATH, 'runs/run-monitoring') },
        environment: { kind: 'cloud', env_id: 'ts-ci' },
      },
    });
    expect(runStartResult.success).toBe(true);
    expect(db.getOrgControlState(organization.id).data?.phase).toBe('monitoring');
  });

  it('rejects cross-organization operations from the current watcher context', async () => {
    const now = Date.now();
    const foreignOrganization: TOrganization = {
      id: 'org_watcher_foreign',
      name: 'Foreign Org',
      workspace: path.join(TEST_DATA_PATH, 'foreign-workspace'),
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    fs.mkdirSync(foreignOrganization.workspace, { recursive: true });
    expect(db.createOrganization(foreignOrganization).success).toBe(true);

    const result = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/task/create',
      params: {
        organization_id: foreignOrganization.id,
        title: 'Foreign task',
        objective: 'Should be blocked',
        scope: ['src/'],
        done_criteria: ['blocked'],
        budget: {},
        risk_tier: 'low',
        validators: [],
        deliverable_schema: {},
      },
    });

    expect(result.success).toBe(false);
    expect(db.getOrganizationTasks(foreignOrganization.id).data).toHaveLength(0);
  });

  it('allows the same file path to be retried after malformed input', async () => {
    const brief = seedConfirmedBrief(db, organization.id);
    seedPlanSnapshot(db, organization.id, brief.id);

    const contextDir = getOrganizationContextDir(organization.workspace);
    const operationsDir = path.join(contextDir, 'control', 'operations');
    const filePath = path.join(operationsDir, 'retry-task.json');

    fs.writeFileSync(filePath, '{invalid json', 'utf-8');
    await processOrganizationOperationFile(organization.id, organization.workspace, filePath);

    const errorResult = JSON.parse(fs.readFileSync(filePath.replace(/\.json$/, '.result.json'), 'utf-8')) as {
      success: boolean;
    };
    expect(errorResult.success).toBe(false);

    fs.writeFileSync(
      filePath,
      JSON.stringify({
        method: 'org/task/create',
        params: {
          organization_id: organization.id,
          title: 'Retry task',
          objective: 'Retry with valid payload',
          scope: ['docs/'],
          done_criteria: ['retry succeeds'],
          budget: {},
          risk_tier: 'low',
          validators: [],
          deliverable_schema: {},
        },
      }),
      'utf-8'
    );
    await processOrganizationOperationFile(organization.id, organization.workspace, filePath);

    const successResult = JSON.parse(fs.readFileSync(filePath.replace(/\.json$/, '.result.json'), 'utf-8')) as {
      success: boolean;
    };
    expect(successResult.success).toBe(true);
    expect(db.getOrganizationTasks(organization.id).data?.some((item) => item.title === 'Retry task')).toBe(true);
  });

  it('rolls back a created run when task status update fails', async () => {
    const brief = seedConfirmedBrief(db, organization.id);
    seedPlanSnapshot(db, organization.id, brief.id);

    const updateSpy = vi.spyOn(db, 'updateOrgTask').mockReturnValueOnce({
      success: false,
      error: 'task status update failed',
    });

    const runStartResult = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/run/start',
      params: {
        task_id: task.id,
        workspace: { mode: 'isolated', type: 'worktree', path: path.join(WORKSPACE_PATH, 'runs/run-rollback') },
        environment: { kind: 'cloud', env_id: 'ts-ci' },
      },
    });

    expect(runStartResult.success).toBe(false);
    expect(db.listOrgRuns({ task_id: task.id }).data).toHaveLength(0);
    updateSpy.mockRestore();
  });

  it('rejects artifact and eval requests when run does not belong to the given task', async () => {
    const brief = seedConfirmedBrief(db, organization.id);
    seedPlanSnapshot(db, organization.id, brief.id);

    const now = Date.now();
    const secondTask: TOrgTask = {
      id: 'org_watcher_task_2',
      organization_id: organization.id,
      title: 'Second task',
      objective: 'Used for mismatch validation',
      scope: ['src/renderer/'],
      done_criteria: ['mismatch blocked'],
      budget: {},
      risk_tier: 'low',
      validators: [],
      deliverable_schema: {},
      status: 'ready',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgTask(secondTask).success).toBe(true);

    const runStartResult = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/run/start',
      params: {
        task_id: task.id,
        workspace: { mode: 'isolated', type: 'worktree', path: path.join(WORKSPACE_PATH, 'runs/run-mismatch') },
        environment: { kind: 'cloud', env_id: 'ts-ci' },
      },
    });
    expect(runStartResult.success).toBe(true);
    const runId = (runStartResult.data as { id: string }).id;

    const artifactResult = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/artifact/register',
      params: {
        organization_id: organization.id,
        task_id: secondTask.id,
        run_id: runId,
        type: 'test_log',
        title: 'Mismatched artifact',
      },
    });
    expect(artifactResult.success).toBe(false);

    const evalResult = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/eval/execute',
      params: {
        task_id: secondTask.id,
        run_id: runId,
        eval_spec_id: evalSpec.id,
      },
    });
    expect(evalResult.success).toBe(false);
  });

  it('reverts governance approval when audit persistence fails', async () => {
    const brief = seedConfirmedBrief(db, organization.id);
    seedPlanSnapshot(db, organization.id, brief.id);

    const runStartResult = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/run/start',
      params: {
        task_id: task.id,
        workspace: { mode: 'isolated', type: 'worktree', path: path.join(WORKSPACE_PATH, 'runs/run-governance') },
        environment: { kind: 'cloud', env_id: 'ts-ci' },
      },
    });
    expect(runStartResult.success).toBe(true);
    const runId = (runStartResult.data as { id: string }).id;

    const patchResult = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/evolution/propose',
      params: {
        organization_id: organization.id,
        mutation_target: 'skill',
        based_on: [runId],
        proposal: { skill_name: 'watcher-triage', change_type: 'create' },
      },
    });
    expect(patchResult.success).toBe(true);
    const patchId = (patchResult.data as { id: string }).id;

    const auditSpy = vi.spyOn(db, 'createOrgAuditLog').mockReturnValueOnce({
      success: false,
      error: 'audit persistence failed',
    });

    const approvalResult = await executeOrganizationOperation(organization.id, organization.workspace, {
      method: 'org/governance/approve',
      params: {
        target_type: 'genome_patch',
        target_id: patchId,
        comment: 'should roll back',
      },
    });

    expect(approvalResult.success).toBe(false);
    expect(db.getOrgGenomePatch(patchId).data?.status).toBe('proposed');
    auditSpy.mockRestore();
  });

  it('parses operation files and writes result files into .aionui-org', async () => {
    const brief = seedConfirmedBrief(db, organization.id);
    seedPlanSnapshot(db, organization.id, brief.id);

    const contextDir = getOrganizationContextDir(organization.workspace);
    const operationsDir = path.join(contextDir, 'control', 'operations');
    const filePath = path.join(operationsDir, 'create-task.json');

    fs.writeFileSync(
      filePath,
      JSON.stringify({
        method: 'org/task/create',
        params: {
          organization_id: organization.id,
          title: 'File task',
          objective: 'Create task from operation file',
          scope: ['docs/'],
          done_criteria: ['file parsed'],
          budget: {},
          risk_tier: 'low',
          validators: [],
          deliverable_schema: {},
        },
      }),
      'utf-8'
    );

    await processOrganizationOperationFile(organization.id, organization.workspace, filePath);

    expect(fs.existsSync(filePath)).toBe(false);
    const resultPath = filePath.replace(/\.json$/, '.result.json');
    expect(fs.existsSync(resultPath)).toBe(true);

    const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8')) as { success: boolean; data?: { id: string } };
    expect(result.success).toBe(true);
    expect(result.data?.id).toBeTruthy();

    const tasksJson = JSON.parse(fs.readFileSync(path.join(contextDir, 'context', 'tasks.json'), 'utf-8')) as Array<{
      id: string;
      title: string;
    }>;
    expect(tasksJson.some((item) => item.title === 'File task')).toBe(true);
  });
});
