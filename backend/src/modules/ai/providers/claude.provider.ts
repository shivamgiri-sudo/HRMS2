/**
 * Anthropic Claude provider for the Mira registry.
 *
 * WHY fetch RATHER THAN @anthropic-ai/sdk
 *   Anthropic's own guidance prefers the official SDK, and gemini.provider.ts already
 *   establishes an optional-dependency pattern here, so this is a deliberate departure with
 *   three specific reasons:
 *     1. A new dependency means editing package.json and package-lock.json and running an
 *        install, in a repository that currently has a dozen concurrent worktrees sharing one
 *        node_modules. Lockfile churn there is a real, present cost.
 *     2. Shipping the dependency without installing it would produce a provider that cannot
 *        run — the same half-shipped shape criticised for notifications, where the config and
 *        the call sites are two halves of one change.
 *     3. The surface actually needed is one POST to /v1/messages with a JSON body. No
 *        streaming, tool use, files or batching. openrouter.provider.ts is the same shape and
 *        is the closest sibling.
 *   If the SDK is adopted later, the wire contract below is what it would emit anyway.
 *
 * THREE THINGS THAT ARE 400 ERRORS ON claude-opus-5, NOT STYLE CHOICES
 *   - `temperature`, `top_p` and `top_k` are REMOVED from the API. AiGenerateRequest carries
 *     `temperature` and both sibling providers forward it, so this provider must drop it
 *     unconditionally — not "if defined". A test asserts the request body has no such key.
 *   - Assistant prefill (a trailing assistant turn) is rejected. History mapping must end on
 *     a user turn.
 *   - `thinking: {type:"enabled", budget_tokens:N}` is removed; adaptive is the only mode,
 *     and it is on by default. Depth is controlled through output_config.effort.
 *
 * `max_tokens` caps thinking AND response text together, so it is sized generously.
 */
import type {
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
  AiProviderTestResult,
  SafeAiProviderConfig,
} from '../ai-provider.types.js';
import { pickConversationEntries } from '../ai-conversation.service.js';

const OFFICIAL_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-opus-5';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Server-side fallback. Claude Opus 5 runs safety classifiers that can decline a request
 * (HTTP 200 with stop_reason "refusal"), and UAT feedback about access control or security
 * is a realistic trigger. "default" routes by refusal category rather than pinning a model,
 * so there is no fallback-model migration to own later.
 */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Pinned to the official host: an AI base URL is an exfiltration path if it is user-settable. */
function baseUrl(value?: string): string {
  const candidate = String(value || OFFICIAL_BASE_URL).replace(/\/+$/, '');
  return candidate === OFFICIAL_BASE_URL ? candidate : OFFICIAL_BASE_URL;
}

export interface ClaudeCallInput {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  systemInstruction: string;
  userQuestion: string;
  context: Record<string, unknown>;
  /** Shape returned by pickConversationEntries(): summaries and answers share `text`. */
  conversation: Array<{ question: string; text: string }>;
  maxOutputTokens: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** When supplied, the model is constrained to this JSON Schema. */
  jsonSchema?: Record<string, unknown>;
}

export interface ClaudeCallResult {
  answer: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  stopReason?: string;
  refusalCategory?: string | null;
  modelUsed?: string;
}

export class ClaudeRefusalError extends Error {
  constructor(
    readonly category: string | null,
    readonly explanation: string | null
  ) {
    super(
      `Claude declined this request${category ? ` (${category})` : ''}. ` +
        (explanation ?? 'No further detail was returned.')
    );
    this.name = 'ClaudeRefusalError';
  }
}

/**
 * Build the request body.
 *
 * Exported so tests can assert its shape without a network call — the parts that matter here
 * are the absent keys, and an absent key is only testable if the body is inspectable.
 */
