/**
 * Employee warnings. The record lives on the employee (employee_warning) and every issue/withdrawal is
 * also written to the existing employee_journey_log, so it shows on the same Journey timeline as every
 * other lifecycle event. View: the employee, HR/admin, and the reporting line (TL and AM). Issue: HR/admin
 * or a manager for someone in their span. Never for yourself.
 */
import { Router, type NextFunction, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { db } from "../../db/mysql.js";
import {
  requireAuth,
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { spanClauseFor } from "../../shared/reportingSpan.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import {
  WARNING_CATEGORIES,
  WARNING_SEVERITIES,
  forViewer,
  type ViewerRelation,
  type WarningRecord,
} from "./warnings.pure.js";

export const warningsRouter = Router();
warningsRouter.use(requireAuth);

const HR_ROLES = ["super_admin", "admin", "hr", "hr_admin"] as const;
const MANAGER_ROLES = [
  "manager",
  "assistant_manager",
  "tl",
  "team_leader",
  "branch_head",
  "process_manager",
] as const;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const issueSchema = z.object({
  employeeId: z.string().trim().min(1).max(36),
  warningDate: isoDay,
  category: z.enum(WARNING_CATEGORIES),
  severity: z.enum(WARNING_SEVERITIES),
  description: z.string().trim().min(5).max(2000),
  remarks: z.string().trim().max(1000).nullish(),
});
const withdrawSchema = z.object({ reason: z.string().trim().min(3).max(1000) });

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const wrap =
  (fn: Handler) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };

async function inSpan(
  callerEmployeeId: string,
  employeeId: string,
): Promise<boolean> {
  const span = spanClauseFor(callerEmployeeId, "e");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 AS ok FROM employees e WHERE e.id = ? AND ${span.sql} LIMIT 1`,
    [employeeId, ...span.params],
  );
  return rows.length > 0;
}

/** How the caller relates to the employee, or null when they may not see this employee's warnings. */
async function relationTo(
  req: AuthenticatedRequest,
  employeeId: string,
): Promise<ViewerRelation | null> {
  const caller = await getEmployeeForUser(req.authUser.id);
  if (caller?.id && String(caller.id) === employeeId) return "self";
  if (await hasAnyRole(req.authUser.id, ...HR_ROLES)) return "hr";
  if (caller?.id && (await inSpan(String(caller.id), employeeId)))
    return "span";
  return null;
}

const rowToRecord = (r: RowDataPacket): WarningRecord => ({
  id: String(r.id),
  employeeId: String(r.employee_id),
  warningDate: String(r.warning_date),
  category: String(r.category),
  severity: String(r.severity),
  description: String(r.description),
  remarks: (r.remarks as string | null) ?? null,
  status: r.status as "active" | "withdrawn",
  issuedByName: (r.issued_by_name as string | null) ?? null,
  withdrawnAt: (r.withdrawn_at as string | null) ?? null,
  withdrawnByName: (r.withdrawn_by_name as string | null) ?? null,
  withdrawnReason: (r.withdrawn_reason as string | null) ?? null,
  createdAt: String(r.created_at),
});

const COLUMNS = `id, employee_id, DATE_FORMAT(warning_date, '%Y-%m-%d') AS warning_date, category, severity, description, remarks, status,
  issued_by_name, DATE_FORMAT(withdrawn_at, '%Y-%m-%d %H:%i') AS withdrawn_at, withdrawn_by_name, withdrawn_reason,
  DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS created_at`;

async function journey(
  employeeId: string,
  eventType: string,
  description: string,
  actorId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO employee_journey_log (id, employee_id, event_type, event_date, description, module, triggered_by, metadata)
       VALUES (UUID(), ?, ?, CURDATE(), ?, 'warnings', ?, ?)`,
      [employeeId, eventType, description, actorId, JSON.stringify(metadata)],
    );
  } catch (err) {
    // The warning itself is the record; a timeline write failure must not undo it.
    console.error("[warnings] journey log failed:", (err as Error).message);
  }
}

