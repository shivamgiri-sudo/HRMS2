import { Router, type NextFunction, type Response } from 'express';
import { db } from '../../db/mysql.js';
import { upsertOpenWorkItem } from '../../shared/workItem.js';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { requireWriteAccess } from '../../middleware/authMiddleware.js';
import { checkEmployeeCodeGate } from './employee-code-gate.service.js';
import { provisionLmsIdentityForEmployee } from '../lms/lms-provisioning.service.js';
import { generateEmployeeCode } from '../employees/employee-code.service.js';
import type { RowDataPacket } from 'mysql2';

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;

const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

// GET /api/ats/employee-code/:candidateId/gate-check
router.get(
  '/:candidateId/gate-check',
  requireAuth,
  requireRole('payroll_hr', 'payroll_head', 'admin', 'hr'),
  h(async (req, res) => {
    const result = await checkEmployeeCodeGate(req.params.candidateId);
    return res.json({ success: true, ...result });
  }),
);

// POST /api/ats/employee-code/:candidateId/generate
router.post(
  '/:candidateId/generate',
  requireAuth,
  requireWriteAccess,
  requireRole('admin', 'hr', 'payroll_hr'),
  h(async (req, res) => {
    const { candidateId } = req.params;

    const gate = await checkEmployeeCodeGate(candidateId);
    if (!gate.canGenerate) {
      return res.status(400).json({
        success: false,
        message: 'Employee code cannot be generated - gate checks not passed',
        blockers: gate.blockers,
        checklist: gate.checklist,
      });
    }

    // Use the shared generator rather than a second format. This route used to
    // emit MAS{YYMM}{00000}, which the orchestrator's `^MAS[0-9]+$` max-scan
    // also matches — a single such code would cast to ~260,000,000 and push the
    // shared sequence permanently into the hundreds of millions.
    let empCode: string;
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      empCode = await generateEmployeeCode(conn, 'Permanent');
      await conn.execute(
        `UPDATE employee_code_sequence SET last_generated_code = ? WHERE company_prefix = 'MAS' AND is_offrole = 0`,
        [empCode],
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      conn.release();
      throw err;
    }
    conn.release();

    // Write employee_code back to ats_candidate and move to employee_code_generated stage.
    await db.execute(
      'UPDATE ats_candidate SET employee_code = ?, current_stage = \'employee_code_generated\', updated_at = NOW() WHERE id = ?',
      [empCode, candidateId],
    );

    // Write employee_code to employees table if employee master already exists for this candidate.
    await db.execute(
      `UPDATE employees e
         JOIN ats_candidate c ON c.id = ?
         SET e.employee_code = ?
       WHERE e.employee_code IS NULL
         AND (e.user_id = c.user_id OR e.user_id IN (
               SELECT au.id FROM auth_user au WHERE au.email = c.email LIMIT 1
             ))`,
      [candidateId, empCode],
    ).catch(() => {
      // Employee master may not exist yet, so the ATS candidate remains the source of truth for now.
    });

    // If the employee master already exists, provision the LMS learner identity immediately.
    // If not, this is a harmless no-op and later employee creation/onboarding flows will pick it up.
    try {
      const lmsResult = await provisionLmsIdentityForEmployee({
        employeeCode: empCode,
        createdBy: req.authUser!.id,
      });
      if (lmsResult.message) {
        console.info(`[ATS] LMS provisioning for ${empCode}: ${lmsResult.message}`);
      }
    } catch (err) {
      console.warn(
        `[ATS] LMS provisioning skipped for ${empCode}:`,
        err instanceof Error ? err.message : String(err),
      );
    }

    // Update onboarding bridge with the generated code.
    // `bridge_status` is not a column on ats_onboarding_bridge (only `status` is) —
    // this silently no-op'd via the trailing .catch() on every real call, so the
    // bridge's employee_code/status never reflected code generation at all.
    await db.execute(
      'UPDATE ats_onboarding_bridge SET employee_code = ?, status = \'code_generated\', updated_at = NOW() WHERE candidate_id = ?',
      [empCode, candidateId],
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
      ],
    );

    // Audit
    await db.execute(
      `INSERT INTO sensitive_action_log
         (id, actor_user_id, action_type, module_key, entity_type, entity_id, change_summary, acted_at)
       VALUES (UUID(), ?, 'EMPLOYEE_CODE_GENERATED', 'ats', 'ats_candidate', ?, ?, NOW())`,
      [req.authUser!.id, candidateId, JSON.stringify({ employee_code: empCode })],
    ).catch(() => {});

    // Work item for employee master creation.
    // Was an INSERT ... ON DUPLICATE KEY UPDATE, which could never fire — work_item has no
    // unique key but its primary — so every call appended another copy of the same task.
    await upsertOpenWorkItem({
      itemType: "EMPLOYEE_MASTER_CREATION",
      title: "Create employee master record",
      moduleCode: "employees",
      entityType: "candidate",
      entityId: candidateId,
      assignedToRole: "hr",
      priority: "critical",
    }).catch(() => {});

    return res.json({ success: true, employeeCode: empCode, message: 'Employee code generated' });
  }),
);

export const employeeCodeGateRouter = router;
