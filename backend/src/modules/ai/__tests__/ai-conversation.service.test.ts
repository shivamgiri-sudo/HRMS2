import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearConversation,
  conversationThreadCount,
  getThread,
  isFollowUp,
  lastIntentTurn,
  pickConversationEntries,
  providerHistory,
  providerHistorySummaries,
  recordTurn,
  resolveFollowUp,
} from '../ai-conversation.service.js';

const USER = 'user-1';

beforeEach(() => clearConversation());

describe('what may leave the server', () => {
  it('never replays a self-account answer to a provider', () => {
    recordTurn(USER, {
      question: 'show my salary',
      answer: 'Your net pay is 82,000 rupees',
      intent: 'salary',
      externalSafe: false,
    });
    recordTurn(USER, { question: 'what does MAS do?', answer: 'BPO services.', externalSafe: true });

    const history = providerHistory(USER);

    expect(history).toHaveLength(1);
    expect(JSON.stringify(history)).not.toContain('82,000');
    expect(JSON.stringify(history)).not.toMatch(/salary/i);
  });

  it('still keeps the unsafe turn in process for follow-up resolution', () => {
    recordTurn(USER, { question: 'my attendance', answer: '22 present', intent: 'attendance', externalSafe: false });

    expect(getThread(USER)).toHaveLength(1);
    expect(lastIntentTurn(USER)?.intent).toBe('attendance');
    expect(providerHistory(USER)).toHaveLength(0);
  });

  it('trims a long answer before replaying it', () => {
    recordTurn(USER, { question: 'q', answer: 'x'.repeat(900), externalSafe: true });

    const [turn] = providerHistory(USER);
    expect(turn.answer.length).toBeLessThan(500);
    expect(turn.answer.endsWith('…')).toBe(true);
  });
});

describe('providerHistorySummaries', () => {
  it('includes a self-account turn as a redacted summary, never its raw answer', () => {
    recordTurn(USER, {
      question: 'show my salary',
      answer: 'Your net pay is 82,000 rupees',
      intent: 'salary',
      externalSafe: false,
      redactedSummary: 'The user previously asked about their salary or payslip; Mira answered from live HRMS data without exposing values in this shared history.',
    });

    const summaries = providerHistorySummaries(USER);

    expect(summaries).toHaveLength(1);
    expect(summaries[0].summary).not.toContain('82,000');
    expect(summaries[0].summary).not.toMatch(/\d/); // no digit at all — no value could have leaked in
    expect(summaries[0].summary).toContain('salary or payslip');
    // providerHistory() must still exclude it entirely — this feature is additive.
    expect(providerHistory(USER)).toHaveLength(0);
  });

  it('gives an external-safe turn the same trimmed answer providerHistory() would show', () => {
    recordTurn(USER, { question: 'what does MAS do?', answer: 'x'.repeat(900), externalSafe: true });

    const [summary] = providerHistorySummaries(USER);
    const [history] = providerHistory(USER);
    expect(summary.summary).toBe(history.answer);
  });

  it('falls back to a generic sentence when externalSafe is false but redactedSummary was not set', () => {
    recordTurn(USER, { question: 'my attendance', answer: '22 present', intent: 'attendance', externalSafe: false });

    const [summary] = providerHistorySummaries(USER);
    expect(summary.summary).toContain('attendance');
    expect(summary.summary).not.toContain('22');
  });

  it('keeps chronological order matching getThread()', () => {
    recordTurn(USER, { question: 'q1', answer: 'a1', externalSafe: true });
    recordTurn(USER, { question: 'q2', answer: 'a2', intent: 'leave', externalSafe: false, redactedSummary: 'about leave' });

    const summaries = providerHistorySummaries(USER);
    expect(summaries.map((s) => s.question)).toEqual(['q1', 'q2']);
  });
});

describe('pickConversationEntries', () => {
  it('prefers conversationSummaries when present', () => {
    const result = pickConversationEntries(
      [{ question: 'q', answer: 'raw answer' }],
      [{ question: 'q', summary: 'redacted summary' }],
    );
    expect(result).toEqual([{ question: 'q', text: 'redacted summary' }]);
  });

  it('falls back to conversation when conversationSummaries is absent', () => {
    const result = pickConversationEntries([{ question: 'q', answer: 'raw answer' }], undefined);
    expect(result).toEqual([{ question: 'q', text: 'raw answer' }]);
  });

  it('returns an empty array when neither is provided', () => {
    expect(pickConversationEntries(undefined, undefined)).toEqual([]);
  });
});

