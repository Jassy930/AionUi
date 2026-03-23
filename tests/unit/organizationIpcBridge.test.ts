/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { org } from '@/common/ipcBridge';
import type { ConversationExecutionBinding } from '@/common/storage';
import {
  TASK_STATUS_VALUES,
  RUN_STATUS_VALUES,
  GENOME_PATCH_STATUS_VALUES,
  MUTATION_TARGET_VALUES,
  ORGANIZATION_CONTROL_PHASE_VALUES,
  ORGANIZATION_CONTROL_EVENT_TYPE_VALUES,
  ORG_PLAN_SNAPSHOT_STATUS_VALUES,
  ORG_APPROVAL_STATUS_VALUES,
} from '@/common/types/organization';

describe('organization ipc bridge contracts', () => {
  it('exposes all required org namespaces', () => {
    expect(org.organization).toBeDefined();
    expect(org.task).toBeDefined();
    expect(org.run).toBeDefined();
    expect(org.artifact).toBeDefined();
    expect(org.memory).toBeDefined();
    expect(org.eval).toBeDefined();
    expect(org.skill).toBeDefined();
    expect(org.evolution).toBeDefined();
    expect(org.governance).toBeDefined();
  });

  it('matches status enums with Organization OS design', () => {
    expect(TASK_STATUS_VALUES).toEqual(['draft', 'ready', 'scheduled', 'running', 'completed', 'blocked', 'archived']);
    expect(RUN_STATUS_VALUES).toEqual(['created', 'active', 'verifying', 'reviewing', 'closed']);
    expect(GENOME_PATCH_STATUS_VALUES).toEqual(['proposed', 'offline_eval', 'canary', 'adopted', 'rejected']);
    expect(MUTATION_TARGET_VALUES).toEqual(['skill', 'eval_spec', 'routing_policy', 'task_template']);
    expect(ORGANIZATION_CONTROL_PHASE_VALUES).toEqual([
      'intake',
      'brainstorming',
      'awaiting_human_decision',
      'drafting_plan',
      'awaiting_plan_approval',
      'dispatching',
      'monitoring',
      'blocked',
    ]);
    expect(ORG_PLAN_SNAPSHOT_STATUS_VALUES).toEqual(['draft', 'approved', 'superseded']);
    expect(ORG_APPROVAL_STATUS_VALUES).toEqual(['pending', 'approved', 'rejected', 'needs_more_info']);
  });

  it('exposes critical control-plane methods', () => {
    expect(org.organization.create).toBeDefined();
    expect(org.organization.getControlState).toBeDefined();
    expect(org.organization.listApprovals).toBeDefined();
    expect(org.organization.respondApproval).toBeDefined();
    expect(org.task.create).toBeDefined();
    expect(org.run.start).toBeDefined();
    expect(org.artifact.create).toBeDefined();
    expect(org.memory.promote).toBeDefined();
    expect(org.eval.execute).toBeDefined();
    expect(org.skill.create).toBeDefined();
    expect(org.evolution.propose).toBeDefined();
    expect(org.governance.approve).toBeDefined();
  });

  it('defines control runtime event types and conversation metadata contract', () => {
    expect(ORGANIZATION_CONTROL_EVENT_TYPE_VALUES).toEqual([
      'task_created',
      'task_updated',
      'run_started',
      'run_updated',
      'run_closed',
      'run_failed',
      'approval_requested',
      'approval_responded',
      'reconcile_tick',
      'eval_executed',
      'memory_promoted',
      'evolution_proposed',
      'governance_changed',
    ]);

    const runtimeBinding: Pick<
      ConversationExecutionBinding,
      'organizationAutoDrive' | 'autoDrivePaused' | 'lastReconcileAt' | 'controlConversationVersion'
    > = {
      organizationAutoDrive: true,
      autoDrivePaused: false,
      lastReconcileAt: Date.now(),
      controlConversationVersion: 1,
    };

    expect(runtimeBinding.organizationAutoDrive).toBe(true);
    expect(runtimeBinding.autoDrivePaused).toBe(false);
    expect(typeof runtimeBinding.lastReconcileAt).toBe('number');
    expect(runtimeBinding.controlConversationVersion).toBe(1);
  });
});
