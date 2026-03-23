/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { ICreateConversationParams } from '@/common/ipcBridge';

vi.mock('../../src/process/initStorage', () => ({
  getSystemDir: () => ({
    workDir: '/tmp/aionui-test-workdir',
  }),
}));

vi.mock('../../src/process/utils/openclawUtils', () => ({
  computeOpenClawIdentityHash: vi.fn(async () => 'identity-hash'),
}));

vi.mock('@/common/utils', () => ({
  uuid: () => 'conversation-test-id',
}));

describe('initAgent', () => {
  it('preserves organization control metadata when creating acp conversations', async () => {
    const { createAcpAgent } = await import('../../src/process/initAgent');
    const params: ICreateConversationParams = {
      type: 'acp',
      model: { id: 'gpt-5', useModel: 'gpt-5' },
      extra: {
        workspace: '/tmp/org-control-workspace',
        customWorkspace: true,
        backend: 'codex',
        cliPath: '/usr/local/bin/codex',
        agentName: 'codex',
        organizationId: 'org_alpha',
        runId: 'run_beta',
        organizationRole: 'control_plane',
        organizationAutoDrive: true,
        autoDrivePaused: false,
        lastReconcileAt: 123,
        controlConversationVersion: 2,
      },
    };

    const conversation = await createAcpAgent(params);

    expect(conversation.type).toBe('acp');
    expect(conversation.extra.organizationId).toBe('org_alpha');
    expect(conversation.extra.runId).toBe('run_beta');
    expect(conversation.extra.organizationRole).toBe('control_plane');
    expect(conversation.extra.organizationAutoDrive).toBe(true);
    expect(conversation.extra.autoDrivePaused).toBe(false);
    expect(conversation.extra.lastReconcileAt).toBe(123);
    expect(conversation.extra.controlConversationVersion).toBe(2);
  });
});
