/**
 * Reimbursement Management routes.
 * Mounted at /api/payroll/reimbursements
 *
 * Claim lifecycle: draft → submitted → approved/rejected → processed
 */

import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { randomUUID } from "crypto";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { db } from "../../db/mysql.js";

export const reimbursementsRouter = Router();

// ---------------------------------------------------------------------------
// Handler wrapper
// ---------------------------------------------------------------------------
const h =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void): void => {
    void fn(req, res).catch(next);
  };

// ---------------------------------------------------------------------------
// Ensure table exists
// ---------------------------------------------------------------------------
async function ensureTable(): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS employee_reimbursement_claim (
      id               CHAR(36)                                                    NOT NULL,
      employee_id      VARCHAR(36)                                                 NOT NULL,
      claim_type       ENUM('LTA','MEDICAL','INTERNET','PHONE','FUEL','OTHER')     NOT NULL,
      claim_month      VARCHAR(7)                                                  NOT NULL,
      amount_claimed   DECIMAL(10,2)                                               NOT NULL,
      amount_approved  DECIMAL(10,2)                                               NULL,
      description      TEXT                                                        NULL,
      documents_url    VARCHAR(500)                                                NULL,
      status           ENUM('draft','submitted','approved','rejected','processed') NOT NULL DEFAULT 'draft',
      submitted_at     DATETIME                                                    NULL,
      approved_by      VARCHAR(36)                                                 NULL,
      approved_at      DATETIME                                                    NULL,
      rejected_by      VARCHAR(36)                                                 NULL,
      rejected_at      DATETIME                                                    NULL,
      rejection_reason TEXT                                                        NULL,
      payroll_run_id   VARCHAR(36)                                                 NULL,
      processed_at     DATETIME                                                    NULL,
      created_at       DATETIME                                                    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at       DATETIME                                                    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_erc_emp    (employee_id),
      KEY idx_erc_month  (claim_month),
      KEY idx_erc_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

void ensureTable().catch((err) =>
  console.error("[reimbursements] Table ensure failed:", err)
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const APPROVER_ROLES = ["admin", "hr", "payroll_head", "finance", "super_admin"] as const;
const PROCESSOR_ROLES = ["payroll_head", "super_admin"] as const;

async function resolveEmployeeIdForUser(userId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
    [userId]
  );
  return (rows as { id: string }[])[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// GET / — list all claims (admin/hr/payroll_head/finance)
// Query: status, claim_month, employee_id, page, limit
// ---------------------------------------------------------------------------
reimbursementsRouter.get(
  "/",
  requireAuth,
  requireRole(...APPROVER_ROLES),
  h(async (req, res) => {
    const { status, claim_month, employee_id } = req.query as Record<string, string | undefined>;
    const rawPage  = parseInt(String(req.query.page  ?? "1"), 10);
    const rawLimit = parseInt(String(req.query.limit ?? "50"), 10);
    const page  = Math.max(1, Number.isNaN(rawPage)  ? 1  : rawPage);
    const limit = Math.min(200, Math.max(1, Number.isNaN(rawLimit) ? 50 : rawLimit));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status) {
      conditions.push("erc.status = ?");
      params.push(status);
    }
    if (claim_month) {
      conditions.push("erc.claim_month = ?");
      params.push(claim_month);
    }
    if (employee_id) {
      conditions.push("erc.employee_id = ?");
      params.push(employee_id);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
         FROM employee_reimbursement_claim erc
         ${where}`,
      params
    );
    const total = Number((countRows as RowDataPacket[])[0]?.total ?? 0);

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT erc.*,
              COALESCE(NULLIF(TRIM(e.full_name),''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
              e.employee_code
         FROM employee_reimbursement_claim erc
         LEFT JOIN employees e ON e.id = erc.employee_id
         ${where}
         ORDER BY erc.created_at DESC
         LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return res.json({ success: true, data: rows, total, page, limit });
  })
);

// ---------------------------------------------------------------------------
// GET /my — claims for the authenticated user's employee record
// ---------------------------------------------------------------------------
reimbursementsRouter.get(
  "/my",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const employeeId = await resolveEmployeeIdForUser(userId);
    if (!employeeId) {
      return res.status(404).json({ success: false, message: "No active employee record linked to your user account" });
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT erc.*
         FROM employee_reimbursement_claim erc
        WHERE erc.employee_id = ?
        ORDER BY erc.created_at DESC`,
      [employeeId]
    );

    return res.json({ success: true, data: rows });
  })
);

// ---------------------------------------------------------------------------
// POST / — create a claim (draft status)
// ---------------------------------------------------------------------------
reimbursementsRouter.post(
  "/",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const employeeId = await resolveEmployeeIdForUser(userId);
    if (!employeeId) {
      return res.status(404).json({ success: false, message: "No active employee record linked to your user account" });
    }

    const body = req.body as {
      claim_type?: string;
      claim_month?: string;
      amount_claimed?: unknown;
      description?: string;
    };

    const validTypes = ["LTA", "MEDICAL", "INTERNET", "PHONE", "FUEL", "OTHER"];
    if (!body.claim_type || !validTypes.includes(String(body.claim_type).toUpperCase())) {
      return res.status(400).json({ success: false, message: `claim_type must be one of: ${validTypes.join(", ")}` });
    }
    if (!body.claim_month || !/^\d{4}-\d{2}$/.test(String(body.claim_month))) {
      return res.status(400).json({ success: false, message: "claim_month must be in YYYY-MM format" });
    }
    const amount = Number(body.amount_claimed);
    if (!amount || Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "amount_claimed must be a positive number" });
    }

    const id = randomUUID();
    await db.execute<ResultSetHeader>(
      `INSERT INTO employee_reimbursement_claim
         (id, employee_id, claim_type, claim_month, amount_claimed, description, status)
       VALUES (?, ?, ?, ?, ?, ?, 'draft')`,
      [
        id,
        employeeId,
        String(body.claim_type).toUpperCase(),
        String(body.claim_month),
        amount,
        body.description ? String(body.description) : null,
      ]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM employee_reimbursement_claim WHERE id = ? LIMIT 1",
      [id]
    );
    return res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
  })
);

