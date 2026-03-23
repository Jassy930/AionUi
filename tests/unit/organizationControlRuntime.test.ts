/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TMessage } from '@/common/chatLib';
import type { TOrganizationControlEvent } from '@/common/types/organization';

const {
  mockGetDatabase,
  mockInsertMessage,
  mockGetConversation,
  mockUpdateConversation,
  mockCreateOrgTask,
  mockCreateOrgRun,
  mockGetOrganizationReconcileSnapshot,
  mockSyncOrganizationContext,
  insertedMessages,
  mockIsProcessing,
  mockOnceIdle,
  mockTriggerOrganizationControlInternalContinue,
} = vi.hoisted(() => {
  const insertedMessages: TMessage[] = [];
  const mockInsertMessage = vi.fn((message: TMessage) => {
    insertedMessages.push(message);
    return { success: true, data: message };
  });
  const mockGetConversation = vi.fn(() => ({
    success: true,
    data: { id: 'conv_control_1', extra: {} },
  }));
  const mockUpdateConversation = vi.fn(() => ({ success: true }));
  const mockCreateOrgTask = vi.fn();
  const mockCreateOrgRun = vi.fn();
  const mockGetOrganizationReconcileSnapshot = vi.fn(() => null);
  const mockSyncOrganizationContext = vi.fn();
  const mockGetDatabase = vi.fn(() => ({
    insertMessage: mockInsertMessage,
    getConversation: mockGetConversation,
    updateConversation: mockUpdateConversation,
    createOrgTask: mockCreateOrgTask,
    createOrgRun: mockCreateOrgRun,
  }));
  const mockIsProcessing = vi.fn(() => false);
  const mockOnceIdle = vi.fn();
  const mockTriggerOrganizationControlInternalContinue = vi.fn(() =>
    Promise.resolve({ success: true } as { success: boolean; msg?: string })
  );
  return {
    mockGetDatabase,
    mockInsertMessage,
    mockGetConversation,
    mockUpdateConversation,
    mockCreateOrgTask,
    mockCreateOrgRun,
    mockGetOrganizationReconcileSnapshot,
    mockSyncOrganizationContext,
    insertedMessages,
    mockIsProcessing,
    mockOnceIdle,
    mockTriggerOrganizationControlInternalContinue,
  };
});

