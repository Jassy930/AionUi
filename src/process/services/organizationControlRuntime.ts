/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chatLib';
import type { TOrganizationControlEvent } from '@/common/types/organization';
import { uuid } from '@/common/utils';
import { triggerOrganizationControlInternalContinue } from '@process/bridge/conversationBridge';
import { getDatabase } from '@process/database';
import { cronBusyGuard } from '@process/services/cron/CronBusyGuard';
import {
  getOrganizationReconcileSnapshot,
  syncOrganizationContext,
  type TOrganizationReconcileSnapshot,
} from '@process/services/organizationContextService';

export type TOrganizationControlConversationBinding = {
  organizationId: string;
  conversationId: string;
  updatedAt: number;
};

const controlConversationBindings = new Map<string, TOrganizationControlConversationBinding>();
type TControlConversationQueueState = {
  pendingEventCount: number;
  dispatchInFlight: boolean;
  idleCallbackRegistered: boolean;
  pausedAfterFailure: boolean;
};

const controlConversationQueueStates = new Map<string, TControlConversationQueueState>();
const reconcileDriftSignatures = new Map<string, string>();
const DEFAULT_RECONCILE_INTERVAL_MS = 60_000;
let reconcileTicker: ReturnType<typeof setInterval> | null = null;

type TOrganizationControlWarnReason =
  | 'missing_binding'
  | 'conversation_mismatch'
  | 'serialize_error'
  | 'insert_failed'
  | 'insert_error';

function warnOrganizationControlEvent(
  reason: TOrganizationControlWarnReason,
  event: TOrganizationControlEvent,
  boundConversationId: string | null,
  extra?: Record<string, unknown>
): void {
  const context = {
    reason,
    organization_id: event.organization_id,
    event_id: event.id,
    event_type: event.event_type,
    event_control_conversation_id: event.control_conversation_id,
    bound_conversation_id: boundConversationId,
    ...extra,
  };
  console.warn('[organizationControlRuntime] Failed to append control event message', context);
}

export function registerOrganizationControlConversation(
  organizationId: string,
  conversationId: string
): TOrganizationControlConversationBinding {
  const previousBinding = controlConversationBindings.get(organizationId);
  if (previousBinding?.conversationId && previousBinding.conversationId !== conversationId) {
    controlConversationQueueStates.delete(previousBinding.conversationId);
  }

  const binding: TOrganizationControlConversationBinding = {
    organizationId,
    conversationId,
    updatedAt: Date.now(),
  };
  controlConversationBindings.set(organizationId, binding);
  if (!reconcileTicker) {
    startOrganizationControlReconcileTicker();
  }
  return binding;
}

export function getOrganizationControlConversation(
  organizationId: string
): TOrganizationControlConversationBinding | undefined {
  return controlConversationBindings.get(organizationId);
}

export function clearOrganizationControlConversation(organizationId: string): boolean {
  const binding = controlConversationBindings.get(organizationId);
  if (binding?.conversationId) {
    controlConversationQueueStates.delete(binding.conversationId);
  }
  reconcileDriftSignatures.delete(organizationId);
  const deleted = controlConversationBindings.delete(organizationId);
  if (controlConversationBindings.size === 0) {
    stopOrganizationControlReconcileTicker();
  }
  return deleted;
}

export function clearOrganizationControlConversationByConversationId(conversationId: string): boolean {
  controlConversationQueueStates.delete(conversationId);
  for (const [organizationId, binding] of controlConversationBindings.entries()) {
    if (binding.conversationId === conversationId) {
      reconcileDriftSignatures.delete(organizationId);
      controlConversationBindings.delete(organizationId);
      if (controlConversationBindings.size === 0) {
        stopOrganizationControlReconcileTicker();
      }
      return true;
    }
  }
  return false;
}

export function clearAllOrganizationControlConversations(): void {
  controlConversationBindings.clear();
  controlConversationQueueStates.clear();
  reconcileDriftSignatures.clear();
  stopOrganizationControlReconcileTicker();
}

function updateConversationLastReconcileAt(conversationId: string, reconcileAt: number): void {
  const db = getDatabase();
  const conversationResult = db.getConversation(conversationId);
  if (!conversationResult.success || !conversationResult.data) {
    return;
  }

  const existingExtra = (conversationResult.data.extra || {}) as Record<string, unknown>;
  const updateExtra = {
    ...existingExtra,
    lastReconcileAt: reconcileAt,
  };
  db.updateConversation(conversationId, { extra: updateExtra } as Partial<typeof conversationResult.data>);
}

