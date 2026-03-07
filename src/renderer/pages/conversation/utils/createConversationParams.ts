/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { ConfigStorage } from '@/common/storage';
import { ASSISTANT_PRESETS } from '@/common/presets/assistantPresets';
import type { ICreateConversationParams, TProviderWithModel } from '@/common/storage';
import type { AvailableAgent } from '@/renderer/pages/guid/types';
import type { AcpBackend, AcpBackendAll } from '@/types/acpTypes';

/**
 * Map i18n.language to a standard locale key.
 * i18n.language may return 'zh', 'en', etc.; IPC APIs expect 'zh-CN', 'en-US', etc.
 * [BUG-2 fix]
 */
export function getLocaleKey(language: string): string {
  const LOCALE_MAP: Record<string, string> = {
    zh: 'zh-CN',
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    en: 'en-US',
    'en-US': 'en-US',
    ja: 'ja-JP',
    'ja-JP': 'ja-JP',
    ko: 'ko-KR',
    'ko-KR': 'ko-KR',
  };
  return LOCALE_MAP[language] || 'en-US';
}

/**
 * Get the default Gemini model configuration from user settings.
 * Throws if no enabled provider or model is configured.
 * [BUG-3 fix]: callers must call this inside a try block
 */
export async function getDefaultGeminiModel(): Promise<TProviderWithModel> {
  const providers = await ConfigStorage.get('model.config');

  if (!providers || providers.length === 0) {
    throw new Error('No model provider configured');
  }

  const enabledProvider = providers.find((p) => p.enabled !== false);
  if (!enabledProvider) {
    throw new Error('No enabled model provider');
  }

  const enabledModel = enabledProvider.model.find((m) => enabledProvider.modelEnabled?.[m] !== false);

  return {
    id: enabledProvider.id,
    platform: enabledProvider.platform,
    name: enabledProvider.name,
    baseUrl: enabledProvider.baseUrl,
    apiKey: enabledProvider.apiKey,
    useModel: enabledModel || enabledProvider.model[0],
    capabilities: enabledProvider.capabilities,
    contextLimit: enabledProvider.contextLimit,
    modelProtocols: enabledProvider.modelProtocols,
    bedrockConfig: enabledProvider.bedrockConfig,
    enabled: enabledProvider.enabled,
    modelEnabled: enabledProvider.modelEnabled,
    modelHealth: enabledProvider.modelHealth,
  };
}

/**
 * Determine the conversation type from a CLI agent's backend.
 * codex uses ACP path (type: 'acp' + extra.backend = 'codex').
 */
export function getConversationTypeForBackend(backend: string): ICreateConversationParams['type'] {
  switch (backend) {
    case 'gemini':
      return 'gemini';
    case 'openclaw-gateway':
    case 'openclaw':
      return 'openclaw-gateway';
    case 'nanobot':
      return 'nanobot';
    default:
      // claude, qwen, codex, iflow, goose, auggie, kimi, opencode, copilot, qoder, codebuddy, droid, vibe, etc.
      // Note: codex now uses ACP path; legacy 'codex' type is not used for new conversations.
      return 'acp';
  }
}

/**
 * Determine the conversation type from a preset assistant's presetAgentType.
 * ACP-routed types include claude, codebuddy, opencode, qwen, codex.
 */
export function getConversationTypeForPreset(presetAgentType: string): ICreateConversationParams['type'] {
  const ACP_ROUTED_TYPES = ['claude', 'codebuddy', 'opencode', 'qwen', 'codex'];
  if (ACP_ROUTED_TYPES.includes(presetAgentType)) {
    return 'acp';
  }
  // Default: gemini
  return 'gemini';
}

/**
 * Get enabled skills for a preset assistant from stored config.
 */
export async function getEnabledSkillsForAssistant(customAgentId?: string): Promise<string[] | undefined> {
  if (!customAgentId) return undefined;
  const customAgents = await ConfigStorage.get('acp.customAgents');
  const assistant = customAgents?.find((a) => a.id === customAgentId);
  return assistant?.enabledSkills;
}

/**
 * Build ICreateConversationParams for a CLI agent.
 * The backend will automatically fill in derived fields (gateway.cliPath, runtimeValidation, etc.).
 * [BUG-3 fix]: callers must invoke this inside a try block because getDefaultGeminiModel may throw.
 */
