import { Router } from "express";
import { z } from "zod";
import { db as pool } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { canViewEmployee, resolveUserBusinessScope, buildEmployeeScopeCondition } from "../../shared/enterpriseScope.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

export const employeeReactivationRouter = Router();

// All routes require authentication
employeeReactivationRouter.use(requireAuth);

// ── Types ─────────────────────────────────────────────────────────────────────

type ReactivationRow = {
  id: string;
  employee_id: string;
  old_employment_status: string;
  proposed_joining_date: string;
  reinstatement_reason: string;
  gap_days: number;
  same_cost_centre: number;
  ff_already_paid: number;
  status: string;
  exit_request_id: string | null;
  new_branch_id: string | null;
  new_process_id: string | null;
  new_cost_centre_id: string | null;
  initiated_by: string;
  initiated_at: string;
  branch_head_actioned_by: string | null;
  branch_head_actioned_at: string | null;
  branch_head_remarks: string | null;
  hr_final_actioned_by: string | null;
  hr_final_actioned_at: string | null;
  hr_final_remarks: string | null;
  created_at: string;
  updated_at: string;
  // joined fields
  employee_code?: string;
  employee_name?: string;
  branch_name?: string;
  cost_centre_name?: string;
  initiated_by_name?: string;
  branch_head_name?: string;
  hr_final_name?: string;
};

// ── GET /reactivation/pending ─────────────────────────────────────────────────
// Returns all requests pending action for the current user's role

employeeReactivationRouter.get("/reactivation/pending", async (req: AuthenticatedRequest, res) => {
  try {
    const role = req.authUser?.role ?? "";
    const userId = req.authUser?.id;
    const isHR = ["hr", "admin", "super_admin"].includes(role);
    const isBranchHead = role === "branch_head";

    if (!isHR && !isBranchHead) {
      return res.json({ success: true, data: [] });
    }

    // branch_head previously saw every pending reactivation request company-wide — this
    // handler's own prior comment admitted it ("branch heads see all for now"). Scoped via
    // the same employee-scope mechanism (shared/enterpriseScope.ts) used across the rest of
    // this delta-audit remediation (delta-audit 2026-08-14, P1). hr/admin/super_admin stay
    // unrestricted (buildEmployeeScopeCondition's own admin/hr/super_admin/ceo bypass).
    let scopeCondition: { sql: string; params: unknown[] } = { sql: "1=1", params: [] };
    if (isBranchHead && !isHR) {
      const scope = await resolveUserBusinessScope(userId!);
      scopeCondition = buildEmployeeScopeCondition(scope, {
        employeeId: "e.id",
        branchId: "e.branch_id",
        processId: "e.process_id",
      });
    }

    const query = `
      SELECT
        r.*,
        e.employee_code,
        CONCAT(e.first_name, ' ', e.last_name) as employee_name
      FROM employee_reactivation_requests r
      JOIN employees e ON r.employee_id = e.id
      WHERE r.status IN ('pending', 'branch_head_approved')
        AND (${scopeCondition.sql})
      ORDER BY r.created_at DESC
    `;

    const [rows] = await pool.execute<(ReactivationRow & RowDataPacket)[]>(query, scopeCondition.params);

    res.json({ success: true, data: rows });
  } catch (err: any) {
    console.error("[Reactivation] Failed to fetch pending:", err);
    res.status(500).json({ success: false, message: err.message ?? "Failed to load pending requests" });
  }
});

// ── GET /reactivation/all ─────────────────────────────────────────────────────
// Returns all requests with pagination and optional status filter

