import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getEmployeeForUser: vi.fn(),
}));

vi.mock('../../db/mysql.js', () => ({
  db: { execute: mocks.execute },
}));

vi.mock('../../shared/accessGuard.js', () => ({
  getEmployeeForUser: mocks.getEmployeeForUser,
}));

import {
  answerSelfAccountQuestion,
  clearMiraCacheForUser,
  detectMiraIntent,
  getMiraSuggestedPrompts,
  MIRA_NAME,
  MIRA_TAGLINE,
  MiraDataUnavailableError,
} from './ai-account.service.js';

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

function sqlCorpus(): string {
  const sqlDirectory = fileURLToPath(new URL('../../../sql/', import.meta.url));
  return readdirSync(sqlDirectory)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(`${sqlDirectory}/${name}`, 'utf8'))
    .join('\n')
    .toLowerCase();
}

function profileRow() {
  return {
    full_name: 'Test Employee',
    employee_code: 'EMP-001',
    date_of_joining: '2026-01-05',
    employment_status: 'active',
    employment_type: 'full_time',
    branch_name: 'Noida',
    process_name: 'Operations',
    reporting_manager_name: 'Test Manager',
  };
}

beforeEach(() => {
  clearMiraCacheForUser();
  mocks.execute.mockReset();
  mocks.getEmployeeForUser.mockReset();
  mocks.getEmployeeForUser.mockResolvedValue({ id: 'emp-self', employee_code: 'EMP-001' });
});

