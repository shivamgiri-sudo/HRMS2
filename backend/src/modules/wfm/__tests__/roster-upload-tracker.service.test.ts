import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({ db: { execute: dbExecute } }));

import { istEpoch } from '../roster-upload-tracker.logic.js';
import { getTracker } from '../roster-upload-tracker.service.js';
import { runRosterUploadEscalation, sendManualReminder } from '../roster-upload-escalation.service.js';

const NOW = istEpoch('2026-09-21', 12); // Monday 21 Sep 2026, 12:00 IST — deadline (Sun 18:00) has passed
const NOIDA = 'b0000000-0000-0000-0000-000000000001';
const P_ONFIDO = 'c0000000-0000-0000-0000-000000000001';
const P_HOUSING = 'c0000000-0000-0000-0000-000000000002';
const secs = (d: string, h: number) => istEpoch(d, h) / 1000;

function route(sql: string, params: unknown[] = []): unknown[] {
  if (sql.includes('FROM wfm_roster_upload_alert')) {
    throw Object.assign(new Error('no table'), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });
  }
  if (sql.includes('GROUP BY e.branch_id, br.branch_name')) {
    const pairs = [
      { branch_id: NOIDA, branch_name: 'NOIDA', process_id: P_ONFIDO, process_name: 'Onfido', expected: 4 },
      { branch_id: NOIDA, branch_name: 'NOIDA', process_id: P_HOUSING, process_name: 'Housing', expected: 3 },
    ];
    // Like the real query, honour an `e.process_id = ?` filter.
    const wanted = sql.includes('e.process_id = ?') ? params.find((p) => p === P_ONFIDO || p === P_HOUSING) : undefined;
    return wanted ? pairs.filter((p) => p.process_id === wanted) : pairs;
  }
  if (sql.includes('FROM wfm_roster_import_batch b')) {
    return [
      // Onfido: fully covered by Saturday → uploaded on time
      { branch_id: NOIDA, process_id: P_ONFIDO, week_start: '2026-09-21', covered: 4, first_commit: secs('2026-09-19', 11), full_commit: secs('2026-09-19', 11) },
    ];
  }
  if (sql.includes("uas.role_key IN") && sql.includes('uas.branch_id')) {
    return [{ scope_id: NOIDA, user_id: 'u-wfm', email: 'wfm@x.in', employee_id: 'e-wfm', full_name: 'Anita Sharma' }];
  }
  if (sql.includes("uas.role_key IN") && sql.includes('uas.process_id')) {
    return [{ scope_id: P_ONFIDO, user_id: 'u-rv', email: 'rv@x.in', employee_id: 'e-rv', full_name: 'Rahul Verma' }];
  }
  if (sql.includes('COALESCE(e.reporting_manager_id, e.manager_id) AS mid')) {
    return [{ branch_id: NOIDA, process_id: P_HOUSING, mid: 'e-pn', user_id: 'u-pn', full_name: 'Priya Nair', c: 3 }];
  }
  return [];
}

beforeEach(() => {
  dbExecute.mockReset();
  dbExecute.mockImplementation(async (sql: string, params?: unknown[]) => [route(sql, params)]);
});

describe('getTracker', () => {
  it('classifies each branch × process × week from committed coverage', async () => {
    const result = await getTracker({ nowMs: NOW, weeks: 1, offset: 3 }); // window = this week only
    const rows = result.branches[0].processes;
    const onfido = rows.find((r) => r.processName === 'Onfido')!;
    const housing = rows.find((r) => r.processName === 'Housing')!;
    expect(onfido.cells[0].status).toBe('uploaded');
    expect(housing.cells[0].status).toBe('missing');
    expect(result.weeks[0].isCurrent).toBe(true);
  });

  it('names the process manager, falling back to the most common reporting manager', async () => {
    const result = await getTracker({ nowMs: NOW, weeks: 1, offset: 3 });
    const rows = result.branches[0].processes;
    expect(rows.find((r) => r.processName === 'Onfido')!.managers[0].name).toBe('Rahul Verma');
    expect(rows.find((r) => r.processName === 'Housing')!.managers[0].name).toBe('Priya Nair');
    expect(result.branches[0].wfm[0].name).toBe('Anita Sharma');
  });

  it('counts this week and next week in the summary', async () => {
    const result = await getTracker({ nowMs: NOW });
    expect(result.summary.currentWeek).toMatchObject({ uploaded: 1, missing: 1 });
    expect(result.summary.nextWeek.due).toBe(2);
  });

  it('keeps only rows with a matching status and only the chosen manager', async () => {
    const missingOnly = await getTracker({ nowMs: NOW, weeks: 1, offset: 3, status: 'missing' });
    expect(missingOnly.branches[0].processes.map((r) => r.processName)).toEqual(['Housing']);
    const byManager = await getTracker({ nowMs: NOW, weeks: 1, offset: 3, managerId: 'e-rv' });
    expect(byManager.branches[0].processes.map((r) => r.processName)).toEqual(['Onfido']);
    // manager filter narrows the counts too
    expect(byManager.summary.currentWeek).toMatchObject({ uploaded: 1, missing: 0 });
  });

  it('lists every branch, process and manager as filter options', async () => {
    const result = await getTracker({ nowMs: NOW, weeks: 1, offset: 3, status: 'missing' });
    expect(result.filters.branches).toEqual([{ id: NOIDA, name: 'NOIDA' }]);
    expect(result.filters.processes).toHaveLength(2);
    expect(result.filters.managers.map((m) => m.name)).toEqual(['Priya Nair', 'Rahul Verma']);
  });

  it('restricts a scoped viewer to their branches through the SQL', async () => {
    await getTracker({ nowMs: NOW, scope: { branchIds: [NOIDA], processIds: null } });
    const pairSql = dbExecute.mock.calls.find((c) => String(c[0]).includes('GROUP BY e.branch_id, br.branch_name'))!;
    expect(String(pairSql[0])).toContain('e.branch_id IN (?)');
    expect(pairSql[1]).toContain(NOIDA);
  });
});

