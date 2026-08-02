/**
 * Super Admin configuration of provisioning notification recipients.
 *
 * The preview endpoint matters as much as the CRUD. Recipients were previously
 * derived from three tables and nothing showed the result, so a wrong routing
 * stayed invisible until someone noticed the mail arriving at the wrong desk.
 * Configuring without seeing the outcome is how that happened; this screen
 * always shows who would actually be emailed.
 */
import { Router, type NextFunction, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  CONFIGURABLE_EVENTS, listBranchRecipients, upsertRecipient, removeRecipient,
  getConfiguredRecipients,
} from "./notification-recipients.service.js";

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

// Configuration decides who is told about a new joiner across every branch, so
// it is Super Admin only — matching the signing-certificate router.
router.use(requireAuth, requireRole("super_admin", "admin"));

/** The events that can be configured, for the UI to render. */
router.get("/events", h(async (_req, res) => {
  return res.json({ success: true, data: CONFIGURABLE_EVENTS });
}));

/** Branches worth configuring — active ones, and any that already have config. */
router.get("/branches", h(async (_req, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT b.id, b.branch_name, b.branch_code, b.active_status,
            (SELECT COUNT(*) FROM employees e WHERE e.branch_id = b.id AND e.active_status = 1) AS headcount
       FROM branch_master b
      WHERE b.active_status = 1
         OR EXISTS (SELECT 1 FROM employees e WHERE e.branch_id = b.id AND e.active_status = 1)
      ORDER BY b.branch_name`,
  );
  return res.json({ success: true, data: rows });
}));

router.get("/:branchId", h(async (req, res) => {
  return res.json({ success: true, data: await listBranchRecipients(String(req.params.branchId)) });
}));

/**
 * Who would actually be emailed for each event at this branch, and on what
 * basis — configured, derived from the branch SPOC, or escalated to the branch
 * head because neither exists.
 */
router.get("/:branchId/effective", h(async (req, res) => {
  const branchId = String(req.params.branchId);
  const out: Array<Record<string, unknown>> = [];

  for (const ev of CONFIGURABLE_EVENTS) {
    const configured = await getConfiguredRecipients(branchId, ev.code);
    if (configured) {
      out.push({
        eventCode: ev.code, label: ev.label, basis: "configured",
        to: configured.to.map((t) => t.email), cc: configured.cc,
      });
      continue;
    }

    // Mirrors the fallback in it-provisioning.service.ts so the preview shows
    // what would really happen, not what is configured.
    const [spocs] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT au.email, e.full_name
         FROM user_assignment_scope uas
         JOIN auth_user au ON au.id = uas.user_id
         LEFT JOIN employees e ON e.user_id = au.id
        WHERE uas.role_key = ? AND uas.branch_id = ? AND uas.active_status = 1
          AND au.email IS NOT NULL AND COALESCE(au.is_blocked, 0) = 0`,
      [ev.fallbackRole, branchId],
    ).catch(() => [[]] as unknown as [RowDataPacket[]]);

    if (spocs.length > 0) {
      out.push({
        eventCode: ev.code, label: ev.label, basis: "branch_spoc",
        to: spocs.map((r) => String(r.email)), cc: [],
      });
      continue;
    }

    const [head] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT au.email
         FROM branch_head_assignments bha
         JOIN branch_master b ON b.branch_name = bha.branch_name
         JOIN employees e ON e.id = bha.branch_head_id AND e.active_status = 1
         JOIN auth_user au ON au.id = e.user_id
        WHERE b.id = ? AND bha.is_active = TRUE`,
      [branchId],
    ).catch(() => [[]] as unknown as [RowDataPacket[]]);

    out.push({
      eventCode: ev.code, label: ev.label,
      basis: head.length ? "branch_head_escalation" : "none",
      to: head.map((r) => String(r.email)), cc: [],
    });
  }
  return res.json({ success: true, data: out });
}));

router.post("/", h(async (req, res) => {
  const b = req.body as Record<string, unknown>;
  const result = await upsertRecipient({
    branchId: String(b.branchId ?? ""),
    eventCode: String(b.eventCode ?? ""),
    recipientType: b.recipientType === "cc" ? "cc" : "to",
    employeeId: typeof b.employeeId === "string" ? b.employeeId : null,
    email: typeof b.email === "string" ? b.email : null,
    remarks: typeof b.remarks === "string" ? b.remarks : null,
    actorUserId: req.authUser?.id ?? null,
  });
  return res.json({ success: true, data: result });
}));

router.delete("/:id", h(async (req, res) => {
  await removeRecipient(String(req.params.id), req.authUser?.id ?? null);
  return res.json({ success: true });
}));

/** Employee search, so a recipient can be picked rather than typed. */
router.get("/lookup/employees", h(async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const branchId = typeof req.query.branchId === "string" ? req.query.branchId : null;
  if (q.length < 2) return res.json({ success: true, data: [] });
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.full_name, au.email, b.branch_name, d.designation_name
       FROM employees e
       LEFT JOIN auth_user au ON au.id = e.user_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN designation_master d ON d.id = e.designation_id
      WHERE e.active_status = 1
        AND (e.full_name LIKE ? OR e.employee_code LIKE ?)
        ${branchId ? "AND (e.branch_id = ? OR ? IS NULL)" : ""}
      ORDER BY (e.branch_id = ?) DESC, e.full_name
      LIMIT 20`,
    branchId ? [`%${q}%`, `%${q}%`, branchId, branchId, branchId] : [`%${q}%`, `%${q}%`, ""],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  return res.json({ success: true, data: rows });
}));

export const notificationRecipientsRouter = router;
