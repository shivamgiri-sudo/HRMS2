import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearConversation,
  conversationThreadCount,
  getThread,
  isFollowUp,
  lastIntentTurn,
  providerHistory,
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

  it('records every exit of the ask handler', () => {
    const routes = source('../ai-insights.routes.ts');
    const start = routes.indexOf("aiInsightsRouter.post('/ask'");
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
});