// ---------------------------------------------------------------------------
// POST /:id/submit — change draft → submitted
// ---------------------------------------------------------------------------
reimbursementsRouter.post(
  "/:id/submit",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const employeeId = await resolveEmployeeIdForUser(userId);
    if (!employeeId) {
      return res.status(404).json({ success: false, message: "No active employee record linked to your user account" });
    }

    const { id } = req.params;
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM employee_reimbursement_claim WHERE id = ? LIMIT 1",
      [id]
    );
    type ClaimRow = RowDataPacket & { status: string; employee_id: string };
    const claim = (rows as ClaimRow[])[0];
    if (!claim) return res.status(404).json({ success: false, message: "Claim not found" });
    if (claim.employee_id !== employeeId) {
      return res.status(403).json({ success: false, message: "You can only submit your own claims" });
    }
    if (claim.status !== "draft") {
      return res.status(400).json({ success: false, message: `Only draft claims can be submitted (current: ${claim.status})` });
    }

    await db.execute<ResultSetHeader>(
      "UPDATE employee_reimbursement_claim SET status = 'submitted', submitted_at = NOW() WHERE id = ?",
      [id]
    );

    return res.json({ success: true, message: "Claim submitted for approval" });
  })
);

// ---------------------------------------------------------------------------
// PATCH /:id/approve — approve a submitted claim
// ---------------------------------------------------------------------------
reimbursementsRouter.patch(
  "/:id/approve",
  requireAuth,
  requireRole(...APPROVER_ROLES),
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const { id } = req.params;
    const body = req.body as { amount_approved?: unknown; remarks?: string };

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM employee_reimbursement_claim WHERE id = ? LIMIT 1",
      [id]
    );
    type ClaimRow = RowDataPacket & { status: string; amount_claimed: string | number };
    const claim = (rows as ClaimRow[])[0];
    if (!claim) return res.status(404).json({ success: false, message: "Claim not found" });
    if (claim.status !== "submitted") {
      return res.status(400).json({ success: false, message: `Only submitted claims can be approved (current: ${claim.status})` });
    }

    const approvedAmt = body.amount_approved != null
      ? Number(body.amount_approved)
      : Number(claim.amount_claimed);

    await db.execute<ResultSetHeader>(
      `UPDATE employee_reimbursement_claim
          SET status = 'approved', approved_by = ?, approved_at = NOW(), amount_approved = ?
        WHERE id = ?`,
      [userId, approvedAmt, id]
    );

    void logSensitiveAction({
      actor_user_id: userId,
      actor_role: req.authUser!.role,
      action_type: "reimbursement_approved",
      module_key: "payroll_reimbursements",
      entity_type: "employee_reimbursement_claim",
      entity_id: id,
      old_value_json: { status: "submitted" },
      new_value_json: { status: "approved", amount_approved: approvedAmt, remarks: body.remarks ?? null },
      req,
    });

    return res.json({ success: true, message: "Claim approved" });
  })
);

