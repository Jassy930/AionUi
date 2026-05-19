import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const invoke = vi.fn();
vi.mock('@/common', () => ({
  ipcBridge: { analytics: { getAgentUsage: { invoke: (...a: unknown[]) => invoke(...a) } } },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.count != null ? `${k}:${o.count}` : k) }),
}));
vi.mock('@renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid='settings-page-wrapper'>{children}</div>,
}));

import UsageStats from '@renderer/pages/settings/UsageStats';

const baseResp = {
  scannedAt: 'x',
  sources: [],
  summary: {
    byAgent: [
      {
        agent: 'claude',
        sessions: 1,
        messages: 2,
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 3,
      },
    ],
  },
  byModel: [],
  trend: { granularity: 'day', points: [] },
  timeRange: '30d',
  sessionsTotal: 1,
  sessionsLimit: 200,
  sessionsOffset: 0,
  sessions: [
    {
      agent: 'claude',
      sessionId: 's1',
      project: '/p',
      model: 'm',
      startedAt: 'a',
      lastActiveAt: 'b',
      messages: 2,
      totalTokens: 3,
    },
  ],
};

describe('UsageStats container', () => {
  beforeEach(() => {
    invoke.mockReset();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('renders data after load', async () => {
    invoke.mockResolvedValue(baseResp);
    render(<UsageStats />);
    await waitFor(() => {
      const el = screen.queryAllByText((c) => c.includes('usageStats.summary.totalTokens'));
      expect(el.length).toBeGreaterThan(0);
    });
  });

  it('shows unsupported on 404', async () => {
    invoke.mockRejectedValue({ status: 404 });
    render(<UsageStats />);
    await waitFor(() => {
      const el = screen.queryAllByText((c) => c.includes('usageStats.unsupported'));
      expect(el.length).toBeGreaterThan(0);
    });
  });

  it('shows generic error on other failures', async () => {
    invoke.mockRejectedValue({ status: 500 });
    render(<UsageStats />);
    await waitFor(() => {
      const el = screen.queryAllByText((c) => c.includes('usageStats.error'));
      expect(el.length).toBeGreaterThan(0);
    });
  });
});
