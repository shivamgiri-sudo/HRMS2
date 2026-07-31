/**
 * Payroll notification wiring — the strictest group.
 *
 * Payroll is where a wrong recipient is a data-leak incident rather than a bug, so the
 * cases below are the ones that would actually cause harm: a payslip carrying a CC, a
 * financial mail falling back to a personal address, or a CEO copy firing on a run that
 * never crossed the threshold.
 *
 * The first two are enforced by the resolver (tested in recipient-resolver.test.ts) — what
 * is pinned here is that this module feeds it the right sensitivity and the right amount.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/mysql.js', () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]), query: vi.fn().mockResolvedValue([[], []]) },
  pingDb: vi.fn(),
}));
vi.mock('../src/modules/communication/notification.gateway.js', () => ({
  notificationGateway: { notify: vi.fn().mockResolvedValue({ outcome: 'shadow' }) },
}));

import { notifyPayrollRunStatus, notifyPayslipsReady } from '../src/modules/payroll/payroll.notifications.js';
import { notificationGateway } from '../src/modules/communication/notification.gateway.js';
import { db } from '../src/db/mysql.js';

const notify = () => notificationGateway.notify as ReturnType<typeof vi.fn>;
const sent = () => notify().mock.calls[0][0];
const exec = () => db.execute as ReturnType<typeof vi.fn>;

const run = (over: Record<string, unknown> = {}) => ({
  id: 'run-1', run_month: '2026-08', branch_id: 'br-1',
  total_employees: 400, total_gross: 9_000_000, total_deductions: 1_200_000, total_net: 7_800_000, ...over,
});

const line = (n: number, over: Record<string, unknown> = {}) => ({
  employee_id: `emp-${n}`, employee_code: `MAS00${n}`,
  net_salary: 48250, gross_salary: 55000, lwp_days: 0, branch_id: 'br-1', ...over,
});

function mockFlow(opts: { run?: Record<string, unknown> | null; prior?: Record<string, unknown>[]; lines?: Record<string, unknown>[] }) {
  exec().mockReset();
  exec().mockImplementation(async (sql: string) => {
    if (/FROM salary_prep_run WHERE id/i.test(sql)) return [opts.run === null ? [] : [opts.run ?? run()], []];
    if (/run_month < \?/i.test(sql)) return [opts.prior ?? [], []];
    if (/FROM salary_prep_line/i.test(sql)) return [opts.lines ?? [], []];
    return [[], []];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  notify().mockResolvedValue({ outcome: 'shadow' });
});

describe('run status mapping', () => {
  it.each([
    ['calculated', 'payroll_run_calculated'],
    ['under_review', 'payroll_run_under_review'],
    ['approved', 'payroll_run_approved'],
    ['locked', 'payroll_run_locked'],
  ])('maps %s to %s', async (status, event) => {
    mockFlow({});
    await notifyPayrollRunStatus('run-1', status);
    expect(sent().eventCode).toBe(event);
  });

  it.each(['draft', 'calculating', 'cancelled'])('does not notify on %s', async (status) => {
    mockFlow({});
    await notifyPayrollRunStatus('run-1', status);
    expect(notify()).not.toHaveBeenCalled();
  });

  it('does not send a run-level notification on disbursed — that fans out to payslips', async () => {
    mockFlow({});
    await notifyPayrollRunStatus('run-1', 'disbursed');
    expect(notify()).not.toHaveBeenCalled();
  });
});

describe('the CEO threshold', () => {
  it('passes the real net total as the conditional amount', async () => {
    mockFlow({ run: run({ total_net: 6_200_000 }) });
    await notifyPayrollRunStatus('run-1', 'approved');
    expect(sent().context.vars).toEqual({ amount: 6_200_000 });
  });

  it('passes a below-threshold amount unchanged — the resolver decides, not this module', async () => {
    mockFlow({ run: run({ total_net: 4_000_000 }) });
    await notifyPayrollRunStatus('run-1', 'approved');
    expect(sent().context.vars.amount).toBe(4_000_000);
  });

  it('sends 0 rather than undefined when the total is missing, so the CEO is not copied by accident', async () => {
    mockFlow({ run: run({ total_net: null }) });
    await notifyPayrollRunStatus('run-1', 'approved');
    expect(sent().context.vars.amount).toBe(0);
  });
});

describe('run analytics', () => {
  it('carries headcount, gross and net', async () => {
    mockFlow({});
    await notifyPayrollRunStatus('run-1', 'approved');
    expect(sent().data).toMatchObject({ headcount: 400, total_gross: 9_000_000, total_net: 7_800_000 });
  });

  it('computes variance against the prior comparable run', async () => {
    mockFlow({ prior: [{ run_month: '2026-07', total_net: 7_600_000 }] });
    await notifyPayrollRunStatus('run-1', 'approved');
    expect(sent().data).toMatchObject({ variance_vs_prior: 200_000, prior_month: '2026-07' });
  });

  it('reports null variance — not 0 — for a first run with no prior', async () => {
    mockFlow({ prior: [] });
    await notifyPayrollRunStatus('run-1', 'approved');
    expect(sent().data.variance_vs_prior).toBeNull();
    expect(sent().data.prior_month).toBeNull();
  });

  it('only compares against runs that actually reached approval', async () => {
    mockFlow({});
    await notifyPayrollRunStatus('run-1', 'approved');
    const sql = exec().mock.calls.map((c) => String(c[0])).find((s) => /run_month < \?/.test(s))!;
    expect(sql).toMatch(/status IN \('approved','locked','disbursed'\)/);
  });
});

describe('payslip fan-out', () => {
  it('notifies once per employee with their own figures', async () => {
    mockFlow({ lines: [line(1), line(2, { net_salary: 51000, lwp_days: 1.5 })] });
    const r = await notifyPayslipsReady('run-1');
    expect(r).toMatchObject({ employees: 2, notified: 2, skipped: 0 });
    const datas = notify().mock.calls.map((c) => c[0].data);
    expect(datas[0]).toMatchObject({ net_pay: 48250, lop_days: 0 });
    expect(datas[1]).toMatchObject({ net_pay: 51000, lop_days: 1.5 });
  });

  it('uses a per-employee dedupe key so a re-run cannot double-send a payslip', async () => {
    mockFlow({ lines: [line(1), line(2)] });
    await notifyPayslipsReady('run-1');
    const keys = notify().mock.calls.map((c) => c[0].dedupeKey);
    expect(keys).toEqual([
      'salary_prep_run:run-1:payslip:emp-1',
      'salary_prep_run:run-1:payslip:emp-2',
    ]);
  });

  it('never names a CC — a payslip may not be copied to anyone', async () => {
    mockFlow({ lines: [line(1)] });
    await notifyPayslipsReady('run-1');
    expect(sent()).not.toHaveProperty('specOverride');
    // recipients come from the registry, which seeds payslip_ready with an empty cc;
    // the resolver throws if that ever changes.
    expect(sent().eventCode).toBe('payslip_ready');
  });

  it('keeps going when one employee fails', async () => {
    mockFlow({ lines: [line(1), line(2), line(3)] });
    notify()
      .mockResolvedValueOnce({ outcome: 'shadow' })
      .mockRejectedValueOnce(new Error('no official email'))
      .mockResolvedValueOnce({ outcome: 'shadow' });
    const r = await notifyPayslipsReady('run-1');
    expect(r).toMatchObject({ employees: 3, notified: 2, skipped: 1 });
  });

  it('counts an undeliverable employee as skipped rather than silently succeeding', async () => {
    mockFlow({ lines: [line(1)] });
    notify().mockResolvedValueOnce({ outcome: 'undeliverable' });
    const r = await notifyPayslipsReady('run-1');
    expect(r).toMatchObject({ notified: 0, skipped: 1 });
  });

  it('does nothing when the run does not exist', async () => {
    mockFlow({ run: null });
    const r = await notifyPayslipsReady('gone');
    expect(notify()).not.toHaveBeenCalled();
    expect(r.employees).toBe(0);
  });
});