describe('runRosterUploadEscalation (dry run)', () => {
  it('plans the Monday 10:00 escalation for the missing process and tells WFM, manager and skip level', async () => {
    const result = await runRosterUploadEscalation({ nowMs: NOW, dryRun: true });
    const housing = result.actions.find((a) => a.processName === 'Housing' && a.weekStart === '2026-09-21')!;
    expect(housing.stage).toBe('escalated');
    expect(housing.recipients.map((r) => r.role)).toEqual(['wfm', 'manager']); // no skip-level mapped in the fixture
    expect(result.delivered).toBe(0);
  });

  it('stays silent about a process that uploaded on time', async () => {
    const result = await runRosterUploadEscalation({ nowMs: NOW, dryRun: true });
    expect(result.actions.some((a) => a.processName === 'Onfido' && a.weekStart === '2026-09-21')).toBe(false);
  });

  it('sends nothing on a dry run — no inserts', async () => {
    await runRosterUploadEscalation({ nowMs: NOW, dryRun: true });
    expect(dbExecute.mock.calls.some((c) => String(c[0]).includes('INSERT'))).toBe(false);
  });
});

describe('sendManualReminder', () => {
  const HOUSING_WEEK = ['2026-09-21'] as const;

  it('refuses to report success when the alert table is missing (nothing was delivered)', async () => {
    dbExecute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT INTO wfm_roster_upload_alert')) {
        throw Object.assign(new Error('no table'), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });
      }
      return [route(sql, params)];
    });
    await expect(sendManualReminder(NOIDA, P_HOUSING, HOUSING_WEEK[0], NOW)).rejects.toMatchObject({ status: 503 });
  });

  it('refuses a week that is already fully uploaded', async () => {
    await expect(sendManualReminder(NOIDA, P_ONFIDO, HOUSING_WEEK[0], NOW)).rejects.toMatchObject({ status: 409 });
  });
});

describe('coverage matching', () => {
  it('matches import rows to employees by employee code, because the import leaves employee_id NULL', async () => {
    await getTracker({ nowMs: NOW, weeks: 1, offset: 3 });
    const coverageSql = String(dbExecute.mock.calls.find((c) => String(c[0]).includes('FROM wfm_roster_import_batch b'))![0]);
    expect(coverageSql).toContain('r.employee_id_raw');
    expect(coverageSql).toMatch(/e\.employee_code COLLATE utf8mb4_unicode_ci\s*=\s*c\.employee_code COLLATE utf8mb4_unicode_ci/);
    expect(coverageSql).not.toContain('r.employee_id IS NOT NULL');
  });

  it('finds uncovered employees the same way', async () => {
    dbExecute.mockImplementation(async (sql: string, params?: unknown[]) => [route(sql, params)]);
    const { getCellDetail } = await import('../roster-upload-tracker.service.js');
    await getCellDetail(NOIDA, P_HOUSING, '2026-09-21', NOW);
    const uncoveredSql = String(dbExecute.mock.calls.find((c) => String(c[0]).includes('NOT EXISTS'))![0]);
    expect(uncoveredSql).toContain('r.employee_id_raw');
    expect(uncoveredSql).not.toMatch(/r\.employee_id\s*=\s*e\.id/);
  });
});

describe('ROSTER_UPLOAD_ESCALATION_FROM_WEEK', () => {
  afterEach(() => { delete process.env.ROSTER_UPLOAD_ESCALATION_FROM_WEEK; });

  it('does not alert on weeks before the chosen first week', async () => {
    process.env.ROSTER_UPLOAD_ESCALATION_FROM_WEEK = '2026-09-28';
    const result = await runRosterUploadEscalation({ nowMs: NOW, dryRun: true }); // Mon 21 Sep: W/C 21 Sep is excluded
    expect(result.weeks).toEqual(['2026-09-28']);
    expect(result.actions).toEqual([]); // W/C 28 Sep's first stage is Friday 10:00
  });

  it('starts alerting the chosen week at its Friday reminder', async () => {
    process.env.ROSTER_UPLOAD_ESCALATION_FROM_WEEK = '2026-09-28';
    const result = await runRosterUploadEscalation({ nowMs: istEpoch('2026-09-25', 10), dryRun: true });
    expect(result.actions.every((a) => a.weekStart === '2026-09-28' && a.stage === 'reminder')).toBe(true);
    expect(result.actions.length).toBeGreaterThan(0);
  });

  it('returns nothing when every candidate week is before the first week', async () => {
    process.env.ROSTER_UPLOAD_ESCALATION_FROM_WEEK = '2027-01-04';
    const result = await runRosterUploadEscalation({ nowMs: NOW, dryRun: true });
    expect(result).toMatchObject({ weeks: [], actions: [] });
  });

  it('ignores a malformed value rather than silencing or blasting everything', async () => {
    process.env.ROSTER_UPLOAD_ESCALATION_FROM_WEEK = 'next monday';
    const result = await runRosterUploadEscalation({ nowMs: NOW, dryRun: true });
    expect(result.weeks).toEqual(['2026-09-21', '2026-09-28']);
  });
});
