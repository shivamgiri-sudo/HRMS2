import { Router, type Request, type Response } from "express";
import { requireRole } from "../../middleware/requireRole.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";

const ESI_BOT_ROLES = ["payroll", "payroll_hr", "payroll_branch", "payroll_head", "super_admin"];

export const esicAutomationRouter = Router();

esicAutomationRouter.use(requireAuth, requireRole(...ESI_BOT_ROLES));

// GET /api/payroll/esic-automation/cases
esicAutomationRouter.get("/esic-automation/cases", async (req: Request, res: Response) => {
  const { search, status } = req.query as Record<string, string>;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (search) {
    conditions.push("(employee_name LIKE ? OR employee_code LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  if (status && status !== "ALL") {
    conditions.push("status = ?");
    params.push(status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, registration_id, employee_id, employee_code, employee_name, branch_name,
            readiness, status, current_step, esic_ip_number, acknowledgement_url,
            last_error_code, last_error_message, attempt_count,
            approved_by, approved_at, started_at, completed_at, created_at, updated_at
     FROM esic_registration_case
     ${where}
     ORDER BY updated_at DESC`,
    params,
  );

  res.json({ cases: rows, total: rows.length });
});

// GET /api/payroll/esic-automation/cases/:id
esicAutomationRouter.get("/esic-automation/cases/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  const [[caseRow]] = await db.query<RowDataPacket[]>(
    `SELECT id, registration_id, employee_id, employee_code, employee_name, branch_name,
            readiness, status, current_step, esic_ip_number, acknowledgement_url,
            last_error_code, last_error_message, attempt_count,
            approved_by, approved_at, started_at, completed_at, created_at, updated_at
     FROM esic_registration_case WHERE id = ?`,
    [id],
  );

  if (!caseRow) {
    res.status(404).json({ success: false, error: "Case not found" });
    return;
  }

  const [timeline] = await db.query<RowDataPacket[]>(
    `SELECT id, event_type, from_status, to_status, actor_type, actor_id, detail_json, created_at
     FROM esic_registration_event WHERE case_id = ? ORDER BY created_at ASC`,
    [id],
  );

  res.json({ case: caseRow, timeline });
});

// POST /api/payroll/esic-automation/cases/:id/approve
esicAutomationRouter.post("/esic-automation/cases/:id/approve", async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = (req as AuthenticatedRequest).authUser?.id ?? null;

  const [[caseRow]] = await db.query<RowDataPacket[]>(
    "SELECT id, status FROM esic_registration_case WHERE id = ?",
    [id],
  );

  if (!caseRow) {
    res.status(404).json({ success: false, error: "Case not found" });
    return;
  }

  if (caseRow.status !== "NEEDS_REVIEW") {
    res.status(400).json({ success: false, error: `Cannot approve a case with status ${caseRow.status}` });
    return;
  }

  await db.query(
    `UPDATE esic_registration_case SET status = 'APPROVED', approved_by = ?, approved_at = NOW() WHERE id = ?`,
    [userId, id],
  );

  await db.query(
    `INSERT INTO esic_registration_event (id, case_id, event_type, from_status, to_status, actor_type, actor_id)
     VALUES (?, ?, 'APPROVED', 'NEEDS_REVIEW', 'APPROVED', 'hr_user', ?)`,
    [randomUUID(), id, userId],
  );

  res.json({ success: true });
});