employeeReactivationRouter.get("/reactivation/all", async (req: AuthenticatedRequest, res) => {
  try {
    const role = req.authUser?.role ?? "";
    const isHR = ["hr", "admin", "super_admin"].includes(role);
    const isPayrollHead = role === "payroll_head";

    if (!isHR && !isPayrollHead) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit ?? "20"), 10)));
    const offset = (page - 1) * limit;
    const statusFilter = req.query.status ? String(req.query.status) : "";

    let whereClause = "";
    const params: any[] = [];

    if (statusFilter) {
      whereClause = "WHERE r.status = ?";
      params.push(statusFilter);
    }

    const countQuery = `SELECT COUNT(*) as total FROM employee_reactivation_requests r ${whereClause}`;
    const [countRows] = await pool.execute<(RowDataPacket & { total: number })[]>(countQuery, params);
    const total = countRows[0]?.total ?? 0;

    const dataQuery = `
      SELECT
        r.*,
        e.employee_code,
        CONCAT(e.first_name, ' ', e.last_name) as employee_name
      FROM employee_reactivation_requests r
      JOIN employees e ON r.employee_id = e.id
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [rows] = await pool.execute<(ReactivationRow & RowDataPacket)[]>(dataQuery, params);

    res.json({ success: true, data: rows, total, page, limit });
  } catch (err: any) {
    console.error("[Reactivation] Failed to fetch all:", err);
    res.status(500).json({ success: false, message: err.message ?? "Failed to load reactivations" });
  }
});

// ── GET /reactivation/:id ─────────────────────────────────────────────────────
// Returns single request detail

employeeReactivationRouter.get(
  "/reactivation/:id",
  // This endpoint carried NO role check at all before this fix — any authenticated user of
  // any role could fetch full detail (employee name, branch, cost centre, every actor's
  // identity) of any reactivation request by guessing/incrementing :id (delta-audit
  // 2026-08-14, P0: missing auth, not just missing scope).
  requireRole("hr", "admin", "super_admin", "branch_head"),
  async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT
        r.*,
        e.employee_code,
        COALESCE(NULLIF(e.full_name, ''), TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, '')))) as employee_name,
        b.branch_name as branch_name,
        cc.cost_centre_name as cost_centre_name,
        COALESCE(
          NULLIF(initiator.full_name, ''),
          NULLIF(TRIM(CONCAT(COALESCE(initiator.first_name, ''), ' ', COALESCE(initiator.last_name, ''))), ''),
          init_user.email
        ) as initiated_by_name,
        COALESCE(
          NULLIF(branch_head_actor.full_name, ''),
          NULLIF(TRIM(CONCAT(COALESCE(branch_head_actor.first_name, ''), ' ', COALESCE(branch_head_actor.last_name, ''))), ''),
          branch_head_user.email
        ) as branch_head_name,
        COALESCE(
          NULLIF(hr_final_actor.full_name, ''),
          NULLIF(TRIM(CONCAT(COALESCE(hr_final_actor.first_name, ''), ' ', COALESCE(hr_final_actor.last_name, ''))), ''),
          hr_final_user.email
        ) as hr_final_name
      FROM employee_reactivation_requests r
      JOIN employees e ON r.employee_id = e.id
      LEFT JOIN branch_master b ON e.branch_id = b.id
      LEFT JOIN cost_centre_master cc ON e.cost_centre_id = cc.id
      LEFT JOIN auth_user init_user ON r.initiated_by = init_user.id
      LEFT JOIN employees initiator ON initiator.user_id = init_user.id AND initiator.active_status = 1
      LEFT JOIN auth_user branch_head_user ON r.branch_head_actioned_by = branch_head_user.id
      LEFT JOIN employees branch_head_actor ON branch_head_actor.user_id = branch_head_user.id AND branch_head_actor.active_status = 1
      LEFT JOIN auth_user hr_final_user ON r.hr_final_actioned_by = hr_final_user.id
      LEFT JOIN employees hr_final_actor ON hr_final_actor.user_id = hr_final_user.id AND hr_final_actor.active_status = 1
      WHERE r.id = ?
    `;

    const [rows] = await pool.execute<(ReactivationRow & RowDataPacket)[]>(query, [id]);

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }

    // branch_head previously had no scope check here either — combined with the missing
    // role gate above, any branch_head (or, before this fix, any authenticated user at all)
    // could read a reactivation request for an employee outside their own branch.
    if (!(await canViewEmployee(req.authUser!.id, String(rows[0].employee_id)))) {
      return res.status(403).json({ success: false, message: "This reactivation request is not in your assigned scope" });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err: any) {
    console.error("[Reactivation] Failed to fetch detail:", err);
    res.status(500).json({ success: false, message: err.message ?? "Failed to load request" });
  }
  }
);

