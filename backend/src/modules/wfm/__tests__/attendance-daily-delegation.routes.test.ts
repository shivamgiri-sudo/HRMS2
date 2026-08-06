import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * Regression coverage for a live production bug: TeamAttendanceTab.tsx calls
 * GET /api/wfm/attendance/daily?date=X&limit=500 (no employeeId), which
 * always hit wfm.routes.ts's own "/attendance/daily" handler — mounted
 * earlier (app.ts:334) than attendance-daily-scoped.routes.ts's matching
 * mount (app.ts:516) — and that handler unconditionally 400'd without
 * employeeId, so the Team Attendance tab always failed to load.
 *
 * Fix: when employeeId is absent, wfm.routes.ts now delegates to
 * scopedAttendanceDailyHandler (extracted from attendance-daily-scoped.routes.ts)
 * instead of 400ing. The employeeId-provided path is untouched — verified
 * here by confirming the delegation is NOT invoked when employeeId is given.
 */
vi.mock('../../../middleware/authMiddleware.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string } }).authUser = { id: 'test-user-id' };
    next();
  },
}));

vi.mock('../../../shared/accessGuard.js', () => ({
  hasRole: vi.fn().mockResolvedValue(false),
  getEmployeeForUser: vi.fn().mockResolvedValue({ id: 'emp-self' }),
}));

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({ db: { execute: mocks.execute } }));

vi.mock('../attendance-daily-scoped.routes.js', async () => {
  const actual = await vi.importActual<typeof import('../attendance-daily-scoped.routes.js')>('../attendance-daily-scoped.routes.js');
  return {
    ...actual,
    scopedAttendanceDailyHandler: vi.fn(async (_req: unknown, res: express.Response) =>
      res.json({ success: true, data: [], total: 0, page: 1, limit: 200, delegated: true }),
    ),
  };
});

import { scopedAttendanceDailyHandler } from '../attendance-daily-scoped.routes.js';

describe('GET /api/wfm/attendance/daily — employeeId-absent delegation', () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue([[{ record_date: '2026-08-01', attendance_status: 'present' }]]);
    const { wfmRouter } = await import('../wfm.routes.js');
    app = express();
    app.use('/api/wfm', wfmRouter);
  });

  it('delegates to scopedAttendanceDailyHandler when employeeId is absent (the TeamAttendanceTab case)', async () => {
    const res = await request(app).get('/api/wfm/attendance/daily?date=2026-08-06&limit=500');
    expect(res.status).toBe(200);
    expect(res.body.delegated).toBe(true);
    expect(scopedAttendanceDailyHandler).toHaveBeenCalledTimes(1);
    // The original per-employee query must never run for this case.
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('does NOT delegate, and does NOT 400, when employeeId is provided (the five existing callers)', async () => {
    const { hasRole, getEmployeeForUser } = await import('../../../shared/accessGuard.js');
    vi.mocked(getEmployeeForUser).mockResolvedValue({ id: 'emp-self' } as any);
    vi.mocked(hasRole).mockResolvedValue(false);

    const res = await request(app).get('/api/wfm/attendance/daily?employeeId=emp-self&fromDate=2026-08-01&toDate=2026-08-06');
    expect(res.status).toBe(200);
    expect(scopedAttendanceDailyHandler).not.toHaveBeenCalled();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.execute.mock.calls[0];
    expect(sql).toContain('FROM attendance_daily_record');
    expect(params[0]).toBe('emp-self');
  });

  it('still enforces the ownership check for a non-privileged caller requesting someone else\'s employeeId', async () => {
    const { hasRole, getEmployeeForUser } = await import('../../../shared/accessGuard.js');
    vi.mocked(getEmployeeForUser).mockResolvedValue({ id: 'emp-self' } as any);
    vi.mocked(hasRole).mockResolvedValue(false);

    const res = await request(app).get('/api/wfm/attendance/daily?employeeId=someone-elses-id');
    expect(res.status).toBe(403);
    expect(scopedAttendanceDailyHandler).not.toHaveBeenCalled();
  });
});
