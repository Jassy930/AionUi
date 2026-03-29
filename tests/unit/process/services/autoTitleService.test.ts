import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectCjk, generateTitle } from '@process/services/autoTitleService';
import type { TProviderWithModel } from '@/common/config/storage';

// ── detectCjk ───────────────────────────────────────────────────────

describe('detectCjk', () => {
  it('should return true for predominantly Chinese text', () => {
    expect(detectCjk('你好世界这是一个测试')).toBe(true);
  });

  it('should return false for pure English text', () => {
    expect(detectCjk('Hello world this is a test')).toBe(false);
  });

  it('should return true when CJK exceeds 10% threshold', () => {
    // 3 CJK out of 23 total chars ≈ 13%
    expect(detectCjk('Hello 你好世 world test')).toBe(true);
  });

  it('should return false when CJK is below 10% threshold', () => {
    // 1 CJK out of 30+ total chars < 10%
    expect(detectCjk('Hello world this is a long English text 你')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(detectCjk('')).toBe(false);
  });

  it('should detect CJK extension B characters', () => {
    // U+20000-U+2A6DF is CJK Unified Ideographs Extension B, outside our regex range
    // but U+3400-U+4DBF (Extension A) is included
    expect(detectCjk('㐀㐁㐂㐃㐄㐅㐆㐇㐈㐉')).toBe(true);
  });

  it('should detect Japanese punctuation in CJK range', () => {
    // U+3000-U+303F includes CJK symbols and punctuation
    expect(detectCjk('「テスト」（確認）')).toBe(true);
  });
});

// ── generateTitle ───────────────────────────────────────────────────

describe('generateTitle', () => {
  const mockProvider: TProviderWithModel = {
    id: 'test-provider',
    platform: 'openai',
    name: 'Test Provider',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test-key',
    model: ['gpt-4o'],
    useModel: 'gpt-4o',
  };

  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return generated title on success', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: 'Code Review Discussion' } }],
      })),
    );

    const title = await generateTitle(mockProvider, 'Review my code', 'Sure, let me look at it.');
    expect(title).toBe('Code Review Discussion');
  });

  it('should strip surrounding quotes from title', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: '"Code Review Discussion"' } }],
      })),
    );

    const title = await generateTitle(mockProvider, 'Review my code', 'Sure.');
    expect(title).toBe('Code Review Discussion');
  });

  it('should not strip smart quotes (only ASCII quotes are stripped)', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: '\u201CCode Review\u201D' } }],
      })),
    );

    const title = await generateTitle(mockProvider, 'Review my code', 'Sure.');
    expect(title).toBe('\u201CCode Review\u201D');
  });

  it('should truncate title to 120 characters', async () => {
    const longTitle = 'A'.repeat(200);
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: longTitle } }],
      })),
    );

    const title = await generateTitle(mockProvider, 'Hello', 'World');
    expect(title).toHaveLength(120);
  });

  it('should return null when baseUrl is missing', async () => {
    const provider = { ...mockProvider, baseUrl: '' };
    const title = await generateTitle(provider, 'Hello', 'World');
    expect(title).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should return null when useModel is missing', async () => {
    const provider = { ...mockProvider, useModel: '' };
    const title = await generateTitle(provider, 'Hello', 'World');
    expect(title).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should return null for anthropic platform', async () => {
    const provider = { ...mockProvider, platform: 'anthropic' };
    const title = await generateTitle(provider, 'Hello', 'World');
    expect(title).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should return null when API returns non-200 status', async () => {
    fetchSpy.mockResolvedValue(new Response('Internal Server Error', { status: 500 }));

    const title = await generateTitle(mockProvider, 'Hello', 'World');
    expect(title).toBeNull();
  });

  it('should return null when response has no choices', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ choices: [] })),
    );

    const title = await generateTitle(mockProvider, 'Hello', 'World');
    expect(title).toBeNull();
  });

  it('should return null when choice content is empty', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: '   ' } }],
      })),
    );

    const title = await generateTitle(mockProvider, 'Hello', 'World');
    expect(title).toBeNull();
  });

  it('should return null when fetch throws (e.g. timeout)', async () => {
    fetchSpy.mockRejectedValue(new Error('AbortError: timeout'));

    const title = await generateTitle(mockProvider, 'Hello', 'World');
    expect(title).toBeNull();
  });

  it('should send correct request body', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: 'Title' } }],
      })),
    );

    await generateTitle(mockProvider, 'Hello', 'World');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }),
    );

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('gpt-4o');
    expect(body.max_tokens).toBe(50);
    expect(body.temperature).toBe(0.3);
  });

  it('should include Authorization header when apiKey is present', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: 'Title' } }],
      })),
    );

    await generateTitle(mockProvider, 'Hello', 'World');

    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test-key');
  });

  it('should omit Authorization header when apiKey is empty', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: 'Title' } }],
      })),
    );

    await generateTitle({ ...mockProvider, apiKey: '' }, 'Hello', 'World');

    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('should strip trailing slash from baseUrl', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: 'Title' } }],
      })),
    );

    await generateTitle({ ...mockProvider, baseUrl: 'https://api.example.com/v1/' }, 'Hello', 'World');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.anything(),
    );
  });

  it('should use Chinese prompt for CJK user messages', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: '代码审查讨论' } }],
      })),
    );

    await generateTitle(mockProvider, '请帮我审查这段代码', '好的，让我看看。');

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const prompt = body.messages[0].content as string;
    expect(prompt).toContain('根据以下对话内容');
  });

  it('should use English prompt for non-CJK user messages', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: 'Code Review' } }],
      })),
    );

    await generateTitle(mockProvider, 'Please review my code', 'Sure.');

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const prompt = body.messages[0].content as string;
    expect(prompt).toContain('Based on the following conversation');
  });

  it('should truncate long messages to 500 chars in prompt', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: 'Title' } }],
      })),
    );

    const longMessage = 'x'.repeat(1000);
    await generateTitle(mockProvider, longMessage, longMessage);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const prompt = body.messages[0].content as string;
    // Each message should be sliced to 500, so "User: " + 500 + "\nAssistant: " + 500
    expect(prompt).not.toContain('x'.repeat(501));
  });
});
