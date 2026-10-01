import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const state = vi.hoisted(() => ({ visible: null as null | Set<string> }));

vi.mock('../../../../middleware/authMiddleware.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: 'u1' }; next(); },
}));
vi.mock('../../../../middleware/requireRole.js', () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock('../../payroll-branch-scope.js', () => ({
  OUT_OF_SCOPE_BODY: { success: false, error: 'out of scope' },
  filterVisibleEmployeeIds: vi.fn(async (_r: unknown, ids: string[]) => state.visible ?? new Set(ids)),
}));
vi.mock('../../../../shared/auditLog.js', () => ({ logSensitiveAction: vi.fn() }));
vi.mock('../pendency.service.js', async (orig) => ({
  ...(await orig<typeof import('../pendency.service.js')>()),
  sendPendencyReminders: vi.fn(async () => [{ employee_id: 'e1', employee_code: 'A', status: 'sent' }]),
}));

import { pendencyRemindersRouter } from '../pendency-reminders.routes.js';
import { sendPendencyReminders } from '../pendency.service.js';

const app = express();
app.use(express.json());
app.use('/api/payroll', pendencyRemindersRouter);

describe('POST /api/payroll/pendency-reminders', () => {
  beforeEach(() => { vi.clearAllMocks(); state.visible = null; });

  it('rejects an unknown kind', async () => {
    const res = await request(app).post('/api/payroll/pendency-reminders').send({ kind: 'x', employee_ids: ['e1'] });
    expect(res.status).toBe(400);
  });

  it('rejects an empty or oversize list', async () => {
    expect((await request(app).post('/api/payroll/pendency-reminders').send({ kind: 'esi_docs', employee_ids: [] })).status).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => `e${i}`);
    expect((await request(app).post('/api/payroll/pendency-reminders').send({ kind: 'esi_docs', employee_ids: many })).status).toBe(400);
  });

  it('403s when any employee is outside the caller scope, and sends nothing', async () => {
    state.visible = new Set(['e1']);
    const res = await request(app).post('/api/payroll/pendency-reminders').send({ kind: 'esi_docs', employee_ids: ['e1', 'e2'] });
    expect(res.status).toBe(403);
    expect(sendPendencyReminders).not.toHaveBeenCalled();
  });

  it('sends for in-scope employees and returns the summary', async () => {
    const res = await request(app).post('/api/payroll/pendency-reminders').send({ kind: 'esi_docs', employee_ids: ['e1'] });
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(sendPendencyReminders).toHaveBeenCalledWith(expect.objectContaining({ kind: 'esi_docs', sentBy: 'u1', trigger: 'manual' }));
  });
});