warningsRouter.get(
  "/employee/:employeeId",
  wrap(async (req, res) => {
    const employeeId = String(req.params.employeeId).slice(0, 36);
    const relation = await relationTo(req, employeeId);
    if (!relation)
      return res.status(403).json({
        success: false,
        message: "You cannot view this employee's warnings.",
      });
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM employee_warning WHERE employee_id = ? ORDER BY warning_date DESC, created_at DESC LIMIT 200`,
      [employeeId],
    );
    const canIssue =
      relation !== "self" &&
      (relation === "hr" ||
        (await hasAnyRole(req.authUser.id, ...MANAGER_ROLES)));
    return res.json({
      success: true,
      data: {
        relation,
        canIssue,
        warnings: forViewer(rows.map(rowToRecord), relation),
      },
    });
  }),
);

warningsRouter.post(
  "/",
  requireWriteAccess,
  wrap(async (req, res) => {
    const parsed = issueSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid warning",
      });
    const input = parsed.data;
    const relation = await relationTo(req, input.employeeId);
    if (!relation || relation === "self")
      return res.status(403).json({
        success: false,
        message: "You cannot issue a warning to this employee.",
      });
    if (
      relation === "span" &&
      !(await hasAnyRole(req.authUser.id, ...MANAGER_ROLES))
    ) {
      return res.status(403).json({
        success: false,
        message: "Only a manager or HR can issue a warning.",
      });
    }
    const [idRows] = await db.execute<RowDataPacket[]>("SELECT UUID() AS id");
    const id = String(idRows[0].id);
    const issuer = req.authUser.email ?? req.authUser.id;
    await db.execute(
      `INSERT INTO employee_warning (id, employee_id, warning_date, category, severity, description, remarks, issued_by, issued_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.employeeId,
        input.warningDate,
        input.category,
        input.severity,
        input.description,
        input.remarks ?? null,
        req.authUser.id,
        issuer,
      ],
    );
    await journey(
      input.employeeId,
      "warning_issued",
      `${input.severity} warning (${input.category}) issued`,
      req.authUser.id,
      {
        warningId: id,
        category: input.category,
        severity: input.severity,
      },
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM employee_warning WHERE id = ? LIMIT 1`,
      [id],
    );
    return res.status(201).json({ success: true, data: rowToRecord(rows[0]) });
  }),
);

warningsRouter.patch(
  "/:id/withdraw",
  requireWriteAccess,
  wrap(async (req, res) => {
    const parsed = withdrawSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        success: false,
        message: parsed.error.issues[0]?.message ?? "A reason is required",
      });
    const id = String(req.params.id).slice(0, 36);
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT employee_id, issued_by, status FROM employee_warning WHERE id = ? LIMIT 1",
      [id],
    );
    const target = rows[0];
    if (!target)
      return res
        .status(404)
        .json({ success: false, message: "Warning not found" });
    const isHr = await hasAnyRole(req.authUser.id, ...HR_ROLES);
    if (!isHr && String(target.issued_by) !== req.authUser.id) {
      return res.status(403).json({
        success: false,
        message: "Only HR or the person who issued it can withdraw a warning.",
      });
    }
    if (target.status === "withdrawn")
      return res.status(409).json({
        success: false,
        message: "This warning is already withdrawn.",
      });
    await db.execute(
      "UPDATE employee_warning SET status = 'withdrawn', withdrawn_at = NOW(), withdrawn_by_name = ?, withdrawn_reason = ? WHERE id = ?",
      [req.authUser.email ?? req.authUser.id, parsed.data.reason, id],
    );
    await journey(
      String(target.employee_id),
      "warning_withdrawn",
      "Warning withdrawn",
      req.authUser.id,
      { warningId: id },
    );
    const [after] = await db.execute<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM employee_warning WHERE id = ? LIMIT 1`,
      [id],
    );
    return res.json({ success: true, data: rowToRecord(after[0]) });
  }),
);
