/**
 * The Claude provider's wire contract.
 *
 * Most of these assert the ABSENCE of something. That is deliberate: `temperature`, `top_p`
 * and `top_k` are rejected with a 400 by claude-opus-5, and both sibling providers in this
 * registry forward `temperature` straight through from AiGenerateRequest. The failure mode is
 * a provider that works in every unit test and 400s on its first real call, so the absence is
 * what needs a test, not the presence.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildClaudeRequestBody,
  ClaudeProvider,
  ClaudeRefusalError,
  stableStringify,
  type ClaudeCallInput,
} from "../claude.provider.js";

function input(overrides: Partial<ClaudeCallInput> = {}): ClaudeCallInput {
  return {
    apiKey: "sk-test",
    model: "claude-opus-5",
    baseUrl: "https://api.anthropic.com",
    timeoutMs: 5000,
    systemInstruction: "You are a validator.",
    userQuestion: "Assess this item.",
    context: {},
    conversation: [],
    maxOutputTokens: 4000,
    ...overrides,
  };
}

describe("request body", () => {
  it("contains no temperature, top_p or top_k — all 400 on claude-opus-5", () => {
    const body = buildClaudeRequestBody(input());
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("top_k");
    // Also assert on the serialised form: a key nested anywhere would still be rejected.
    expect(JSON.stringify(body)).not.toMatch(/"(temperature|top_p|top_k)"/);
  });

  it("uses adaptive thinking, not the removed budget_tokens form", () => {
    const body = buildClaudeRequestBody(input()) as { thinking: { type: string } };
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(JSON.stringify(body)).not.toMatch(/budget_tokens/);
  });

  it("puts cache_control on the system block", () => {
    const body = buildClaudeRequestBody(input()) as {
      system: Array<{ type: string; text: string; cache_control?: { type: string } }>;
    };
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.system[0].text).toBe("You are a validator.");
  });

  it("passes a json_schema through output_config.format when one is supplied", () => {
    const schema = { type: "object", properties: { ok: { type: "boolean" } } };
    const body = buildClaudeRequestBody(input({ jsonSchema: schema, effort: "high" })) as {
      output_config: { effort: string; format?: { type: string; schema: unknown } };
    };
    expect(body.output_config.effort).toBe("high");
    expect(body.output_config.format).toEqual({ type: "json_schema", schema });
  });

  it("omits format entirely when no schema is supplied", () => {
    const body = buildClaudeRequestBody(input()) as { output_config: Record<string, unknown> };
    expect(body.output_config).not.toHaveProperty("format");
  });

  it("always ends on a user turn — a trailing assistant turn is a 400", () => {
    const body = buildClaudeRequestBody(
      input({
        conversation: [
          { question: "first?", text: "first answer" },
          { question: "second?", text: "second answer" },
        ],
      })
    ) as { messages: Array<{ role: string; content: string }> };

    expect(body.messages[body.messages.length - 1].role).toBe("user");
    // And the assistant turns are still present in order — no prefill, but no data loss.
    expect(body.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
  });

  it("appends context after the question so the cached system prefix stays stable", () => {
    const body = buildClaudeRequestBody(input({ context: { b: 2, a: 1 } })) as {
      messages: Array<{ content: string }>;
      system: Array<{ text: string }>;
    };
    const last = body.messages[body.messages.length - 1].content;
    expect(last).toContain("Assess this item.");
    expect(last).toContain("<context>");
    // The system block must not have absorbed anything volatile.
    expect(body.system[0].text).not.toContain("<context>");
  });

  it("opts into server-side fallbacks", () => {
    expect(buildClaudeRequestBody(input())).toMatchObject({ fallbacks: "default" });
  });
});

describe("stableStringify", () => {
  it("produces identical output for objects that differ only in key order", () => {
    // An unsorted JSON.stringify above the cache breakpoint silently invalidates the prompt
    // cache on every call, which is invisible except as a bill.
    expect(stableStringify({ a: 1, b: { y: 2, x: 3 } })).toBe(
      stableStringify({ b: { x: 3, y: 2 }, a: 1 })
    );
  });

  it("does not reorder arrays, whose order is meaningful", () => {
    expect(stableStringify({ xs: [3, 1, 2] })).toBe('{"xs":[3,1,2]}');
  });
});

describe("call()", () => {
  const okResponse = (over: Record<string, unknown> = {}) =>
    ({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "hello" }],
        stop_reason: "end_turn",
        model: "claude-opus-5",
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900 },
        ...over,
      }),
    }) as unknown as Response;

  it("sends the documented headers", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await new ClaudeProvider().call(input());

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
    vi.unstubAllGlobals();
  });

  it("surfaces cache reads so prompt-cache health is observable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse()));
    const result = await new ClaudeProvider().call(input());
    expect(result.cacheReadTokens).toBe(900);
    expect(result.inputTokens).toBe(10);
    vi.unstubAllGlobals();
  });

  it("throws a typed refusal BEFORE reading content", async () => {
    // A refusal returns HTTP 200 with an empty content array. Indexing content[0] before
    // checking stop_reason throws a TypeError on exactly the case that most needs a clean,
    // attributable error.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse({
          content: [],
          stop_reason: "refusal",
          stop_details: { type: "refusal", category: "harmful_content", explanation: "no" },
        })
      )
    );

    const err = await new ClaudeProvider().call(input()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClaudeRefusalError);
    expect((err as ClaudeRefusalError).category).toBe("harmful_content");
    vi.unstubAllGlobals();
  });

  it("does not silently return a default object on a refusal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse({ content: [], stop_reason: "refusal" }))
    );
    await expect(new ClaudeProvider().call(input())).rejects.toThrow(ClaudeRefusalError);
    vi.unstubAllGlobals();
  });

  it("raises the HTTP status on a non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({ ok: false, status: 400, text: async () => "temperature: unsupported" }) as unknown as Response
      )
    );
    await expect(new ClaudeProvider().call(input())).rejects.toThrow(/Claude API 400/);
    vi.unstubAllGlobals();
  });
});

describe("generateText()", () => {
  it("never forwards request.temperature, even when the caller sets one", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({
            content: [{ type: "text", text: "ok" }],
            stop_reason: "end_turn",
            model: "claude-opus-5",
            usage: {},
          }),
        }) as unknown as Response
    );
    vi.stubGlobal("fetch", fetchMock);

    await new ClaudeProvider().generateText({
      userQuestion: "hi",
      systemInstruction: "sys",
      sanitizedContext: {},
      // AiGenerateRequest carries this field and the sibling providers forward it.
      temperature: 0.7,
      apiKey: "sk-test",
      model: "claude-opus-5",
    } as never);

    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).not.toHaveProperty("temperature");
    vi.unstubAllGlobals();
  });

  it("returns a grounded message rather than throwing when no key is configured", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const res = await new ClaudeProvider().generateText({
      userQuestion: "hi",
      sanitizedContext: {},
    } as never);
    expect(res.fallbackUsed).toBe(true);
    expect(res.answer).toMatch(/not configured/i);
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
  });
});
