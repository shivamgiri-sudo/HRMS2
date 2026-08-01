/**
 * Payroll HR issuance of appointment letters.
 *
 * A separate router from appointment-esign.routes.ts, which is admin/hr only and
 * sits on a table carrying two competing schemas. payroll_hr has no alias in the
 * role model, so it must be named explicitly on every route — requireRole('payroll')
 * does NOT admit a payroll_hr user.
 */
import { Router, type NextFunction, type Response } from "express";
import fs from "fs";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  evaluateAppointmentLetterEligibility, listAppointmentLetterQueue,
} from "./appointmentLetterEligibility.service.js";
import { issueAppointmentLetter, revokeAppointmentLetter } from "./appointmentLetterIssue.service.js";

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

const ISSUE_ROLES = ["super_admin", "admin", "payroll_hr", "payroll_head", "hr"] as const;
const VIEW_ROLES = [...ISSUE_ROLES, "payroll", "branch_head"] as const;

router.use(requireAuth);

/** The work list: who can be issued to, and why the rest cannot. */
router.get("/appointment-letters/queue", requireRole(...VIEW_ROLES), h(async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 200) || 200, 500);
  const rows = await listAppointmentLetterQueue(limit);
  return res.json({
    success: true,
    data: {
      eligible: rows.filter((r) => r.eligible),
      blocked: rows.filter((r) => !r.eligible),
      counts: { eligible: rows.filter((r) => r.eligible).length, blocked: rows.filter((r) => !r.eligible).length },
    },
  });
}));

router.get("/appointment-letters/eligibility/:employeeId", requireRole(...VIEW_ROLES), h(async (req, res) => {
  return res.json({ success: true, data: await evaluateAppointmentLetterEligibility(req.params.employeeId) });
}));

/** Issue. Warnings need force=true; critical blockers can never be forced. */
router.post("/appointment-letters/:employeeId/issue", requireRole(...ISSUE_ROLES), h(async (req, res) => {
  const b = req.body as Record<string, unknown>;
  const data = await issueAppointmentLetter({
    employeeId: req.params.employeeId,
    actorUserId: req.authUser!.id,
    force: b.force === true || b.force === "true",
    overrideReason: typeof b.override_reason === "string" ? b.override_reason : null,
  });
  return res.json({ success: true, data });
}));

router.get("/appointment-letters", requireRole(...VIEW_ROLES), h(async (req, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, letter_number, employee_id, employee_code, employee_name, designation,
            branch_name, date_of_joining, is_ca_issued, employee_esign_status,
            status, issued_at, revoked_at
       FROM appointment_letter_issue
      ORDER BY issued_at DESC
      LIMIT ${Math.min(Number(req.query.limit ?? 100) || 100, 500)}`,
  );
  return res.json({ success: true, data: rows });
}));

/** Download the signed PDF. */
router.get("/appointment-letters/:issueId/download", requireRole(...VIEW_ROLES), h(async (req, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT letter_number, signed_file_path FROM appointment_letter_issue WHERE id = ? LIMIT 1`,
    [req.params.issueId],
  );
  const r = (rows as RowDataPacket[])[0];
  if (!r) return res.status(404).json({ success: false, message: "Letter not found" });

  const p = String(r.signed_file_path ?? "");
  if (!p || !fs.existsSync(p)) {
    // Say which letter is missing rather than a bare 404 — the row exists, the
    // file does not, and that distinction is what HR needs to act on.
    return res.status(404).json({
      success: false,
      message: `The signed PDF for ${r.letter_number} is not on disk. It may need to be re-issued.`,
    });
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${r.letter_number}.pdf"`);
  return fs.createReadStream(p).pipe(res);
}));

router.post("/appointment-letters/:issueId/revoke", requireRole("super_admin", "admin", "payroll_head"), h(async (req, res) => {
  const reason = String((req.body as Record<string, unknown>).reason ?? "");
  await revokeAppointmentLetter({ issueId: req.params.issueId, actorUserId: req.authUser!.id, reason });
  return res.json({ success: true, message: "Appointment letter revoked." });
}));

export const appointmentLetterRouter = router;
