import { Router } from "express";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { db as pool } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { canViewEmployee } from "../../shared/enterpriseScope.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { evaluateRehire } from "./rehire/rehireEligibility.js";
import { loadRehireFacts } from "./rehire/rehireFacts.js";
import { isFormerReport } from "./rehire/rehireAccess.js";

export const employeeGovernanceRouter = Router();

employeeGovernanceRouter.use(requireAuth);

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

// ── GET /:id/rehire-eligibility?proposed_joining_date=YYYY-MM-DD ──────────────
// Read-only. Powers the live eligibility panel on the raise form, so HR or a manager sees
// "blocked: terminated" BEFORE filling the form. Same facts and same rules as initiate and
// as the approval re-check, so the three can never disagree.
employeeGovernanceRouter.get(
  "/:id/rehire-eligibility",
  requireRole("hr", "admin", "super_admin", "manager", "branch_head"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = DATE.safeParse(req.query.proposed_joining_date);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "proposed_joining_date (YYYY-MM-DD) is required" });
      }
      const employeeId = String(req.params.id);
      const userId = req.authUser!.id;

      if (!(await canViewEmployee(userId, employeeId))) {
        return res.status(403).json({ success: false, message: "This employee is outside your branch / assigned scope" });
      }
      if (req.authUser!.role === "manager" && !(await isFormerReport(pool, employeeId, userId))) {
        return res.status(403).json({ success: false, message: "You can look this up only for an employee who reported to you" });
      }

      const loaded = await loadRehireFacts(pool, employeeId, parsed.data);
      if (!loaded) return res.status(404).json({ success: false, message: "Employee not found" });

      return res.json({
        success: true,
        data: {
          employeeId,
          proposedJoiningDate: parsed.data,
          gapDays: loaded.facts.gapDays,
          previousEndDate: loaded.previousEndDate,
          eligibility: evaluateRehire(loaded.facts),
        },
      });
    } catch (err: any) {
      console.error("[Governance] rehire-eligibility failed:", err);
      return res.status(500).json({ success: false, message: err.message ?? "Failed to check eligibility" });
    }
  },
);
const flagSchema = z.object({
  reason: z.string().trim().min(10, "Give the reason (at least 10 characters)"),
  flag_date: DATE.optional(),
  document_url: z.string().trim().url().max(500).optional(),
});

const todayIso = () => new Date().toISOString().slice(0, 10);

// ── POST /:id/rehire-block/flag ───────────────────────────────────────────────
// HR records a disciplinary finding. It can be set at any time, including after the person has left
// (a fraud found in an audit). Flagging again re-arms a block a super_admin had lifted.
// A pending rejoin request is not cancelled here: approval re-evaluates eligibility from live facts
// (rejoinActivation.ts) and will refuse it.
employeeGovernanceRouter.post(
  "/:id/rehire-block/flag",
  requireRole("hr", "admin", "super_admin"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const body = flagSchema.parse(req.body);
      const employeeId = String(req.params.id);
      const actorId = req.authUser!.id;

      if (!(await canViewEmployee(actorId, employeeId))) {
        return res.status(403).json({ success: false, message: "This employee is outside your branch / assigned scope" });
      }
      const [emp] = await pool.execute<RowDataPacket[]>("SELECT id FROM employees WHERE id = ?", [employeeId]);
      if (!emp.length) return res.status(404).json({ success: false, message: "Employee not found" });

      const flagDate = body.flag_date ?? todayIso();
      await pool.execute(
        `INSERT INTO employee_rehire_control
           (employee_id, disciplinary_flag, disciplinary_reason, disciplinary_flag_date, disciplinary_flagged_by, disciplinary_document_url)
         VALUES (?, 1, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           disciplinary_flag = 1,
           disciplinary_reason = VALUES(disciplinary_reason),
           disciplinary_flag_date = VALUES(disciplinary_flag_date),
           disciplinary_flagged_by = VALUES(disciplinary_flagged_by),
           disciplinary_document_url = VALUES(disciplinary_document_url),
           block_lifted_by = NULL, block_lifted_at = NULL, block_lift_reason = NULL`,
        [employeeId, body.reason, flagDate, actorId, body.document_url ?? null],
      );

      await logSensitiveAction({
        actor_user_id: actorId,
        action_type: "REHIRE_DISCIPLINARY_FLAG_SET",
        module_key: "employees",
        entity_type: "employee",
        entity_id: employeeId,
        employee_id: employeeId,
        change_summary: { fields: ["disciplinary_flag"] },
        new_value_json: { disciplinary_flag: 1, flag_date: flagDate },
        reason: body.reason,
        req,
      });

      return res.json({ success: true, message: "Disciplinary flag recorded. This employee can no longer be rejoined." });
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ success: false, message: "Invalid input", errors: err.errors });
      }
      console.error("[Governance] flag failed:", err);
      return res.status(500).json({ success: false, message: err.message ?? "Failed to record the flag" });
    }
  },
);

const liftSchema = z.object({
  reason: z.string().trim().min(20, "A lift needs a written reason of at least 20 characters"),
});

// ── POST /:id/rehire-block/lift ───────────────────────────────────────────────
// super_admin ONLY — requireRole("super_admin") rejects admin and hr. This clears only the
// disciplinary-flag block. Termination, misconduct and performance exits stay blocked regardless:
// evaluateRehire never consults the lift for those.
employeeGovernanceRouter.post(
  "/:id/rehire-block/lift",
  requireRole("super_admin"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const body = liftSchema.parse(req.body);
      const employeeId = String(req.params.id);
      const actorId = req.authUser!.id;

      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT disciplinary_flag, block_lifted_at FROM employee_rehire_control WHERE employee_id = ?",
        [employeeId],
      );
      const row = rows[0];
      if (!row || Number(row.disciplinary_flag) !== 1) {
        return res.status(409).json({ success: false, message: "There is no disciplinary flag on this employee to lift" });
      }
      if (row.block_lifted_at != null) {
        return res.status(409).json({ success: false, message: "This flag has already been lifted" });
      }

      await pool.execute(
        `UPDATE employee_rehire_control
            SET block_lifted_by = ?, block_lifted_at = NOW(), block_lift_reason = ?
          WHERE employee_id = ?`,
        [actorId, body.reason, employeeId],
      );

      await logSensitiveAction({
        actor_user_id: actorId,
        action_type: "REHIRE_BLOCK_LIFTED",
        module_key: "employees",
        entity_type: "employee",
        entity_id: employeeId,
        employee_id: employeeId,
        change_summary: { fields: ["block_lifted_at"] },
        reason: body.reason,
        req,
      });

      return res.json({ success: true, message: "Disciplinary block lifted." });
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ success: false, message: "Invalid input", errors: err.errors });
      }
      console.error("[Governance] lift failed:", err);
      return res.status(500).json({ success: false, message: err.message ?? "Failed to lift the block" });
    }
  },
);