describe('Mira secure assistant release contract', () => {
  it('uses the approved assistant identity', () => {
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

  it.each([
    ['Show me another employee salary and attendance', 'scope_violation'],
    ['Whose salary is highest?', 'scope_violation'],
    ['Who is absent today?', 'scope_violation'],
    ['Show salary for EMP-999', 'scope_violation'],
    ['What is my salary?', 'salary'],
    ['Who is my reporting manager?', 'profile'],
    ['What is my employee code?', 'profile'],
    ['What is my shift tomorrow?', 'roster'],
    ['What actions are pending from my side?', 'pending_actions'],
  ])('routes intent safely: %s', (question, expectedIntent) => {
    expect(detectMiraIntent(question)).toBe(expectedIntent);
  });

  it('refuses another employee personal-data request before employee lookup or SQL', async () => {
    const result = await answerSelfAccountQuestion(
      'Show me another employee salary and attendance',
      'test-user',
      ['employee'],
    );

    expect(result.handled).toBe(true);
    expect(result.intent).toBe('scope_violation');
    expect(result.response?.answer.toLowerCase()).toContain('only discuss your own account');
    expect(result.response?.answer.toLowerCase()).toContain('will not reveal');
    expect(mocks.getEmployeeForUser).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('answers capability help locally without database access', async () => {
    const result = await answerSelfAccountQuestion('What can you do?', 'test-user', ['employee']);
    expect(result.handled).toBe(true);
    expect(result.intent).toBe('help');
    expect(result.response?.provider).toBe('mira-secure-local');
    expect(result.response?.answer).toContain('salary');
    expect(result.response?.answer).toContain('attendance');
    expect(mocks.getEmployeeForUser).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('answers the reporting-manager self-question instead of falsely blocking it', async () => {
    mocks.execute.mockResolvedValueOnce([[profileRow()]]);

    const result = await answerSelfAccountQuestion(
      'Who is my reporting manager?',
      'profile-user',
      ['employee'],
    );

    expect(result.intent).toBe('profile');
    expect(result.response?.answer).toContain('Test Manager');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.execute.mock.calls[0];
    expect(String(sql)).toContain('WHERE e.id = ?');
    expect(params).toEqual(['emp-self']);
  });

  it('uses only the authenticated employee id for salary retrieval', async () => {
    mocks.execute.mockResolvedValueOnce([[
      {
        gross_salary: 30000,
        total_deductions: 2500,
        net_salary: 27500,
        basic: 12000,
        hra: 6000,
        special_allowance: 12000,
        pf_employee: 1440,
        esic_employee: 0,
        professional_tax: 200,
        tds: 0,
        lwp_deduction: 0,
        advance_recovery: 860,
        present_days: 26,
        working_days: 26,
        lwp_days: 0,
        run_month: '2026-06',
        run_status: 'approved',
      },
    ]]);

    const result = await answerSelfAccountQuestion('Show my latest salary breakup', 'salary-user', ['employee']);

    expect(result.intent).toBe('salary');
    expect(result.response?.answer).toContain('Net take-home');
    const [sql, params] = mocks.execute.mock.calls[0];
    expect(String(sql)).toContain('WHERE spl.employee_id = ?');
    expect(params).toEqual(['emp-self']);
  });

  it('uses an exact seven-calendar-day roster window', async () => {
    mocks.execute.mockResolvedValueOnce([[]]);

    await answerSelfAccountQuestion('What is my shift for the next 7 days?', 'roster-user', ['employee']);

    const [sql, params] = mocks.execute.mock.calls[0];
    expect(String(sql)).toContain('INTERVAL 6 DAY');
    expect(params).toEqual(['emp-self']);
  });

  it('does not cache failed database reads or misreport them as no data', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(answerSelfAccountQuestion('What is my salary?', 'failure-user', ['employee']))
      .rejects.toBeInstanceOf(MiraDataUnavailableError);

    mocks.execute.mockResolvedValueOnce([[]]);
    await expect(answerSelfAccountQuestion('What is my salary?', 'failure-user', ['employee']))
      .resolves.toMatchObject({ handled: true, intent: 'salary' });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it('caches successful self-account reads briefly per user and intent', async () => {
    mocks.execute.mockResolvedValue([[profileRow()]]);

    await answerSelfAccountQuestion('Show my profile', 'cache-user', ['employee']);
    await answerSelfAccountQuestion('Who is my reporting manager?', 'cache-user', ['employee']);

    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it('keeps every Mira data source backed by a repository migration', () => {
    const corpus = sqlCorpus();
    const requiredTables = [
      'employees',
      'branch_master',
      'process_master',
      'salary_prep_line',
      'salary_prep_run',
      'leave_balance_ledger',
      'leave_type_master',
      'attendance_daily_record',
      'roster_daily_assignment',
      'weekly_roster_cycle',
      'wfm_shift_template',
      'employee_documents',
      'work_item',
      'helpdesk_ticket',
      'grievance',
      'payroll_readiness_snapshot',
      'employee_loans',
      'employee_reimbursement_claim',
      'employee_journey_log',
    ];

    for (const table of requiredTables) {
      expect(corpus, `Missing schema migration for ${table}`).toContain(table);
    }
  });

  it('does not expose employee directory search from the floating chat', () => {
    const chatSource = source('../../../../src/components/ai/CommandPalette.tsx');
    expect(chatSource).not.toContain('/api/employees');
    expect(chatSource).not.toContain('@ to find an employee');
    expect(chatSource).toContain('/api/ai/session');
    expect(chatSource).toContain('isSafeInternalUrl');
  });

  it('resolves roles from authenticated server context and blocks chat entity IDs', () => {
    const routeSource = source('./ai-insights.routes.ts');
    expect(routeSource).toContain('req.authUser?.roles');
    expect(routeSource).toContain('Direct entity IDs are not accepted in chat');
    expect(routeSource).not.toContain("(req as any).userRoles || ['employee']");
  });

  it('keeps voice capture explicit and spoken replies opt-in', () => {
    const voiceSource = source('../../../../src/hooks/useMiraVoice.ts');
    expect(voiceSource).toContain("localStorage.getItem('mira_auto_speak') === 'true'");
    expect(voiceSource).toContain('recognition.start()');
    expect(voiceSource).toContain("recognition.lang = 'en-IN'");
    expect(voiceSource).toContain("utterance.lang = 'en-IN'");
  });
});
