import { Router } from "express";
import { z } from "zod";
import { db as pool } from "../../db/mysql.js";
import {
  requireAuth,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  canViewEmployee,
  resolveUserBusinessScope,
  buildEmployeeScopeCondition,
} from "../../shared/enterpriseScope.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { evaluateRehire } from "./rehire/rehireEligibility.js";
import { loadRehireFacts } from "./rehire/rehireFacts.js";
import { isFormerReport } from "./rehire/rehireAccess.js";
import { activateRejoin, RejoinBlockedError } from "./rehire/rejoinActivation.js";
import { runRejoinFollowUps, type FollowUpResult } from "./rehire/rejoinFollowUps.js";
import { realFollowUpDeps } from "./rehire/rejoinFollowUps.deps.js";
import { notifyRejoinRequested, notifyRejoinDecided, notifyFollowUpAttention } from "./rehire/rejoinNotifications.js";

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
// Returns all requests pending action for the current user's role. 'branch_head_approved' is a legacy
// status: the old two-step flow parked requests there for an HR confirmation that no longer exists, so
// those requests are still waiting for the branch head's final decision.

employeeReactivationRouter.get(
  "/reactivation/pending",
  async (req: AuthenticatedRequest, res) => {
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
    // Owner ruling 2026-10-01: hr is branch-scoped too, so the scope is applied to every caller
    // (org-wide roles get 1=1 from buildEmployeeScopeCondition).
    const scope = await resolveUserBusinessScope(userId!);
    const scopeCondition = buildEmployeeScopeCondition(scope, {
      employeeId: "e.id",
      branchId: "e.branch_id",
      processId: "e.process_id",
    });

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

      const [rows] = await pool.execute<(ReactivationRow & RowDataPacket)[]>(
        query,
        scopeCondition.params,
      );

      res.json({ success: true, data: rows });
    } catch (err: any) {
      console.error("[Reactivation] Failed to fetch pending:", err);
      res
        .status(500)
        .json({
          success: false,
          message: err.message ?? "Failed to load pending requests",
        });
    }
  },
);

// ── GET /reactivation/all ─────────────────────────────────────────────────────
// Returns all requests with pagination and optional status filter