export async function buildCliAgentParams(agent: AvailableAgent, workspace: string): Promise<ICreateConversationParams> {
  const { backend, name: agentName, cliPath } = agent;

  const type = getConversationTypeForBackend(backend);

  const extra: ICreateConversationParams['extra'] = {
    workspace,
    customWorkspace: true,
  };

  if (type === 'acp' || type === 'openclaw-gateway') {
    extra.backend = backend as AcpBackendAll;
    extra.agentName = agentName;
    if (cliPath) extra.cliPath = cliPath;
  }

  // Gemini type uses a placeholder model (matching Guid page behavior in useGuidSend).
  // The Guid page uses currentModel || placeholderModel, so Gemini does NOT require
  // a configured model provider - it works with Google auth instead.
  const model: TProviderWithModel =
    type === 'gemini'
      ? {
          id: 'gemini-placeholder',
          name: 'Gemini',
          useModel: 'default',
          platform: 'gemini-with-google-auth' as TProviderWithModel['platform'],
          baseUrl: '',
          apiKey: '',
        }
      : ({} as TProviderWithModel);

  return { type, model, name: agentName, extra };
}

/**
 * Build ICreateConversationParams for a preset assistant.
 * Applies 4-layer fallback for reading rules and skills (BUG-1 fix).
 * Uses getLocaleKey() to convert i18n.language to standard locale format (BUG-2 fix).
 * [BUG-3 fix]: callers must invoke this inside a try block because getDefaultGeminiModel may throw.
 */
export async function buildPresetAssistantParams(agent: AvailableAgent, workspace: string, language: string): Promise<ICreateConversationParams> {
  const { customAgentId, presetAgentType = 'gemini' } = agent;

  // [BUG-2] Map raw i18n.language to standard locale key
  const localeKey = getLocaleKey(language);

  let presetContext: string | undefined;
  let skillContent: string | undefined;

  if (customAgentId) {
    // Layer 1: User-customized assistant rules
    try {
      const result = await ipcBridge.fs.readAssistantRule.invoke({
        assistantId: customAgentId,
        locale: localeKey,
      });
      if (result) presetContext = result;
    } catch (_e) {
      // No user-customized rules - fall through
    }

    // Layer 2: User-customized assistant skills
    try {
      const result = await ipcBridge.fs.readAssistantSkill.invoke({
        assistantId: customAgentId,
        locale: localeKey,
      });
      if (result) skillContent = result;
    } catch (_e) {
      // No user-customized skills - fall through
    }

    // Layer 3 & 4: Fallback for builtin assistants (builtin-*)
    // [BUG-1] Builtin assistant rules/skills are bundled with the app; user files don't exist for them.
    if (customAgentId.startsWith('builtin-')) {
      const presetId = customAgentId.replace('builtin-', '');
      const preset = ASSISTANT_PRESETS.find((p) => p.id === presetId);
      if (preset) {
        // Layer 3: Builtin rules fallback
        if (!presetContext && preset.ruleFiles) {
          try {
            const ruleFile = preset.ruleFiles[localeKey] || preset.ruleFiles['en-US'];
            if (ruleFile) {
              const result = await ipcBridge.fs.readBuiltinRule.invoke({ fileName: ruleFile });
              if (result) presetContext = result;
            }
          } catch (_e) {
            // Builtin rules not found - continue without them
          }
        }
        // Layer 4: Builtin skills fallback
        if (!skillContent && preset.skillFiles) {
          try {
            const skillFile = preset.skillFiles[localeKey] || preset.skillFiles['en-US'];
            if (skillFile) {
              const result = await ipcBridge.fs.readBuiltinSkill.invoke({ fileName: skillFile });
              if (result) skillContent = result;
            }
          } catch (_e) {
            // Builtin skills not found - continue without them
          }
        }
      }
    }
  }

  // Read enabled skills from stored config for this assistant
  const enabledSkills = await getEnabledSkillsForAssistant(customAgentId);

  const type = getConversationTypeForPreset(presetAgentType);

  const extra: ICreateConversationParams['extra'] = {
    workspace,
    customWorkspace: true,
    enabledSkills,
    presetAssistantId: customAgentId,
  };

  if (type === 'gemini') {
    // gemini uses presetRules field
    extra.presetRules = presetContext;
  } else {
    // acp uses presetContext field
    extra.presetContext = presetContext;
    if (type === 'acp') {
      extra.backend = presetAgentType as AcpBackend;
    }
  }

  const model = type === 'gemini' ? await getDefaultGeminiModel() : ({} as TProviderWithModel);

  return { type, model, name: agent.name, extra };
}
