/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TOrgArtifact, TOrgRun, TOrgTask, TOrganization } from '@/common/types/organization';

let currentDb: import('@/process/database').AionUIDatabase;

const TEST_DATA_PATH = path.join(
  os.tmpdir(),
  `aionui-org-evolution-service-${Date.now()}-${Math.random().toString(16).slice(2)}`
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

describe('organizationEvolutionService', () => {
  let db: AionUIDatabase;
  let organization: TOrganization;
  let task: TOrgTask;
  let runA: TOrgRun;
  let runB: TOrgRun;
  let artifactA: TOrgArtifact;

  beforeEach(() => {
    fs.mkdirSync(TEST_DATA_PATH, { recursive: true });
    fs.mkdirSync(WORKSPACE_PATH, { recursive: true });
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
    }

    db = new AionUIDatabase();
    currentDb = db;

    const now = Date.now();
    organization = {
      id: 'org_evolution_service_alpha',
      name: 'Org Evolution Service Alpha',
      workspace: WORKSPACE_PATH,
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrganization(organization).success).toBe(true);

    task = {
      id: 'org_evolution_service_task_1',
      organization_id: organization.id,
      title: 'Promote learning',
      objective: 'Extract memory and evolve patches',
      scope: ['src/process/'],
      done_criteria: ['memory created', 'patch progressed'],
      budget: { max_runs: 4 },
      risk_tier: 'normal',
      validators: [],
      deliverable_schema: {},
      status: 'completed',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgTask(task).success).toBe(true);

    runA = {
      id: 'org_evolution_service_run_a',
      organization_id: organization.id,
      task_id: task.id,
      status: 'closed',
      workspace: { mode: 'isolated', type: 'worktree', path: path.join(WORKSPACE_PATH, 'runs/a') },
      environment: { kind: 'cloud', env_id: 'ts-ci' },
      execution_logs: [{ at: now, level: 'info', message: 'Seed idempotency table before tests.' }],
      created_at: now,
      updated_at: now,
      ended_at: now,
    };
    runB = {
      id: 'org_evolution_service_run_b',
      organization_id: organization.id,
      task_id: task.id,
      status: 'closed',
      workspace: { mode: 'isolated', type: 'worktree', path: path.join(WORKSPACE_PATH, 'runs/b') },
      environment: { kind: 'cloud', env_id: 'ts-ci' },
      execution_logs: [{ at: now + 1, level: 'info', message: 'Persist evaluation summary into memory cards.' }],
      created_at: now + 1,
      updated_at: now + 1,
      ended_at: now + 1,
    };
    expect(db.createOrgRun(runA).success).toBe(true);
    expect(db.createOrgRun(runB).success).toBe(true);

    artifactA = {
      id: 'org_evolution_service_artifact_a',
      organization_id: organization.id,
      task_id: task.id,
      run_id: runA.id,
      type: 'failure_report',
      title: 'Regression finding',
      summary: 'Tests fail unless the idempotency table is seeded first.',
      metadata: { severity: 'medium' },
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgArtifact(artifactA).success).toBe(true);
  });

  afterEach(() => {
    db?.close();
  });

  afterAll(() => {
    fs.rmSync(TEST_DATA_PATH, { recursive: true, force: true });
  });

  it('promotes run learnings into memory cards and advances genome patches through offline eval and canary', async () => {
    const {
      promoteMemoryCardFromRun,
      proposeGenomePatchFromRuns,
      executeGenomePatchOfflineEval,
      executeGenomePatchCanary,
    } = await import('@/process/services/organizationEvolutionService');

    const memoryResult = promoteMemoryCardFromRun({
      organization_id: organization.id,
      run_id: runA.id,
      artifact_ids: [artifactA.id],
      type: 'failure_pattern',
      title: 'Seed idempotency table before regression',
      tags: ['payments', 'regression'],
    });
    expect(memoryResult.success).toBe(true);
    expect(memoryResult.data).toEqual(
      expect.objectContaining({
        organization_id: organization.id,
        type: 'failure_pattern',
      })
    );
    expect(memoryResult.data?.knowledge_unit).toContain('idempotency');
    expect(memoryResult.data?.traceability).toEqual({
      source_run_ids: [runA.id],
      source_artifact_ids: [artifactA.id],
    });

    const patchResult = proposeGenomePatchFromRuns({
      organization_id: organization.id,
      mutation_target: 'skill',
      based_on: [runA.id, runB.id],
      proposal: {
        skill_name: 'payments-regression-triage',
        change_type: 'create',
      },
    });
    expect(patchResult.success).toBe(true);
    expect(patchResult.data?.status).toBe('proposed');

    const offlineEvalResult = executeGenomePatchOfflineEval({
      patch_id: patchResult.data!.id,
    });
    expect(offlineEvalResult.success).toBe(true);
    expect(offlineEvalResult.data?.status).toBe('offline_eval');
    expect(offlineEvalResult.data?.offline_eval_result).toEqual(
      expect.objectContaining({
        score: 1,
      })
    );

    const canaryResult = executeGenomePatchCanary({
      patch_id: patchResult.data!.id,
    });
    expect(canaryResult.success).toBe(true);
    expect(canaryResult.data?.status).toBe('canary');
    expect(canaryResult.data?.canary_result).toEqual(
      expect.objectContaining({
        score: 1,
      })
    );

    const persistedPatch = db.getOrgGenomePatch(patchResult.data!.id).data;
    expect(persistedPatch?.status).toBe('canary');
    expect(db.listOrgMemoryCards({ organization_id: organization.id }).data).toHaveLength(1);
  });
});
