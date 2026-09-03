import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * The Attendance Lookup header strip, and specifically its "No record" tile.
 *
 * That tile is `total_active - total_with_record`, and total_with_record came from
 * COUNT(*) over a LEFT JOIN from employees — which counts every active employee whether or
 * not the join matched. The two numbers were therefore always equal and the tile always
 * read 0. Verified live on 2026-09-03: 1,037 active employees, 742 attendance rows, tile
 * showed 0 where it should have shown 295 (and 1 and 10 on the two days either side).
 *
 * The count now comes from the attendance rows themselves.
 */

vi.mock('../../../middleware/authMiddleware.js', () => ({
  requireAuth: (req: any, _res: express.Response, next: express.NextFunction) => {
    req.authUser = { id: 'hr-user', role: 'hr', roles: ['hr'] };
    next();
  },
  requireWriteAccess: (_req: any, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock('../../../middleware/requireRole.js', () => ({
  requireRole: () => (_req: any, _res: express.Response, next: express.NextFunction) => next(),
  requireScopedRole: () => (_req: any, _res: express.Response, next: express.NextFunction) => next(),
}));

const mocks = vi.hoisted(() => ({ execute: vi.fn(), buildScopeWhereClause: vi.fn(), hasScopedAccess: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({ db: { execute: mocks.execute, query: mocks.execute } }));
vi.mock('../../../shared/scopeAccess.js', () => ({
  buildScopeWhereClause: mocks.buildScopeWhereClause,
  hasScopedAccess: mocks.hasScopedAccess,
  hasAnyRole: vi.fn(async () => true),
}));

/**
 * Today's rows: 742 attendance records against 1,037 active employees — the real live
 * figures for 2026-09-03.
 *
 * The mock answers COUNT(*) the way MySQL would for the query it is actually given, which
 * is what makes the assertion below a regression test rather than a restatement of a
 * hard-coded number: a LEFT JOIN from employees keeps the unmatched rows and counts all
 * 1,037, an inner join from attendance counts the 742 that exist.
 */
function wireDb() {
  mocks.execute.mockImplementation(async (sql: string) => {
    if (sql.includes('SUM(adr.attendance_status')) {
      const countsEveryEmployee = /LEFT JOIN\s+attendance_daily_record/.test(sql);
      return [[{
        total_with_record: countsEveryEmployee ? 1037 : 742,
        present: 500, half_day: 40, absent: 100,
        missing_punch: 80, on_leave: 12, week_off: 8, holiday: 2,
      }]];
    }
    if (sql.includes('COUNT(*) AS total')) return [[{ total: 1037 }]];
    return [[]];
  });
}

async function callSummary() {
  const routes = await import('../employee.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/employees', (routes as any).default ?? (routes as any).employeeRouter);
  return request(app).get('/api/employees/hr-hub/today-summary');
}

describe('hr-hub today summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.buildScopeWhereClause.mockResolvedValue({ sql: '1=1', params: [] });
  });

  it('reports the employees who have no attendance record at all today', async () => {
    wireDb();
    const res = await callSummary();

    expect(res.status).toBe(200);
    expect(res.body.data.total_active).toBe(1037);
    // 1037 - 742. Was 0 for every organisation, on every day, before this.
    expect(res.body.data.no_record).toBe(295);
  });

  it('counts attendance rows rather than every active employee', async () => {
    wireDb();
    await callSummary();

    const summarySql = String(
      mocks.execute.mock.calls.find(([sql]) => String(sql).includes('SUM(adr.attendance_status'))?.[0] ?? ''
    );
    // Driving off attendance_daily_record is what makes the count mean "has a record".
    expect(summarySql).toMatch(/FROM\s+attendance_daily_record\s+adr/);
    expect(summarySql).not.toMatch(/LEFT JOIN\s+attendance_daily_record/);
  });

  it('keeps every status bucket the header strip renders', async () => {
    wireDb();
    const res = await callSummary();

    expect(res.body.data).toMatchObject({
      present: 500, half_day: 40, absent: 100,
      missing_punch: 80, on_leave: 12, week_off: 8, holiday: 2,
    });
  });
});
