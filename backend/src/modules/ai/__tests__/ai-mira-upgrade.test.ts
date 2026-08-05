import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), getEmployeeForUser: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({ db: { execute: mocks.execute } }));
vi.mock('../../../shared/accessGuard.js', () => ({ getEmployeeForUser: mocks.getEmployeeForUser }));

import { answerSelfAccountQuestion, clearMiraCacheForUser, describeAccountIntentForHistory, detectMiraIntent } from '../ai-account.service.js';
import type { AccountIntent } from '../ai-account.service.js';
import { answerCompanyQuestion, clearCompanyKnowledgeCache, COMPANY_SYSTEM_INSTRUCTION, getPublicCompanyContext } from '../ai-company-knowledge.service.js';
import { OpenRouterProvider } from '../providers/openrouter.provider.js';

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

beforeEach(() => {
  clearMiraCacheForUser();
  clearCompanyKnowledgeCache();
  mocks.execute.mockReset();
  mocks.getEmployeeForUser.mockReset();
  mocks.getEmployeeForUser.mockResolvedValue({ id: 'employee-self', employee_code: 'EMP-001' });
  vi.unstubAllGlobals();
});

describe('Mira live grounding and OpenRouter upgrade', () => {
  it.each([
    ['meri attendance batao', 'attendance'],
    ['aaj ka punch hua?', 'attendance'],
    ['kitne din present tha last month?', 'attendance'],
    ['meri salary batao', 'salary'],
    ['kitni chhutti baki hai?', 'leave'],
    ['kal ki shift kya hai?', 'roster'],
  ])('recognises natural Indian employee questions: %s', (question, intent) => {
    expect(detectMiraIntent(question)).toBe(intent);
  });

  it('queries today attendance from the authenticated employee only', async () => {
    mocks.execute.mockResolvedValueOnce([[
      {
        present_days: 1, half_days: 0, absent_days: 0, leave_days: 0, late_marks: 0, lwp_days: 0,
        total_hours: 8.5, working_days: 1, first_clock_in: '09:31 AM', last_clock_out: '06:03 PM',
        latest_status: 'present', attendance_source: 'biometric',
      },
    ]]);
    const result = await answerSelfAccountQuestion('aaj ka punch hua?', 'user-self', ['employee']);
    expect(result.response?.answer).toContain('09:31 AM');
    expect(result.response?.answer).toContain('biometric');
    const [sql, params] = mocks.execute.mock.calls[0];
    expect(String(sql)).toContain('record_date = CURDATE()');
    expect(String(sql)).toContain('clock_in_time');
    expect(params).toEqual(['employee-self']);
  });

  it('uses the previous calendar month when requested', async () => {
    mocks.execute.mockResolvedValueOnce([[{ working_days: 0 }]]);
    await answerSelfAccountQuestion('Summarise my attendance last month', 'user-self', ['employee']);
    const [sql] = mocks.execute.mock.calls[0];
    expect(String(sql)).toContain('DATE_SUB(CURDATE(), INTERVAL 1 MONTH)');
    expect(String(sql)).toContain('LAST_DAY');
  });

  it('answers leadership from approved official company facts without a model disclaimer', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('knowledge table not migrated in this unit test'));
    const response = await answerCompanyQuestion('Who is the CEO of the company?');
    expect(response?.answer).toContain('Deepak Kashyap');
    expect(response?.answer).toContain('CEO & Co-Founder');
    expect(response?.answer.toLowerCase()).not.toContain('knowledge cutoff');
    expect(response?.sourceContexts?.join(' ')).toContain('mascallnet.ai/about');
  });

  it('answers branch heads from live HRMS assignments and exposes no contact details', async () => {
    mocks.execute.mockResolvedValueOnce([[
      { branch_name: 'Noida', city: 'Noida', state: 'Uttar Pradesh', branch_head_name: 'Branch Leader' },
    ]]);
    const response = await answerCompanyQuestion('Who is the Noida branch head?');
    expect(response?.answer).toContain('Branch Leader');
    expect(response?.answer).toContain('live HRMS organisation scope');
    expect(response?.answer).not.toContain('@');
  });

  it('documents the company-services bug and proves the fix, back to back', async () => {
    // Regression test for a real bug: 425_mira_openrouter_company_knowledge.sql
    // only ever seeded 6 of FALLBACK_FACTS's 7 rows (no 'company-services').
    // facts() does `dbFacts.length ? dbFacts : FALLBACK_FACTS` — all-or-nothing,
    // not merged — so once any DB rows exist, answerCompanyQuestion's
    // `selected.length ? selected : allFacts.filter(category === 'overview')`
    // fallback meant a "what services does MAS offer" question silently
    // answered with overview/mission content instead of services content — a
    // plausible-looking but topically wrong answer, not an obvious failure.
    // Fixed by 1076_mira_company_services_seed.sql.
    //
    // facts() caches its result for 10 minutes (module-level factCache,
    // cleared in beforeEach via clearCompanyKnowledgeCache() so this and every
    // other test starts clean). Both halves of this test share that same
    // module-level cache, so they must run in one test with fake timers
    // advancing past the TTL between them — two separate tests would
    // silently reuse the first mock's cached result for the second, which
    // would look like a pass, not catch anything.
    vi.useFakeTimers();
    try {
      mocks.execute.mockResolvedValueOnce([[
        { knowledge_key: 'company-overview', category: 'overview', title: 'Company overview', content_text: 'Overview content.', source_url: 'https://mascallnet.ai/about/' },
      ]]);
      const before = await answerCompanyQuestion('What services does MAS offer?');
      // This IS the bug: no services row -> silently answers with overview
      // content instead of a "services" answer.
      expect(before?.answer).toContain('Overview content.');

      vi.advanceTimersByTime(11 * 60_000); // past the 10-minute factCache TTL
      mocks.execute.mockResolvedValueOnce([[
        { knowledge_key: 'company-overview', category: 'overview', title: 'Company overview', content_text: 'Overview content.', source_url: 'https://mascallnet.ai/about/' },
        { knowledge_key: 'company-services', category: 'services', title: 'Services and capabilities', content_text: 'MAS Callnet provides customer support, back-office and process management services.', source_url: 'https://mascallnet.ai' },
      ]]);
      const after = await answerCompanyQuestion('What services does MAS offer?');
      expect(after?.answer).toContain('Services and capabilities');
      expect(after?.answer).toContain('back-office and process management');
      expect(after?.answer).not.toContain('Overview content.');
    } finally {
      vi.useRealTimers();
      // The cache entry set above stores expiresAt computed from the fake,
      // artificially-advanced clock — once real timers resume, that
      // timestamp would still look "not yet expired" for a long real-world
      // stretch and silently leak this test's 2-row result into whichever
      // test runs next. Clear explicitly rather than rely on the next test's
      // own beforeEach ordering relative to this cleanup.
      clearCompanyKnowledgeCache();
    }
  });

  it('builds external context from public company facts only', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('use fallback facts'));
    const context = await getPublicCompanyContext('Tell me about MAS Callnet leadership');
    const serialized = JSON.stringify(context).toLowerCase();
    expect(serialized).toContain('approved_public_company_information_only');
    expect(serialized).toContain('deepak kashyap');
    expect(serialized).not.toContain('employee_id');
    expect(serialized).not.toContain('salary');
    expect(serialized).not.toContain('aadhaar');
  });

  it('forbids memory-cutoff language in the provider instruction', () => {
    expect(COMPANY_SYSTEM_INSTRUCTION).toContain('Never mention a training-data date');
    expect(COMPANY_SYSTEM_INSTRUCTION).toContain("I couldn't find that in HRMS or the approved MAS Callnet sources.");
    expect(COMPANY_SYSTEM_INSTRUCTION).toContain('Never invent');
  });

  it('calls the official OpenRouter endpoint with app attribution and approved context', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Grounded answer' } }],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenRouterProvider();
    const response = await provider.generateText({
      userId: 'user-self', roleKeys: ['employee'], providerKey: 'openrouter', apiKey: 'test-key',
      model: 'openrouter/auto', userQuestion: 'Who is the CEO?',
      sanitizedContext: { facts: [{ content: 'Deepak Kashyap is CEO.' }], source_contexts: ['official:https://mascallnet.ai/about/'] },
      requestSource: 'copilot',
    });
    expect(response.answer).toBe('Grounded answer');
    expect(response.provider).toBe('openrouter');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer test-key');
    expect(options.headers['X-OpenRouter-Title']).toBe('MAS HRMS Mira');
    expect(String(options.body).toLowerCase()).toContain('approved context');
  });

  it('folds conversationSummaries into alternating user/assistant messages, preferring them over conversation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Follow-up answer' } }], usage: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenRouterProvider();
    await provider.generateText({
      userId: 'user-self', roleKeys: ['employee'], providerKey: 'openrouter', apiKey: 'test-key',
      userQuestion: 'and what about last month?',
      sanitizedContext: { safe_mode: true },
      requestSource: 'copilot',
      // Both present — conversationSummaries (redacted, always-safe) must win.
      conversation: [{ question: 'show my salary', answer: 'Your net pay is 82,000 rupees' }],
      conversationSummaries: [{ question: 'show my salary', summary: 'The user previously asked about their salary; Mira answered from live HRMS data without exposing values in this shared history.' }],
    });
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(options.body));
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1]).toEqual({ role: 'user', content: 'show my salary' });
    expect(body.messages[2].role).toBe('assistant');
    expect(body.messages[2].content).toContain('without exposing values');
    expect(body.messages[2].content).not.toContain('82,000');
    // Final message is still the actual question with approved context.
    expect(body.messages[3].role).toBe('user');
    expect(body.messages[3].content).toContain('and what about last month?');
  });

  it('reproduces the original 2-message payload when no conversation history is present (regression guard)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Answer' } }], usage: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenRouterProvider();
    await provider.generateText({
      userId: 'user-self', roleKeys: ['employee'], providerKey: 'openrouter', apiKey: 'test-key',
      userQuestion: 'Who is the CEO?', sanitizedContext: { safe_mode: true }, requestSource: 'copilot',
    });
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(options.body));
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
  });

  it('keeps live self-service before any external AI rate limit', () => {
    const routes = source('../ai-insights.routes.ts');
    // The argument is `routedQuestion` since follow-up resolution landed; what
    // this guards is the call order, not the variable name.
    const localIndex = routes.indexOf('answerSelfAccountQuestion(');
    const companyIndex = routes.indexOf('answerCompanyQuestion(safeQuestion');
    const rateIndex = routes.indexOf('checkAndIncrement(userId');
    expect(localIndex).toBeGreaterThan(-1);
    expect(companyIndex).toBeGreaterThan(localIndex);
    expect(rateIndex).toBeGreaterThan(companyIndex);
    expect(routes).toContain('Daily external AI request limit reached. Your live HRMS self-service answers remain available.');
  });

  it('replaces provider memory disclaimers and rule-based fallback with an approved-source response', () => {
    const routes = source('../ai-insights.routes.ts');
    expect(routes).toContain('modelDisclaimer');
    expect(routes).toContain('companyKnowledgeMissResponse()');
    expect(routes).toContain("response.fallbackUsed && response.provider === 'rule-based'");
  });

  it('returns a grounded OpenRouter failure instead of generic rule-based text', async () => {
    const provider = new OpenRouterProvider();
    const response = await provider.generateText({
      userId: 'user-self', roleKeys: ['employee'], providerKey: 'openrouter',
      userQuestion: 'Tell me about the company', sanitizedContext: { safe_mode: true }, requestSource: 'copilot',
    });
    expect(response.fallbackUsed).toBe(true);
    expect(response.provider).toBe('openrouter');
    expect(response.answer.toLowerCase()).toContain('live hrms');
    expect(response.answer.toLowerCase()).not.toContain('context analysed');
  });

  it('keeps provider creation UUID-safe, transactional and production-encrypted', () => {
    const routes = source('../ai-insights.routes.ts');
    const config = source('../ai-provider-config.service.ts');
    expect(routes).toContain('Provider is not supported by this HRMS build');
    expect(routes).toContain('activeStatus');
    expect(routes).toContain('isDefault');
    expect(config).toContain('UPDATE ai_provider_config SET is_default = FALSE WHERE provider_key != ?');
    expect(config).toContain('AI_ENCRYPTION_KEY or ENCRYPTION_KEY must be configured in production');
    expect(config).toContain('beginTransaction');
    expect(config).toContain('FOR UPDATE');
    expect(config).not.toContain('const id = (result as any).insertId');
  });

  it('registers OpenRouter, proactive briefing and company knowledge routes', () => {
    const registry = source('../ai-provider.registry.ts');
    const routes = source('../ai-insights.routes.ts');
    expect(registry).toContain('openRouterProvider');
    expect(registry).toContain('OPENROUTER_API_KEY');
    expect(routes).toContain("'/briefing'");
    expect(routes).toContain("'/company-knowledge/refresh'");
    expect(routes).toContain('getPublicCompanyContext');
    expect(routes).toContain('MiraDataUnavailableError');
  });

  it('prefers natural Indian browser voices and offers Hindi', () => {
    const voice = source('../../../../../src/hooks/useMiraVoice.ts');
    expect(voice).toContain('Neerja');
    expect(voice).toContain('Prabhat');
    expect(voice).toContain("'hi-IN'");
    expect(voice).toContain('voiceschanged');
    expect(voice).toContain("utterance.rate = language === 'hi-IN' ? 0.92 : 0.96");
  });

  it('adds OpenRouter administration and official knowledge refresh to the UI', () => {
    const settings = source('../../../../../src/pages/AIProviderSettings.tsx');
    expect(settings).toContain('OpenRouter Configuration');
    expect(settings).toContain('https://openrouter.ai/api/v1');
    expect(settings).toContain('/api/ai/company-knowledge/refresh');
    expect(settings).toContain('Personal employee data remains on the local secure path');
  });
});

describe('describeAccountIntentForHistory', () => {
  const TOPICAL_INTENTS: AccountIntent[] = [
    'coach', 'account_overview', 'profile', 'salary', 'leave', 'attendance', 'roster',
    'documents', 'pending_actions', 'support', 'payroll_readiness', 'loans', 'reimbursements', 'journey',
  ];

  it.each(TOPICAL_INTENTS)('produces a topic-only sentence for intent %s, no digits or values', (intent) => {
    const summary = describeAccountIntentForHistory(intent);
    expect(summary).toContain('The user previously asked about');
    expect(summary).toContain('without exposing values in this shared history');
    expect(summary).not.toMatch(/\d/);
  });

  it.each(['help', 'scope_violation', 'unknown'] as AccountIntent[])(
    'falls back to a generic label for non-topical intent %s',
    (intent) => {
      expect(describeAccountIntentForHistory(intent)).toContain('their HRMS account');
    },
  );
});
