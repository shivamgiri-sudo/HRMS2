// backend/src/modules/apr/apr.routes.ts
import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { db } from '../../db/mysql.js';
import { getAprData } from './apr.service.js';
import type { RowDataPacket } from 'mysql2';

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// GET /api/apr/data?date=YYYY-MM-DD
router.get('/data', h(async (req: AuthenticatedRequest, res) => {
  const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
  const userId = req.authUser!.id;

  const [roleRows] = await db.execute<RowDataPacket[]>(
    `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`,
    [userId]
  );
  const roles = (roleRows as RowDataPacket[]).map((r: any) => r.role_key as string);
  const isManager = roles.some(r =>
    ['admin', 'manager', 'process_manager', 'hr', 'team_leader', 'tl'].includes(r)
  );

  let employeeCode: string | undefined;
  if (!isManager) {
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_code FROM employees WHERE user_id = ? LIMIT 1`,
      [userId]
    );
    employeeCode = (empRows as any[])[0]?.employee_code as string | undefined;
    if (!employeeCode) {
      return res.json({ success: true, data: { configured: true, rows: [], reason: 'no_employee_code' } });
    }
  }

  const result = await getAprData({ date, employeeCode, isManager });

  if (!result.configured) {
    return res.json({ success: true, data: { configured: false, rows: [] } });
  }

  return res.json({ success: true, data: { configured: true, rows: result.rows } });
}));

export { router as aprRouter };
