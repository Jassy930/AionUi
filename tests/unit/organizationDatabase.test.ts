/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/storage';
import type {
  TOrgApprovalRecord,
  TOrgArtifact,
  TOrgBrief,
  TOrgControlState,
  TOrganization,
  TOrgPlanSnapshot,
  TOrgRun,
  TOrgTask,
} from '@/common/types/organization';
import type { TProject, TTask } from '@/common/types/task';

const TEST_DATA_PATH = path.join(os.tmpdir(), `aionui-org-db-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const DB_PATH = path.join(TEST_DATA_PATH, 'aionui.db');

vi.mock('@process/utils', async () => {
  const fsModule = await import('node:fs');
  return {
    ensureDirectory: (dir: string) => fsModule.mkdirSync(dir, { recursive: true }),
    getDataPath: () => TEST_DATA_PATH,
  };
});

import { AionUIDatabase } from '@/process/database';

function buildTestConversation(id: string, now: number, workspace: string, organizationId?: string): TChatConversation {
  return {
    id,
    name: `Conversation ${id}`,
    type: 'acp',
    extra: {
      workspace,
      customWorkspace: true,
      backend: 'codex',
      organizationId,
      organizationRole: organizationId ? 'control_plane' : undefined,
    },
    createTime: now,
    modifyTime: now,
    status: 'pending',
  };
}

describe('organization database schema and repository', () => {
  let db: AionUIDatabase;

  beforeEach(() => {
    fs.mkdirSync(TEST_DATA_PATH, { recursive: true });
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
    }
    db = new AionUIDatabase();
  });

  afterEach(() => {
    db?.close();
  });

  afterAll(() => {
    fs.rmSync(TEST_DATA_PATH, { recursive: true, force: true });
  });

  it('creates organization tables and conversation mapping columns', () => {
    const sqlite = new BetterSqlite3(DB_PATH, { readonly: true });
    const tables = sqlite
      .prepare(
        `
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'organizations',
          'org_tasks',
          'org_runs',
          'org_artifacts',
          'org_memory_cards',
          'org_eval_specs',
          'org_skills',
          'org_genome_patches',
          'org_audit_logs',
          'org_control_states',
          'org_briefs',
          'org_plan_snapshots',
          'org_approval_records'
        )
      `
      )
      .all() as Array<{ name: string }>;
    const tableSet = new Set(tables.map((t) => t.name));

    expect(tableSet).toEqual(
      new Set([
        'organizations',
        'org_tasks',
        'org_runs',
        'org_artifacts',
        'org_memory_cards',
        'org_eval_specs',
        'org_skills',
        'org_genome_patches',
        'org_audit_logs',
        'org_control_states',
        'org_briefs',
        'org_plan_snapshots',
        'org_approval_records',
      ])
    );

    const conversationColumns = sqlite.prepare(`PRAGMA table_info(conversations)`).all() as Array<{ name: string }>;
    const conversationColumnSet = new Set(conversationColumns.map((c) => c.name));
    expect(conversationColumnSet.has('organization_id')).toBe(true);
    expect(conversationColumnSet.has('run_id')).toBe(true);

    sqlite.close();
  });

  it('supports organization -> task contract -> run as primary path', () => {
    const now = Date.now();
    const org: TOrganization = {
      id: 'org_alpha',
      name: 'Org Alpha',
      description: 'Organization OS',
      workspace: '/tmp/org-alpha',
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };

    const orgResult = db.createOrganization(org);
    expect(orgResult.success).toBe(true);

    const task: TOrgTask = {
      id: 'org_task_1',
      organization_id: org.id,
      title: 'Implement payment retry',
      objective: 'Handle payment retries safely',
      scope: ['payments/', 'tests/payments/'],
      done_criteria: ['regression passes', 'retry added', 'idempotency covered'],
      budget: { max_runs: 8, max_cost_usd: 20 },
      risk_tier: 'normal',
      validators: [{ kind: 'command', argv: ['pytest', 'tests/payments', '-q'] }],
      deliverable_schema: { type: 'object' },
      status: 'ready',
      created_at: now,
      updated_at: now,
    };

    const taskResult = db.createOrgTask(task);
    expect(taskResult.success).toBe(true);

    const run: TOrgRun = {
      id: 'org_run_1',
      organization_id: org.id,
      task_id: task.id,
      status: 'created',
      workspace: { mode: 'isolated', type: 'worktree', path: '/tmp/worktree' },
      environment: { kind: 'cloud', env_id: 'python-ci' },
      context_policy: { project_memory: 'strict', episodic_top_k: 5 },
      execution: { model: 'gpt-5.4', effort: 'medium', sandbox: 'workspaceWrite' },
      execution_logs: [],
      created_at: now,
      updated_at: now,
    };

    const runResult = db.createOrgRun(run);
    expect(runResult.success).toBe(true);

    const tasksResult = db.getOrganizationTasks(org.id);
    expect(tasksResult.success).toBe(true);
    expect(tasksResult.data?.map((item) => item.id)).toEqual([task.id]);

    const runsResult = db.listOrgRuns({ task_id: task.id });
    expect(runsResult.success).toBe(true);
    expect(runsResult.data?.map((item) => item.id)).toEqual([run.id]);
    expect(runsResult.data?.[0]?.task_id).toBe(task.id);
  });

  it('keeps legacy projects/tasks path separated from organization primary path', () => {
    const now = Date.now();
    const legacyProject: TProject = {
      id: 'proj_legacy_1',
      name: 'Legacy Project',
      description: 'Legacy path',
      workspace: '/tmp/legacy',
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    expect(db.createProject(legacyProject).success).toBe(true);

    const legacyTask: TTask = {
      id: 'legacy_task_1',
      project_id: legacyProject.id,
      name: 'Legacy Task',
      description: 'Legacy task row',
      status: 'todo',
      sort_order: 0,
      created_at: now,
      updated_at: now,
    };
    expect(db.createTask(legacyTask).success).toBe(true);

    const org: TOrganization = {
      id: 'org_beta',
      name: 'Org Beta',
      workspace: '/tmp/org-beta',
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrganization(org).success).toBe(true);

    const orgTask: TOrgTask = {
      id: 'org_task_beta_1',
      organization_id: org.id,
      title: 'Org-first Task',
      objective: 'Use org task path',
      scope: ['src/'],
      done_criteria: ['works'],
      budget: {},
      risk_tier: 'low',
      validators: [],
      deliverable_schema: {},
      status: 'draft',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgTask(orgTask).success).toBe(true);

    const legacyTasksResult = db.getProjectTasks(legacyProject.id);
    expect(legacyTasksResult.success).toBe(true);
    expect(legacyTasksResult.data?.map((t) => t.id)).toEqual([legacyTask.id]);

    const orgTasksResult = db.getOrganizationTasks(org.id);
    expect(orgTasksResult.success).toBe(true);
    expect(orgTasksResult.data?.map((t) => t.id)).toEqual([orgTask.id]);
  });

  it('enforces organization consistency when associating conversation with run', () => {
    const now = Date.now();

    const orgA: TOrganization = {
      id: 'org_assoc_a',
      name: 'Org Assoc A',
      workspace: '/tmp/org-assoc-a',
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    const orgB: TOrganization = {
      id: 'org_assoc_b',
      name: 'Org Assoc B',
      workspace: '/tmp/org-assoc-b',
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrganization(orgA).success).toBe(true);
    expect(db.createOrganization(orgB).success).toBe(true);

    const taskA: TOrgTask = {
      id: 'org_task_assoc_a',
      organization_id: orgA.id,
      title: 'Associate Conversation Task',
      objective: 'Validate conversation/run organization guard',
      scope: ['src/process/database'],
      done_criteria: ['guard exists'],
      budget: { max_runs: 3 },
      risk_tier: 'normal',
      validators: [{ kind: 'review', target: 'uncommittedChanges' }],
      deliverable_schema: { type: 'object' },
      status: 'ready',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgTask(taskA).success).toBe(true);

    const runA: TOrgRun = {
      id: 'org_run_assoc_a',
      organization_id: orgA.id,
      task_id: taskA.id,
      status: 'created',
      workspace: { mode: 'isolated', type: 'worktree', path: '/tmp/org-assoc-worktree' },
      environment: { kind: 'cloud', env_id: 'python-ci' },
      context_policy: { project_memory: 'strict', episodic_top_k: 5 },
      execution: { model: 'gpt-5.4', effort: 'medium' },
      execution_logs: [],
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgRun(runA).success).toBe(true);

    const conversation: TChatConversation = {
      id: 'conv_org_assoc_1',
      name: 'Org Conversation',
      type: 'codex',
      extra: { workspace: '/tmp/org-assoc-conversation' },
      createTime: now,
      modifyTime: now,
      status: 'pending',
    };
    expect(db.createConversation(conversation).success).toBe(true);

    const missingRunResult = db.associateConversationWithOrgRun(conversation.id, orgA.id, 'run_missing');
    expect(missingRunResult.success).toBe(false);

    const mismatchResult = db.associateConversationWithOrgRun(conversation.id, orgB.id, runA.id);
    expect(mismatchResult.success).toBe(false);

    const deriveOrgResult = db.associateConversationWithOrgRun(conversation.id, null, runA.id);
    expect(deriveOrgResult.success).toBe(true);

    const sqlite = new BetterSqlite3(DB_PATH, { readonly: true });
    const row = sqlite
      .prepare('SELECT organization_id, run_id FROM conversations WHERE id = ?')
      .get(conversation.id) as
      | {
          organization_id: string | null;
          run_id: string | null;
        }
      | undefined;
    sqlite.close();

    expect(row?.organization_id).toBe(orgA.id);
    expect(row?.run_id).toBe(runA.id);
  });

  it('round-trips task contract JSON fields', () => {
    const now = Date.now();
    const org: TOrganization = {
      id: 'org_json_roundtrip',
      name: 'Org JSON',
      workspace: '/tmp/org-json',
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrganization(org).success).toBe(true);

    const task: TOrgTask = {
      id: 'org_task_json_roundtrip',
      organization_id: org.id,
      title: 'JSON Round Trip Task',
      objective: 'Persist and load task contract JSON fields',
      scope: ['payments/', 'tests/payments/', 'docs/'],
      done_criteria: ['all validations pass'],
      budget: {
        max_runs: 8,
        max_cost_usd: 20,
        max_duration_ms: 120000,
      },
      risk_tier: 'high',
      validators: [
        { kind: 'command', argv: ['pytest', 'tests/payments', '-q'] },
        { kind: 'review', target: 'uncommittedChanges', required_approver: 'human' },
      ],
      deliverable_schema: {
        type: 'object',
        required: ['summary', 'diffStats'],
      },
      status: 'ready',
      created_at: now,
      updated_at: now,
    };

    expect(db.createOrgTask(task).success).toBe(true);
    const fetchedTask = db.getOrgTask(task.id);
    expect(fetchedTask.success).toBe(true);
    expect(fetchedTask.data?.scope).toEqual(task.scope);
    expect(fetchedTask.data?.budget).toEqual(task.budget);
    expect(fetchedTask.data?.validators).toEqual(task.validators);
    expect(fetchedTask.data?.deliverable_schema).toEqual(task.deliverable_schema);
  });

  it('supports artifact CRUD and list as non-primary-path object', () => {
    const now = Date.now();
    const org: TOrganization = {
      id: 'org_artifact_crud',
      name: 'Org Artifact',
      workspace: '/tmp/org-artifact',
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrganization(org).success).toBe(true);

    const task: TOrgTask = {
      id: 'org_task_artifact_crud',
      organization_id: org.id,
      title: 'Artifact Task',
      objective: 'Exercise artifact CRUD',
      scope: ['src/'],
      done_criteria: ['artifact lifecycle verified'],
      budget: { max_runs: 2 },
      risk_tier: 'low',
      validators: [],
      deliverable_schema: {},
      status: 'ready',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgTask(task).success).toBe(true);

    const run: TOrgRun = {
      id: 'org_run_artifact_crud',
      organization_id: org.id,
      task_id: task.id,
      status: 'created',
      workspace: { mode: 'isolated', type: 'worktree', path: '/tmp/org-artifact-worktree' },
      environment: { kind: 'cloud' },
      execution_logs: [],
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgRun(run).success).toBe(true);

    const artifact: TOrgArtifact = {
      id: 'org_artifact_1',
      organization_id: org.id,
      task_id: task.id,
      run_id: run.id,
      type: 'code_diff',
      title: 'Initial Diff',
      summary: 'before update',
      content_ref: 'git://diff/123',
      metadata: { files: 3, risk: 'normal' },
      created_at: now,
      updated_at: now,
    };
    const createResult = db.createOrgArtifact(artifact);
    expect(createResult.success).toBe(true);

    const getResult = db.getOrgArtifact(artifact.id);
    expect(getResult.success).toBe(true);
    expect(getResult.data?.metadata).toEqual(artifact.metadata);

    const listResult = db.listOrgArtifacts({ run_id: run.id });
    expect(listResult.success).toBe(true);
    expect(listResult.data?.map((item) => item.id)).toEqual([artifact.id]);

    const updateResult = db.updateOrgArtifact(artifact.id, {
      summary: 'after update',
      metadata: { files: 5, risk: 'high' },
    });
    expect(updateResult.success).toBe(true);

    const updatedResult = db.getOrgArtifact(artifact.id);
    expect(updatedResult.success).toBe(true);
    expect(updatedResult.data?.summary).toBe('after update');
    expect(updatedResult.data?.metadata).toEqual({ files: 5, risk: 'high' });

    const deleteResult = db.deleteOrgArtifact(artifact.id);
    expect(deleteResult.success).toBe(true);
    expect(deleteResult.data).toBe(true);

    const afterDelete = db.getOrgArtifact(artifact.id);
    expect(afterDelete.success).toBe(false);
  });

  it('round-trips control state and brief repository methods', () => {
    const now = Date.now();
    const org: TOrganization = {
      id: 'org_control_state_1',
      name: 'Org Control State',
      workspace: '/tmp/org-control-state',
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrganization(org).success).toBe(true);

    const brief: TOrgBrief = {
      id: 'org_brief_1',
      organization_id: org.id,
      title: 'Execution Brief',
      summary: 'Brief for governance flow',
      status: 'draft',
      tier1_open_questions: ['What is non-negotiable?'],
      tier2_pending_items: ['Confirm data retention policy'],
      constraints: ['No model weight changes'],
      risk_notes: ['Potential unsafe auto-approval'],
      created_at: now,
      updated_at: now,
    };

    const createBrief = db.createOrgBrief(brief);
    expect(createBrief.success).toBe(true);

    const fetchedBrief = db.getOrgBrief(brief.id);
    expect(fetchedBrief.success).toBe(true);
    expect(fetchedBrief.data?.tier1_open_questions).toEqual(brief.tier1_open_questions);
    expect(fetchedBrief.data?.tier2_pending_items).toEqual(brief.tier2_pending_items);
    expect(fetchedBrief.data?.constraints).toEqual(brief.constraints);
    expect(fetchedBrief.data?.risk_notes).toEqual(brief.risk_notes);

    const listedBriefs = db.listOrgBriefs(org.id);
    expect(listedBriefs.success).toBe(true);
    expect(listedBriefs.data?.map((item) => item.id)).toEqual([brief.id]);

    const conversation = buildTestConversation('conv_control_state_1', now, org.workspace, org.id);
    expect(db.createConversation(conversation).success).toBe(true);

    const approvedSnapshot: TOrgPlanSnapshot = {
      id: 'plan_snapshot_approved_1',
      organization_id: org.id,
      brief_id: brief.id,
      title: 'Approved Plan Snapshot 1',
      objective: 'Approved plan objective 1',
      content: { steps: ['approved-step-1'] },
      status: 'approved',
      approved_by: 'human_reviewer',
      approved_at: now - 100,
      created_at: now - 100,
      updated_at: now - 100,
    };
    const nextApprovedSnapshot: TOrgPlanSnapshot = {
      id: 'plan_snapshot_approved_2',
      organization_id: org.id,
      brief_id: brief.id,
      title: 'Approved Plan Snapshot 2',
      objective: 'Approved plan objective 2',
      content: { steps: ['approved-step-2'] },
      status: 'approved',
      approved_by: 'human_reviewer',
      approved_at: now - 50,
      created_at: now - 50,
      updated_at: now - 50,
    };
    expect(db.createOrgPlanSnapshot(approvedSnapshot).success).toBe(true);
    expect(db.createOrgPlanSnapshot(nextApprovedSnapshot).success).toBe(true);

    const controlState: TOrgControlState = {
      id: 'org_control_state_row_1',
      organization_id: org.id,
      conversation_id: 'conv_control_state_1',
      phase: 'awaiting_plan_approval',
      active_brief_id: brief.id,
      active_plan_id: approvedSnapshot.id,
      needs_human_input: true,
      pending_approval_count: 1,
      last_human_touch_at: now - 1000,
      updated_at: now,
    };

    const createState = db.createOrgControlState(controlState);
    expect(createState.success).toBe(true);

    const fetchedState = db.getOrgControlState(org.id);
    expect(fetchedState.success).toBe(true);
    expect(fetchedState.data).toEqual(controlState);

    const updateState = db.updateOrgControlState(org.id, {
      phase: 'monitoring',
      needs_human_input: false,
      pending_approval_count: 0,
      active_plan_id: nextApprovedSnapshot.id,
      last_human_touch_at: now + 1000,
    });
    expect(updateState.success).toBe(true);

    const updatedState = db.getOrgControlState(org.id);
    expect(updatedState.success).toBe(true);
    expect(updatedState.data?.phase).toBe('monitoring');
    expect(updatedState.data?.needs_human_input).toBe(false);
    expect(updatedState.data?.pending_approval_count).toBe(0);
    expect(updatedState.data?.active_plan_id).toBe(nextApprovedSnapshot.id);
    expect(updatedState.data?.last_human_touch_at).toBe(now + 1000);

    expect(db.deleteOrgPlanSnapshot(nextApprovedSnapshot.id).success).toBe(true);
    const afterSnapshotDelete = db.getOrgControlState(org.id);
    expect(afterSnapshotDelete.success).toBe(true);
    expect(afterSnapshotDelete.data?.active_plan_id).toBeUndefined();

    expect(db.deleteOrgBrief(brief.id).success).toBe(true);
    const afterBriefDelete = db.getOrgControlState(org.id);
    expect(afterBriefDelete.success).toBe(true);
    expect(afterBriefDelete.data?.active_brief_id).toBeUndefined();

    const deleteState = db.deleteOrgControlState(org.id);
    expect(deleteState.success).toBe(true);
    expect(deleteState.data).toBe(true);

    const deletedState = db.getOrgControlState(org.id);
    expect(deletedState.success).toBe(false);
  });

  it('gets latest brief and round-trips brief update/delete', () => {
    const now = Date.now();
    const org: TOrganization = {
      id: 'org_brief_latest_1',
      name: 'Org Brief Latest',
      workspace: '/tmp/org-brief-latest',
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrganization(org).success).toBe(true);

    const firstBrief: TOrgBrief = {
      id: 'org_brief_latest_first',
      organization_id: org.id,
      title: 'First Brief',
      summary: 'Initial summary',
      status: 'draft',
      tier1_open_questions: ['Question A'],
      tier2_pending_items: ['Pending A'],
      constraints: ['Constraint A'],
      risk_notes: ['Risk A'],
      created_at: now - 20,
      updated_at: now - 20,
    };
    const secondBrief: TOrgBrief = {
      id: 'org_brief_latest_second',
      organization_id: org.id,
      title: 'Second Brief',
      summary: 'Newer summary',
      status: 'confirmed',
      tier1_open_questions: ['Question B'],
      tier2_pending_items: ['Pending B'],
      constraints: ['Constraint B'],
      risk_notes: ['Risk B'],
      created_at: now - 10,
      updated_at: now - 10,
    };

    expect(db.createOrgBrief(firstBrief).success).toBe(true);
    expect(db.createOrgBrief(secondBrief).success).toBe(true);

    const latestBeforeUpdate = db.getLatestOrgBrief(org.id);
    expect(latestBeforeUpdate.success).toBe(true);
    expect(latestBeforeUpdate.data?.id).toBe(secondBrief.id);

    const updateResult = db.updateOrgBrief(firstBrief.id, {
      title: 'First Brief Updated',
      summary: 'Updated summary',
      status: 'confirmed',
      tier1_open_questions: ['Question A1'],
      tier2_pending_items: ['Pending A1'],
      constraints: ['Constraint A1'],
      risk_notes: ['Risk A1'],
    });
    expect(updateResult.success).toBe(true);

    const updatedBrief = db.getOrgBrief(firstBrief.id);
    expect(updatedBrief.success).toBe(true);
    expect(updatedBrief.data?.title).toBe('First Brief Updated');
    expect(updatedBrief.data?.summary).toBe('Updated summary');
    expect(updatedBrief.data?.status).toBe('confirmed');
    expect(updatedBrief.data?.tier1_open_questions).toEqual(['Question A1']);
    expect(updatedBrief.data?.tier2_pending_items).toEqual(['Pending A1']);
    expect(updatedBrief.data?.constraints).toEqual(['Constraint A1']);
    expect(updatedBrief.data?.risk_notes).toEqual(['Risk A1']);

    const latestAfterUpdate = db.getLatestOrgBrief(org.id);
    expect(latestAfterUpdate.success).toBe(true);
    expect(latestAfterUpdate.data?.id).toBe(firstBrief.id);

    const deleteResult = db.deleteOrgBrief(secondBrief.id);
    expect(deleteResult.success).toBe(true);
    expect(deleteResult.data).toBe(true);

    const deletedBrief = db.getOrgBrief(secondBrief.id);
    expect(deletedBrief.success).toBe(false);
  });

  it('creates and queries plan snapshots by draft/approved/superseded status', () => {
    const now = Date.now();
    const org: TOrganization = {
      id: 'org_plan_snapshot_1',
      name: 'Org Plan Snapshot',
      workspace: '/tmp/org-plan-snapshot',
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrganization(org).success).toBe(true);

    const brief: TOrgBrief = {
      id: 'brief_plan_1',
      organization_id: org.id,
      title: 'Plan Brief',
      summary: 'Plan brief summary',
      status: 'confirmed',
      tier1_open_questions: [],
      tier2_pending_items: [],
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgBrief(brief).success).toBe(true);

    const draftSnapshot: TOrgPlanSnapshot = {
      id: 'plan_snapshot_draft_1',
      organization_id: org.id,
      brief_id: brief.id,
      title: 'Draft Plan',
      objective: 'Draft plan objective',
      content: { steps: ['draft-step-1'] },
      status: 'draft',
      created_at: now,
      updated_at: now,
    };
    const approvedSnapshot: TOrgPlanSnapshot = {
      id: 'plan_snapshot_approved_1',
      organization_id: org.id,
      brief_id: brief.id,
      title: 'Approved Plan',
      objective: 'Approved plan objective',
      content: { steps: ['approved-step-1'] },
      status: 'approved',
      approved_by: 'human_reviewer',
      approved_at: now + 10,
      created_at: now + 10,
      updated_at: now + 10,
    };
    const supersededSnapshot: TOrgPlanSnapshot = {
      id: 'plan_snapshot_superseded_1',
      organization_id: org.id,
      brief_id: brief.id,
      title: 'Superseded Plan',
      objective: 'Superseded plan objective',
      content: { steps: ['superseded-step-1'] },
      status: 'superseded',
      created_at: now + 20,
      updated_at: now + 20,
    };

    expect(db.createOrgPlanSnapshot(draftSnapshot).success).toBe(true);
    expect(db.createOrgPlanSnapshot(approvedSnapshot).success).toBe(true);
    expect(db.createOrgPlanSnapshot(supersededSnapshot).success).toBe(true);

    const getApproved = db.getOrgPlanSnapshot(approvedSnapshot.id);
    expect(getApproved.success).toBe(true);
    expect(getApproved.data?.status).toBe('approved');
    expect(getApproved.data?.approved_by).toBe('human_reviewer');

    const allSnapshots = db.listOrgPlanSnapshots({ organization_id: org.id });
    expect(allSnapshots.success).toBe(true);
    expect(allSnapshots.data?.map((item) => item.id).sort()).toEqual(
      [draftSnapshot.id, approvedSnapshot.id, supersededSnapshot.id].sort()
    );

    const draftSnapshots = db.listOrgPlanSnapshots({ organization_id: org.id, status: 'draft' });
    expect(draftSnapshots.success).toBe(true);
    expect(draftSnapshots.data?.map((item) => item.id)).toEqual([draftSnapshot.id]);

    const approvedSnapshots = db.listOrgPlanSnapshots({ organization_id: org.id, status: 'approved' });
    expect(approvedSnapshots.success).toBe(true);
    expect(approvedSnapshots.data?.map((item) => item.id)).toEqual([approvedSnapshot.id]);

    const supersededSnapshots = db.listOrgPlanSnapshots({ organization_id: org.id, status: 'superseded' });
    expect(supersededSnapshots.success).toBe(true);
    expect(supersededSnapshots.data?.map((item) => item.id)).toEqual([supersededSnapshot.id]);
  });

  it('gets latest plan snapshots with optional status filter and round-trips update/delete', () => {
    const now = Date.now();
    const org: TOrganization = {
      id: 'org_plan_snapshot_latest_1',
      name: 'Org Plan Snapshot Latest',
      workspace: '/tmp/org-plan-snapshot-latest',
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrganization(org).success).toBe(true);

    const brief: TOrgBrief = {
      id: 'brief_plan_latest_1',
      organization_id: org.id,
      title: 'Plan Latest Brief',
      summary: 'Plan latest brief summary',
      status: 'confirmed',
      tier1_open_questions: [],
      tier2_pending_items: [],
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgBrief(brief).success).toBe(true);

    const draftOlder: TOrgPlanSnapshot = {
      id: 'plan_snapshot_draft_old',
      organization_id: org.id,
      brief_id: brief.id,
      title: 'Draft Old',
      objective: 'Draft old objective',
      content: { steps: ['draft-old'] },
      status: 'draft',
      created_at: now - 30,
      updated_at: now - 30,
    };
    const draftLatest: TOrgPlanSnapshot = {
      id: 'plan_snapshot_draft_latest',
      organization_id: org.id,
      brief_id: brief.id,
      title: 'Draft Latest',
      objective: 'Draft latest objective',
      content: { steps: ['draft-latest'] },
      status: 'draft',
      created_at: now - 20,
      updated_at: now - 20,
    };
    const approvedLatest: TOrgPlanSnapshot = {
      id: 'plan_snapshot_approved_latest',
      organization_id: org.id,
      brief_id: brief.id,
      title: 'Approved Latest',
      objective: 'Approved latest objective',
      content: { steps: ['approved-latest'] },
      status: 'approved',
      approved_by: 'human_reviewer',
      approved_at: now - 10,
      created_at: now - 10,
      updated_at: now - 10,
    };

    expect(db.createOrgPlanSnapshot(draftOlder).success).toBe(true);
    expect(db.createOrgPlanSnapshot(draftLatest).success).toBe(true);
    expect(db.createOrgPlanSnapshot(approvedLatest).success).toBe(true);

    const latestAny = db.getLatestOrgPlanSnapshot(org.id);
    expect(latestAny.success).toBe(true);
    expect(latestAny.data?.id).toBe(approvedLatest.id);

    const latestDraft = db.getLatestOrgPlanSnapshot(org.id, 'draft');
    expect(latestDraft.success).toBe(true);
    expect(latestDraft.data?.id).toBe(draftLatest.id);

    const latestApproved = db.getLatestOrgPlanSnapshot(org.id, 'approved');
    expect(latestApproved.success).toBe(true);
    expect(latestApproved.data?.id).toBe(approvedLatest.id);

    const updateResult = db.updateOrgPlanSnapshot(draftOlder.id, {
      title: 'Draft Old Updated',
      objective: 'Draft old objective updated',
      content: { steps: ['draft-old-updated'], owner: 'organization_ai' },
      status: 'approved',
      approved_by: 'human_reviewer',
      approved_at: now,
    });
    expect(updateResult.success).toBe(true);

    const updatedSnapshot = db.getOrgPlanSnapshot(draftOlder.id);
    expect(updatedSnapshot.success).toBe(true);
    expect(updatedSnapshot.data?.title).toBe('Draft Old Updated');
    expect(updatedSnapshot.data?.objective).toBe('Draft old objective updated');
    expect(updatedSnapshot.data?.content).toEqual({ steps: ['draft-old-updated'], owner: 'organization_ai' });
    expect(updatedSnapshot.data?.status).toBe('approved');
    expect(updatedSnapshot.data?.approved_by).toBe('human_reviewer');
    expect(updatedSnapshot.data?.approved_at).toBe(now);

    const deleteResult = db.deleteOrgPlanSnapshot(draftLatest.id);
    expect(deleteResult.success).toBe(true);
    expect(deleteResult.data).toBe(true);

    const deletedSnapshot = db.getOrgPlanSnapshot(draftLatest.id);
    expect(deletedSnapshot.success).toBe(false);
  });

  it('creates and lists approval records by organization', () => {
    const now = Date.now();
    const orgA: TOrganization = {
      id: 'org_approval_a',
      name: 'Org Approval A',
      workspace: '/tmp/org-approval-a',
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    const orgB: TOrganization = {
      id: 'org_approval_b',
      name: 'Org Approval B',
      workspace: '/tmp/org-approval-b',
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrganization(orgA).success).toBe(true);
    expect(db.createOrganization(orgB).success).toBe(true);

    const approvalA1: TOrgApprovalRecord = {
      id: 'approval_a_1',
      organization_id: orgA.id,
      scope: 'tier1_decision',
      status: 'pending',
      target_type: 'organization',
      target_id: orgA.id,
      title: 'Confirm non-negotiables',
      detail: 'Need human confirmation before planning',
      requested_by: 'organization_ai',
      created_at: now,
      updated_at: now,
    };
    const approvalA2: TOrgApprovalRecord = {
      id: 'approval_a_2',
      organization_id: orgA.id,
      scope: 'plan_gate',
      status: 'approved',
      target_type: 'run',
      target_id: 'run_a_1',
      title: 'Approve execution plan',
      requested_by: 'organization_ai',
      decided_by: 'human_reviewer',
      decided_at: now + 100,
      decision_comment: 'Proceed',
      created_at: now + 100,
      updated_at: now + 100,
    };
    const approvalB1: TOrgApprovalRecord = {
      id: 'approval_b_1',
      organization_id: orgB.id,
      scope: 'tier2_decision',
      status: 'rejected',
      target_type: 'skill',
      target_id: 'skill_b_1',
      title: 'Approve new skill',
      requested_by: 'organization_ai',
      decided_by: 'human_reviewer',
      decided_at: now + 200,
      decision_comment: 'Insufficient evidence',
      created_at: now + 200,
      updated_at: now + 200,
    };

    expect(db.createOrgApprovalRecord(approvalA1).success).toBe(true);
    expect(db.createOrgApprovalRecord(approvalA2).success).toBe(true);
    expect(db.createOrgApprovalRecord(approvalB1).success).toBe(true);

    const getApproval = db.getOrgApprovalRecord(approvalA1.id);
    expect(getApproval.success).toBe(true);
    expect(getApproval.data?.organization_id).toBe(orgA.id);

    const listOrgA = db.listOrgApprovalRecords({ organization_id: orgA.id });
    expect(listOrgA.success).toBe(true);
    expect(listOrgA.data?.map((item) => item.id).sort()).toEqual([approvalA1.id, approvalA2.id].sort());

    const listPendingOrgA = db.listOrgApprovalRecords({ organization_id: orgA.id, status: 'pending' });
    expect(listPendingOrgA.success).toBe(true);
    expect(listPendingOrgA.data?.map((item) => item.id)).toEqual([approvalA1.id]);

    const listOrgB = db.listOrgApprovalRecords({ organization_id: orgB.id });
    expect(listOrgB.success).toBe(true);
    expect(listOrgB.data?.map((item) => item.id)).toEqual([approvalB1.id]);
  });

  it('gets latest approval records with optional filters and round-trips update/delete', () => {
    const now = Date.now();
    const org: TOrganization = {
      id: 'org_approval_latest_1',
      name: 'Org Approval Latest',
      workspace: '/tmp/org-approval-latest',
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrganization(org).success).toBe(true);

    const tier1Pending: TOrgApprovalRecord = {
      id: 'approval_latest_tier1_pending',
      organization_id: org.id,
      scope: 'tier1_decision',
      status: 'pending',
      target_type: 'organization',
      target_id: org.id,
      title: 'Tier1 pending',
      requested_by: 'organization_ai',
      created_at: now - 30,
      updated_at: now - 30,
    };
    const planPending: TOrgApprovalRecord = {
      id: 'approval_latest_plan_pending',
      organization_id: org.id,
      scope: 'plan_gate',
      status: 'pending',
      target_type: 'run',
      target_id: 'run_latest_1',
      title: 'Plan pending',
      detail: 'Need plan approval',
      requested_by: 'organization_ai',
      created_at: now - 20,
      updated_at: now - 20,
    };
    const planApproved: TOrgApprovalRecord = {
      id: 'approval_latest_plan_approved',
      organization_id: org.id,
      scope: 'plan_gate',
      status: 'approved',
      target_type: 'run',
      target_id: 'run_latest_2',
      title: 'Plan approved',
      detail: 'Approved execution',
      requested_by: 'organization_ai',
      decided_by: 'human_reviewer',
      decided_at: now - 10,
      decision_comment: 'Proceed',
      created_at: now - 10,
      updated_at: now - 10,
    };

    expect(db.createOrgApprovalRecord(tier1Pending).success).toBe(true);
    expect(db.createOrgApprovalRecord(planPending).success).toBe(true);
    expect(db.createOrgApprovalRecord(planApproved).success).toBe(true);

    const latestAny = db.getLatestOrgApprovalRecord(org.id);
    expect(latestAny.success).toBe(true);
    expect(latestAny.data?.id).toBe(planApproved.id);

    const latestPending = db.getLatestOrgApprovalRecord(org.id, { status: 'pending' });
    expect(latestPending.success).toBe(true);
    expect(latestPending.data?.id).toBe(planPending.id);

    const latestTier1 = db.getLatestOrgApprovalRecord(org.id, { scope: 'tier1_decision' });
    expect(latestTier1.success).toBe(true);
    expect(latestTier1.data?.id).toBe(tier1Pending.id);

    const latestPendingPlan = db.getLatestOrgApprovalRecord(org.id, {
      status: 'pending',
      scope: 'plan_gate',
    });
    expect(latestPendingPlan.success).toBe(true);
    expect(latestPendingPlan.data?.id).toBe(planPending.id);

    const updateResult = db.updateOrgApprovalRecord(tier1Pending.id, {
      scope: 'tier2_decision',
      status: 'needs_more_info',
      target_type: 'task',
      target_id: 'task_latest_1',
      title: 'Tier1 pending updated',
      detail: 'Need more business detail',
      decided_by: 'human_reviewer',
      decided_at: now,
      decision_comment: 'Please clarify constraints',
    });
    expect(updateResult.success).toBe(true);

    const updatedRecord = db.getOrgApprovalRecord(tier1Pending.id);
    expect(updatedRecord.success).toBe(true);
    expect(updatedRecord.data?.scope).toBe('tier2_decision');
    expect(updatedRecord.data?.status).toBe('needs_more_info');
    expect(updatedRecord.data?.target_type).toBe('task');
    expect(updatedRecord.data?.target_id).toBe('task_latest_1');
    expect(updatedRecord.data?.title).toBe('Tier1 pending updated');
    expect(updatedRecord.data?.detail).toBe('Need more business detail');
    expect(updatedRecord.data?.decided_by).toBe('human_reviewer');
    expect(updatedRecord.data?.decided_at).toBe(now);
    expect(updatedRecord.data?.decision_comment).toBe('Please clarify constraints');

    const deleteResult = db.deleteOrgApprovalRecord(planPending.id);
    expect(deleteResult.success).toBe(true);
    expect(deleteResult.data).toBe(true);

    const deletedRecord = db.getOrgApprovalRecord(planPending.id);
    expect(deletedRecord.success).toBe(false);
  });

  it('rejects approval records with inconsistent decision metadata', () => {
    const now = Date.now();
    const org: TOrganization = {
      id: 'org_approval_constraints_1',
      name: 'Org Approval Constraints',
      workspace: '/tmp/org-approval-constraints',
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrganization(org).success).toBe(true);

    const invalidPending: TOrgApprovalRecord = {
      id: 'approval_invalid_pending',
      organization_id: org.id,
      scope: 'tier1_decision',
      status: 'pending',
      target_type: 'organization',
      target_id: org.id,
      title: 'Invalid pending approval',
      requested_by: 'organization_ai',
      decided_by: 'human_reviewer',
      decided_at: now,
      decision_comment: 'Should not be decided yet',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgApprovalRecord(invalidPending).success).toBe(false);

    const invalidApproved: TOrgApprovalRecord = {
      id: 'approval_invalid_approved',
      organization_id: org.id,
      scope: 'plan_gate',
      status: 'approved',
      target_type: 'run',
      target_id: 'run_invalid_approved',
      title: 'Invalid approved approval',
      requested_by: 'organization_ai',
      created_at: now + 1,
      updated_at: now + 1,
    };
    expect(db.createOrgApprovalRecord(invalidApproved).success).toBe(false);

    const validPending: TOrgApprovalRecord = {
      id: 'approval_valid_pending',
      organization_id: org.id,
      scope: 'tier1_decision',
      status: 'pending',
      target_type: 'organization',
      target_id: org.id,
      title: 'Valid pending approval',
      requested_by: 'organization_ai',
      created_at: now + 2,
      updated_at: now + 2,
    };
    expect(db.createOrgApprovalRecord(validPending).success).toBe(true);
    expect(
      db.updateOrgApprovalRecord(validPending.id, {
        status: 'approved',
      }).success
    ).toBe(false);
  });

  it('rejects cross-organization brief and plan references', () => {
    const now = Date.now();
    const orgA: TOrganization = {
      id: 'org_cross_reference_a',
      name: 'Org Cross Reference A',
      workspace: '/tmp/org-cross-reference-a',
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    const orgB: TOrganization = {
      id: 'org_cross_reference_b',
      name: 'Org Cross Reference B',
      workspace: '/tmp/org-cross-reference-b',
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrganization(orgA).success).toBe(true);
    expect(db.createOrganization(orgB).success).toBe(true);

    const briefA: TOrgBrief = {
      id: 'brief_cross_reference_a',
      organization_id: orgA.id,
      title: 'Cross reference brief A',
      summary: 'Cross reference summary A',
      status: 'confirmed',
      tier1_open_questions: [],
      tier2_pending_items: [],
      created_at: now,
      updated_at: now,
    };
    const briefB: TOrgBrief = {
      id: 'brief_cross_reference_b',
      organization_id: orgB.id,
      title: 'Cross reference brief B',
      summary: 'Cross reference summary B',
      status: 'confirmed',
      tier1_open_questions: [],
      tier2_pending_items: [],
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgBrief(briefA).success).toBe(true);
    expect(db.createOrgBrief(briefB).success).toBe(true);

    const snapshotA: TOrgPlanSnapshot = {
      id: 'plan_cross_reference_a',
      organization_id: orgA.id,
      brief_id: briefA.id,
      title: 'Cross reference snapshot A',
      objective: 'Cross reference objective A',
      content: { steps: ['a'] },
      status: 'approved',
      approved_by: 'human_reviewer',
      approved_at: now,
      created_at: now,
      updated_at: now,
    };
    const snapshotB: TOrgPlanSnapshot = {
      id: 'plan_cross_reference_b',
      organization_id: orgB.id,
      brief_id: briefB.id,
      title: 'Cross reference snapshot B',
      objective: 'Cross reference objective B',
      content: { steps: ['b'] },
      status: 'approved',
      approved_by: 'human_reviewer',
      approved_at: now,
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgPlanSnapshot(snapshotA).success).toBe(true);
    expect(db.createOrgPlanSnapshot(snapshotB).success).toBe(true);

    const invalidSnapshot = db.createOrgPlanSnapshot({
      id: 'plan_cross_reference_invalid',
      organization_id: orgB.id,
      brief_id: briefA.id,
      title: 'Invalid cross-org snapshot',
      objective: 'Should fail',
      content: { steps: ['invalid'] },
      status: 'draft',
      created_at: now + 1,
      updated_at: now + 1,
    });
    expect(invalidSnapshot.success).toBe(false);

    const conversationB = buildTestConversation('conv_cross_reference_b', now, orgB.workspace, orgB.id);
    expect(db.createConversation(conversationB).success).toBe(true);

    const invalidControlState = db.createOrgControlState({
      id: 'control_state_cross_reference_invalid',
      organization_id: orgB.id,
      conversation_id: conversationB.id,
      phase: 'awaiting_plan_approval',
      active_brief_id: briefA.id,
      active_plan_id: snapshotA.id,
      needs_human_input: true,
      pending_approval_count: 1,
      last_human_touch_at: now,
      updated_at: now,
    });
    expect(invalidControlState.success).toBe(false);

    const validControlState = db.createOrgControlState({
      id: 'control_state_cross_reference_valid',
      organization_id: orgB.id,
      conversation_id: conversationB.id,
      phase: 'awaiting_plan_approval',
      active_brief_id: briefB.id,
      active_plan_id: snapshotB.id,
      needs_human_input: true,
      pending_approval_count: 1,
      last_human_touch_at: now,
      updated_at: now,
    });
    expect(validControlState.success).toBe(true);
    expect(
      db.updateOrgControlState(orgB.id, {
        active_brief_id: briefA.id,
      }).success
    ).toBe(false);
  });
});
