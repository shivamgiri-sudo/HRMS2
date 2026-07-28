import type {
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
  AiProviderTestResult,
  SafeAiProviderConfig,
} from '../ai-provider.types.js';
import { ruleBasedProvider } from './ruleBased.provider.js';

const OFFICIAL_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openrouter/auto';

function baseUrl(value?: string): string {
  const candidate = String(value || OFFICIAL_BASE_URL).replace(/\/+$/, '');
  return candidate === OFFICIAL_BASE_URL ? candidate : OFFICIAL_BASE_URL;
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

export class OpenRouterProvider implements AiProvider {
  key = 'openrouter';
  displayName = 'OpenRouter';
  supportsChat = true;
  supportsJson = true;
  supportsStreaming = false;
  supportsEmbeddings = false;

  async testConnection(config: SafeAiProviderConfig): Promise<AiProviderTestResult> {
    const startedAt = Date.now();
    const model = config.modelName || process.env.OPENROUTER_DEFAULT_MODEL || DEFAULT_MODEL;
    const apiKey = config.apiKey || process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return { success: false, latencyMs: Date.now() - startedAt, model, error: 'OpenRouter API key is not configured' };
    }

    try {
      await this.call({
        apiKey,
        model,
        baseUrl: baseUrl(config.baseUrl),
        timeoutMs: config.timeout ?? 30_000,
        systemInstruction: 'Return exactly: connection successful',
        userQuestion: 'Test the connection.',
        context: { safe_mode: true },
        temperature: 0,
        maxOutputTokens: 24,
      });
      return { success: true, latencyMs: Date.now() - startedAt, model };
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - startedAt,
        model,
        error: error instanceof Error ? error.message : 'OpenRouter connection test failed',
      };
    }
  }

  async generateText(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const startedAt = Date.now();
    const apiKey = request.apiKey || process.env.OPENROUTER_API_KEY;
    const model = request.model || process.env.OPENROUTER_DEFAULT_MODEL || DEFAULT_MODEL;
    if (!apiKey) {
      const fallback = await ruleBasedProvider.generateText(request);
      return { ...fallback, fallbackUsed: true };
    }

    try {
      const result = await this.call({
        apiKey,
        model,
        baseUrl: OFFICIAL_BASE_URL,
        timeoutMs: 30_000,
        systemInstruction: request.systemInstruction || 'You are Mira, MAS Callnet’s helpful HRMS assistant.',
        userQuestion: request.userQuestion,
        context: request.sanitizedContext,
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
      console.error('[OpenRouter] Generation failed:', error instanceof Error ? error.message : error);
      const fallback = await ruleBasedProvider.generateText(request);
      return { ...fallback, fallbackUsed: true };
    }
  }

  private async call(input: {
    apiKey: string;
    model: string;
    baseUrl: string;
    timeoutMs: number;
    systemInstruction: string;
    userQuestion: string;
    context: Record<string, unknown>;
    temperature: number;
    maxOutputTokens: number;
    responseFormat?: 'text' | 'json';
  }): Promise<{ answer: string; inputTokens?: number; outputTokens?: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(3_000, Math.min(input.timeoutMs, 60_000)));
    try {
      const response = await fetch(`${input.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://mascallnet.ai',
          'X-OpenRouter-Title': process.env.OPENROUTER_APP_NAME || 'MAS HRMS Mira',
        },
        body: JSON.stringify({
          model: input.model,
          messages: [
            { role: 'system', content: input.systemInstruction },
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
      if (!response.ok) throw new Error(payload.error?.message || `OpenRouter request failed with status ${response.status}`);
      const answer = messageText(payload.choices?.[0]?.message?.content);
      if (!answer) throw new Error('OpenRouter returned an empty response');
      return { answer, inputTokens: payload.usage?.prompt_tokens, outputTokens: payload.usage?.completion_tokens };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('OpenRouter request timed out');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const openRouterProvider = new OpenRouterProvider();
