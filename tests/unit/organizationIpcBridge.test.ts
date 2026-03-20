/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { org } from '@/common/ipcBridge';
import {
  TASK_STATUS_VALUES,
  RUN_STATUS_VALUES,
  GENOME_PATCH_STATUS_VALUES,
  MUTATION_TARGET_VALUES,
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
  });

  it('exposes critical control-plane methods', () => {
    expect(org.organization.create).toBeDefined();
    expect(org.task.create).toBeDefined();
    expect(org.run.start).toBeDefined();
    expect(org.artifact.create).toBeDefined();
    expect(org.memory.promote).toBeDefined();
    expect(org.eval.execute).toBeDefined();
    expect(org.skill.create).toBeDefined();
    expect(org.evolution.propose).toBeDefined();
    expect(org.governance.approve).toBeDefined();
  });
});