function buildReconcileDrift(snapshot: TOrganizationReconcileSnapshot): {
  hasDrift: boolean;
  reasons: string[];
} {
  if (!snapshot.control_state) {
    return {
      hasDrift: true,
      reasons: ['control_state_missing'],
    };
  }

  const reasons: string[] = [];
  if (snapshot.control_state.phase !== snapshot.derived_state.expected_phase) {
    reasons.push('phase_mismatch');
  }
  if (snapshot.control_state.needs_human_input !== snapshot.derived_state.expected_needs_human_input) {
    reasons.push('needs_human_input_mismatch');
  }
  if (snapshot.control_state.pending_approval_count !== snapshot.derived_state.pending_approval_count) {
    reasons.push('pending_approval_count_mismatch');
  }

  return {
    hasDrift: reasons.length > 0,
    reasons,
  };
}

function buildReconcileDriftSignature(snapshot: TOrganizationReconcileSnapshot, reasons: string[]): string {
  return JSON.stringify({
    organization_id: snapshot.organization_id,
    phase: snapshot.control_state?.phase ?? null,
    expected_phase: snapshot.derived_state.expected_phase,
    needs_human_input: snapshot.control_state?.needs_human_input ?? null,
    expected_needs_human_input: snapshot.derived_state.expected_needs_human_input,
    pending_approval_count: snapshot.control_state?.pending_approval_count ?? null,
    expected_pending_approval_count: snapshot.derived_state.pending_approval_count,
    active_run_count: snapshot.active_run_count,
    reasons,
  });
}

function appendReconcileTickEvent(
  organizationId: string,
  conversationId: string,
  snapshot: TOrganizationReconcileSnapshot,
  reasons: string[]
): boolean {
  return enqueueOrganizationControlEvent({
    id: `org_reconcile_${uuid()}`,
    organization_id: organizationId,
    control_conversation_id: conversationId,
    event_type: 'reconcile_tick',
    source: 'organization_runtime_reconcile',
    summary: `Reconcile drift detected for organization ${organizationId}.`,
    payload: {
      organization_id: organizationId,
      drift_reasons: reasons,
      snapshot,
      object_ids: {
        organization_id: organizationId,
      },
    },
    timestamp: snapshot.generated_at,
  });
}

function getControlBindingEntries(organizationId?: string): Array<[string, TOrganizationControlConversationBinding]> {
  if (!organizationId) {
    return Array.from(controlConversationBindings.entries());
  }

  const binding = controlConversationBindings.get(organizationId);
  return binding ? [[organizationId, binding]] : [];
}

export function runOrganizationControlReconcilePass(
  options: { organizationId?: string; forceEmit?: boolean } = {}
): number {
  let emittedCount = 0;
  const bindings = getControlBindingEntries(options.organizationId);
  for (const [organizationId, binding] of bindings) {
    const snapshot = getOrganizationReconcileSnapshot(organizationId);
    if (!snapshot) {
      reconcileDriftSignatures.delete(organizationId);
      continue;
    }

    const reconcileAt = snapshot.generated_at;
    updateConversationLastReconcileAt(binding.conversationId, reconcileAt);

    const drift = buildReconcileDrift(snapshot);
    if (!drift.hasDrift) {
      reconcileDriftSignatures.delete(organizationId);
      continue;
    }

    const signature = buildReconcileDriftSignature(snapshot, drift.reasons);
    const previousSignature = reconcileDriftSignatures.get(organizationId);
    if (!options.forceEmit && previousSignature === signature) {
      continue;
    }

    const appended = appendReconcileTickEvent(organizationId, binding.conversationId, snapshot, drift.reasons);
    if (!appended) {
      continue;
    }

    reconcileDriftSignatures.set(organizationId, signature);
    emittedCount += 1;
    syncOrganizationContext(organizationId);
  }
  return emittedCount;
}

export function startOrganizationControlReconcileTicker(intervalMs = DEFAULT_RECONCILE_INTERVAL_MS): void {
  stopOrganizationControlReconcileTicker();
  reconcileTicker = setInterval(() => {
    runOrganizationControlReconcilePass();
  }, intervalMs);
}

export function stopOrganizationControlReconcileTicker(): void {
  if (!reconcileTicker) {
    return;
  }
  clearInterval(reconcileTicker);
  reconcileTicker = null;
}

