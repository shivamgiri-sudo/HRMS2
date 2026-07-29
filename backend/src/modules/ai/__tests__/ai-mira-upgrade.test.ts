import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), getEmployeeForUser: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({ db: { execute: mocks.execute } }));
vi.mock('../../../shared/accessGuard.js', () => ({ getEmployeeForUser: mocks.getEmployeeForUser }));

import { answerSelfAccountQuestion, clearMiraCacheForUser, detectMiraIntent } from '../ai-account.service.js';
import { answerCompanyQuestion, COMPANY_SYSTEM_INSTRUCTION, getPublicCompanyContext } from '../ai-company-knowledge.service.js';
import { OpenRouterProvider } from '../providers/openrouter.provider.js';

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

beforeEach(() => {
  clearMiraCacheForUser();
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