employeeReactivationRouter.get(
  "/reactivation/all",
  async (req: AuthenticatedRequest, res) => {
    try {
      const role = req.authUser?.role ?? "";
      const isHR = ["hr", "admin", "super_admin"].includes(role);
      const isPayrollHead = role === "payroll_head";

      if (!isHR && !isPayrollHead) {
        return res
          .status(403)
          .json({ success: false, message: "Unauthorized" });
      }

      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
      const limit = Math.max(
        1,
        Math.min(100, parseInt(String(req.query.limit ?? "20"), 10)),
      );
      const offset = (page - 1) * limit;
      const statusFilter = req.query.status ? String(req.query.status) : "";

    // Branch scoping (owner ruling 2026-10-01): hr only sees reactivations of its own branch.
    const allScope = buildEmployeeScopeCondition(await resolveUserBusinessScope(req.authUser!.id), {
      employeeId: "e.id",
      branchId: "e.branch_id",
      processId: "e.process_id",
    });
    let whereClause = `WHERE (${allScope.sql})`;
    const params: any[] = [...allScope.params];

    if (statusFilter) {
      whereClause += " AND r.status = ?";
      params.push(statusFilter);
    }

    const countQuery = `SELECT COUNT(*) as total FROM employee_reactivation_requests r JOIN employees e ON r.employee_id = e.id ${whereClause}`;
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

      const [rows] = await pool.execute<(ReactivationRow & RowDataPacket)[]>(
        dataQuery,
        params,
      );

      res.json({ success: true, data: rows, total, page, limit });
    } catch (err: any) {
      console.error("[Reactivation] Failed to fetch all:", err);
      res
        .status(500)
        .json({
          success: false,
          message: err.message ?? "Failed to load reactivations",
        });
    }
  },
);

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

      const [rows] = await pool.execute<(ReactivationRow & RowDataPacket)[]>(
        query,
        [id],
      );

      if (!rows.length) {
        return res
          .status(404)
          .json({ success: false, message: "Request not found" });
      }

      // branch_head previously had no scope check here either — combined with the missing
      // role gate above, any branch_head (or, before this fix, any authenticated user at all)
      // could read a reactivation request for an employee outside their own branch.
      if (
        !(await canViewEmployee(req.authUser!.id, String(rows[0].employee_id)))
      ) {
        return res
          .status(403)
          .json({
            success: false,
            message: "This reactivation request is not in your assigned scope",
          });
      }

      res.json({ success: true, data: rows[0] });
    } catch (err: any) {
      console.error("[Reactivation] Failed to fetch detail:", err);
      res
        .status(500)
        .json({
          success: false,
          message: err.message ?? "Failed to load request",
        });
    }
  },
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
  requireRole("hr", "admin", "super_admin", "manager"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const body = initiateSchema.parse(req.body);
      const initiatedBy = req.authUser!.id;
      const role = req.authUser!.role;

      if (!(await canViewEmployee(initiatedBy, body.employee_id))) {
        return res.status(403).json({ success: false, message: "This employee is outside your branch / assigned scope" });
      }

      // A reporting manager may raise only for someone who reported to them.
      if (role === "manager" && !(await isFormerReport(pool, body.employee_id, initiatedBy))) {
        return res.status(403).json({ success: false, message: "You can raise a rejoin only for an employee who reported to you" });
      }

      const loaded = await loadRehireFacts(pool, body.employee_id, body.proposed_joining_date);
      if (!loaded) return res.status(404).json({ success: false, message: "Employee not found" });

      const [activeRows] = await pool.execute<RowDataPacket[]>(
        "SELECT 1 FROM employees WHERE id = ? AND LOWER(employment_status) = 'active' AND active_status = 1",
        [body.employee_id],
      );
      if (activeRows.length) return res.status(400).json({ success: false, message: "Employee is already active" });

      const [existingRows] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM employee_reactivation_requests WHERE employee_id = ? AND status IN ('pending', 'branch_head_approved')",
        [body.employee_id],
      );
      if (existingRows.length > 0) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "A pending reactivation request already exists for this employee",
          });
      }

      const verdict = evaluateRehire(loaded.facts);
      if (verdict.status === "blocked") {
        return res.status(400).json({
          success: false,
          message: verdict.reasons.find((r) => r.severity === "blocked")?.message ?? "Rejoin is not allowed",
          ...(verdict.requiresFreshOnboarding ? { reason: "REQUIRES_FRESH_ONBOARDING" } : {}),
          eligibility: verdict,
        });
      }

      await pool.execute<ResultSetHeader>(
        `INSERT INTO employee_reactivation_requests (
           employee_id, old_employment_status, proposed_joining_date, reinstatement_reason,
           gap_days, same_cost_centre, ff_already_paid, status, exit_request_id, initiated_by,
           raised_by_role, eligibility_status, eligibility_snapshot
         ) VALUES (?, ?, ?, ?, ?, 1, ?, 'pending', ?, ?, ?, ?, ?)`,
        [
          body.employee_id,
          loaded.facts.legacyStatusText ?? "Inactive",
          body.proposed_joining_date,
          body.reinstatement_reason.trim(),
          loaded.facts.gapDays,
          loaded.ffAlreadyPaid ? 1 : 0,
          loaded.exitRequestId,
          initiatedBy,
          role,
          verdict.status,
          JSON.stringify(verdict),
        ],
      );

      // The primary key is CHAR(36) DEFAULT (UUID()), so result.insertId is 0: read the real id back.
      const [idRows] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM employee_reactivation_requests WHERE employee_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
        [body.employee_id],
      );
      const requestId = idRows?.[0]?.id ? String(idRows[0].id) : undefined;
      if (requestId) {
        try { await notifyRejoinRequested(requestId); } catch (e) { console.error("[Reactivation] notify failed:", e); }
      }

      res.status(201).json({ success: true, id: requestId, eligibility: verdict, message: "Rejoin request created" });
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res
          .status(400)
          .json({
            success: false,
            message: "Invalid input",
            errors: err.errors,
          });
      }
      console.error("[Reactivation] Failed to initiate:", err);
      res
        .status(500)
        .json({
          success: false,
          message: err.message ?? "Failed to create request",
        });
    }
  },
);

// ── POST /reactivation/:id/branch-action ──────────────────────────────────────
// Branch head approves or rejects

const branchActionSchema = z.object({
  action: z.enum(["approved", "rejected"]),
  remarks: z.string().min(5),
  // Required (true) and remarks >= 20 chars when the leaver absconded.
  absconding_acknowledged: z.boolean().optional(),
});

