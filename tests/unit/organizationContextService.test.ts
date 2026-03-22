/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/storage';
import type {
  TOrgApprovalRecord,
  TOrganization,
  TOrgTask,
  TOrgRun,
  TOrgArtifact,
  TOrgBrief,
  TOrgControlState,
  TOrgEvalSpec,
  TOrgPlanSnapshot,
  TOrgSkill,
  TOrgGenomePatch,
} from '@/common/types/organization';

let currentDb: import('@/process/database').AionUIDatabase;

const TEST_DATA_PATH = path.join(
  os.tmpdir(),
  `aionui-org-context-${Date.now()}-${Math.random().toString(16).slice(2)}`
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

import { AionUIDatabase } from '@/process/database';
import {
  generateOrganizationSystemPrompt,
  getOrganizationContextDir,
  initOrganizationContext,
  syncOrganizationContext,
} from '@/process/services/organizationContextService';

function buildTestConversation(id: string, now: number, workspace: string, organizationId: string): TChatConversation {
  return {
    id,
    name: `Conversation ${id}`,
    type: 'acp',
    extra: {
      workspace,
      customWorkspace: true,
      backend: 'codex',
      organizationId,
      organizationRole: 'control_plane',
    },
    createTime: now,
    modifyTime: now,
    status: 'pending',
  };
}

describe('organizationContextService', () => {
  let db: AionUIDatabase;

  beforeEach(() => {
    fs.mkdirSync(TEST_DATA_PATH, { recursive: true });
    fs.mkdirSync(WORKSPACE_PATH, { recursive: true });
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
    }

    db = new AionUIDatabase();
    currentDb = db;
  });

  afterEach(() => {
    db?.close();
  });

  afterAll(() => {
    fs.rmSync(TEST_DATA_PATH, { recursive: true, force: true });
  });

  it('projects organization state into .aionui-org and generates organization-centric system prompt', () => {
    const now = Date.now();
    const organization: TOrganization = {
      id: 'org_context_alpha',
      name: 'Org Context Alpha',
      description: 'Organization OS workspace',
      workspace: WORKSPACE_PATH,
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrganization(organization).success).toBe(true);

    const conversation = buildTestConversation('org_context_conv_1', now, WORKSPACE_PATH, organization.id);
    expect(db.createConversation(conversation).success).toBe(true);

    const task: TOrgTask = {
      id: 'org_context_task_1',
      organization_id: organization.id,
      title: 'Build control plane',
      objective: 'Implement the organization control plane',
      scope: ['src/process/', 'src/common/'],
      done_criteria: ['bridge registered', 'watcher active'],
      budget: { max_runs: 4, max_cost_usd: 10 },
      risk_tier: 'normal',
      validators: [{ kind: 'command', argv: ['bunx', 'vitest', '--run'] }],
      deliverable_schema: { type: 'object', required: ['summary'] },
      status: 'ready',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgTask(task).success).toBe(true);

    const run: TOrgRun = {
      id: 'org_context_run_1',
      organization_id: organization.id,
      task_id: task.id,
      status: 'active',
      workspace: { mode: 'isolated', type: 'worktree', path: path.join(WORKSPACE_PATH, 'runs/run-1') },
      environment: { kind: 'cloud', env_id: 'ts-ci' },
      context_policy: { project_memory: 'strict', episodic_top_k: 5 },
      execution: { model: 'gpt-5.4', effort: 'medium' },
      execution_logs: [{ at: now, level: 'info', message: 'run started' }],
      started_at: now,
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgRun(run).success).toBe(true);

    const artifact: TOrgArtifact = {
      id: 'org_context_artifact_1',
      organization_id: organization.id,
      task_id: task.id,
      run_id: run.id,
      type: 'code_diff',
      title: 'Bridge diff',
      summary: 'Adds org control plane bridge',
      content_ref: 'git://diff/control-plane',
      metadata: { files: 4 },
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgArtifact(artifact).success).toBe(true);

    const secondaryRun: TOrgRun = {
      id: 'org_context_run_2',
      organization_id: organization.id,
      task_id: task.id,
      status: 'verifying',
      workspace: { mode: 'isolated', type: 'worktree', path: path.join(WORKSPACE_PATH, 'runs/run-2') },
      environment: { kind: 'cloud', env_id: 'ts-ci' },
      execution_logs: [{ at: now + 1, level: 'info', message: 'run verifying' }],
      created_at: now + 1,
      updated_at: now + 1,
    };
    expect(db.createOrgRun(secondaryRun).success).toBe(true);

    const secondaryArtifact: TOrgArtifact = {
      id: 'org_context_artifact_2',
      organization_id: organization.id,
      task_id: task.id,
      run_id: secondaryRun.id,
      type: 'review_note',
      title: 'Secondary note',
      summary: 'Must remain visible beside the first artifact',
      created_at: now + 1,
      updated_at: now + 1,
    };
    expect(db.createOrgArtifact(secondaryArtifact).success).toBe(true);

    const evalSpec: TOrgEvalSpec = {
      id: 'org_context_eval_1',
      organization_id: organization.id,
      name: 'Control Plane Eval',
      description: 'Checks bridge and watcher contract',
      test_commands: [{ argv: ['bunx', 'vitest', '--run', 'tests/unit/organizationBridge.test.ts'] }],
      quality_gates: [{ gate: 'unit-tests', rule: 'must-pass' }],
      thresholds: { min_pass_rate: 1 },
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgEvalSpec(evalSpec).success).toBe(true);

    const skill: TOrgSkill = {
      id: 'org_context_skill_1',
      organization_id: organization.id,
      name: 'control-plane-rollout',
      description: 'Roll out control plane changes',
      workflow_unit: 'plan -> test -> bridge -> watcher',
      instructions: 'Use TDD and update docs.',
      resources: ['docs/plans/2026-03-20-organization-os-project-panel.md'],
      version: 1,
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgSkill(skill).success).toBe(true);

    const genomePatch: TOrgGenomePatch = {
      id: 'org_context_patch_1',
      organization_id: organization.id,
      mutation_target: 'skill',
      based_on: [run.id],
      proposal: { skill_name: 'control-plane-rollout', change_type: 'update' },
      status: 'proposed',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgGenomePatch(genomePatch).success).toBe(true);

    const draftBrief: TOrgBrief = {
      id: 'org_context_brief_1',
      organization_id: organization.id,
      title: 'Initial Brief',
      summary: 'Collect human-only decisions first',
      status: 'draft',
      tier1_open_questions: ['Who is the target user?'],
      tier2_pending_items: ['Confirm routing strategy'],
      constraints: ['No direct execution at top level'],
      risk_notes: ['Needs approval gate before dispatch'],
      created_at: now - 50,
      updated_at: now - 50,
    };
    const confirmedBrief: TOrgBrief = {
      id: 'org_context_brief_2',
      organization_id: organization.id,
      title: 'Confirmed Brief',
      summary: 'Use authority tiers and approval gates',
      status: 'confirmed',
      tier1_open_questions: [],
      tier2_pending_items: ['Approve architecture draft'],
      constraints: ['Coordinator only'],
      risk_notes: ['Unsafe if runs start before approval'],
      created_at: now - 10,
      updated_at: now - 10,
    };
    expect(db.createOrgBrief(draftBrief).success).toBe(true);
    expect(db.createOrgBrief(confirmedBrief).success).toBe(true);

    const draftPlanSnapshot: TOrgPlanSnapshot = {
      id: 'org_context_plan_draft_1',
      organization_id: organization.id,
      brief_id: confirmedBrief.id,
      title: 'Draft governance rollout',
      objective: 'Draft task decomposition',
      content: { steps: ['brainstorm', 'approve', 'dispatch'] },
      status: 'draft',
      created_at: now - 20,
      updated_at: now - 20,
    };
    const approvedPlanSnapshot: TOrgPlanSnapshot = {
      id: 'org_context_plan_approved_1',
      organization_id: organization.id,
      brief_id: confirmedBrief.id,
      title: 'Approved governance rollout',
      objective: 'Execute only after approval',
      content: { steps: ['ask human', 'draft plan', 'start run'] },
      status: 'approved',
      approved_by: 'human_reviewer',
      approved_at: now - 5,
      created_at: now - 5,
      updated_at: now - 5,
    };
    expect(db.createOrgPlanSnapshot(draftPlanSnapshot).success).toBe(true);
    expect(db.createOrgPlanSnapshot(approvedPlanSnapshot).success).toBe(true);

    const controlState: TOrgControlState = {
      id: 'org_context_control_state_1',
      organization_id: organization.id,
      conversation_id: conversation.id,
      phase: 'awaiting_plan_approval',
      active_brief_id: confirmedBrief.id,
      active_plan_id: approvedPlanSnapshot.id,
      needs_human_input: true,
      pending_approval_count: 1,
      last_human_touch_at: now - 100,
      updated_at: now,
    };
    expect(db.createOrgControlState(controlState).success).toBe(true);

    const approvalRecord: TOrgApprovalRecord = {
      id: 'org_context_approval_1',
      organization_id: organization.id,
      scope: 'plan_gate',
      status: 'pending',
      target_type: 'run',
      target_id: approvedPlanSnapshot.id,
      title: 'Approve plan before dispatch',
      detail: 'Human must approve before any run starts',
      requested_by: 'organization_ai',
      created_at: now - 1,
      updated_at: now - 1,
    };
    expect(db.createOrgApprovalRecord(approvalRecord).success).toBe(true);

    const legacyPendingApproval: TOrgApprovalRecord = {
      id: 'org_context_approval_legacy_pending',
      organization_id: organization.id,
      scope: 'tier1_decision',
      status: 'pending',
      target_type: 'organization',
      target_id: organization.id,
      title: 'Legacy pending approval',
      detail: 'Old pending approval must still remain visible',
      requested_by: 'organization_ai',
      created_at: now - 10_000,
      updated_at: now - 10_000,
    };
    expect(db.createOrgApprovalRecord(legacyPendingApproval).success).toBe(true);

    for (let index = 0; index < 100; index += 1) {
      expect(
        db.createOrgApprovalRecord({
          id: `org_context_approval_history_${index}`,
          organization_id: organization.id,
          scope: 'plan_gate',
          status: 'approved',
          target_type: 'run',
          target_id: `org_context_run_history_${index}`,
          title: `Historical approval ${index}`,
          requested_by: 'organization_ai',
          decided_by: 'human_reviewer',
          decided_at: now + index,
          decision_comment: 'Approved',
          created_at: now + index,
          updated_at: now + index,
        }).success
      ).toBe(true);
    }

    initOrganizationContext(organization);
    syncOrganizationContext(organization.id);

    const contextDir = getOrganizationContextDir(organization.workspace);
    expect(fs.existsSync(path.join(contextDir, 'context', 'organization.json'))).toBe(true);
    expect(fs.existsSync(path.join(contextDir, 'context', 'tasks.json'))).toBe(true);
    expect(fs.existsSync(path.join(contextDir, 'context', 'runs.json'))).toBe(true);
    expect(fs.existsSync(path.join(contextDir, 'context', 'artifacts.json'))).toBe(true);
    expect(fs.existsSync(path.join(contextDir, 'context', 'control_state.json'))).toBe(true);
    expect(fs.existsSync(path.join(contextDir, 'context', 'briefs.json'))).toBe(true);
    expect(fs.existsSync(path.join(contextDir, 'context', 'plan_snapshots.json'))).toBe(true);
    expect(fs.existsSync(path.join(contextDir, 'context', 'approvals.json'))).toBe(true);
    expect(fs.existsSync(path.join(contextDir, 'control', 'schema.json'))).toBe(true);

    const tasksJson = JSON.parse(fs.readFileSync(path.join(contextDir, 'context', 'tasks.json'), 'utf-8')) as Array<{
      id: string;
      title: string;
      status: string;
    }>;
    expect(tasksJson).toEqual([
      expect.objectContaining({
        id: task.id,
        title: task.title,
        status: task.status,
      }),
    ]);

    const artifactsJson = JSON.parse(
      fs.readFileSync(path.join(contextDir, 'context', 'artifacts.json'), 'utf-8')
    ) as Array<{ id: string; title: string }>;
    expect(artifactsJson.map((item) => item.id)).toEqual(expect.arrayContaining([artifact.id, secondaryArtifact.id]));

    const controlStateJson = JSON.parse(
      fs.readFileSync(path.join(contextDir, 'context', 'control_state.json'), 'utf-8')
    ) as {
      phase: string;
      pending_approval_count: number;
      needs_human_input: boolean;
      active_plan_id?: string;
    };
    expect(controlStateJson).toEqual(
      expect.objectContaining({
        phase: 'awaiting_plan_approval',
        pending_approval_count: 1,
        needs_human_input: true,
        active_plan_id: approvedPlanSnapshot.id,
      })
    );

    const briefsJson = JSON.parse(fs.readFileSync(path.join(contextDir, 'context', 'briefs.json'), 'utf-8')) as Array<{
      id: string;
      status: string;
    }>;
    expect(briefsJson.map((item) => item.id)).toEqual([confirmedBrief.id, draftBrief.id]);

    const planSnapshotsJson = JSON.parse(
      fs.readFileSync(path.join(contextDir, 'context', 'plan_snapshots.json'), 'utf-8')
    ) as Array<{ id: string; status: string; content?: { steps?: string[] } }>;
    expect(planSnapshotsJson.map((item) => item.id)).toEqual([approvedPlanSnapshot.id, draftPlanSnapshot.id]);
    expect(planSnapshotsJson[0]).toEqual(
      expect.objectContaining({
        id: approvedPlanSnapshot.id,
        content: expect.objectContaining({
          steps: ['ask human', 'draft plan', 'start run'],
        }),
      })
    );

    const approvalsJson = JSON.parse(
      fs.readFileSync(path.join(contextDir, 'context', 'approvals.json'), 'utf-8')
    ) as Array<{
      id: string;
      scope: string;
      status: string;
    }>;
    expect(approvalsJson.length).toBe(102);
    expect(approvalsJson.map((item) => item.id)).toEqual(
      expect.arrayContaining([approvalRecord.id, legacyPendingApproval.id])
    );

    const controlSchema = JSON.parse(fs.readFileSync(path.join(contextDir, 'control', 'schema.json'), 'utf-8')) as {
      control_phases?: string[];
      approval_gates?: Array<{ scope: string; required_before: string[] }>;
      methods?: string[];
    };
    expect(controlSchema.control_phases).toEqual(
      expect.arrayContaining([
        'intake',
        'brainstorming',
        'awaiting_human_decision',
        'awaiting_plan_approval',
        'dispatching',
        'monitoring',
      ])
    );
    expect(controlSchema.approval_gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: 'tier1_decision',
        }),
        expect.objectContaining({
          scope: 'plan_gate',
          required_before: expect.arrayContaining(['org/run/start']),
        }),
      ])
    );
    expect(controlSchema.methods).toEqual(
      expect.arrayContaining([
        'org/control/brief/update',
        'org/control/plan/update',
        'org/approval/request',
        'org/approval/respond',
      ])
    );

    const prompt = generateOrganizationSystemPrompt(organization.id);
    expect(prompt).toContain('Organization Control Plane AI');
    expect(prompt).toContain('strict three-tier authority model');
    expect(prompt).toContain('Tier 1');
    expect(prompt).toContain('Tier 2');
    expect(prompt).toContain('Tier 3');
    expect(prompt).toContain('You are a coordinator, not an executor.');
    expect(prompt).toContain('ask the user directly');
    expect(prompt).toContain('ask clarifying questions first');
    expect(prompt).toContain('draft or update a brief');
    expect(prompt).toContain('approved plan snapshot');
    expect(prompt).toContain('start a Run');
    expect(prompt).toContain('.aionui-org');
    expect(prompt).toContain('control_state.json');
    expect(prompt).toContain('briefs.json');
    expect(prompt).toContain('plan_snapshots.json');
    expect(prompt).toContain('approvals.json');
    expect(prompt).toContain('approval gates');
    expect(prompt).toContain('control phases');
    expect(prompt).toContain('Pending approvals: 2');
    expect(prompt).toContain('Task Contract');
    expect(prompt).toContain('Run');
    expect(prompt).toContain('GenomePatch');
  });
});
