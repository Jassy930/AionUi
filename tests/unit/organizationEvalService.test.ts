/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TOrganization, TOrgEvalSpec, TOrgRun, TOrgTask } from '@/common/types/organization';

let currentDb: import('@/process/database').AionUIDatabase;
const safeExecFileMock = vi.fn();

const TEST_DATA_PATH = path.join(
  os.tmpdir(),
  `aionui-org-eval-service-${Date.now()}-${Math.random().toString(16).slice(2)}`
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

describe('organizationEvalService', () => {
  let db: AionUIDatabase;
  let organization: TOrganization;
  let task: TOrgTask;
  let run: TOrgRun;
  let evalSpec: TOrgEvalSpec;

  beforeEach(() => {
    safeExecFileMock.mockReset();
    fs.mkdirSync(TEST_DATA_PATH, { recursive: true });
    fs.mkdirSync(WORKSPACE_PATH, { recursive: true });
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
    }

    db = new AionUIDatabase();
    currentDb = db;

    const now = Date.now();
    organization = {
      id: 'org_eval_service_alpha',
      name: 'Org Eval Service Alpha',
      workspace: WORKSPACE_PATH,
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrganization(organization).success).toBe(true);

    task = {
      id: 'org_eval_service_task_1',
      organization_id: organization.id,
      title: 'Run regression eval',
      objective: 'Execute eval spec and register artifacts',
      scope: ['tests/unit/'],
      done_criteria: ['commands pass', 'artifacts persisted'],
      budget: { max_runs: 2 },
      risk_tier: 'normal',
      validators: [],
      deliverable_schema: {},
      status: 'running',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgTask(task).success).toBe(true);

    run = {
      id: 'org_eval_service_run_1',
      organization_id: organization.id,
      task_id: task.id,
      status: 'verifying',
      workspace: { mode: 'isolated', type: 'worktree', path: path.join(WORKSPACE_PATH, 'runs/run-1') },
      environment: { kind: 'cloud', env_id: 'ts-ci' },
      execution: { model: 'gpt-5.4', effort: 'medium' },
      execution_logs: [{ at: now, level: 'info', message: 'run finished' }],
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgRun(run).success).toBe(true);

    evalSpec = {
      id: 'org_eval_service_spec_1',
      organization_id: organization.id,
      name: 'Regression Eval',
      description: 'Executes organization regression checks',
      test_commands: [{ argv: ['bun', '--version'] }, { argv: ['bunx', 'vitest', '--version'], timeout_ms: 1000 }],
      quality_gates: [
        { gate: 'commands', rule: 'all-pass' },
        { gate: 'score', rule: 'min-pass-rate' },
      ],
      thresholds: { min_pass_rate: 1 },
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgEvalSpec(evalSpec).success).toBe(true);
  });

  afterEach(() => {
    db?.close();
  });

  afterAll(() => {
    fs.rmSync(TEST_DATA_PATH, { recursive: true, force: true });
  });

  it('registers run artifacts and executes eval specs into a structured result', async () => {
    safeExecFileMock
      .mockResolvedValueOnce({ stdout: '1.2.3\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'vitest/4.1.0\n', stderr: '' });

    const { executeOrganizationEval, registerOrganizationArtifact } =
      await import('@/process/services/organizationEvalService');

    const artifactResult = registerOrganizationArtifact({
      organization_id: organization.id,
      task_id: task.id,
      run_id: run.id,
      type: 'test_log',
      title: 'Regression log',
      summary: 'Captured after run completion',
      content_ref: 'file://tmp/regression.log',
      metadata: { source: 'unit-test' },
    });
    expect(artifactResult.success).toBe(true);
    expect(db.listOrgArtifacts({ run_id: run.id }).data).toHaveLength(1);

    const evalResult = await executeOrganizationEval({
      task_id: task.id,
      run_id: run.id,
      eval_spec_id: evalSpec.id,
    });

    expect(evalResult.success).toBe(true);
    expect(evalResult.data).toEqual(
      expect.objectContaining({
        task_id: task.id,
        run_id: run.id,
        eval_spec_id: evalSpec.id,
        passed: true,
        score: 1,
        threshold_violations: [],
      })
    );
    expect(evalResult.data?.summary).toContain('2/2');
    expect(safeExecFileMock).toHaveBeenCalledTimes(2);
    expect(safeExecFileMock).toHaveBeenNthCalledWith(
      1,
      'bun',
      ['--version'],
      expect.objectContaining({ timeout: undefined })
    );
  });
});