employeeReactivationRouter.post(
  "/reactivation/:id/branch-action",
  requireRole("branch_head"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const body = branchActionSchema.parse(req.body);
      const actionedBy = req.authUser!.id;

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [rows] = await conn.execute<(ReactivationRow & RowDataPacket)[]>(
          "SELECT * FROM employee_reactivation_requests WHERE id = ? FOR UPDATE",
          [id],
        );
        if (!rows.length) {
          await conn.rollback();
          return res
            .status(404)
            .json({ success: false, message: "Request not found" });
        }
        const request = rows[0];

        if (!(await canViewEmployee(actionedBy, String(request.employee_id)))) {
          await conn.rollback();
          return res.status(403).json({ success: false, message: "This reactivation request is not in your assigned scope" });
        }
        // 'branch_head_approved' rows were left by the old flow at the removed HR step: the branch head
        // finishes them here, through the same eligibility-checked activation.
        if (request.status !== "pending" && request.status !== "branch_head_approved") {
          await conn.rollback();
          return res.status(400).json({ success: false, message: "Request is not pending branch head action" });
        }

        // mysql2 returns a JSON column as an object, so stringify before searching it.
        const isAbsconding = JSON.stringify((request as { eligibility_snapshot?: unknown }).eligibility_snapshot ?? {}).includes('"ABSCONDING"');
        if (body.action === "approved" && isAbsconding) {
          if (body.absconding_acknowledged !== true || body.remarks.trim().length < 20) {
            await conn.rollback();
            return res.status(400).json({ success: false, message: "This employee absconded: tick the acknowledgement and give remarks of at least 20 characters" });
          }
        }

        await conn.execute(
          `UPDATE employee_reactivation_requests
              SET status = ?, absconding_acknowledged = ?,
                  branch_head_actioned_by = ?, branch_head_actioned_at = NOW(), branch_head_remarks = ?
            WHERE id = ?`,
          [body.action === "approved" ? "approved" : "rejected", body.absconding_acknowledged === true ? 1 : 0, actionedBy, body.remarks.trim(), id],
        );

        if (body.action === "approved") {
          const verdict = await activateRejoin(
            conn,
            { id: request.id, employee_id: request.employee_id, proposed_joining_date: request.proposed_joining_date, absconding_acknowledged: body.absconding_acknowledged === true ? 1 : 0 },
            actionedBy,
            body.remarks.trim(),
          );
          // The 20-character rule above reads the snapshot stored when the request was raised, which requests from
          // the old flow do not have. The live verdict is the authority, so enforce it here too: throwing rolls the
          // whole activation back (the catch below does the rollback).
          if (verdict.requiresAbscondingAck && body.remarks.trim().length < 20) {
            throw new RejoinBlockedError(verdict, "This employee absconded: give remarks of at least 20 characters");
          }
        }

        await conn.commit();

        // After the commit, never inside the transaction: the follow-ups use the pool, and their failure
        // must not undo an approval that is already durable.
        let followUps: FollowUpResult[] = [];
        if (body.action === "approved") {
          const rawDate: unknown = request.proposed_joining_date;
          const rejoinDate = rawDate instanceof Date ? rawDate.toISOString().slice(0, 10) : String(rawDate).slice(0, 10);
          try {
            followUps = await runRejoinFollowUps(pool, realFollowUpDeps, {
              requestId: String(request.id),
              employeeId: String(request.employee_id),
              approverId: actionedBy,
              rejoinDate,
            });
          } catch (e) {
            console.error("[Reactivation] follow-ups failed after approval:", e);
          }
        }

        // Best effort, after the commit and the follow-ups: a notification problem never changes the result.
        try {
          await notifyRejoinDecided(String(request.id), body.action === "approved" ? "approved" : "rejected");
          if (body.action === "approved" && followUps.some((f) => f.ok === false)) {
            await notifyFollowUpAttention(String(request.id), followUps);
          }
        } catch (e) {
          console.error("[Reactivation] notify failed:", e);
        }

        return res.json({
          success: true,
          message: body.action === "approved" ? "Rejoin approved; employee is active again" : "Rejoin request rejected",
          followUps,
        });
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res
          .status(400)
          .json({
            success: false,
            message: "Invalid input",
            errors: err.errors,
          });
      }
      if (err instanceof RejoinBlockedError) {
        return res.status(400).json({ success: false, message: err.message, eligibility: err.verdict });
      }
      console.error("[Reactivation] Branch action failed:", err);
      res.status(500).json({ success: false, message: err.message ?? "Failed to process action" });
    }
  },
);

// ── POST /reactivation/:id/hr-action ──────────────────────────────────────────
// Removed: the branch head's approval now activates the employee.

employeeReactivationRouter.post(
  "/reactivation/:id/hr-action",
  requireRole("hr", "admin", "super_admin"),
  (_req, res) => {
    res.status(410).json({
      success: false,
      message: "HR confirmation was removed. The branch head's approval now activates the employee.",
    });
  },
);
