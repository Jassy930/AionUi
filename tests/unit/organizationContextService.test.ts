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
  TOrganization,
  TOrgTask,
  TOrgRun,
  TOrgArtifact,
  TOrgEvalSpec,
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

    initOrganizationContext(organization);
    syncOrganizationContext(organization.id);

    const contextDir = getOrganizationContextDir(organization.workspace);
    expect(fs.existsSync(path.join(contextDir, 'context', 'organization.json'))).toBe(true);
    expect(fs.existsSync(path.join(contextDir, 'context', 'tasks.json'))).toBe(true);
    expect(fs.existsSync(path.join(contextDir, 'context', 'runs.json'))).toBe(true);
    expect(fs.existsSync(path.join(contextDir, 'context', 'artifacts.json'))).toBe(true);
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

    const prompt = generateOrganizationSystemPrompt(organization.id);
    expect(prompt).toContain('Organization Control Plane AI');
    expect(prompt).toContain('Task Contract');
    expect(prompt).toContain('Run');
    expect(prompt).toContain('.aionui-org');
    expect(prompt).toContain('GenomePatch');
  });
});
