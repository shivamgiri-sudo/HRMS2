import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  answerSelfAccountQuestion,
  getMiraSuggestedPrompts,
  MIRA_NAME,
  MIRA_TAGLINE,
} from './ai-account.service.js';

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

describe('Mira secure assistant contract', () => {
  it('uses the new assistant identity', () => {
    expect(MIRA_NAME).toBe('Mira');
    expect(MIRA_TAGLINE.toLowerCase()).toContain('private');
  });

  it('offers broad self-account prompts without cross-employee prompts', () => {
    const prompts = getMiraSuggestedPrompts();
    expect(prompts.length).toBeGreaterThanOrEqual(6);
    expect(prompts.join(' ').toLowerCase()).toContain('salary');
    expect(prompts.join(' ').toLowerCase()).toContain('attendance');
    expect(prompts.join(' ').toLowerCase()).not.toContain('which employees');
  });

  it('refuses another employee personal-data request before any employee lookup', async () => {
    const result = await answerSelfAccountQuestion(
      'Show me another employee salary and attendance',
      'test-user',
      ['employee'],
    );

    expect(result.handled).toBe(true);
    expect(result.intent).toBe('scope_violation');
    expect(result.response?.answer.toLowerCase()).toContain('only discuss your own account');
    expect(result.response?.answer.toLowerCase()).toContain('will not reveal');
  });

  it('answers capability help locally without database access', async () => {
    const result = await answerSelfAccountQuestion('What can you do?', 'test-user', ['employee']);
    expect(result.handled).toBe(true);
    expect(result.intent).toBe('help');
    expect(result.response?.provider).toBe('mira-secure-local');
    expect(result.response?.answer).toContain('salary');
    expect(result.response?.answer).toContain('attendance');
  });

  it('does not expose employee directory search from the floating chat', () => {
    const chatSource = source('../../../../src/components/ai/CommandPalette.tsx');
    expect(chatSource).not.toContain('/api/employees');
    expect(chatSource).not.toContain('@ to find an employee');
    expect(chatSource).toContain('/api/ai/session');
  });

  it('resolves roles from authenticated server context and blocks chat entity IDs', () => {
    const routeSource = source('./ai-insights.routes.ts');
    expect(routeSource).toContain('req.authUser?.roles');
    expect(routeSource).toContain('Direct entity IDs are not accepted in chat');
    expect(routeSource).not.toContain("(req as any).userRoles || ['employee']");
  });
});
