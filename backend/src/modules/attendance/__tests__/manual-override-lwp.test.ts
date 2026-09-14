import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * Approving a status change must never write NULL into attendance_daily_record.lwp_value.
 *
 * The column is NOT NULL. The approve path derived the new value from a three-entry map
 * (present / half_day / absent) and fell through to `?? null` for everything else, so
 * changing a day to Leave, Holiday, Week Off, Week Off (Worked) or Missing Punch died with
 * ER_BAD_NULL_ERROR. The request 500'd, the override was left 'pending' and the day never
 * moved — reported live on 2026-09-03, the first real use this API has ever had (the table
 * held exactly one row, and it was the failed attempt).
 *
 * The map now covers every status the ENUM allows, with the values production actually
 * holds; missing_punch is the deliberate exception and keeps the day's existing value,
 * because whether an unresolved punch is unpaid is a policy call rather than a derivation.
 */

vi.mock('../../../middleware/authMiddleware.js', () => ({
  requireAuth: (req: any, _res: express.Response, next: express.NextFunction) => {
    req.authUser = { id: 'payroll-head-user', role: 'payroll_head', roles: ['payroll_head'] };
    next();
  },
  requireWriteAccess: (_req: any, _res: express.Response, next: express.NextFunction) => next(),
}));

const mocks = vi.hoisted(() => ({ execute: vi.fn(), hasAnyRole: vi.fn(), logSensitiveAction: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({ db: { execute: mocks.execute } }));
vi.mock('../../../shared/scopeAccess.js', () => ({ hasAnyRole: mocks.hasAnyRole }));
vi.mock('../../../shared/auditLog.js', () => ({ logSensitiveAction: mocks.logSensitiveAction }));

/** The pending override under approval, plus the attendance row it targets. */
function wireDb(newStatus: string, currentLwp: string | null = '0.00') {
  mocks.execute.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM attendance_manual_override amo')) {
      return [[{
        id: 'ovr-1', employee_id: 'emp-1', attendance_date: '2026-08-31',
        old_status: 'present', new_status: newStatus, old_lwp: 0, new_lwp: null,
        reason: 'Change the status to Leave', approval_status: 'pending',
        is_payroll_month_locked: 0, higher_approval_required: 0, payroll_month: '2026-08',
        employee_code: 'MAS47905',
      }]];
    }
    if (sql.includes('FROM attendance_daily_record')) {
      return [[{ id: 'adr-1', attendance_status: 'present', lwp_value: currentLwp, is_locked: 1 }]];
    }
    return [{ affectedRows: 1 }];
  });
}

/** The lwp_value bound to the UPDATE that writes attendance_daily_record. */
function writtenLwp(): unknown {
  const call = mocks.execute.mock.calls.find(
    ([sql]) => String(sql).includes('UPDATE attendance_daily_record')
  );
  return call ? (call[1] as unknown[])[1] : undefined;
}

async function approve() {
  const { attendanceManualOverrideRouter } = await import('../attendance.manual-override.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/attendance', attendanceManualOverrideRouter);
  return request(app).post('/api/attendance/manual-overrides/ovr-1/approve').send({});
}

describe('manual attendance override — LWP on approve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.hasAnyRole.mockImplementation(async (_id: string, ...roles: string[]) =>
      roles.includes('payroll_head'));
  });

  it.each([
    ['leave_approved', 0],
    ['holiday', 0],
    ['week_off', 0],
    ['week_off_worked', 0],
    ['present', 0],
    ['half_day', 0.5],
    ['absent', 1],
  ])('writes a real number for %s, never NULL', async (status, expected) => {
    wireDb(String(status));
    const res = await approve();

    expect(res.status).toBe(200);
    const lwp = writtenLwp();
    expect(lwp).not.toBeNull();
    expect(Number(lwp)).toBe(expected);
  });

  it("keeps the day's existing LWP for missing_punch, which is a policy call", async () => {
    wireDb('missing_punch', '1.00');
    const res = await approve();

    expect(res.status).toBe(200);
    expect(Number(writtenLwp())).toBe(1);
  });

  it('falls back to 0 rather than NULL when the day carries no LWP at all', async () => {
    wireDb('missing_punch', null);
    const res = await approve();

    expect(res.status).toBe(200);
    expect(writtenLwp()).not.toBeNull();
    expect(Number(writtenLwp())).toBe(0);
  });

  it('still honours an explicitly supplied new_lwp', async () => {
    mocks.execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM attendance_manual_override amo')) {
        return [[{
          id: 'ovr-1', employee_id: 'emp-1', attendance_date: '2026-08-31',
          old_status: 'present', new_status: 'leave_approved', new_lwp: 0.5,
          reason: 'Half a day of unpaid leave', approval_status: 'pending',
          is_payroll_month_locked: 0, higher_approval_required: 0,
        }]];
      }
      if (sql.includes('FROM attendance_daily_record')) {
        return [[{ id: 'adr-1', attendance_status: 'present', lwp_value: '0.00', is_locked: 0 }]];
      }
      return [{ affectedRows: 1 }];
    });

    const res = await approve();
    expect(res.status).toBe(200);
    expect(Number(writtenLwp())).toBe(0.5);
  });
});
