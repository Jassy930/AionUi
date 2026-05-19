/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// ---- snake_case: 与 AionCLI ApiResponse.data 严格对齐 (仅 adapter 层使用) ----

export type UsageSourceStatusRaw = {
  agent: string;
  files_total: number;
  files_parsed: number;
  files_skipped: number;
  available: boolean;
  error: string | null;
};

export type UsageByAgentRaw = {
  agent: string;
  sessions: number;
  messages: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
};

export type UsageByModelRaw = {
  agent: string;
  model: string;
  sessions: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
};

export type TrendPointRaw = { bucket: string; by_agent: Record<string, number> };

export type SessionRowRaw = {
  agent: string;
  session_id: string;
  project: string;
  model: string;
  started_at: string;
  last_active_at: string;
  messages: number;
  total_tokens: number;
};

export type AgentUsageResponseRaw = {
  scanned_at: string;
  sources: UsageSourceStatusRaw[];
  summary: { by_agent: UsageByAgentRaw[] };
  by_model: UsageByModelRaw[];
  trend: { granularity: string; points: TrendPointRaw[] };
  time_range: string;
  sessions_total: number;
  sessions_limit: number;
  sessions_offset: number;
  sessions: SessionRowRaw[];
};

// ---- camelCase: 组件消费的域模型 ----

export type UsageSourceStatus = {
  agent: string;
  filesTotal: number;
  filesParsed: number;
  filesSkipped: number;
  available: boolean;
  error: string | null;
};

export type UsageByAgent = {
  agent: string;
  sessions: number;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
};

export type UsageByModel = {
  agent: string;
  model: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
};

export type TrendPoint = { bucket: string; byAgent: Record<string, number> };

export type SessionRow = {
  agent: string;
  sessionId: string;
  project: string;
  model: string;
  startedAt: string;
  lastActiveAt: string;
  messages: number;
  totalTokens: number;
};

export type AgentUsageResponse = {
  scannedAt: string;
  sources: UsageSourceStatus[];
  summary: { byAgent: UsageByAgent[] };
  byModel: UsageByModel[];
  trend: { granularity: string; points: TrendPoint[] };
  timeRange: string;
  sessionsTotal: number;
  sessionsLimit: number;
  sessionsOffset: number;
  sessions: SessionRow[];
};

export type AgentUsageParams = {
  trendGranularity?: 'day' | 'week';
  timeRange?: '7d' | '30d' | '90d' | 'all';
  refresh?: boolean;
  sessionsLimit?: number;
  sessionsOffset?: number;
};

export function fromApiAgentUsage(r: AgentUsageResponseRaw): AgentUsageResponse {
  return {
    scannedAt: r.scanned_at,
    sources: r.sources.map((s) => ({
      agent: s.agent,
      filesTotal: s.files_total,
      filesParsed: s.files_parsed,
      filesSkipped: s.files_skipped,
      available: s.available,
      error: s.error,
    })),
    summary: {
      byAgent: r.summary.by_agent.map((a) => ({
        agent: a.agent,
        sessions: a.sessions,
        messages: a.messages,
        inputTokens: a.input_tokens,
        outputTokens: a.output_tokens,
        cacheReadTokens: a.cache_read_tokens,
        cacheCreationTokens: a.cache_creation_tokens,
        totalTokens: a.total_tokens,
      })),
    },
    byModel: r.by_model.map((m) => ({
      agent: m.agent,
      model: m.model,
      sessions: m.sessions,
      inputTokens: m.input_tokens,
      outputTokens: m.output_tokens,
      cacheReadTokens: m.cache_read_tokens,
      cacheCreationTokens: m.cache_creation_tokens,
      totalTokens: m.total_tokens,
    })),
    trend: {
      granularity: r.trend.granularity,
      points: r.trend.points.map((p) => ({ bucket: p.bucket, byAgent: p.by_agent })),
    },
    timeRange: r.time_range,
    sessionsTotal: r.sessions_total,
    sessionsLimit: r.sessions_limit,
    sessionsOffset: r.sessions_offset,
    sessions: r.sessions.map((s) => ({
      agent: s.agent,
      sessionId: s.session_id,
      project: s.project,
      model: s.model,
      startedAt: s.started_at,
      lastActiveAt: s.last_active_at,
      messages: s.messages,
      totalTokens: s.total_tokens,
    })),
  };
}