describe('thread housekeeping', () => {
  it('keeps only the most recent turns', () => {
    for (let i = 0; i < 10; i += 1) {
      recordTurn(USER, { question: `q${i}`, answer: `a${i}`, externalSafe: true });
    }

    const thread = getThread(USER);
    expect(thread).toHaveLength(6);
    expect(thread[0].question).toBe('q4');
    expect(thread[5].question).toBe('q9');
  });

  it('ignores an empty question', () => {
    recordTurn(USER, { question: '   ', answer: 'a', externalSafe: true });
    expect(getThread(USER)).toHaveLength(0);
  });

  it('separates users', () => {
    recordTurn(USER, { question: 'mine', answer: 'a', externalSafe: true });
    recordTurn('user-2', { question: 'theirs', answer: 'b', externalSafe: true });

    expect(getThread(USER)).toHaveLength(1);
    expect(getThread('user-2')[0].question).toBe('theirs');
    expect(conversationThreadCount()).toBe(2);
  });

  it('clears one user without touching another', () => {
    recordTurn(USER, { question: 'a', answer: 'a', externalSafe: true });
    recordTurn('user-2', { question: 'b', answer: 'b', externalSafe: true });

    clearConversation(USER);

    expect(getThread(USER)).toHaveLength(0);
    expect(getThread('user-2')).toHaveLength(1);
  });
});

describe('isFollowUp', () => {
  it.each(['and last month?', 'what about June', 'same for tomorrow', 'aur batao', 'then?'])(
    'treats %s as a follow-up',
    (question) => expect(isFollowUp(question)).toBe(true),
  );

  it.each([
    'show my attendance for today',
    'what is my leave balance',
    'coach me',
    'and what is the salary structure at MAS',
  ])('leaves %s to stand on its own', (question) => {
    expect(isFollowUp(question)).toBe(false);
  });

  it('ignores anything long enough to carry its own subject', () => {
    expect(isFollowUp(`and ${'x'.repeat(100)}`)).toBe(false);
  });
});

describe('resolveFollowUp', () => {
  const previous = { question: 'my attendance', answer: '22 present', intent: 'attendance', externalSafe: false, at: 0 };

  it('carries the previous subject across', () => {
    expect(resolveFollowUp('and last month?', previous)).toBe('attendance last month');
  });

  it('strips a leading preposition left behind', () => {
    expect(resolveFollowUp('what about for June', previous)).toBe('attendance June');
  });

  it('does nothing without a previous intent', () => {
    expect(resolveFollowUp('and last month?', null)).toBeNull();
  });

  it('does not rewrite a self-contained question', () => {
    expect(resolveFollowUp('what is my leave balance', previous)).toBeNull();
  });

  it('returns null when nothing survives the strip', () => {
    expect(resolveFollowUp('and', previous)).toBeNull();
  });
});

