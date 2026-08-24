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
import { renderAppointmentLetterPdf } from "./appointmentLetterPdf.service.js";
import { resolveEmployeeLetterhead, assertPrintableLetterhead } from "../org/branchAddress.service.js";
import { resolveAppointmentLetterSalary } from "./appointmentLetterData.service.js";

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

/**
 * Preview the appointment letter as a PDF — no saving, no signing, no DB writes.
 * Uses real employee data where available; falls back to placeholder salary if
 * salary_component_assignments has no record yet.
 */
router.get("/appointment-letters/:employeeId/preview-pdf", requireRole(...VIEW_ROLES), h(async (req, res) => {
  const { employeeId } = req.params;
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.full_name, e.date_of_joining,
            d.name AS designation_name
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
      WHERE e.id = ? LIMIT 1`,
    [employeeId],
  );
  const emp = (empRows as RowDataPacket[])[0];
  if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });

  // Resolve letterhead — falls back to city/state if no full address
  const letterhead = await resolveEmployeeLetterhead(employeeId).then(assertPrintableLetterhead).catch(() => ({
    branchName: "Head Office",
    addressLines: ["MAS Callnet India Pvt. Ltd.", "Noida, Uttar Pradesh"],
    gstin: null, cin: null,
  }));

  // Resolve salary — use real data or placeholder
  let salary: Awaited<ReturnType<typeof resolveAppointmentLetterSalary>>;
  try {
    salary = await resolveAppointmentLetterSalary(employeeId);
  } catch {
    salary = {
      basic: 0, hra: 0, lta: 0, conveyance: 0, otherAllowance: 0,
      specialAllowance: 0, bonus: 0, medicalAllowance: 0, portfolio: 0,
      pli: 0, gross: 0, esicEmployee: 0, epfEmployee: 0, netSalary: 0,
      esicEmployer: 0, epfEmployer: 0, adminCharges: 0, ctc: 0,
      source: "salary_component_assignments", sourceRef: null,
      pfApplicable: false, esicApplicable: false,
      unavailableLines: ["Salary not yet assigned — placeholder values shown"],
    };
  }

  const pdfBytes = await renderAppointmentLetterPdf({
    employeeName: String(emp.full_name ?? ""),
    employeeCode: String(emp.employee_code ?? ""),
    designation: String(emp.designation_name ?? ""),
    dateOfJoining: emp.date_of_joining ?? null,
    issueDate: new Date(),
    letterNumber: "PREVIEW-DRAFT",
    verificationUrl: "https://mcnhrms.teammas.in/verify/appointment/PREVIEW",
    qrPngDataUrl: null,
    letterhead,
    salary,
    signerName: "Authorised Signatory",
    signerDesignation: "Director",
    selfSignedNotice: null,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="appointment-letter-preview-${emp.employee_code}.pdf"`);
  res.send(pdfBytes);
}));

router.post("/appointment-letters/:issueId/revoke", requireRole("super_admin", "admin", "payroll_head"), h(async (req, res) => {
  const reason = String((req.body as Record<string, unknown>).reason ?? "");
  await revokeAppointmentLetter({ issueId: req.params.issueId, actorUserId: req.authUser!.id, reason });
  return res.json({ success: true, message: "Appointment letter revoked." });
}));

export const appointmentLetterRouter = router;