// ---------------------------------------------------------------------------
// PATCH /:id/reject — reject a submitted claim
// ---------------------------------------------------------------------------
reimbursementsRouter.patch(
  "/:id/reject",
  requireAuth,
  requireRole(...APPROVER_ROLES),
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const { id } = req.params;
    const body = req.body as { reason?: string };

    if (!body.reason?.trim()) {
      return res.status(400).json({ success: false, message: "Rejection reason is required" });
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM employee_reimbursement_claim WHERE id = ? LIMIT 1",
      [id]
    );
    type ClaimRow = RowDataPacket & { status: string };
    const claim = (rows as ClaimRow[])[0];
    if (!claim) return res.status(404).json({ success: false, message: "Claim not found" });
    if (claim.status !== "submitted") {
      return res.status(400).json({ success: false, message: `Only submitted claims can be rejected (current: ${claim.status})` });
    }

    await db.execute<ResultSetHeader>(
      `UPDATE employee_reimbursement_claim
          SET status = 'rejected', rejected_by = ?, rejected_at = NOW(), rejection_reason = ?
        WHERE id = ?`,
      [userId, body.reason.trim(), id]
    );

    void logSensitiveAction({
      actor_user_id: userId,
      actor_role: req.authUser!.role,
      action_type: "reimbursement_rejected",
      module_key: "payroll_reimbursements",
      entity_type: "employee_reimbursement_claim",
      entity_id: id,
      old_value_json: { status: "submitted" },
      new_value_json: { status: "rejected", rejection_reason: body.reason.trim() },
      req,
    });

    return res.json({ success: true, message: "Claim rejected" });
  })
);

// ---------------------------------------------------------------------------
// PATCH /:id/process — mark an approved claim as processed
// ---------------------------------------------------------------------------
reimbursementsRouter.patch(
  "/:id/process",
  requireAuth,
  requireRole(...PROCESSOR_ROLES),
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const { id } = req.params;
    const body = req.body as { payroll_run_id?: string };

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM employee_reimbursement_claim WHERE id = ? LIMIT 1",
      [id]
    );
    type ClaimRow = RowDataPacket & { status: string };
    const claim = (rows as ClaimRow[])[0];
    if (!claim) return res.status(404).json({ success: false, message: "Claim not found" });
    if (claim.status !== "approved") {
      return res.status(400).json({ success: false, message: `Only approved claims can be processed (current: ${claim.status})` });
    }

    await db.execute<ResultSetHeader>(
      `UPDATE employee_reimbursement_claim
          SET status = 'processed', processed_at = NOW(), payroll_run_id = ?
        WHERE id = ?`,
      [body.payroll_run_id ?? null, id]
    );

    void logSensitiveAction({
      actor_user_id: userId,
      actor_role: req.authUser!.role,
      action_type: "reimbursement_processed",
      module_key: "payroll_reimbursements",
      entity_type: "employee_reimbursement_claim",
      entity_id: id,
      old_value_json: { status: "approved" },
      new_value_json: { status: "processed", payroll_run_id: body.payroll_run_id ?? null },
      req,
    });

    return res.json({ success: true, message: "Claim marked as processed" });
  })
);

// ---------------------------------------------------------------------------
// DELETE /:id — hard delete, own claim, draft status only
// ---------------------------------------------------------------------------
reimbursementsRouter.delete(
  "/:id",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const employeeId = await resolveEmployeeIdForUser(userId);
    if (!employeeId) {
      return res.status(404).json({ success: false, message: "No active employee record linked to your user account" });
    }

    const { id } = req.params;
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM employee_reimbursement_claim WHERE id = ? LIMIT 1",
      [id]
    );
    type ClaimRow = RowDataPacket & { status: string; employee_id: string };
    const claim = (rows as ClaimRow[])[0];
    if (!claim) return res.status(404).json({ success: false, message: "Claim not found" });
    if (claim.employee_id !== employeeId) {
      return res.status(403).json({ success: false, message: "You can only delete your own claims" });
    }
    if (claim.status !== "draft") {
      return res.status(400).json({ success: false, message: "Only draft claims can be deleted" });
    }

    await db.execute<ResultSetHeader>(
      "DELETE FROM employee_reimbursement_claim WHERE id = ?",
      [id]
    );

    return res.json({ success: true, message: "Draft claim deleted" });
  })
);
