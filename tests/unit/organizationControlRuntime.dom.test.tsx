/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageText } from '@/common/chatLib';
import MessageText from '@/renderer/messages/MessagetText';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

vi.mock('@icon-park/react', () => ({
  Copy: () => <span data-testid='icon-copy' />,
}));

vi.mock('@/renderer/utils/clipboard', () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/renderer/components/CollapsibleContent', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/components/Markdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const buildOrgEventMessage = (
  overrides: Partial<{
    eventType: string;
    taskId: string | null;
    runId: string | null;
    source: string;
    summary: string;
  }> = {}
): IMessageText => {
  const payload = {
    event_type: overrides.eventType ?? 'run_closed',
    task_id: overrides.taskId ?? 'task_alpha',
    run_id: overrides.runId ?? 'run_alpha',
    approval_id: null,
    source: overrides.source ?? 'organization_runtime',
    summary: overrides.summary ?? 'Run closed and waiting for next decision.',
    payload: {
      object_ids: {
        task_id: overrides.taskId ?? 'task_alpha',
        run_id: overrides.runId ?? 'run_alpha',
      },
    },
    timestamp: 1_742_690_000_000,
  };

  return {
    id: `msg_${payload.event_type}_${payload.task_id ?? 'none'}_${payload.run_id ?? 'none'}`,
    msg_id: `org_${payload.event_type}`,
    conversation_id: 'conv_control',
    type: 'text',
    position: 'left',
    status: 'finish',
    createdAt: payload.timestamp,
    content: {
      content: `[OrgEvent] ${payload.event_type}\n${JSON.stringify(payload, null, 2)}`,
    },
  };
};

describe('organizationControlRuntime message rendering', () => {
  it('renders organization control events as structured cards', () => {
    render(<MessageText message={buildOrgEventMessage()} />);

    const eventCard = screen.getByTestId('org-control-event-card');
    expect(within(eventCard).getByText('Organization event')).toBeInTheDocument();
    expect(within(eventCard).getAllByText('run_closed')).toHaveLength(2);
    expect(within(eventCard).getByText('task_alpha')).toBeInTheDocument();
    expect(within(eventCard).getByText('run_alpha')).toBeInTheDocument();
    expect(within(eventCard).getByText('organization_runtime')).toBeInTheDocument();
    expect(within(eventCard).getByText('Run closed and waiting for next decision.')).toBeInTheDocument();
    expect(screen.queryByText(/\[OrgEvent\]/)).not.toBeInTheDocument();
  });

  it('keeps concurrent task and run identities isolated per event card', () => {
    render(
      <div>
        <MessageText
          message={buildOrgEventMessage({
            eventType: 'task_created',
            taskId: 'task_alpha',
            runId: null,
            summary: 'Task alpha was created.',
          })}
        />
        <MessageText
          message={buildOrgEventMessage({
            eventType: 'run_started',
            taskId: 'task_beta',
            runId: 'run_beta',
            summary: 'Run beta started.',
          })}
        />
      </div>
    );

    const eventCards = screen.getAllByTestId('org-control-event-card');
    expect(eventCards).toHaveLength(2);

    expect(within(eventCards[0]).getAllByText('task_created')).toHaveLength(2);
    expect(within(eventCards[0]).getByText('task_alpha')).toBeInTheDocument();
    expect(within(eventCards[0]).getByText('Task alpha was created.')).toBeInTheDocument();
    expect(within(eventCards[0]).queryByText('run_beta')).not.toBeInTheDocument();

    expect(within(eventCards[1]).getAllByText('run_started')).toHaveLength(2);
    expect(within(eventCards[1]).getByText('task_beta')).toBeInTheDocument();
    expect(within(eventCards[1]).getByText('run_beta')).toBeInTheDocument();
    expect(within(eventCards[1]).getByText('Run beta started.')).toBeInTheDocument();
    expect(within(eventCards[1]).queryByText('task_alpha')).not.toBeInTheDocument();
  });

  it('does not truncate long task and run identifiers in event cards', () => {
    const longTaskId = 'task_1234567890_abcdefghijklmnopqrstuvwxyz_long_identifier';
    const longRunId = 'run_1234567890_abcdefghijklmnopqrstuvwxyz_long_identifier';

    render(
      <MessageText
        message={buildOrgEventMessage({
          eventType: 'run_closed',
          taskId: longTaskId,
          runId: longRunId,
          summary: 'Long identifiers should remain readable.',
        })}
      />
    );

    const eventCard = screen.getByTestId('org-control-event-card');
    const taskValue = within(eventCard).getByText(longTaskId);
    const runValue = within(eventCard).getByText(longRunId);

    expect(taskValue).not.toHaveClass('truncate');
    expect(runValue).not.toHaveClass('truncate');
  });
});
