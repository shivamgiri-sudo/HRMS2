import { Router } from 'express';
import { db } from '../../db/mysql.js';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { requireWriteAccess } from '../../middleware/authMiddleware.js';
import { checkEmployeeCodeGate } from './employee-code-gate.service.js';
import type { RowDataPacket } from 'mysql2';

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

// GET /api/ats/employee-code/:candidateId/gate-check
router.get('/:candidateId/gate-check', requireAuth, requireRole('payroll_hr', 'payroll_head', 'admin', 'hr', 'ho_hr', 'branch_hr'), h(async (req: any, res: any) => {
  const result = await checkEmployeeCodeGate(req.params.candidateId);
  return res.json({ success: true, ...result });
}));

// POST /api/ats/employee-code/:candidateId/generate
router.post('/:candidateId/generate', requireAuth, requireWriteAccess, requireRole('admin', 'hr', 'ho_hr', 'branch_hr', 'payroll_hr'), h(async (req: any, res: any) => {
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

  // Generate code: MASCYYMM-NNNNN (sequential)
  const now = new Date();
  const yymm = String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, '0');
  const [countRow] = await db.execute<RowDataPacket[]>(
    'SELECT COUNT(*) as cnt FROM employees WHERE created_at >= DATE_FORMAT(NOW(),\'%Y-%m-01\')'
  ).catch(() => [[{ cnt: 0 }]] as any);
  const seq = String(((countRow as any[])[0]?.cnt ?? 0) + 1).padStart(4, '0');
  const empCode = `MAS${yymm}${seq}`;

  // Persist code on candidate
  await db.execute(
    'UPDATE ats_candidate SET current_stage=\'employee_code_generated\', updated_at=NOW() WHERE id=?',
    [candidateId]
  );

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
      req.authUser.id,
    ]
  );

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
