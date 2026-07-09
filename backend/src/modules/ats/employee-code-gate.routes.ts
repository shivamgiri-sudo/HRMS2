import { Router, type NextFunction, type Response } from 'express';
import { db } from '../../db/mysql.js';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { requireWriteAccess } from '../../middleware/authMiddleware.js';
import { checkEmployeeCodeGate } from './employee-code-gate.service.js';
import type { RowDataPacket } from 'mysql2';

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;

const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};


// GET /api/ats/employee-code/:candidateId/gate-check
router.get('/:candidateId/gate-check', requireAuth, requireRole('payroll_hr', 'payroll_head', 'admin', 'hr', 'ho_hr', 'branch_hr'), h(async (req, res) => {
  const result = await checkEmployeeCodeGate(req.params.candidateId);
  return res.json({ success: true, ...result });
}));

// POST /api/ats/employee-code/:candidateId/generate
router.post('/:candidateId/generate', requireAuth, requireWriteAccess, requireRole('admin', 'hr', 'ho_hr', 'branch_hr', 'payroll_hr'), h(async (req, res) => {
  const { candidateId } = req.params;

  const gate = await checkEmployeeCodeGate(candidateId);
  if (!gate.canGenerate) {
    return res.status(400).json({
      success: false,
      message: 'Employee code cannot be generated — gate checks not passed',
      blockers: gate.blockers,
      checklist: gate.checklist,
    });
  }

  // Generate code using atomic sequence — prevents duplicate codes under concurrent requests
  const now = new Date();
  const yymm = String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, '0');
  let empCode: string;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE employee_code_sequence SET current_sequence = current_sequence + 1, last_generated_at = NOW()
       WHERE company_prefix = 'MAS' AND is_offrole = 0`
    );
    const [seqRows] = await conn.execute<RowDataPacket[]>(
      `SELECT current_sequence FROM employee_code_sequence WHERE company_prefix = 'MAS' AND is_offrole = 0 LIMIT 1`
    );
    const seq = String((seqRows as RowDataPacket[])[0]?.current_sequence ?? 1).padStart(5, '0');
    empCode = `MAS${yymm}${seq}`;
    await conn.execute(
      `UPDATE employee_code_sequence SET last_generated_code = ? WHERE company_prefix = 'MAS' AND is_offrole = 0`,
      [empCode]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }
  conn.release();

  // Write employee_code back to ats_candidate and move to employee_code_generated stage
  await db.execute(
    'UPDATE ats_candidate SET employee_code = ?, current_stage = \'employee_code_generated\', updated_at = NOW() WHERE id = ?',
    [empCode, candidateId]
  );

  // Write employee_code to employees table if employee master already exists for this candidate
  await db.execute(
    `UPDATE employees e
       JOIN ats_candidate c ON c.id = ?
       SET e.employee_code = ?
     WHERE e.employee_code IS NULL
       AND (e.user_id = c.user_id OR e.user_id IN (
             SELECT au.id FROM auth_user au WHERE au.email = c.email LIMIT 1
           ))`,
    [candidateId, empCode]
  ).catch(() => { /* employee master may not exist yet — code stored on ats_candidate for bridging */ });

  // Update onboarding bridge with the generated code
  await db.execute(
    'UPDATE ats_onboarding_bridge SET employee_code = ?, bridge_status = \'code_generated\', updated_at = NOW() WHERE candidate_id = ?',
    [empCode, candidateId]
  ).catch(() => {});

  // Log
  await db.execute(
    `INSERT INTO employee_code_generation_log
       (id, candidate_id, employee_code, gate_checklist, blocked_by, generated_by, generated_at, status)
     VALUES (UUID(),?,?,?,?,?,NOW(),'generated')`,
    [
      candidateId,
      empCode,
      JSON.stringify(gate.checklist),
      JSON.stringify([]),
      req.authUser!.id,
    ]
  );

  // Audit
  await db.execute(
    `INSERT INTO sensitive_action_log
       (id, actor_user_id, action_type, module_key, entity_type, entity_id, change_summary, created_at)
     VALUES (UUID(), ?, 'EMPLOYEE_CODE_GENERATED', 'ats', 'ats_candidate', ?, ?, NOW())`,
    [req.authUser!.id, candidateId, JSON.stringify({ employee_code: empCode })]
  ).catch(() => {});

  // Work item for employee master creation
  await db.execute(
    `INSERT INTO work_item (id,item_type,title,module_code,entity_type,entity_id,assigned_to_role,priority,status,created_at)
     VALUES (UUID(),'EMPLOYEE_MASTER_CREATION','Create employee master record','employees','candidate',?,
             'hr','critical','pending',NOW())
     ON DUPLICATE KEY UPDATE updated_at = NOW()`,
    [candidateId]
  ).catch(() => {});

  return res.json({ success: true, employeeCode: empCode, message: 'Employee code generated' });
}));

export const employeeCodeGateRouter = router;
