import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({ db: { execute: dbExecute } }));

import {
  getAttendanceMismatchBlock,
  getAttendanceMismatchDetail,
  getRosterUploadedBlock,
  getJoiningBlock,
  getFnfPendingBlock,
  getNocPendingBlock,
  getDigilockerPendingBlock,
  getEsignPendingBlock,
  getAppointmentLetterBlock,
  getOpsControlTowerSummary,
} from '../ops-control-tower.service.js';

const NOIDA = 'b0000000-0000-0000-0000-000000000001';
const AHM = 'b0000000-0000-0000-0000-000000000002';
const BRANCHES = [
  { id: NOIDA, branch_name: 'NOIDA' },
  { id: AHM, branch_name: 'AHMEDABAD-JALDARSHAN' },
];

function route(sql: string): unknown[] {
  if (sql.includes('FROM branch_master')) return BRANCHES;
  return [];
}

beforeEach(() => {
  dbExecute.mockReset();
  dbExecute.mockImplementation(async (sql: string) => [route(sql)]);
});

describe('getAttendanceMismatchBlock', () => {
  it('zero-fills a branch with no open issues and totals the rest', async () => {
    dbExecute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM branch_master')) return [BRANCHES];
      if (sql.includes('FROM attendance_reconciliation_issue')) {
        return [[{ branch_id: NOIDA, open_count: 9, last_resolved: '2026-09-18 10:00:00' }]];
      }
      return [[]];
    });
    const block = await getAttendanceMismatchBlock();
    expect(block.grandTotal).toBe(9);
    const noida = block.branches.find((b) => b.branchId === NOIDA)!;
    const ahm = block.branches.find((b) => b.branchId === AHM)!;
    expect(noida.count).toBe(9);
    expect(noida.correctionLastDateMs).not.toBeNull();
    expect(ahm.count).toBe(0);
    expect(ahm.correctionLastDateMs).toBeNull();
  });

  it('degrades to an empty block when the source table is missing, instead of throwing', async () => {
    dbExecute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM branch_master')) return [BRANCHES];
      throw Object.assign(new Error('no table'), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });
    });
    const block = await getAttendanceMismatchBlock();
    expect(block.grandTotal).toBe(0);
    expect(block.branches.every((b) => b.count === 0)).toBe(true);
  });
});

describe('getAttendanceMismatchDetail', () => {
  it('reads the branch-scoped open issues', async () => {
    dbExecute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM attendance_reconciliation_issue')) {
        return [[{ employee_id: 'e1', employee_code: 'MAS1', full_name: 'A B', issue_date: '2026-09-18', issue_type: 'missing_punch_with_usable_source', days_open: 4 }]];
      }
      return [[]];
    });
    const rows = await getAttendanceMismatchDetail(NOIDA);
    expect(rows).toEqual([{ employeeId: 'e1', employeeCode: 'MAS1', employeeName: 'A B', issueDate: '2026-09-18', issueType: 'missing_punch_with_usable_source', daysOpen: 4 }]);
  });
});

describe('getRosterUploadedBlock', () => {
  it('reports the most recent committed date per branch and flags a stale one', async () => {
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    dbExecute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM branch_master')) return [BRANCHES];
      if (sql.includes('FROM wfm_roster_import_batch')) {
        return [[{ branch_id: NOIDA, last_committed: recent }, { branch_id: AHM, last_committed: old }]];
      }
      return [[]];
    });
    const block = await getRosterUploadedBlock();
    const noida = block.branches.find((b) => b.branchId === NOIDA)!;
    const ahm = block.branches.find((b) => b.branchId === AHM)!;
    expect(noida.stale).toBe(false);
    expect(ahm.stale).toBe(true);
  });

  it('treats a branch with no upload at all as stale', async () => {
    const block = await getRosterUploadedBlock();
    expect(block.branches.every((b) => b.stale && b.lastDateMs === null)).toBe(true);
  });
});

describe('getJoiningBlock', () => {
  it('buckets joiners by days between code creation and joining date', async () => {
    dbExecute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM branch_master')) return [BRANCHES];
      if (sql.includes('FROM employees') && sql.includes('date_of_joining = ?')) {
        return [[{ branch_id: NOIDA, lag_days: 0 }, { branch_id: NOIDA, lag_days: 2 }, { branch_id: AHM, lag_days: 9 }]];
      }
      return [[]];
    });
    const block = await getJoiningBlock('2026-09-22');
    expect(block.grandTotal).toBe(3);
    const noida = block.branches.find((b) => b.branchId === NOIDA)!;
    expect(noida.total).toBe(2);
    expect(noida.buckets['Same day']).toBe(1);
    expect(noida.buckets['-2']).toBe(1);
    const ahm = block.branches.find((b) => b.branchId === AHM)!;
    expect(ahm.buckets['>5']).toBe(1);
    expect(block.grandBuckets['>5']).toBe(1);
  });
});

