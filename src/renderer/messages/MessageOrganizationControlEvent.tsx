/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import CollapsibleContent from '@/renderer/components/CollapsibleContent';
import MarkdownView from '@/renderer/components/Markdown';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';

const ORG_EVENT_PREFIX = '[OrgEvent] ';

export type TOrganizationControlMessageBody = {
  event_type: string;
  task_id: string | null;
  run_id: string | null;
  approval_id?: string | null;
  source?: string;
  summary?: string;
  payload?: Record<string, unknown>;
  timestamp?: number;
};

type MessageOrganizationControlEventProps = {
  event: TOrganizationControlMessageBody;
};

type EventFieldProps = {
  label: string;
  value: string | null | undefined;
  emphasize?: boolean;
  wrap?: boolean;
};

function EventField({ label, value, emphasize = false, wrap = false }: EventFieldProps) {
  return (
    <div className='min-w-0 flex flex-col gap-4px rounded-8px bg-[var(--color-fill-1)] px-10px py-8px'>
      <span className='text-11px leading-16px text-[var(--color-text-3)]'>{label}</span>
      <span
        className={classNames('text-13px leading-18px text-[var(--color-text-1)]', {
          'font-600': emphasize,
          truncate: !wrap,
          'break-all whitespace-normal': wrap,
        })}
        title={value ?? undefined}
      >
        {value}
      </span>
    </div>
  );
}

export function parseOrganizationControlEvent(content: string): TOrganizationControlMessageBody | null {
  if (!content.startsWith(ORG_EVENT_PREFIX)) {
    return null;
  }

  const newlineIndex = content.indexOf('\n');
  if (newlineIndex === -1) {
    return null;
  }

  const fallbackEventType = content.slice(ORG_EVENT_PREFIX.length, newlineIndex).trim();
  const rawBody = content.slice(newlineIndex + 1).trim();
  if (!rawBody) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawBody) as Partial<TOrganizationControlMessageBody>;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return {
      event_type: typeof parsed.event_type === 'string' ? parsed.event_type : fallbackEventType,
      task_id: typeof parsed.task_id === 'string' ? parsed.task_id : null,
      run_id: typeof parsed.run_id === 'string' ? parsed.run_id : null,
      approval_id: typeof parsed.approval_id === 'string' ? parsed.approval_id : null,
      source: typeof parsed.source === 'string' ? parsed.source : undefined,
      summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
      payload:
        parsed.payload && typeof parsed.payload === 'object' && !Array.isArray(parsed.payload)
          ? (parsed.payload as Record<string, unknown>)
          : {},
      timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : undefined,
    };
  } catch {
    return null;
  }
}

const MessageOrganizationControlEvent: React.FC<MessageOrganizationControlEventProps> = ({ event }) => {
  const { t } = useTranslation();

  const fallbackText = t('messages.organizationEvent.notSet', { defaultValue: 'Not set' });
  const eventType = event.event_type || fallbackText;
  const payloadText = JSON.stringify(event.payload ?? {}, null, 2);
  const hasPayload = payloadText !== '{}';

  return (
    <section
      className='w-full rounded-12px border border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-12px'
      data-testid='org-control-event-card'
    >
      <div className='mb-10px flex items-center justify-between gap-8px'>
        <span className='text-12px font-600 leading-18px text-[var(--color-text-1)]'>
          {t('messages.organizationEvent.title', { defaultValue: 'Organization event' })}
        </span>
        <span className='rounded-999px bg-[var(--color-fill-2)] px-8px py-2px text-11px leading-16px text-[var(--color-text-2)]'>
          {eventType}
        </span>
      </div>

      <div className='grid grid-cols-1 gap-8px md:grid-cols-2'>
        <EventField
          label={t('messages.organizationEvent.eventType', { defaultValue: 'Event type' })}
          value={eventType}
          emphasize
        />
        <EventField
          label={t('messages.organizationEvent.source', { defaultValue: 'Source' })}
          value={event.source || fallbackText}
        />
        <EventField
          label={t('messages.organizationEvent.taskId', { defaultValue: 'Task' })}
          value={event.task_id || fallbackText}
          wrap
        />
        <EventField
          label={t('messages.organizationEvent.runId', { defaultValue: 'Run' })}
          value={event.run_id || fallbackText}
          wrap
        />
        {event.approval_id ? (
          <EventField
            label={t('messages.organizationEvent.approvalId', { defaultValue: 'Approval' })}
            value={event.approval_id}
          />
        ) : null}
      </div>

      {event.summary ? (
        <div className='mt-10px rounded-8px bg-[var(--color-fill-1)] px-10px py-8px'>
          <div className='mb-4px text-11px leading-16px text-[var(--color-text-3)]'>
            {t('messages.organizationEvent.summary', { defaultValue: 'Summary' })}
          </div>
          <div className='text-13px leading-20px text-[var(--color-text-1)]'>{event.summary}</div>
        </div>
      ) : null}

      {hasPayload ? (
        <div className='mt-10px'>
          <div className='mb-4px text-11px leading-16px text-[var(--color-text-3)]'>
            {t('messages.organizationEvent.payload', { defaultValue: 'Payload' })}
          </div>
          <CollapsibleContent maxHeight={160} defaultCollapsed={true}>
            <MarkdownView
              codeStyle={{ marginTop: 4, marginBlock: 4 }}
            >{`\`\`\`json\n${payloadText}\n\`\`\``}</MarkdownView>
          </CollapsibleContent>
        </div>
      ) : null}
    </section>
  );
};

export default MessageOrganizationControlEvent;
