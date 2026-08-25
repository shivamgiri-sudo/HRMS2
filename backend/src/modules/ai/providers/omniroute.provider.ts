import type {
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
  AiProviderTestResult,
  SafeAiProviderConfig,
} from '../ai-provider.types.js';
import { pickConversationEntries } from '../ai-conversation.service.js';

// Self-hosted OmniRoute AI gateway (https://github.com/diegosouzapw/OmniRoute) —
// runs on the same production box as this backend, loopback-only, port 20128.
// See hrms2-omniroute-gateway memory for deployment details. OpenAI-compatible
// /v1/chat/completions, same request/response shape as OpenRouter, so this
// provider mirrors openrouter.provider.ts almost exactly.
const DEFAULT_BASE_URL = 'http://127.0.0.1:20128/v1';
// 'auto/best-chat' and friends route to reasoning models that spend their
// entire token budget on hidden reasoning_content and never emit a real
// `content` field in OmniRoute's keyless free pool — verified 2026-08-25.
// 'auto/mimo' (mimo-v2.5-free) is the one keyless route confirmed to return
// real, grounded content in that same free pool.
const DEFAULT_MODEL = 'auto/mimo';

function baseUrl(value?: string): string {
  const candidate = String(value || process.env.OMNIROUTE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return candidate;
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text?: unknown }).text ?? '') : ''))
      .join('')
      .trim();
  }
  return '';
}

export class OmniRouteProvider implements AiProvider {
  key = 'omniroute';
  displayName = 'OmniRoute Gateway';
  supportsChat = true;
  supportsJson = true;
  supportsStreaming = false;
  supportsEmbeddings = false;

  async testConnection(config: SafeAiProviderConfig): Promise<AiProviderTestResult> {
    const startedAt = Date.now();
    const model = config.modelName || process.env.OMNIROUTE_DEFAULT_MODEL || DEFAULT_MODEL;
    // Unlike OpenRouter, OmniRoute's keyless "auto" pool works with no API key
    // at all — do not fail the test just because none is configured.
    const apiKey = config.apiKey || process.env.OMNIROUTE_API_KEY;

    try {
      await this.call({
        apiKey,
        model,
        baseUrl: baseUrl(config.baseUrl),
        timeoutMs: config.timeout ?? 30_000,
        systemInstruction: 'Return exactly: connection successful',
        userQuestion: 'Test the connection.',
        context: { safe_mode: true },
        conversation: [],
        temperature: 0,
        maxOutputTokens: 24,
      });
      return { success: true, latencyMs: Date.now() - startedAt, model };
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - startedAt,
        model,
        error: error instanceof Error ? error.message : 'OmniRoute connection test failed',
      };
    }
  }

  async generateText(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const startedAt = Date.now();
    const apiKey = request.apiKey || process.env.OMNIROUTE_API_KEY;
    const model = request.model || process.env.OMNIROUTE_DEFAULT_MODEL || DEFAULT_MODEL;

    try {
      const result = await this.call({
        apiKey,
        model,
        baseUrl: DEFAULT_BASE_URL,
        timeoutMs: 30_000,
        systemInstruction: request.systemInstruction || 'You are Mira, MAS Callnet’s helpful HRMS assistant.',
        userQuestion: request.userQuestion,
        context: request.sanitizedContext,
        conversation: pickConversationEntries(request.conversation, request.conversationSummaries),
        temperature: request.temperature ?? 0.2,
        maxOutputTokens: request.maxOutputTokens ?? 800,
        responseFormat: request.responseFormat,
      });

      return {
        answer: result.answer,
        provider: this.key,
        model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: Date.now() - startedAt,
        safetyBlocked: false,
        fallbackUsed: false,
        generatedAt: new Date().toISOString(),
        sourceContexts: Array.isArray(request.sanitizedContext.source_contexts)
          ? request.sanitizedContext.source_contexts.map(String)
          : ['company_public_knowledge'],
        dataConfidence: request.sanitizedContext.data_confidence as Record<string, number> | undefined,
      };
    } catch (error) {
      console.error('[OmniRoute] Generation failed:', error instanceof Error ? error.message : error);
      return this.groundedFailure(
        startedAt,
        model,
        `I couldn't complete the approved-source request right now. Please ask a specific HRMS or MAS Callnet question and try again.`,
      );
    }
  }

  private groundedFailure(startedAt: number, model: string, answer: string): AiGenerateResponse {
    return {
      answer,
      provider: this.key,
      model,
      latencyMs: Math.max(1, Date.now() - startedAt),
      safetyBlocked: false,
      fallbackUsed: true,
      generatedAt: new Date().toISOString(),
      sourceContexts: ['approved_sources:provider_unavailable'],
      dataConfidence: { overall: 0 },
    };
  }

  private async call(input: {
    apiKey?: string;
    model: string;
    baseUrl: string;
    timeoutMs: number;
    systemInstruction: string;
    userQuestion: string;
    context: Record<string, unknown>;
    conversation?: Array<{ question: string; text: string }>;
    temperature: number;
    maxOutputTokens: number;
    responseFormat?: 'text' | 'json';
  }): Promise<{ answer: string; inputTokens?: number; outputTokens?: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(3_000, Math.min(input.timeoutMs, 60_000)));
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;

      const response = await fetch(`${input.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers,
        body: JSON.stringify({
          model: input.model,
          messages: [
            { role: 'system', content: input.systemInstruction },
            ...(input.conversation ?? []).flatMap((turn) => ([
              { role: 'user' as const, content: turn.question },
              { role: 'assistant' as const, content: turn.text },
            ])),
            {
              role: 'user',
              content: `Approved context (use only this context; do not invent facts):\n${JSON.stringify(input.context, null, 2)}\n\nQuestion: ${input.userQuestion}`,
            },
          ],
          temperature: input.temperature,
          max_tokens: input.maxOutputTokens,
          response_format: input.responseFormat === 'json' ? { type: 'json_object' } : undefined,
        }),
      });

      const payload = await response.json().catch(() => ({})) as {
        error?: { message?: string };
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      if (!response.ok) throw new Error(payload.error?.message || `OmniRoute request failed with status ${response.status}`);
      const answer = messageText(payload.choices?.[0]?.message?.content);
      if (!answer) throw new Error('OmniRoute returned an empty response');
      return { answer, inputTokens: payload.usage?.prompt_tokens, outputTokens: payload.usage?.completion_tokens };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('OmniRoute request timed out');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const omniRouteProvider = new OmniRouteProvider();
