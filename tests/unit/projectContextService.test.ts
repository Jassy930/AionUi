/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '@process/database';

vi.mock('@process/database', () => ({
  getDatabase: vi.fn(),
}));

import { generateProjectSystemPrompt } from '@/process/services/projectContextService';

describe('generateProjectSystemPrompt', () => {
  const getProject = vi.fn();
  const getProjectTasks = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDatabase).mockReturnValue({
      getProject,
      getProjectTasks,
    } as never);
  });

  it('includes manager-style delegation rules for the top-level project agent', () => {
    getProject.mockReturnValue({
      success: true,
      data: {
        id: 'project-1',
        name: 'AionUi',
        description: 'Project workspace',
        workspace: '/tmp/aionui',
      },
    });
    getProjectTasks.mockReturnValue({
      success: true,
      data: [],
    });

    const prompt = generateProjectSystemPrompt('project-1');

    expect(prompt).toContain('project manager and technical director');
    expect(prompt).toContain('Management-only requests can be answered directly');
    expect(prompt).toContain('Any substantial execution must first become a task');
    expect(prompt).toContain('You MUST NOT use any skill');
    expect(prompt).toContain('This restriction applies only to the top-level project agent');
  });
});