export function appendOrganizationControlEventMessage(event: TOrganizationControlEvent): boolean {
  const binding = getOrganizationControlConversation(event.organization_id);
  if (!binding?.conversationId) {
    warnOrganizationControlEvent('missing_binding', event, null);
    return false;
  }
  if (event.control_conversation_id !== binding.conversationId) {
    warnOrganizationControlEvent('conversation_mismatch', event, binding.conversationId);
    return false;
  }

  const messageBody = {
    event_type: event.event_type,
    task_id: event.task_id ?? null,
    run_id: event.run_id ?? null,
    approval_id: event.approval_id,
    source: event.source,
    summary: event.summary,
    payload: event.payload ?? {},
    timestamp: event.timestamp,
  };

  let serializedMessageBody = '';
  try {
    serializedMessageBody = JSON.stringify(messageBody, null, 2);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    warnOrganizationControlEvent('serialize_error', event, binding.conversationId, {
      error_message: errorMessage,
    });
    return false;
  }

  const message: TMessage = {
    id: uuid(),
    msg_id: `org_event_${event.id}`,
    conversation_id: binding.conversationId,
    type: 'text',
    position: 'left',
    status: 'finish',
    createdAt: event.timestamp ?? Date.now(),
    content: {
      content: `[OrgEvent] ${event.event_type}\n${serializedMessageBody}`,
    },
  };

  try {
    const result = getDatabase().insertMessage(message);
    if (!result.success) {
      warnOrganizationControlEvent('insert_failed', event, binding.conversationId, {
        insert_success: false,
      });
    }
    return result.success;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    warnOrganizationControlEvent('insert_error', event, binding.conversationId, {
      error_message: errorMessage,
    });
    return false;
  }
}

function getControlConversationQueueState(conversationId: string): TControlConversationQueueState {
  const existing = controlConversationQueueStates.get(conversationId);
  if (existing) return existing;
  const state: TControlConversationQueueState = {
    pendingEventCount: 0,
    dispatchInFlight: false,
    idleCallbackRegistered: false,
    pausedAfterFailure: false,
  };
  controlConversationQueueStates.set(conversationId, state);
  return state;
}

function cleanupControlConversationQueueState(conversationId: string): void {
  const state = controlConversationQueueStates.get(conversationId);
  if (!state) return;
  if (state.pendingEventCount > 0 || state.dispatchInFlight || state.idleCallbackRegistered) return;
  controlConversationQueueStates.delete(conversationId);
}

function scheduleOrganizationControlDispatch(conversationId: string): void {
  const state = getControlConversationQueueState(conversationId);
  if (state.dispatchInFlight || state.pendingEventCount <= 0 || state.pausedAfterFailure) return;

  if (cronBusyGuard.isProcessing(conversationId)) {
    if (state.idleCallbackRegistered) return;
    state.idleCallbackRegistered = true;
    cronBusyGuard.onceIdle(conversationId, () => {
      state.idleCallbackRegistered = false;
      scheduleOrganizationControlDispatch(conversationId);
    });
    return;
  }

  state.dispatchInFlight = true;
  const queuedEventCount = state.pendingEventCount;
  state.pendingEventCount = 0;

  void (async () => {
    let failed = false;
    let errorMessage: string | undefined;
    try {
      const result = await triggerOrganizationControlInternalContinue(conversationId, { queuedEventCount });
      if (!result.success) {
        failed = true;
        errorMessage = result.msg ?? 'internal continue returned success=false';
      }
    } catch (error) {
      failed = true;
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    state.dispatchInFlight = false;
    if (failed) {
      state.pendingEventCount += queuedEventCount;
      state.pausedAfterFailure = true;
      console.warn('[organizationControlRuntime] Internal control continue failed, keep pending events for retry', {
        conversation_id: conversationId,
        queued_event_count: queuedEventCount,
        pending_event_count: state.pendingEventCount,
        error_message: errorMessage,
      });
      return;
    }

    if (state.pendingEventCount > 0) {
      scheduleOrganizationControlDispatch(conversationId);
      return;
    }
    cleanupControlConversationQueueState(conversationId);
  })();
}

function enqueueControlConversationAutoDrive(conversationId: string): void {
  const state = getControlConversationQueueState(conversationId);
  state.pendingEventCount += 1;
  state.pausedAfterFailure = false;
  scheduleOrganizationControlDispatch(conversationId);
}

export function enqueueOrganizationControlEvent(event: TOrganizationControlEvent): boolean {
  const appended = appendOrganizationControlEventMessage(event);
  if (!appended) return false;

  const binding = getOrganizationControlConversation(event.organization_id);
  const conversationId = binding?.conversationId;
  if (!conversationId || conversationId !== event.control_conversation_id) {
    return true;
  }

  enqueueControlConversationAutoDrive(conversationId);
  return true;
}
