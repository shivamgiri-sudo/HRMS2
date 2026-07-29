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
});
