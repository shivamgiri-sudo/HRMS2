import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({ db: { execute: mocks.execute } }));

import { aiAuditService } from '../ai-audit.service.js';

const request = {
  userId: 'user-self',
  roleKeys: ['employee'],
  providerKey: 'mira-secure-local',
  userQuestion: 'Show my salary',
  sanitizedContext: { data_scope: 'self_only' },
  requestSource: 'mira_self_account',
};

const response = {
  answer: 'Your salary is available.',
  provider: 'mira-secure-local',
  model: 'hrms-self-account-v1',
  latencyMs: 1,
  safetyBlocked: false,
  fallbackUsed: false,
  generatedAt: new Date().toISOString(),
};

describe('Mira audit resilience', () => {
  beforeEach(() => {
    mocks.execute.mockReset();
  });

  it('preserves the user answer when the usage audit table is unavailable', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('Table ai_provider_usage_log does not exist'));
    await expect(aiAuditService.logUsage(request, response)).resolves.toBe(0);
  });

  it('preserves the user answer when the prompt audit table is unavailable', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('Table ai_prompt_audit_log does not exist'));
    await expect(aiAuditService.logPromptAudit(request, false, [], 'summary')).resolves.toBeUndefined();
  });

  it('returns the audit id when persistence succeeds', async () => {
    mocks.execute.mockResolvedValueOnce([{ insertId: 42 }]);
    await expect(aiAuditService.logUsage(request, response)).resolves.toBe(42);
  });

  it('includes detected_intent in the INSERT when passed', async () => {
    mocks.execute.mockResolvedValueOnce([{}]);
    await aiAuditService.logPromptAudit(request, false, [], 'summary', 'howto:leave_apply');
    const [sql, params] = mocks.execute.mock.calls[0];
    expect(String(sql)).toContain('detected_intent');
    expect(params).toContain('howto:leave_apply');
  });

  it('inserts a null detected_intent when not passed (backward compatible)', async () => {
    mocks.execute.mockResolvedValueOnce([{}]);
    await aiAuditService.logPromptAudit(request, false, [], 'summary');
    const [, params] = mocks.execute.mock.calls[0];
    expect(params).toContain(null);
  });

  it('omits the provider_key clause from getProviderUsageStats when no providerKey is given', async () => {
    mocks.execute.mockResolvedValueOnce([[{ total_requests: 0 }]]);
    await aiAuditService.getProviderUsageStats();
    const [sql, params] = mocks.execute.mock.calls[0];
    expect(String(sql)).not.toContain('provider_key = ?');
    expect(params).toHaveLength(2); // from, to only — no providerKey param
  });

  it('includes the provider_key clause in getProviderUsageStats when a providerKey is given', async () => {
    mocks.execute.mockResolvedValueOnce([[{ total_requests: 0 }]]);
    await aiAuditService.getProviderUsageStats('openrouter');
    const [sql, params] = mocks.execute.mock.calls[0];
    expect(String(sql)).toContain('provider_key = ?');
    expect(params[0]).toBe('openrouter');
  });

  it('omits the provider_key clause from getTodayUsageCount/getMonthUsageCount when no providerKey is given', async () => {
    mocks.execute.mockResolvedValueOnce([[{ count: 5 }]]);
    await aiAuditService.getTodayUsageCount();
    const [sql, params] = mocks.execute.mock.calls[0];
    expect(String(sql)).not.toContain('provider_key = ?');
    expect(params).toHaveLength(1);
  });

  it('omits the provider_key clause from getTodayTokenUsage/getMonthTokenUsage when no providerKey is given', async () => {
    mocks.execute.mockResolvedValueOnce([[{ input_tokens: 0, output_tokens: 0 }]]);
    await aiAuditService.getTodayTokenUsage();
    const [sql, params] = mocks.execute.mock.calls[0];
    expect(String(sql)).not.toContain('provider_key = ?');
    expect(params).toHaveLength(1);
  });
});