describe('getFnfPendingBlock', () => {
  it('counts everything not yet paid', async () => {
    dbExecute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM branch_master')) return [BRANCHES];
      if (sql.includes('FROM full_final_calculation')) {
        expect(sql).toContain("status <> 'paid'");
        return [[{ branch_id: NOIDA, n: 4 }]];
      }
      return [[]];
    });
    const block = await getFnfPendingBlock();
    expect(block.grandTotal).toBe(4);
  });
});

describe('getNocPendingBlock', () => {
  it('only counts the three open statuses, not completed/cancelled/declined', async () => {
    dbExecute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM branch_master')) return [BRANCHES];
      if (sql.includes('FROM noc_case')) {
        expect(params).toEqual(['invited', 'employee_submitted', 'in_progress']);
        return [[{ branch_id: AHM, n: 2 }]];
      }
      return [[]];
    });
    const block = await getNocPendingBlock();
    expect(block.grandTotal).toBe(2);
  });
});

describe('getDigilockerPendingBlock', () => {
  it('scopes to recently-created employee codes and counts everything not received', async () => {
    dbExecute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM branch_master')) return [BRANCHES];
      if (sql.includes('FROM ats_onboarding_bridge') && sql.includes('digilocker_status')) {
        expect(params?.[0]).toBe(30);
        return [[{ branch_id: NOIDA, n: 3 }]];
      }
      return [[]];
    });
    expect((await getDigilockerPendingBlock()).grandTotal).toBe(3);
  });
});

describe('getEsignPendingBlock (joining-kit, Day-3 SLA)', () => {
  const nowMs = Date.UTC(2026, 8, 22, 6, 0);

  it('counts only employees past Day 3 whose joining documents are not done', async () => {
    dbExecute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM branch_master')) return [BRANCHES];
      if (sql.includes('FROM ats_onboarding_bridge') && sql.includes('joining_document')) {
        return [[
          { branch_id: NOIDA, employee_id: 'e1', created_at: '2026-09-15 09:00:00', done_at: null }, // 7 days old, overdue
          { branch_id: NOIDA, employee_id: 'e2', created_at: '2026-09-21 09:00:00', done_at: null }, // 1 day old, due
          { branch_id: AHM, employee_id: 'e3', created_at: '2026-09-10 09:00:00', done_at: '2026-09-12 09:00:00' }, // done on time
        ]];
      }
      return [[]];
    });
    const block = await getEsignPendingBlock(nowMs);
    expect(block.grandTotal).toBe(1);
    expect(block.branches.find((b) => b.branchId === NOIDA)!.count).toBe(1);
    expect(block.branches.find((b) => b.branchId === AHM)!.count).toBe(0);
  });
});

describe('getAppointmentLetterBlock (Day-7 SLA)', () => {
  const nowMs = Date.UTC(2026, 8, 22, 6, 0);

  it('counts only employees past the Day-7 SLA with nothing signed', async () => {
    dbExecute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM branch_master')) return [BRANCHES];
      if (sql.includes('FROM employees') && sql.includes('appointment_letter_issue')) {
        return [[
          { branch_id: NOIDA, employee_id: 'e1', created_at: '2026-09-10 09:00:00', done_at: null }, // 12 days old, overdue
          { branch_id: NOIDA, employee_id: 'e2', created_at: '2026-09-20 09:00:00', done_at: null }, // 2 days old, due
          { branch_id: AHM, employee_id: 'e3', created_at: '2026-09-01 09:00:00', done_at: '2026-09-05 09:00:00' }, // signed on time
        ]];
      }
      return [[]];
    });
    const block = await getAppointmentLetterBlock(nowMs);
    expect(block.grandTotal).toBe(1);
    expect(block.branches.find((b) => b.branchId === NOIDA)!.count).toBe(1);
    expect(block.branches.find((b) => b.branchId === AHM)!.count).toBe(0);
  });
});

describe('getOpsControlTowerSummary', () => {
  it('assembles all eight blocks', async () => {
    const summary = await getOpsControlTowerSummary('2026-09-22', Date.UTC(2026, 8, 22));
    expect(summary.esignSlaDays).toBe(3);
    expect(summary.appointmentLetterSlaDays).toBe(7);
    expect(summary).toHaveProperty('attendanceMismatch');
    expect(summary).toHaveProperty('rosterUploaded');
    expect(summary).toHaveProperty('joining');
    expect(summary).toHaveProperty('fnfPending');
    expect(summary).toHaveProperty('nocPending');
    expect(summary).toHaveProperty('digilockerPending');
    expect(summary).toHaveProperty('esignPending');
    expect(summary).toHaveProperty('appointmentLetter');
  });
});
