/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TMessage } from '@/common/chatLib';
import type { TChatConversation } from '@/common/storage';
import type { TOrganization, TOrgTask } from '@/common/types/organization';

const TEST_DATA_PATH = path.join(
  os.tmpdir(),
  `aionui-org-run-execution-${Date.now()}-${Math.random().toString(16).slice(2)}`
);
const DB_PATH = path.join(TEST_DATA_PATH, 'aionui.db');

vi.mock('@process/utils', async () => {
  const fsModule = await import('node:fs');
  return {
    ensureDirectory: (dir: string) => fsModule.mkdirSync(dir, { recursive: true }),
    getDataPath: () => TEST_DATA_PATH,
  };
});

import { AionUIDatabase } from '@/process/database';

type ProviderHandler = (payload: any) => Promise<any> | any;

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

describe('organization run execution', () => {
  let db: AionUIDatabase;
  let handlers: Record<string, ProviderHandler>;
  let organization: TOrganization;
  let task: TOrgTask;
  let conversationSeq = 0;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    fs.mkdirSync(TEST_DATA_PATH, { recursive: true });
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
    }

    db = new AionUIDatabase();
    handlers = {};
    conversationSeq = 0;

    const now = Date.now();
    organization = {
      id: 'org_run_exec_alpha',
      name: 'Org Run Exec Alpha',
      description: 'Execution test workspace',
      workspace: path.join(TEST_DATA_PATH, 'workspace'),
      user_id: 'system_default_user',
      created_at: now,
      updated_at: now,
    };
    fs.mkdirSync(organization.workspace, { recursive: true });
    expect(db.createOrganization(organization).success).toBe(true);

    task = {
      id: 'org_run_exec_task_1',
      organization_id: organization.id,
      title: 'Execution seed task',
      objective: 'Bind run execution to conversation',
      scope: ['src/process/'],
      done_criteria: ['conversation created', 'run summarized'],
      budget: { max_runs: 2 },
      risk_tier: 'normal',
      validators: [],
      deliverable_schema: {},
      status: 'ready',
      created_at: now,
      updated_at: now,
    };
    expect(db.createOrgTask(task).success).toBe(true);

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
            const conversation: TChatConversation = {
              id: `conv_org_run_${conversationSeq}`,
              name: params.name || `Org Run Conversation ${conversationSeq}`,
              type: 'acp',
              extra: {
                workspace: params.extra.workspace as string,
                customWorkspace: true,
                backend: (params.extra.backend as string) || 'codex',
                presetContext: params.extra.presetContext as string | undefined,
                currentModelId: params.extra.currentModelId as string | undefined,
                taskId: params.taskId,
                organizationId: params.extra.organizationId as string | undefined,
                runId: params.extra.runId as string | undefined,
                organizationRole: params.extra.organizationRole as string | undefined,
              },
              createTime: Date.now(),
              modifyTime: Date.now(),
              status: 'pending',
            };
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

  it('creates and binds an execution conversation when an org run starts', async () => {
    const { initOrganizationBridge } = await import('@/process/bridge/organizationBridge');
    initOrganizationBridge();

    const startResult = await handlers['org.run.start']({
      task_id: task.id,
      workspace: { mode: 'isolated', type: 'worktree', path: path.join(organization.workspace, 'runs/run-1') },
      environment: { kind: 'cloud', env_id: 'ts-ci' },
      context_policy: { project_memory: 'strict', episodic_top_k: 5 },
      execution: {
        backend: 'codex',
        model: 'gpt-5.4',
        effort: 'medium',
        approvalPolicy: 'unlessTrusted',
      },
    });

    expect(startResult.success).toBe(true);
    expect(startResult.data).toEqual(
      expect.objectContaining({
        organization_id: organization.id,
        task_id: task.id,
      })
    );
    expect(startResult.data?.conversation_id).toBeTruthy();

    const persistedRun = db.getOrgRun(startResult.data.id).data;
    expect(persistedRun?.conversation_id).toBe(startResult.data.conversation_id);

    const persistedConversation = db.getConversation(startResult.data.conversation_id).data;
    expect(persistedConversation?.extra).toEqual(
      expect.objectContaining({
        taskId: task.id,
        organizationId: organization.id,
        runId: startResult.data.id,
        organizationRole: 'run_executor',
      })
    );

    const sqlite = await import('better-sqlite3');
    const readonlyDb = new sqlite.default(DB_PATH, { readonly: true });
    const row = readonlyDb
      .prepare('SELECT organization_id, run_id FROM conversations WHERE id = ?')
      .get(startResult.data.conversation_id) as
      | {
          organization_id: string | null;
          run_id: string | null;
        }
      | undefined;
    readonlyDb.close();

    expect(row?.organization_id).toBe(organization.id);
    expect(row?.run_id).toBe(startResult.data.id);
  });

  it('summarizes the execution conversation when an org run closes', async () => {
    const { initOrganizationBridge } = await import('@/process/bridge/organizationBridge');
    initOrganizationBridge();

    const startResult = await handlers['org.run.start']({
      task_id: task.id,
      workspace: { mode: 'isolated', type: 'worktree', path: path.join(organization.workspace, 'runs/run-2') },
      environment: { kind: 'cloud', env_id: 'ts-ci' },
      context_policy: { project_memory: 'strict', episodic_top_k: 5 },
      execution: {
        backend: 'codex',
        model: 'gpt-5.4',
        effort: 'medium',
      },
    });
    expect(startResult.success).toBe(true);

    const finalMessage: TMessage = {
      id: 'msg_org_run_summary_1',
      msg_id: 'msg_org_run_summary_1',
      conversation_id: startResult.data.conversation_id,
      type: 'text',
      position: 'left',
      status: 'finish',
      content: {
        content: 'Execution finished. Added conversation binding and summary handoff.',
      },
      createdAt: Date.now(),
    };
    expect(db.insertMessage(finalMessage).success).toBe(true);

    const closeResult = await handlers['org.run.close']({ id: startResult.data.id });
    expect(closeResult.success).toBe(true);

    const persistedRun = db.getOrgRun(startResult.data.id).data;
    expect(persistedRun?.status).toBe('closed');
    expect(persistedRun?.execution_logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'info',
          message: expect.stringContaining('Execution finished. Added conversation binding and summary handoff.'),
        }),
      ])
    );

    const persistedConversation = db.getConversation(startResult.data.conversation_id).data;
    expect(persistedConversation?.extra).toEqual(
      expect.objectContaining({
        runSummary: 'Execution finished. Added conversation binding and summary handoff.',
      })
    );
  });
});