export function buildClaudeRequestBody(input: ClaudeCallInput): Record<string, unknown> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const turn of input.conversation ?? []) {
    if (turn.question) messages.push({ role: 'user', content: turn.question });
    if (turn.text) messages.push({ role: 'assistant', content: turn.text });
  }

  // The volatile part goes AFTER the cache breakpoint, so the stable system prefix keeps
  // its cache entry across items. Context is serialised with sorted keys because an
  // unsorted JSON.stringify is a silent cache invalidator.
  const contextBlock = Object.keys(input.context ?? {}).length
    ? `\n\n<context>\n${stableStringify(input.context)}\n</context>`
    : '';
  messages.push({ role: 'user', content: `${input.userQuestion}${contextBlock}` });

  // Prefill is a 400 on this model: the last turn must be the user's.
  if (messages[messages.length - 1]?.role !== 'user') {
    messages.push({ role: 'user', content: 'Continue.' });
  }

  const outputConfig: Record<string, unknown> = { effort: input.effort ?? 'high' };
  if (input.jsonSchema) {
    outputConfig.format = { type: 'json_schema', schema: input.jsonSchema };
  }

  return {
    model: input.model,
    // Caps thinking + text together.
    max_tokens: input.maxOutputTokens,
    thinking: { type: 'adaptive' },
    output_config: outputConfig,
    system: [
      {
        type: 'text',
        text: input.systemInstruction,
        // Opus 5 caches from 512 tokens. The stable prefix (checklist + registry + repo map)
        // clears that comfortably; verify with usage.cache_read_input_tokens on the 2nd call.
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages,
    fallbacks: 'default',
    // NOTE: temperature / top_p / top_k are deliberately absent — 400 on claude-opus-5.
  };
}

/** Deterministic serialisation: an unsorted object is a silent prompt-cache invalidator. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.keys(v as Record<string, unknown>)
          .sort()
          .reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = (v as Record<string, unknown>)[k];
            return acc;
          }, {})
      : v
  );
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  stop_details?: { type?: string; category?: string | null; explanation?: string | null } | null;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export class ClaudeProvider implements AiProvider {
  key = 'claude';
  displayName = 'Anthropic Claude';
  supportsChat = true;
  supportsJson = true;
  supportsStreaming = false;
  supportsEmbeddings = false;

  async call(input: ClaudeCallInput): Promise<ClaudeCallResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const res = await fetch(`${input.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': input.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-beta': FALLBACK_BETA,
        },
        body: JSON.stringify(buildClaudeRequestBody(input)),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Claude API ${res.status}: ${detail.slice(0, 300)}`);
      }

      const json = (await res.json()) as AnthropicResponse;

      // stop_reason MUST be checked before touching content. A refusal returns HTTP 200 with
      // an empty (pre-output) or partial (mid-stream) content array, so indexing content[0]
      // unconditionally throws on exactly the case that most needs a clean error.
      if (json.stop_reason === 'refusal') {
        throw new ClaudeRefusalError(
          json.stop_details?.category ?? null,
          json.stop_details?.explanation ?? null
        );
      }

      const answer = (json.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('')
        .trim();

      return {
        answer,
        inputTokens: json.usage?.input_tokens,
        outputTokens: json.usage?.output_tokens,
        cacheReadTokens: json.usage?.cache_read_input_tokens,
        stopReason: json.stop_reason,
        refusalCategory: json.stop_details?.category ?? null,
        modelUsed: json.model,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection(config: SafeAiProviderConfig): Promise<AiProviderTestResult> {
    const startedAt = Date.now();
    const model = config.modelName || process.env.ANTHROPIC_DEFAULT_MODEL || DEFAULT_MODEL;
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        latencyMs: Date.now() - startedAt,
        model,
        error: 'Anthropic API key is not configured',
      };
    }
    try {
      await this.call({
        apiKey,
        model,
        baseUrl: baseUrl(config.baseUrl),
        timeoutMs: config.timeout ?? 30_000,
        systemInstruction: 'Reply with exactly: connection successful',
        userQuestion: 'Test the connection.',
        context: {},
        conversation: [],
        // Low effort for a connectivity ping: this proves the credential and the wire
        // contract, and paying for deep reasoning to do it would be silly.
        effort: 'low',
        maxOutputTokens: 64,
      });
      return { success: true, latencyMs: Date.now() - startedAt, model };
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - startedAt,
        model,
        error: error instanceof Error ? error.message : 'Claude connection test failed',
      };
    }
  }

  async generateText(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const startedAt = Date.now();
    const apiKey = request.apiKey || process.env.ANTHROPIC_API_KEY;
    const model = request.model || process.env.ANTHROPIC_DEFAULT_MODEL || DEFAULT_MODEL;
    if (!apiKey) {
      return this.groundedFailure(
        startedAt,
        model,
        'Claude is not configured. Your live HRMS and approved company answers are still available.'
      );
    }

    try {
      const result = await this.call({
        apiKey,
        model,
        baseUrl: OFFICIAL_BASE_URL,
        timeoutMs: Number(process.env.ANTHROPIC_TIMEOUT_MS ?? 300_000),
        systemInstruction:
          request.systemInstruction || 'You are Mira, MAS Callnet’s helpful HRMS assistant.',
        userQuestion: request.userQuestion,
        context: request.sanitizedContext,
        conversation: pickConversationEntries(request.conversation, request.conversationSummaries),
        // request.temperature is deliberately IGNORED — see the header note.
        maxOutputTokens: request.maxOutputTokens ?? 4000,
        effort: (process.env.ANTHROPIC_EFFORT as ClaudeCallInput['effort']) ?? 'high',
        jsonSchema: undefined,
      });

      return {
        answer: result.answer,
        provider: this.key,
        model: result.modelUsed || model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: Date.now() - startedAt,
        safetyBlocked: false,
        fallbackUsed: Boolean(result.modelUsed && result.modelUsed !== model),
        generatedAt: new Date().toISOString(),
        sourceContexts: Array.isArray(request.sanitizedContext?.source_contexts)
          ? (request.sanitizedContext.source_contexts as unknown[]).map(String)
          : ['company_public_knowledge'],
        dataConfidence: request.sanitizedContext?.data_confidence as
          | Record<string, number>
          | undefined,
      };
    } catch (error) {
      const refused = error instanceof ClaudeRefusalError;
      console.error('[Claude] Generation failed:', error instanceof Error ? error.message : error);
      return this.groundedFailure(
        startedAt,
        model,
        refused
          ? 'Claude declined to answer this one. Your live HRMS data and approved company answers are still available.'
          : 'Claude is unavailable right now. Your live HRMS data and approved company answers are still available.',
        refused
      );
    }
  }

  async generateJson<T>(request: AiGenerateRequest): Promise<T> {
    const apiKey = request.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('Anthropic API key is not configured');
    const model = request.model || process.env.ANTHROPIC_DEFAULT_MODEL || DEFAULT_MODEL;
    const schema = (request as { jsonSchema?: Record<string, unknown> }).jsonSchema;

    const result = await this.call({
      apiKey,
      model,
      baseUrl: OFFICIAL_BASE_URL,
      timeoutMs: Number(process.env.ANTHROPIC_TIMEOUT_MS ?? 300_000),
      systemInstruction: request.systemInstruction || 'Return only the requested JSON.',
      userQuestion: request.userQuestion,
      context: request.sanitizedContext,
      conversation: pickConversationEntries(request.conversation, request.conversationSummaries),
      maxOutputTokens: request.maxOutputTokens ?? 8000,
      effort: (process.env.ANTHROPIC_EFFORT as ClaudeCallInput['effort']) ?? 'high',
      jsonSchema: schema,
    });

    // output_config.format guarantees the text is valid JSON matching the schema, but a
    // truncated response (stop_reason max_tokens) is still cut mid-object, so parsing can
    // legitimately fail. Say which it was rather than surfacing a bare SyntaxError.
    try {
      return JSON.parse(result.answer) as T;
    } catch {
      throw new Error(
        result.stopReason === 'max_tokens'
          ? 'Claude response was truncated before the JSON was complete — raise max_tokens.'
          : 'Claude returned text that is not valid JSON.'
      );
    }
  }

  private groundedFailure(
    startedAt: number,
    model: string,
    message: string,
    safetyBlocked = false
  ): AiGenerateResponse {
    return {
      answer: message,
      provider: this.key,
      model,
      latencyMs: Date.now() - startedAt,
      safetyBlocked,
      fallbackUsed: true,
      generatedAt: new Date().toISOString(),
      sourceContexts: ['company_public_knowledge'],
    };
  }
}

export const claudeProvider = new ClaudeProvider();
