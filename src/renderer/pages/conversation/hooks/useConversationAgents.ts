/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import type { AvailableAgent } from '@/renderer/pages/guid/types';

export type UseConversationAgentsResult = {
  /** CLI Agents (non-custom, non-preset backends, excluding gemini-CLI) */
  cliAgents: AvailableAgent[];
  /** Preset assistants (isPreset === true) */
  presetAssistants: AvailableAgent[];
  /** Loading state */
  isLoading: boolean;
  /** Error info */
  error: Error | null;
  /** Refresh data */
  refresh: () => Promise<void>;
};

/**
 * Hook to fetch available CLI agents and preset assistants for the conversation tab dropdown.
 * Filters out gemini-CLI agents (BUG-4: matches useGuidAgentSelection filter logic).
 */
export const useConversationAgents = (): UseConversationAgentsResult => {
  const {
    data: availableAgents,
    isLoading,
    error,
    mutate,
  } = useSWR('conversation.agents.available', async () => {
    const result = await ipcBridge.acpConversation.getAvailableAgents.invoke();
    if (result.success) {
      return result.data;
    }
    return [];
  });

  const cliAgents = useMemo(() => {
    if (!availableAgents) return [];
    // Filter: non-custom, non-preset backends, excluding gemini-CLI (backend=gemini && cliPath).
    // AcpDetector always inserts a built-in Gemini entry with cliPath=undefined.
    // We keep this entry (it represents Gemini API) but exclude any gemini entries that have a
    // real cliPath (which would indicate a real Gemini CLI install, handled separately).
    // This matches the Guid page filter in useGuidAgentSelection SWR 'acp.agents.available'.
    return availableAgents.filter((a) => a.backend !== 'custom' && !a.isPreset && !(a.backend === 'gemini' && a.cliPath));
  }, [availableAgents]);

  const presetAssistants = useMemo(() => {
    if (!availableAgents) return [];
    return availableAgents.filter((a) => a.isPreset === true);
  }, [availableAgents]);

  const refresh = async () => {
    await mutate();
  };

  return {
    cliAgents,
    presetAssistants,
    isLoading,
    error: error ?? null,
    refresh,
  };
};
