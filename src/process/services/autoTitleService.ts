/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Auto-title service: generates a concise conversation title
 * by calling the same model via OpenAI-compatible HTTP API after the first turn.
 *
 * Supports providers with OpenAI-compatible /chat/completions endpoints
 * (e.g. openai, deepseek, qwen, moonshot, etc.). Providers that use
 * non-standard APIs (e.g. Anthropic native) are not supported and will
 * be silently skipped.
 */

import type { TProviderWithModel } from '@/common/config/storage';

/**
 * Platforms known to NOT support OpenAI-compatible /chat/completions.
 * These providers use proprietary API formats.
 */
const INCOMPATIBLE_PLATFORMS = new Set(['anthropic']);

const TITLE_PROMPT_EN =
  'Based on the following conversation, generate a concise title (10 words or fewer). Output ONLY the title text, nothing else.\n\n';

const TITLE_PROMPT_ZH = '根据以下对话内容，生成一个简洁的标题（不超过15个字）。只输出标题文本，不要输出其他内容。\n\n';

/**
 * Simple CJK detection: if the user message contains significant CJK characters,
 * use a Chinese prompt for better title quality.
 */
export function detectCjk(text: string): boolean {
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f]/g) || []).length;
  return cjkCount > text.length * 0.1;
}

/**
 * Call the model's chat completion API to generate a title.
 * Only supports OpenAI-compatible APIs.
 */
export async function generateTitle(
  provider: TProviderWithModel,
  userMessage: string,
  assistantMessage: string
): Promise<string | null> {
  try {
    const { baseUrl, useModel } = provider;
    if (!baseUrl || !useModel) return null;

    // Skip providers with incompatible API formats
    const platform = (provider as { platform?: string }).platform;
    if (platform && INCOMPATIBLE_PLATFORMS.has(platform)) {
      console.debug(`[autoTitleService] Skipping title generation: platform "${platform}" is not OpenAI-compatible`);
      return null;
    }

    const conversationSnippet = `User: ${userMessage.slice(0, 500)}\nAssistant: ${assistantMessage.slice(0, 500)}`;
    const titlePrompt = detectCjk(userMessage) ? TITLE_PROMPT_ZH : TITLE_PROMPT_EN;
    const prompt = titlePrompt + conversationSnippet;

    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (provider.apiKey) {
      headers['Authorization'] = `Bearer ${provider.apiKey}`;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: useModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 50,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.warn(`[autoTitleService] API returned ${res.status}: ${await res.text().catch(() => '')}`);
      return null;
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;

    // Clean: remove quotes, limit to 120 chars
    return raw.replace(/^["'""]+|["'""]+$/g, '').slice(0, 120);
  } catch (error) {
    console.warn('[autoTitleService] Failed to generate title:', error instanceof Error ? error.message : error);
    return null;
  }
}
