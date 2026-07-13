/**
 * Employee Loan Management routes.
 * Mounted at /api/payroll/loans
 *
 * Covers: create, list, update, manual payment recording, repayment schedule,
 * employee self-view, and soft-cancel. Payroll engine reads active loans via
 * the employee_loans table and deducts deduction_per_month automatically.
 */

import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { randomUUID } from "crypto";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { db } from "../../db/mysql.js";

export const loansRouter = Router();

// ---------------------------------------------------------------------------
// Typed error-catching wrapper — keeps handlers free of try/catch boilerplate
// ---------------------------------------------------------------------------
type RouteHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;

const h =
  (fn: RouteHandler) =>
  (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void): void => {
    void fn(req, res).catch(next);
  };

// ---------------------------------------------------------------------------
// GET /
// List all loans with optional filtering. Admin / finance / payroll roles.
// Query params: employee_id, status, branch_name, q (name/code search),
//               page (default 1), limit (default 50, max 200).
// ---------------------------------------------------------------------------
loansRouter.get(
  "/",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    if (!(await hasAnyRole(userId, "admin", "finance", "payroll_head", "payroll", "hr", "super_admin"))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { employee_id, status, branch_name, q } = req.query as Record<string, string | undefined>;
    const rawPage = parseInt(String(req.query.page ?? "1"), 10);
    const rawLimit = parseInt(String(req.query.limit ?? "50"), 10);
    const page = Math.max(1, Number.isNaN(rawPage) ? 1 : rawPage);
    const limit = Math.min(200, Math.max(1, Number.isNaN(rawLimit) ? 50 : rawLimit));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (employee_id) {
      conditions.push("el.employee_id = ?");
      params.push(employee_id);
    }
    if (status && ["active", "completed", "cancelled"].includes(status)) {
      conditions.push("el.status = ?");
      params.push(status);
    }
    if (branch_name) {
      conditions.push("el.branch_name = ?");
      params.push(branch_name);
    }
    if (q?.trim()) {
      conditions.push(
        "(el.employee_code LIKE ? OR CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) LIKE ? OR el.loan_type LIKE ?)"
      );
      const like = `%${q.trim()}%`;
      params.push(like, like, like);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
         FROM employee_loans el
         LEFT JOIN employees e ON e.id = el.employee_id
         ${where}`,
      params
    );
    const total = Number((countRows as RowDataPacket[])[0]?.total ?? 0);

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT el.*,
              COALESCE(NULLIF(TRIM(e.full_name),''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name
         FROM employee_loans el
         LEFT JOIN employees e ON e.id = el.employee_id
         ${where}
         ORDER BY el.created_at DESC
         LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return res.json({ success: true, data: rows, total, page, limit });
  })
);

// ---------------------------------------------------------------------------
// GET /employee/:employeeId
// All loans for one employee. Payroll roles OR the employee themselves.
// Returns: { loans, total_deducted, total_pending }
// ---------------------------------------------------------------------------
loansRouter.get(
  "/employee/:employeeId",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const { employeeId } = req.params;

    const isPayrollRole = await hasAnyRole(
      userId,
      "admin", "finance", "payroll_head", "payroll", "hr", "super_admin"
    );

    if (!isPayrollRole) {
      // Verify the authenticated user maps to this employeeId
      const [empRows] = await db.execute<RowDataPacket[]>(
        "SELECT id FROM employees WHERE id = ? AND user_id = ? AND active_status = 1 LIMIT 1",
        [employeeId, userId]
      );
      if (!(empRows as RowDataPacket[])[0]) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    const [loans] = await db.execute<RowDataPacket[]>(
      `SELECT el.*,
              COALESCE(NULLIF(TRIM(e.full_name),''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name
         FROM employee_loans el
         LEFT JOIN employees e ON e.id = el.employee_id
        WHERE el.employee_id = ?
        ORDER BY el.created_at DESC`,
      [employeeId]
    );

    const loanList = loans as RowDataPacket[];
    const total_deducted = loanList.reduce(
      (sum, l) => sum + Number(l.deducted_amount ?? 0),
      0
    );
    const total_pending = loanList.reduce(
      (sum, l) => sum + Number(l.pending_amount ?? 0),
      0
    );

    return res.json({ success: true, data: { loans: loanList, total_deducted, total_pending } });
  })
);

// ---------------------------------------------------------------------------
// POST /
// Create a new loan. Admin / payroll_head / finance only.
// ---------------------------------------------------------------------------
loansRouter.post(
  "/",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    if (!(await hasAnyRole(userId, "admin", "payroll_head", "finance", "super_admin"))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const body = req.body as Record<string, unknown>;
    const {
      employee_id, loan_type, amount, start_date, installments, deduction_per_month,
      end_date, reason,
      cheque_number, cheque_bank, cheque_date,
      rtgs_number, rtgs_date,
      guarantor_name, guarantor_emp_code, guarantor_emp_id,
      branch_name, cost_center,
    } = body;

    if (!employee_id || !loan_type || !amount || !start_date || !installments || !deduction_per_month) {
      return res.status(400).json({
        success: false,
        message: "Required fields: employee_id, loan_type, amount, start_date, installments, deduction_per_month",
      });
    }

    // Resolve employee_code from DB
    const [empRows] = await db.execute<RowDataPacket[]>(
      "SELECT id, employee_code, branch_name FROM employees WHERE id = ? AND active_status = 1 LIMIT 1",
      [employee_id]
    );
    type EmpRow = RowDataPacket & { employee_code: string; branch_name: string | null };
    const emp = (empRows as EmpRow[])[0];
    if (!emp) {
      return res.status(404).json({ success: false, message: "Employee not found or inactive" });
    }

    const loanId = randomUUID();
    const pendingAmount = Number(amount);

    await db.execute<ResultSetHeader>(
      `INSERT INTO employee_loans
         (id, employee_id, employee_code, loan_type, amount, start_date, end_date,
          installments, deduction_per_month, deducted_amount, pending_amount, status,
          guarantor_name, guarantor_emp_code, guarantor_emp_id,
          reason, approved_by, approved_at,
          cheque_number, cheque_bank, cheque_date,
          rtgs_number, rtgs_date,
          branch_name, cost_center)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'active',
               ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?)`,
      [
        loanId,
        employee_id,
        emp.employee_code,
        String(loan_type),
        Number(amount),
        String(start_date),
        end_date ? String(end_date) : null,
        Number(installments),
        Number(deduction_per_month),
        pendingAmount,
        guarantor_name ? String(guarantor_name) : null,
        guarantor_emp_code ? String(guarantor_emp_code) : null,
        guarantor_emp_id ? String(guarantor_emp_id) : null,
        reason ? String(reason) : null,
        userId,
        cheque_number ? String(cheque_number) : null,
        cheque_bank ? String(cheque_bank) : null,
        cheque_date ? String(cheque_date) : null,
        rtgs_number ? String(rtgs_number) : null,
        rtgs_date ? String(rtgs_date) : null,
        branch_name ? String(branch_name) : (emp.branch_name ?? null),
        cost_center ? String(cost_center) : null,
      ]
    );

    void logSensitiveAction({
      actor_user_id: userId,
      actor_role: req.authUser!.role,
      action_type: "loan_created",
      module_key: "payroll_loans",
      entity_type: "employee_loan",
      entity_id: loanId,
      new_value_json: {
        employee_id,
        loan_type,
        amount,
        start_date,
        installments,
        deduction_per_month,
      } as Record<string, unknown>,
      req,
    });

    const [newRows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM employee_loans WHERE id = ? LIMIT 1",
      [loanId]
    );
    return res.status(201).json({ success: true, data: (newRows as RowDataPacket[])[0] });
  })
);

// ---------------------------------------------------------------------------
// PATCH /:id
// Update allowed loan fields. Admin / payroll_head only.
// If status is set to 'completed', pending_amount is zeroed.
// ---------------------------------------------------------------------------
loansRouter.patch(
  "/:id",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    if (!(await hasAnyRole(userId, "admin", "payroll_head", "super_admin"))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { id } = req.params;
    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM employee_loans WHERE id = ? LIMIT 1",
      [id]
    );
    type LoanRow = RowDataPacket & Record<string, unknown>;
    const loan = (existing as LoanRow[])[0];
    if (!loan) {
      return res.status(404).json({ success: false, message: "Loan not found" });
    }

    const body = req.body as Record<string, unknown>;
    const ALLOWED = [
      "deduction_per_month", "end_date", "reason",
      "cheque_number", "cheque_bank", "rtgs_number", "status",
    ] as const;

    const sets: string[] = [];
    const params: unknown[] = [];

    for (const key of ALLOWED) {
      if (key in body && body[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(body[key] ?? null);
      }
    }

    if (body.status !== undefined) {
      if (!["active", "completed", "cancelled"].includes(String(body.status))) {
        return res.status(400).json({ success: false, message: "Invalid status value" });
      }
      if (body.status === "completed") {
        sets.push("pending_amount = 0");
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: "No updatable fields provided" });
    }

    params.push(id);
    await db.execute<ResultSetHeader>(
      `UPDATE employee_loans SET ${sets.join(", ")} WHERE id = ?`,
      params
    );

    void logSensitiveAction({
      actor_user_id: userId,
      actor_role: req.authUser!.role,
      action_type: "loan_updated",
      module_key: "payroll_loans",
      entity_type: "employee_loan",
      entity_id: id,
      old_value_json: {
        status: loan.status,
        deduction_per_month: loan.deduction_per_month,
        pending_amount: loan.pending_amount,
      },
      new_value_json: body as Record<string, unknown>,
      req,
    });

    const [updated] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM employee_loans WHERE id = ? LIMIT 1",
      [id]
    );
    return res.json({ success: true, data: (updated as RowDataPacket[])[0] });
  })
);

// ---------------------------------------------------------------------------
// POST /:id/record-payment
// Record a manual payment (outside payroll deduction cycle).
// Admin / payroll_head / finance. Body: { amount_paid }.
// ---------------------------------------------------------------------------
loansRouter.post(
  "/:id/record-payment",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    if (!(await hasAnyRole(userId, "admin", "payroll_head", "finance", "super_admin"))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { id } = req.params;
    const { amount_paid } = req.body as { amount_paid?: unknown };
    const paid = Number(amount_paid);
    if (!paid || Number.isNaN(paid) || paid <= 0) {
      return res.status(400).json({ success: false, message: "amount_paid must be a positive number" });
    }

    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM employee_loans WHERE id = ? LIMIT 1",
      [id]
    );
    type LoanRow = RowDataPacket & Record<string, unknown>;
    const loan = (existing as LoanRow[])[0];
    if (!loan) {
      return res.status(404).json({ success: false, message: "Loan not found" });
    }
    if (loan.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "Cannot record payment against a cancelled loan",
      });
    }

    const newDeducted = Number(loan.deducted_amount) + paid;
    const newPending = Math.max(0, Number(loan.pending_amount) - paid);
    const newStatus = newPending <= 0 ? "completed" : String(loan.status);

    await db.execute<ResultSetHeader>(
      `UPDATE employee_loans SET deducted_amount = ?, pending_amount = ?, status = ? WHERE id = ?`,
      [newDeducted, newPending, newStatus, id]
    );

    void logSensitiveAction({
      actor_user_id: userId,
      actor_role: req.authUser!.role,
      action_type: "loan_payment_recorded",
      module_key: "payroll_loans",
      entity_type: "employee_loan",
      entity_id: id,
      old_value_json: {
        deducted_amount: loan.deducted_amount,
        pending_amount: loan.pending_amount,
        status: loan.status,
      },
      new_value_json: {
        amount_paid: paid,
        deducted_amount: newDeducted,
        pending_amount: newPending,
        status: newStatus,
      },
      req,
    });

    const [updated] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM employee_loans WHERE id = ? LIMIT 1",
      [id]
    );
    return res.json({ success: true, data: (updated as RowDataPacket[])[0] });
  })
);

// ---------------------------------------------------------------------------
// GET /:id/schedule
// Compute repayment schedule. Accessible by payroll roles or the
// employee who owns the loan.
// Returns: [{ month: "YYYY-MM", emi, running_balance }]
// ---------------------------------------------------------------------------
loansRouter.get(
  "/:id/schedule",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const { id } = req.params;

    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT el.*, e.user_id AS emp_user_id
         FROM employee_loans el
         LEFT JOIN employees e ON e.id = el.employee_id
        WHERE el.id = ? LIMIT 1`,
      [id]
    );
    type LoanRow = RowDataPacket & Record<string, unknown>;
    const loan = (existing as LoanRow[])[0];
    if (!loan) {
      return res.status(404).json({ success: false, message: "Loan not found" });
    }

    const isPayrollRole = await hasAnyRole(
      userId,
      "admin", "finance", "payroll_head", "payroll", "hr", "super_admin"
    );
    if (!isPayrollRole && String(loan.emp_user_id) !== userId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const installments = Number(loan.installments);
    const emi = Number(loan.deduction_per_month);
    const totalAmount = Number(loan.amount);

    // Parse start_date safely; new Date("YYYY-MM-DD") is UTC midnight, adjust for month math
    const rawDate = String(loan.start_date);
    const [yyyy, mm] = rawDate.slice(0, 10).split("-").map(Number);
    const startYear = yyyy ?? new Date().getFullYear();
    const startMonth = (mm ?? 1) - 1; // 0-indexed

    const schedule: Array<{ month: string; emi: number; running_balance: number }> = [];
    let balance = totalAmount;

    for (let i = 0; i < installments; i++) {
      const d = new Date(startYear, startMonth + i, 1);
      const monthLabel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const thisEmi = parseFloat(Math.min(emi, balance).toFixed(2));
      balance = parseFloat(Math.max(0, balance - thisEmi).toFixed(2));
      schedule.push({ month: monthLabel, emi: thisEmi, running_balance: balance });
    }

    return res.json({ success: true, data: schedule });
  })
);

// ---------------------------------------------------------------------------
// DELETE /:id
// Soft-cancel: set status = 'cancelled'. super_admin only.
// Only allowed when loan status is 'active'.
// ---------------------------------------------------------------------------
loansRouter.delete(
  "/:id",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    if (!(await hasAnyRole(userId, "super_admin"))) {
      return res.status(403).json({ success: false, message: "Only super_admin can cancel loans" });
    }

    const { id } = req.params;
    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT id, status FROM employee_loans WHERE id = ? LIMIT 1",
      [id]
    );
    type LoanRow = RowDataPacket & { status: string };
    const loan = (existing as LoanRow[])[0];
    if (!loan) {
      return res.status(404).json({ success: false, message: "Loan not found" });
    }
    if (loan.status !== "active") {
      return res.status(400).json({
        success: false,
        message: `Only active loans can be cancelled (current status: ${loan.status})`,
      });
    }

    await db.execute<ResultSetHeader>(
      "UPDATE employee_loans SET status = 'cancelled' WHERE id = ?",
      [id]
    );

    void logSensitiveAction({
      actor_user_id: userId,
      actor_role: req.authUser!.role,
      action_type: "loan_cancelled",
      module_key: "payroll_loans",
      entity_type: "employee_loan",
      entity_id: id,
      old_value_json: { status: "active" },
      new_value_json: { status: "cancelled" },
      req,
    });

    return res.json({ success: true, message: "Loan cancelled successfully" });
  })
);
