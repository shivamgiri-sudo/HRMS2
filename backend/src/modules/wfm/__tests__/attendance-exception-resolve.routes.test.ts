import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * The first write endpoints on attendance_reconciliation_issue.
 *
 * Until these existed, `resolved_at` was set by the nightly reconciliation worker's own
 * auto-fix and by nothing else — a human who had dealt with an issue had no way to record
 * it, so ~6,000 open rows could only grow. These tests pin the three things that make the
 * write safe: who may do it, that a reason is mandatory, and that it cannot be applied
 * twice.
 */

vi.mock('../../../middleware/authMiddleware.js', () => ({
  requireAuth: (req: any, _res: express.Response, next: express.NextFunction) => {
    req.authUser = { id: 'test-user-id', role: 'payroll_head', roles: ['payroll_head'] };
    next();
  },
  requireWriteAccess: (_req: any, _res: express.Response, next: express.NextFunction) => next(),
}));

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  requireRole: vi.fn(),
  logSensitiveAction: vi.fn(),
  resolveUserBusinessScope: vi.fn(),
  buildEmployeeScopeCondition: vi.fn(),
}));

vi.mock('../../../db/mysql.js', () => ({ db: { execute: mocks.execute } }));
vi.mock('../../../shared/auditLog.js', () => ({ logSensitiveAction: mocks.logSensitiveAction }));
vi.mock('../../../shared/enterpriseScope.js', () => ({
  resolveUserBusinessScope: mocks.resolveUserBusinessScope,
  buildEmployeeScopeCondition: mocks.buildEmployeeScopeCondition,
}));
// requireRole is a factory; the middleware it returns is what admits or refuses the caller.
vi.mock('../../../middleware/requireRole.js', () => ({
  requireRole: (...roles: string[]) => {
    mocks.requireRole(roles);
    return (req: any, res: express.Response, next: express.NextFunction) => {
      const held: string[] = req.authUser?.roles ?? [];
      if (roles.some((r) => held.includes(r))) return next();
      return res.status(403).json({ success: false, error: 'Forbidden' });
    };
  },
}));

const OPEN_ROW = {
  id: 'exc-1',
  issue_type: 'missing_punch_with_usable_source',
  severity: 'blocker',
  issue_date: '2026-08-12',
  employee_id: 'emp-1',
  resolved_at: null,
  review_notes: null,
  reviewed_by: null,
  employee_code: 'MAS1234',
  branch_id: 'br-1',
};

function mockRow(row: any) {
  mocks.execute.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM attendance_reconciliation_issue ari')) return [row ? [row] : []];
    if (sql.trim().startsWith('UPDATE')) return [{ affectedRows: 1 }];
    return [[]];
  });
}

async function buildApp() {
  const { attendanceExceptionsRouter } = await import('../attendance-exceptions.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/wfm/attendance-exceptions', attendanceExceptionsRouter);
  return app;
}

describe('attendance exception resolve / reopen', () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    // Org-wide caller by default; the scope test below narrows it.
    mocks.resolveUserBusinessScope.mockResolvedValue({ assignments: [] });
    mocks.buildEmployeeScopeCondition.mockReturnValue({ sql: '1=1', params: [] });
    app = await buildApp();
  });

  it('resolves an open exception and writes the reviewer, timestamp and reason', async () => {
    mockRow(OPEN_ROW);

    const res = await request(app)
      .post('/api/wfm/attendance-exceptions/exc-1/resolve')
      .send({ reason: 'Punch verified against the branch register.' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: 'exc-1', resolved: true });

    const update = mocks.execute.mock.calls.find(([sql]) => String(sql).trim().startsWith('UPDATE'));
    expect(update![0]).toContain('resolved_at = NOW()');
    expect(update![0]).toContain('reviewed_by = ?');
    // The guard in the WHERE is what makes a double-resolve a no-op even if two reviewers
    // click at the same moment.
    expect(update![0]).toContain('resolved_at IS NULL');
    expect(update![1]).toEqual(['test-user-id', 'Punch verified against the branch register.', 'exc-1']);
    expect(mocks.logSensitiveAction).toHaveBeenCalledWith(
      expect.objectContaining({ action_type: 'ATTENDANCE_EXCEPTION_RESOLVED', entity_id: 'exc-1' }),
    );
  });

  it('refuses a reason shorter than 10 characters, before touching the database', async () => {
    mockRow(OPEN_ROW);

    const res = await request(app)
      .post('/api/wfm/attendance-exceptions/exc-1/resolve')
      .send({ reason: 'ok' });

    expect(res.status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('refuses to resolve an exception that is already resolved', async () => {
    mockRow({ ...OPEN_ROW, resolved_at: '2026-08-20 10:00:00' });

    const res = await request(app)
      .post('/api/wfm/attendance-exceptions/exc-1/resolve')
      .send({ reason: 'Already handled last week.' });

    expect(res.status).toBe(409);
    expect(mocks.execute.mock.calls.some(([sql]) => String(sql).trim().startsWith('UPDATE'))).toBe(false);
  });

  it('refuses an employee outside the caller\'s scope', async () => {
    mocks.buildEmployeeScopeCondition.mockReturnValue({ sql: 'emp.branch_id = ?', params: ['br-other'] });
    mocks.execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM attendance_reconciliation_issue ari')) return [[OPEN_ROW]];
      // The scope probe finds no matching employee row.
      if (sql.includes('FROM employees emp WHERE emp.id = ?')) return [[]];
      return [[]];
    });

    const res = await request(app)
      .post('/api/wfm/attendance-exceptions/exc-1/resolve')
      .send({ reason: 'Attempting a cross-branch resolve.' });

    expect(res.status).toBe(403);
    expect(mocks.execute.mock.calls.some(([sql]) => String(sql).trim().startsWith('UPDATE'))).toBe(false);
  });

  it('gates both writes to super_admin and payroll_head only', async () => {
    // The list endpoints admit ten roles; the writes must not inherit that.
    const gatedRoleSets = mocks.requireRole.mock.calls.map(([roles]) => roles);
    expect(gatedRoleSets).toContainEqual(['super_admin', 'payroll_head']);
    expect(gatedRoleSets.filter((r: string[]) => r.length === 2 && r.includes('payroll_head'))).toHaveLength(2);
  });

  it('reopens a resolved exception', async () => {
    mockRow({ ...OPEN_ROW, resolved_at: '2026-08-20 10:00:00' });

    const res = await request(app)
      .post('/api/wfm/attendance-exceptions/exc-1/reopen')
      .send({ reason: 'Reopened — the punch was never actually corrected.' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: 'exc-1', resolved: false });
    const update = mocks.execute.mock.calls.find(([sql]) => String(sql).trim().startsWith('UPDATE'));
    expect(update![0]).toContain('resolved_at = NULL');
  });
});