describe('wiring', () => {
  const source = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  it('passes only the provider-safe history into the provider request', () => {
    const routes = source('../ai-insights.routes.ts');
    expect(routes).toContain('conversation: providerHistory(userId)');
  });

  it('also passes the complete, always-safe summaries alongside it', () => {
    const routes = source('../ai-insights.routes.ts');
    expect(routes).toContain('conversationSummaries: providerHistorySummaries(userId)');
  });

  it('generates a redacted summary from intent, not from answer text, for the self-account exit', () => {
    const routes = source('../ai-insights.routes.ts');
    expect(routes).toContain('redactedSummary: describeAccountIntentForHistory(local.intent)');
  });

  it('records every exit of the ask handler', () => {
    const routes = source('../ai-insights.routes.ts');
    // The pipeline lives in askHandler; /ask and /ask/stream are thin registrations.
    const start = routes.indexOf('async function askHandler');
    // Bound the slice to this handler — later routes answer with res.json legitimately.
    const next = routes.indexOf('aiInsightsRouter.', start + 1);
    const asked = routes.slice(start, next === -1 ? undefined : next);

    expect(start).toBeGreaterThan(-1);
    expect(asked).toContain('respond(');
    // Exactly one res.json(apiSuccess(...)) — the one inside respond() itself.
    // Any second is an exit that answers without being remembered.
    const rawExits = asked.match(/return res\.json\(apiSuccess\(/g) ?? [];
    expect(rawExits).toHaveLength(1);
    expect(asked).toContain('recordTurn(userId, {');
    expect(asked).toContain('externalSafe: false, intent: local.intent');
  });

  it('marks the self-account exit as unsafe to replay externally', () => {
    const routes = source('../ai-insights.routes.ts');
    expect(routes).toContain('respond(local.response, { externalSafe: false');
  });

  it('renders the history into the Gemini prompt', () => {
    const gemini = source('../providers/gemini.provider.ts');
    expect(gemini).toContain('request.conversation');
    expect(gemini).toContain('Earlier in this conversation');
  });

  it('routes both providers through the same precedence rule instead of each reading request.conversation independently', () => {
    const gemini = source('../providers/gemini.provider.ts');
    const openrouter = source('../providers/openrouter.provider.ts');
    expect(gemini).toContain('pickConversationEntries(request.conversation, request.conversationSummaries)');
    expect(openrouter).toContain('pickConversationEntries(request.conversation, request.conversationSummaries)');
  });
});

describe('persona', () => {
  it('separates grounded facts from ordinary conversation', async () => {
    const { COMPANY_SYSTEM_INSTRUCTION } = await import('../ai-company-knowledge.service.js');

    // Facts stay strictly grounded.
    expect(COMPANY_SYSTEM_INSTRUCTION).toContain('Never invent');
    expect(COMPANY_SYSTEM_INSTRUCTION).toContain("I couldn't find that in HRMS or the approved MAS Callnet sources.");
    expect(COMPANY_SYSTEM_INSTRUCTION).toContain('Never mention a training-data date');
    expect(COMPANY_SYSTEM_INSTRUCTION).toContain('Never request or reveal another employee');

    // Conversation is explicitly exempt, and the failure mode is named.
    expect(COMPANY_SYSTEM_INSTRUCTION).toMatch(/greetings/i);
    expect(COMPANY_SYSTEM_INSTRUCTION).toMatch(/need no approved source/i);
    expect(COMPANY_SYSTEM_INSTRUCTION).toMatch(/never answer a greeting with the not-found line/i);
  });

  it('tells the provider to use earlier turns', async () => {
    const { COMPANY_SYSTEM_INSTRUCTION } = await import('../ai-company-knowledge.service.js');
    expect(COMPANY_SYSTEM_INSTRUCTION).toMatch(/earlier turns/i);
  });
});

describe('streaming', () => {
  const source = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  it('serves both /ask and /ask/stream from one pipeline', () => {
    const routes = source('../ai-insights.routes.ts');
    expect(routes).toContain("askHandler(req, res, 'json')");
    expect(routes).toContain("askHandler(req, res, 'sse')");
    // One handler, so guards and scope checks cannot drift between the two.
    expect(routes.match(/async function askHandler/g) ?? []).toHaveLength(1);
  });

  it('streams only when the caller asked and the provider can', () => {
    const routes = source('../ai-insights.routes.ts');
    expect(routes).toContain("mode === 'sse' && typeof provider.generateTextStream === 'function'");
  });

  it('reports a post-stream rejection as an event, not a status code', () => {
    const routes = source('../ai-insights.routes.ts');
    const validation = routes.slice(routes.indexOf('const responseValidation'));
    // Headers are already sent by then; res.status would throw.
    expect(validation).toContain("sseSend('error', failure)");
  });

  it('disables proxy buffering, which otherwise defeats SSE', () => {
    const routes = source('../ai-insights.routes.ts');
    expect(routes).toContain("'X-Accel-Buffering': 'no'");
  });

  it('shares one prompt builder between streamed and non-streamed answers', () => {
    const gemini = source('../providers/gemini.provider.ts');
    expect(gemini.match(/this\.buildPrompt\(request\)/g) ?? []).toHaveLength(2);
    expect(gemini).toContain('generateContentStream');
    expect(gemini).toContain('supportsStreaming = true');
  });

  it('falls back to a whole answer rather than leaving a stream half-finished', () => {
    const gemini = source('../providers/gemini.provider.ts');
    const streaming = gemini.slice(gemini.indexOf('async generateTextStream'));
    expect(streaming).toContain('return this.generateText(request)');
  });
});
