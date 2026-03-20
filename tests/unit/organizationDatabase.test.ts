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
import type { TOrgArtifact, TOrganization, TOrgRun, TOrgTask } from '@/common/types/organization';
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
          'org_audit_logs'
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
});