// ── POST /reactivation/initiate ───────────────────────────────────────────────
// Creates a new reactivation request

const initiateSchema = z.object({
  employee_id: z.string().uuid(),
  proposed_joining_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reinstatement_reason: z.string().min(10),
  // No placement change fields - reactivation is always to same position
});

employeeReactivationRouter.post(
  "/reactivation/initiate",
  requireRole("hr", "admin", "super_admin"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const body = initiateSchema.parse(req.body);
      const initiatedBy = req.authUser!.id;

      // Check employee exists and is inactive
      const [empRows] = await pool.execute<(RowDataPacket & { employment_status: string; date_of_exit: string | null; cost_centre_id: string | null })[]>(
        "SELECT employment_status, date_of_exit, cost_centre_id FROM employees WHERE id = ?",
        [body.employee_id]
      );

      if (!empRows.length) {
        return res.status(404).json({ success: false, message: "Employee not found" });
      }

      const emp = empRows[0];

      if (emp.employment_status === "Active") {
        return res.status(400).json({ success: false, message: "Employee is already active" });
      }

      // Check if there's already a pending request
      const [existingRows] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM employee_reactivation_requests WHERE employee_id = ? AND status IN ('pending', 'branch_head_approved')",
        [body.employee_id]
      );

      if (existingRows.length > 0) {
        return res.status(400).json({ success: false, message: "A pending reactivation request already exists for this employee" });
      }

      // Calculate gap days
      const exitDate = emp.date_of_exit ? new Date(emp.date_of_exit) : null;
      const proposedDate = new Date(body.proposed_joining_date);
      const gapDays = exitDate ? Math.floor((proposedDate.getTime() - exitDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;

      // Reactivation only allowed within 30 days
      // Beyond 30 days = fresh onboarding through ATS required
      if (gapDays > 30) {
        return res.status(400).json({
          success: false,
          message: "Gap exceeds 30 days. Employee must complete fresh onboarding through ATS with new documentation and background verification.",
          reason: "REQUIRES_FRESH_ONBOARDING"
        });
      }

      // Reactivation is always to same branch/process/cost centre
      const sameCostCentre = 1;

      // Check if F&F was already paid (placeholder logic - adjust based on your exit schema)
      const [ffRows] = await pool.execute<(RowDataPacket & { ff_paid: number })[]>(
        "SELECT IF(ff_settlement_paid_on IS NOT NULL, 1, 0) as ff_paid FROM exit_requests WHERE employee_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1",
        [body.employee_id]
      );
      const ffAlreadyPaid = ffRows.length > 0 ? ffRows[0].ff_paid : 0;

      // Insert request
      const insertQuery = `
        INSERT INTO employee_reactivation_requests (
          employee_id, old_employment_status, proposed_joining_date, reinstatement_reason,
          gap_days, same_cost_centre, ff_already_paid, status,
          initiated_by, initiated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NOW())
      `;

      const [result] = await pool.execute<ResultSetHeader>(insertQuery, [
        body.employee_id,
        emp.employment_status,
        body.proposed_joining_date,
        body.reinstatement_reason.trim(),
        gapDays,
        sameCostCentre,
        ffAlreadyPaid,
        initiatedBy,
      ]);

      res.status(201).json({ success: true, id: result.insertId, message: "Reactivation request created successfully" });
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ success: false, message: "Invalid input", errors: err.errors });
      }
      console.error("[Reactivation] Failed to initiate:", err);
      res.status(500).json({ success: false, message: err.message ?? "Failed to create request" });
    }
  }
);

// ── POST /reactivation/:id/branch-action ──────────────────────────────────────
// Branch head approves or rejects

const branchActionSchema = z.object({
  action: z.enum(["approved", "rejected"]),
  remarks: z.string().min(5),
});

