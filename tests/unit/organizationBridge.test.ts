/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TOrganization, TOrgTask, TOrgEvalSpec } from '@/common/types/organization';

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
    initOrganizationBridge();

    expect(handlers['org.task.create']).toBeTypeOf('function');
    expect(handlers['org.run.start']).toBeTypeOf('function');
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

  it('moves watcher activity to the new workspace after organization workspace update', async () => {
    const { initOrganizationBridge } = await import('@/process/bridge/organizationBridge');
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