vi.mock('@process/database', () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock('@process/services/organizationContextService', () => ({
  getOrganizationReconcileSnapshot: mockGetOrganizationReconcileSnapshot,
  syncOrganizationContext: mockSyncOrganizationContext,
}));

vi.mock('@process/services/cron/CronBusyGuard', () => ({
  cronBusyGuard: {
    isProcessing: mockIsProcessing,
    onceIdle: mockOnceIdle,
  },
}));

vi.mock('@process/bridge/conversationBridge', () => ({
  triggerOrganizationControlInternalContinue: mockTriggerOrganizationControlInternalContinue,
}));
import {
  appendOrganizationControlEventMessage,
  clearAllOrganizationControlConversations,
  clearOrganizationControlConversation,
  clearOrganizationControlConversationByConversationId,
  enqueueOrganizationControlEvent,
  getOrganizationControlConversation,
  registerOrganizationControlConversation,
  runOrganizationControlReconcilePass,
  startOrganizationControlReconcileTicker,
  stopOrganizationControlReconcileTicker,
} from '@/process/services/organizationControlRuntime';

describe('organizationControlRuntime', () => {
  beforeEach(() => {
    clearAllOrganizationControlConversations();
    stopOrganizationControlReconcileTicker();
    vi.useRealTimers();
    insertedMessages.length = 0;
    mockGetDatabase.mockClear();
    mockGetDatabase.mockImplementation(() => ({
      insertMessage: mockInsertMessage,
      getConversation: mockGetConversation,
      updateConversation: mockUpdateConversation,
      createOrgTask: mockCreateOrgTask,
      createOrgRun: mockCreateOrgRun,
    }));
    mockInsertMessage.mockClear();
    mockGetConversation.mockClear();
    mockGetConversation.mockImplementation(() => ({
      success: true,
      data: { id: 'conv_control_1', extra: {} },
    }));
    mockUpdateConversation.mockClear();
    mockUpdateConversation.mockImplementation(() => ({ success: true }));
    mockCreateOrgTask.mockClear();
    mockCreateOrgRun.mockClear();
    mockGetOrganizationReconcileSnapshot.mockClear();
    mockGetOrganizationReconcileSnapshot.mockReturnValue(null);
    mockSyncOrganizationContext.mockClear();
    mockIsProcessing.mockReset();
    mockIsProcessing.mockReturnValue(false);
    mockOnceIdle.mockReset();
    mockTriggerOrganizationControlInternalContinue.mockClear();
    mockTriggerOrganizationControlInternalContinue.mockImplementation(() =>
      Promise.resolve({ success: true } as { success: boolean; msg?: string })
    );
    mockInsertMessage.mockImplementation((message: TMessage) => {
      insertedMessages.push(message);
      return { success: true, data: message };
    });
  });

  function buildControlEvent(overrides: Partial<TOrganizationControlEvent> = {}): TOrganizationControlEvent {
    return {
      id: overrides.id ?? `evt_${Date.now()}`,
      organization_id: overrides.organization_id ?? 'org_alpha',
      control_conversation_id: overrides.control_conversation_id ?? 'conv_control_1',
      event_type: overrides.event_type ?? 'run_closed',
      source: overrides.source ?? 'org.bridge',
      summary: overrides.summary ?? 'Control event summary',
      timestamp: overrides.timestamp ?? Date.now(),
      ...overrides,
    };
  }

  it('registers and updates control conversation binding for organization', () => {
    registerOrganizationControlConversation('org_alpha', 'conv_1');
    expect(getOrganizationControlConversation('org_alpha')?.conversationId).toBe('conv_1');

    registerOrganizationControlConversation('org_alpha', 'conv_2');
    expect(getOrganizationControlConversation('org_alpha')?.conversationId).toBe('conv_2');
  });

  it('clears organization binding directly', () => {
    registerOrganizationControlConversation('org_alpha', 'conv_1');
    expect(clearOrganizationControlConversation('org_alpha')).toBe(true);
    expect(getOrganizationControlConversation('org_alpha')).toBeUndefined();
  });

  it('clears organization binding by conversation id', () => {
    registerOrganizationControlConversation('org_alpha', 'conv_1');
    registerOrganizationControlConversation('org_beta', 'conv_2');

    expect(clearOrganizationControlConversationByConversationId('conv_1')).toBe(true);
    expect(getOrganizationControlConversation('org_alpha')).toBeUndefined();
    expect(getOrganizationControlConversation('org_beta')?.conversationId).toBe('conv_2');
  });

  it('appends structured organization event message into bound control conversation', () => {
    registerOrganizationControlConversation('org_alpha', 'conv_control_1');

    const event: TOrganizationControlEvent = {
      id: 'evt_1',
      organization_id: 'org_alpha',
      control_conversation_id: 'conv_control_1',
      event_type: 'run_closed',
      task_id: 'task_1',
      run_id: 'run_1',
      approval_id: 'approval_1',
      source: 'org.bridge',
      summary: 'Run finished and needs next-step planning.',
      payload: { passRate: 0.94, artifactCount: 3 },
      timestamp: Date.now(),
    };

    const result = enqueueOrganizationControlEvent(event);
    expect(result).toBe(true);
    expect(mockGetDatabase).toHaveBeenCalledTimes(1);
    expect(insertedMessages).toHaveLength(1);
    const inserted = insertedMessages[0];
    expect(inserted?.conversation_id).toBe('conv_control_1');
    expect(inserted?.type).toBe('text');
    expect(inserted?.position).toBe('left');
    expect(inserted?.msg_id).toBe('org_event_evt_1');
    expect(inserted?.createdAt).toBe(event.timestamp);
    const content = (inserted?.content as { content?: string })?.content || '';
    expect(content.startsWith('[OrgEvent] run_closed\n')).toBe(true);
    expect(content).toContain('"event_type": "run_closed"');
    expect(content).toContain('"task_id": "task_1"');
    expect(content).toContain('"run_id": "run_1"');
    expect(content).toContain('Run finished and needs next-step planning.');
    expect(content).toContain('"payload"');
    const jsonBody = content.replace('[OrgEvent] run_closed\n', '');
    expect(() => JSON.parse(jsonBody)).not.toThrow();
    expect(JSON.parse(jsonBody)).toMatchObject({
      event_type: 'run_closed',
      task_id: 'task_1',
      run_id: 'run_1',
    });
  });

  it('appends multiple events for different tasks into same control conversation', () => {
    registerOrganizationControlConversation('org_alpha', 'conv_control_1');

    const resultA = enqueueOrganizationControlEvent({
      id: 'evt_task_1',
      organization_id: 'org_alpha',
      control_conversation_id: 'conv_control_1',
      event_type: 'task_created',
      task_id: 'task_a',
      source: 'org.bridge',
      summary: 'Task A created',
      timestamp: Date.now(),
    });
    const resultB = enqueueOrganizationControlEvent({
      id: 'evt_task_2',
      organization_id: 'org_alpha',
      control_conversation_id: 'conv_control_1',
      event_type: 'task_created',
      task_id: 'task_b',
      run_id: 'run_task_b',
      source: 'org.bridge',
      summary: 'Task B created with runtime context',
      payload: { scope: ['src/process'], retry: 1 },
      timestamp: Date.now(),
    });

    expect(resultA).toBe(true);
    expect(resultB).toBe(true);
    expect(insertedMessages).toHaveLength(2);
    const firstContent = (insertedMessages[0]?.content as { content?: string })?.content || '';
    const secondContent = (insertedMessages[1]?.content as { content?: string })?.content || '';
    expect(firstContent).toContain('"task_id": "task_a"');
    expect(secondContent.startsWith('[OrgEvent] task_created\n')).toBe(true);
    const secondJson = secondContent.replace('[OrgEvent] task_created\n', '');
    expect(() => JSON.parse(secondJson)).not.toThrow();
    expect(JSON.parse(secondJson)).toMatchObject({
      task_id: 'task_b',
      run_id: 'run_task_b',
      summary: 'Task B created with runtime context',
      payload: { scope: ['src/process'], retry: 1 },
    });
  });

  it('auto-drives organization control conversation once when idle after event append', async () => {
    registerOrganizationControlConversation('org_alpha', 'conv_control_1');
    const result = enqueueOrganizationControlEvent(
      buildControlEvent({
        id: 'evt_auto_idle',
      })
    );

    expect(result).toBe(true);
    await vi.waitFor(() => {
      expect(mockTriggerOrganizationControlInternalContinue).toHaveBeenCalledTimes(1);
    });
    expect(mockTriggerOrganizationControlInternalContinue).toHaveBeenCalledWith('conv_control_1', {
      queuedEventCount: 1,
    });
  });

  it('queues event while busy and auto-drives after conversation becomes idle', async () => {
    let idleCallback: (() => void) | undefined;
    mockIsProcessing.mockReturnValue(true);
    mockOnceIdle.mockImplementation((_conversationId: string, callback: () => void) => {
      idleCallback = callback;
    });

    registerOrganizationControlConversation('org_alpha', 'conv_control_1');
    const result = enqueueOrganizationControlEvent(
      buildControlEvent({
        id: 'evt_busy_then_idle',
      })
    );

    expect(result).toBe(true);
    expect(mockTriggerOrganizationControlInternalContinue).not.toHaveBeenCalled();
    expect(mockOnceIdle).toHaveBeenCalledTimes(1);

    mockIsProcessing.mockReturnValue(false);
    expect(idleCallback).toBeTypeOf('function');
    idleCallback?.();

    await vi.waitFor(() => {
      expect(mockTriggerOrganizationControlInternalContinue).toHaveBeenCalledTimes(1);
    });
  });

  it('serializes internal auto-drive dispatch and avoids concurrent interruption', async () => {
    let releaseFirstDispatch: (() => void) | undefined;
    const firstDispatchDone = new Promise<void>((resolve) => {
      releaseFirstDispatch = resolve;
    });
    let inFlight = 0;
    let maxInFlight = 0;
    let callCount = 0;
    mockTriggerOrganizationControlInternalContinue.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      callCount += 1;
      if (callCount === 1) {
        await firstDispatchDone;
      }
      inFlight -= 1;
      return { success: true };
    });

    registerOrganizationControlConversation('org_alpha', 'conv_control_1');
    const firstResult = enqueueOrganizationControlEvent(
      buildControlEvent({
        id: 'evt_serial_1',
      })
    );
    const secondResult = enqueueOrganizationControlEvent(
      buildControlEvent({
        id: 'evt_serial_2',
      })
    );

    expect(firstResult).toBe(true);
    expect(secondResult).toBe(true);
    expect(mockTriggerOrganizationControlInternalContinue).toHaveBeenCalledTimes(1);
    expect(maxInFlight).toBe(1);

    releaseFirstDispatch?.();

    await vi.waitFor(() => {
      expect(mockTriggerOrganizationControlInternalContinue).toHaveBeenCalledTimes(2);
    });
    expect(maxInFlight).toBe(1);
  });

  it('keeps pending events when internal continue resolves success=false and retries on next event', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockTriggerOrganizationControlInternalContinue
      .mockResolvedValueOnce({ success: false, msg: 'runtime temporarily unavailable' })
      .mockResolvedValueOnce({ success: true });

    registerOrganizationControlConversation('org_alpha', 'conv_control_1');

    const firstResult = enqueueOrganizationControlEvent(
      buildControlEvent({
        id: 'evt_retry_1',
      })
    );
    expect(firstResult).toBe(true);

    await vi.waitFor(() => {
      expect(mockTriggerOrganizationControlInternalContinue).toHaveBeenCalledTimes(1);
    });
    expect(mockTriggerOrganizationControlInternalContinue).toHaveBeenNthCalledWith(1, 'conv_control_1', {
      queuedEventCount: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockTriggerOrganizationControlInternalContinue).toHaveBeenCalledTimes(1);

    const secondResult = enqueueOrganizationControlEvent(
      buildControlEvent({
        id: 'evt_retry_2',
      })
    );
    expect(secondResult).toBe(true);

    await vi.waitFor(() => {
      expect(mockTriggerOrganizationControlInternalContinue).toHaveBeenCalledTimes(2);
    });
    expect(mockTriggerOrganizationControlInternalContinue).toHaveBeenNthCalledWith(2, 'conv_control_1', {
      queuedEventCount: 2,
    });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('keeps task_id and run_id keys when event omits them', () => {
    registerOrganizationControlConversation('org_alpha', 'conv_control_1');

    const result = appendOrganizationControlEventMessage({
      id: 'evt_missing_ids',
      organization_id: 'org_alpha',
      control_conversation_id: 'conv_control_1',
      event_type: 'reconcile_tick',
      source: 'org.runtime',
      summary: 'Periodic reconcile tick',
      payload: { pendingTasks: 2 },
      timestamp: Date.now(),
    });

    expect(result).toBe(true);
    expect(insertedMessages).toHaveLength(1);
    const content = (insertedMessages[0]?.content as { content?: string })?.content || '';
    expect(content).toContain('"task_id": null');
    expect(content).toContain('"run_id": null');
  });

  it('does not write event message when no control binding exists', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const event: TOrganizationControlEvent = {
      id: 'evt_no_binding',
      organization_id: 'org_alpha',
      control_conversation_id: 'conv_control_1',
      event_type: 'task_created',
      source: 'org.bridge',
      summary: 'No binding yet',
      timestamp: Date.now(),
    };
    const result = appendOrganizationControlEventMessage(event);

    expect(result).toBe(false);
    expect(mockGetDatabase).not.toHaveBeenCalled();
    expect(insertedMessages).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnContext = warnSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(warnContext).toMatchObject({
      reason: 'missing_binding',
      organization_id: event.organization_id,
      event_id: event.id,
      event_type: event.event_type,
      event_control_conversation_id: event.control_conversation_id,
      bound_conversation_id: null,
    });
    warnSpy.mockRestore();
  });

  it('does not write when event control conversation mismatches binding', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerOrganizationControlConversation('org_alpha', 'conv_control_current');
    const event: TOrganizationControlEvent = {
      id: 'evt_mismatch',
      organization_id: 'org_alpha',
      control_conversation_id: 'conv_control_other',
      event_type: 'run_closed',
      task_id: 'task_1',
      run_id: 'run_1',
      source: 'org.bridge',
      summary: 'Mismatched control conversation id',
      timestamp: Date.now(),
    };
    const result = appendOrganizationControlEventMessage(event);

    expect(result).toBe(false);
    expect(mockGetDatabase).not.toHaveBeenCalled();
    expect(insertedMessages).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnContext = warnSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(warnContext).toMatchObject({
      reason: 'conversation_mismatch',
      organization_id: event.organization_id,
      event_id: event.id,
      event_type: event.event_type,
      event_control_conversation_id: event.control_conversation_id,
      bound_conversation_id: 'conv_control_current',
    });
    warnSpy.mockRestore();
  });

  it('uses timestamp with nullish semantics for createdAt', () => {
    registerOrganizationControlConversation('org_alpha', 'conv_control_1');
    const result = appendOrganizationControlEventMessage({
      id: 'evt_zero_timestamp',
      organization_id: 'org_alpha',
      control_conversation_id: 'conv_control_1',
      event_type: 'reconcile_tick',
      source: 'org.runtime',
      summary: 'Tick with zero timestamp',
      timestamp: 0,
    });

    expect(result).toBe(true);
    expect(insertedMessages).toHaveLength(1);
    expect(insertedMessages[0]?.createdAt).toBe(0);
  });

  it('returns false and warns when database insert fails', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerOrganizationControlConversation('org_alpha', 'conv_control_1');
    mockInsertMessage.mockImplementation(() => ({ success: false }));
    const event: TOrganizationControlEvent = {
      id: 'evt_db_fail',
      organization_id: 'org_alpha',
      control_conversation_id: 'conv_control_1',
      event_type: 'run_closed',
      source: 'org.bridge',
      summary: 'Insert failed',
      timestamp: Date.now(),
    };
    const result = appendOrganizationControlEventMessage(event);

    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnContext = warnSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(warnContext).toMatchObject({
      reason: 'insert_failed',
      organization_id: event.organization_id,
      event_id: event.id,
      event_type: event.event_type,
      event_control_conversation_id: event.control_conversation_id,
      bound_conversation_id: 'conv_control_1',
      insert_success: false,
    });
    warnSpy.mockRestore();
  });

  it('returns false and warns when payload serialization fails', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerOrganizationControlConversation('org_alpha', 'conv_control_1');
    const event: TOrganizationControlEvent = {
      id: 'evt_serialize_fail',
      organization_id: 'org_alpha',
      control_conversation_id: 'conv_control_1',
      event_type: 'run_closed',
      source: 'org.bridge',
      summary: 'Payload has bigint',
      payload: { huge: BigInt(1) } as unknown as Record<string, unknown>,
      timestamp: Date.now(),
    };

    const result = appendOrganizationControlEventMessage(event);

    expect(result).toBe(false);
    expect(mockGetDatabase).not.toHaveBeenCalled();
    expect(insertedMessages).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnContext = warnSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(warnContext).toMatchObject({
      reason: 'serialize_error',
      organization_id: event.organization_id,
      event_id: event.id,
      event_type: event.event_type,
      event_control_conversation_id: event.control_conversation_id,
      bound_conversation_id: 'conv_control_1',
    });
    expect(String(warnContext.error_message)).toContain('BigInt');
    warnSpy.mockRestore();
  });

  it('returns false and warns when database insert throws error', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerOrganizationControlConversation('org_alpha', 'conv_control_1');
    mockInsertMessage.mockImplementation(() => {
      throw new Error('db write exploded');
    });
    const event: TOrganizationControlEvent = {
      id: 'evt_db_throw',
      organization_id: 'org_alpha',
      control_conversation_id: 'conv_control_1',
      event_type: 'run_closed',
      source: 'org.bridge',
      summary: 'Insert throw',
      timestamp: Date.now(),
    };

    const result = appendOrganizationControlEventMessage(event);

    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnContext = warnSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(warnContext).toMatchObject({
      reason: 'insert_error',
      organization_id: event.organization_id,
      event_id: event.id,
      event_type: event.event_type,
      event_control_conversation_id: event.control_conversation_id,
      bound_conversation_id: 'conv_control_1',
      error_message: 'db write exploded',
    });
    warnSpy.mockRestore();
  });

  it('emits reconcile_tick when periodic reconcile detects state drift', async () => {
    vi.useFakeTimers();
    registerOrganizationControlConversation('org_alpha', 'conv_control_1');
    mockGetOrganizationReconcileSnapshot.mockReturnValue({
      organization_id: 'org_alpha',
      control_state: {
        phase: 'drafting_plan',
        needs_human_input: false,
        pending_approval_count: 0,
      },
      derived_state: {
        expected_phase: 'monitoring',
        expected_needs_human_input: false,
        pending_approval_count: 0,
      },
      active_run_count: 1,
      pending_approval_count: 0,
      generated_at: 111,
    });

    startOrganizationControlReconcileTicker(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockGetOrganizationReconcileSnapshot).toHaveBeenCalledWith('org_alpha');
    expect(insertedMessages).toHaveLength(1);
    const content = (insertedMessages[0]?.content as { content?: string })?.content || '';
    expect(content.startsWith('[OrgEvent] reconcile_tick\n')).toBe(true);
    expect(content).toContain('"event_type": "reconcile_tick"');
    expect(content).toContain('"organization_id": "org_alpha"');
    stopOrganizationControlReconcileTicker();
  });

  it('starts reconcile ticker automatically after control conversation registration', async () => {
    vi.useFakeTimers();
    mockGetOrganizationReconcileSnapshot.mockReturnValue({
      organization_id: 'org_alpha',
      control_state: {
        phase: 'drafting_plan',
        needs_human_input: false,
        pending_approval_count: 0,
      },
      derived_state: {
        expected_phase: 'monitoring',
        expected_needs_human_input: false,
        pending_approval_count: 0,
      },
      active_run_count: 1,
      pending_approval_count: 0,
      generated_at: 333,
    });

    registerOrganizationControlConversation('org_alpha', 'conv_control_1');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockGetOrganizationReconcileSnapshot).toHaveBeenCalledWith('org_alpha');
    expect(insertedMessages).toHaveLength(1);
  });

  it('treats non-plan pending approvals as pending counts instead of plan-gate drift', () => {
    registerOrganizationControlConversation('org_alpha', 'conv_control_1');
    mockGetOrganizationReconcileSnapshot.mockReturnValue({
      organization_id: 'org_alpha',
      control_state: {
        phase: 'drafting_plan',
        needs_human_input: false,
        pending_approval_count: 1,
      },
      derived_state: {
        expected_phase: 'drafting_plan',
        expected_needs_human_input: false,
        pending_approval_count: 1,
      },
      active_run_count: 0,
      pending_approval_count: 1,
      generated_at: 444,
    });

    const emittedCount = runOrganizationControlReconcilePass();

    expect(emittedCount).toBe(0);
    expect(insertedMessages).toHaveLength(0);
  });

  it('does not emit duplicate reconcile_tick for the same drift signature', () => {
    registerOrganizationControlConversation('org_alpha', 'conv_control_1');
    mockGetOrganizationReconcileSnapshot.mockReturnValue({
      organization_id: 'org_alpha',
      control_state: {
        phase: 'drafting_plan',
        needs_human_input: false,
        pending_approval_count: 0,
      },
      derived_state: {
        expected_phase: 'monitoring',
        expected_needs_human_input: false,
        pending_approval_count: 0,
      },
      active_run_count: 1,
      pending_approval_count: 0,
      generated_at: 555,
    });

    const firstEmittedCount = runOrganizationControlReconcilePass();
    const secondEmittedCount = runOrganizationControlReconcilePass();

    expect(firstEmittedCount).toBe(1);
    expect(secondEmittedCount).toBe(0);
    expect(insertedMessages).toHaveLength(1);
  });

  it('stops reconcile ticker after the last binding is cleared', async () => {
    vi.useFakeTimers();
    registerOrganizationControlConversation('org_alpha', 'conv_control_1');
    expect(clearOrganizationControlConversation('org_alpha')).toBe(true);
    mockGetOrganizationReconcileSnapshot.mockClear();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockGetOrganizationReconcileSnapshot).not.toHaveBeenCalled();
  });

  it('preserves existing conversation extra fields when updating lastReconcileAt', () => {
    mockGetConversation.mockImplementation(() => ({
      success: true,
      data: {
        id: 'conv_control_1',
        extra: {
          organizationAutoDrive: true,
          customFlag: 'keep-me',
        },
      },
    }));
    registerOrganizationControlConversation('org_alpha', 'conv_control_1');
    mockGetOrganizationReconcileSnapshot.mockReturnValue({
      organization_id: 'org_alpha',
      control_state: {
        phase: 'drafting_plan',
        needs_human_input: false,
        pending_approval_count: 0,
      },
      derived_state: {
        expected_phase: 'drafting_plan',
        expected_needs_human_input: false,
        pending_approval_count: 0,
      },
      active_run_count: 0,
      pending_approval_count: 0,
      generated_at: 666,
    });

    runOrganizationControlReconcilePass();

    expect(mockUpdateConversation).toHaveBeenCalledWith(
      'conv_control_1',
      expect.objectContaining({
        extra: expect.objectContaining({
          organizationAutoDrive: true,
          customFlag: 'keep-me',
          lastReconcileAt: 666,
        }),
      })
    );
  });

  it('reconcile pass only appends event and never creates task/run', () => {
    registerOrganizationControlConversation('org_alpha', 'conv_control_1');
    mockGetOrganizationReconcileSnapshot.mockReturnValue({
      organization_id: 'org_alpha',
      control_state: {
        phase: 'drafting_plan',
        needs_human_input: false,
        pending_approval_count: 0,
      },
      derived_state: {
        expected_phase: 'awaiting_human_decision',
        expected_needs_human_input: true,
        pending_approval_count: 0,
      },
      active_run_count: 0,
      pending_approval_count: 0,
      generated_at: 222,
    });

    const emittedCount = runOrganizationControlReconcilePass();
    expect(emittedCount).toBe(1);
    expect(insertedMessages).toHaveLength(1);
    expect(mockCreateOrgTask).not.toHaveBeenCalled();
    expect(mockCreateOrgRun).not.toHaveBeenCalled();
    expect(mockUpdateConversation).toHaveBeenCalledTimes(1);
    expect(mockSyncOrganizationContext).toHaveBeenCalledWith('org_alpha');
  });
});