employeeReactivationRouter.post(
  "/reactivation/:id/branch-action",
  requireRole("branch_head", "hr", "admin", "super_admin"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const body = branchActionSchema.parse(req.body);
      const actionedBy = req.authUser!.id;

      // Fetch current request
      const [rows] = await pool.execute<(ReactivationRow & RowDataPacket)[]>(
        "SELECT * FROM employee_reactivation_requests WHERE id = ?",
        [id]
      );

      if (!rows.length) {
        return res.status(404).json({ success: false, message: "Request not found" });
      }

      const request = rows[0];

      // branch_head previously had no scope check at all here and could approve/reject any
      // employee's reactivation in any branch, simply by supplying its :id (delta-audit
      // 2026-08-14, P1). hr/admin/super_admin stay unrestricted, matching every other role
      // in this module and canViewEmployee's own admin/hr/super_admin/ceo bypass.
      if (!(await canViewEmployee(actionedBy, String(request.employee_id)))) {
        return res.status(403).json({ success: false, message: "This reactivation request is not in your assigned scope" });
      }

      if (request.status !== "pending") {
        return res.status(400).json({ success: false, message: "Request is not pending branch head action" });
      }

      const newStatus = body.action === "approved" ? "branch_head_approved" : "rejected";

      await pool.execute(
        `UPDATE employee_reactivation_requests
         SET status = ?, branch_head_actioned_by = ?, branch_head_actioned_at = NOW(), branch_head_remarks = ?
         WHERE id = ?`,
        [newStatus, actionedBy, body.remarks.trim(), id]
      );

      res.json({ success: true, message: `Request ${body.action} by branch head` });
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ success: false, message: "Invalid input", errors: err.errors });
      }
      console.error("[Reactivation] Branch action failed:", err);
      res.status(500).json({ success: false, message: err.message ?? "Failed to process action" });
    }
  }
);

// ── POST /reactivation/:id/hr-action ──────────────────────────────────────────
// HR final action: confirmed (reactivates employee) or rejected

const hrActionSchema = z.object({
  action: z.enum(["confirmed", "rejected"]),
  remarks: z.string().min(5),
});

employeeReactivationRouter.post(
  "/reactivation/:id/hr-action",
  requireRole("hr", "admin", "super_admin"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const body = hrActionSchema.parse(req.body);
      const actionedBy = req.authUser!.id;

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        // Fetch request
        const [rows] = await conn.execute<(ReactivationRow & RowDataPacket)[]>(
          "SELECT * FROM employee_reactivation_requests WHERE id = ? FOR UPDATE",
          [id]
        );

        if (!rows.length) {
          await conn.rollback();
          return res.status(404).json({ success: false, message: "Request not found" });
        }

        const request = rows[0];

        if (request.status !== "branch_head_approved") {
          await conn.rollback();
          return res.status(400).json({ success: false, message: "Request is not pending HR final action" });
        }

        const newStatus = body.action === "confirmed" ? "approved" : "rejected";

        await conn.execute(
          `UPDATE employee_reactivation_requests
           SET status = ?, hr_final_actioned_by = ?, hr_final_actioned_at = NOW(), hr_final_remarks = ?
           WHERE id = ?`,
          [newStatus, actionedBy, body.remarks.trim(), id]
        );

        // If confirmed, reactivate the employee (same employee code, same placement)
        if (body.action === "confirmed") {
          await conn.execute(
            `UPDATE employees
             SET employment_status = 'Active',
                 active_status = 1,
                 date_of_exit = NULL,
                 date_of_joining = ?
             WHERE id = ?`,
            [request.proposed_joining_date, request.employee_id]
          );
        }

        await conn.commit();

        res.json({
          success: true,
          message: body.action === "confirmed" ? "Employee reactivated successfully" : "Request rejected",
        });
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ success: false, message: "Invalid input", errors: err.errors });
      }
      console.error("[Reactivation] HR action failed:", err);
      res.status(500).json({ success: false, message: err.message ?? "Failed to process action" });
    }
  }
);
