/**
 * Payroll HR issuance of appointment letters.
 *
 * A separate router from appointment-esign.routes.ts, which is admin/hr only and
 * sits on a table carrying two competing schemas.
 *
 * ── The role note that used to sit here was backwards ────────────────────────
 *
 * It read: "payroll_hr has no alias in the role model, so it must be named
 * explicitly on every route — requireRole('payroll') does NOT admit a payroll_hr
 * user." The truth is the exact reverse, and it cost this module its main
 * audience.
 *
 * DASHBOARD_ROLE_ALIASES in shared/dashboardAccessRegistry.ts maps
 * `payroll_hr -> payroll`, and getUserRoleKeys() runs every resolved role
 * through it. So a payroll_hr user arrives at requireRole ALREADY REWRITTEN to
 * `payroll`, and naming "payroll_hr" on a route matches nobody. Proven live
 * 2026-09-08 against the ESI module with a real token for a payroll_hr holder:
 * refused, with her roles logged as [employee, hr, payroll, recruiter].
 *
 * The effect here was precise and easy to miss: `payroll` is in VIEW_ROLES but
 * was not in ISSUE_ROLES, so Payroll HR could see the queue and open an
 * employee, and every attempt to actually issue returned 403 — on the router
 * whose own first line says it exists for Payroll HR issuance.
 *
 * `payroll` is therefore added to ISSUE_ROLES. That does also admit the holders
 * of a plain `payroll` role, and that is not a choice this route can make
 * differently: the alias makes the two the same principal to every RBAC check
 * in the system. Separating them means removing the alias, which is a
 * system-wide change and is deliberately not made from here.
 */
import { Router, type NextFunction, type Response } from "express";
import fs from "fs";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import {
  appointmentLetterSearchTerm,
  evaluateAppointmentLetterEligibility, listAppointmentLetterQueue,
} from "./appointmentLetterEligibility.service.js";
import { issueAppointmentLetter, revokeAppointmentLetter } from "./appointmentLetterIssue.service.js";
import {
  resendAppointmentAcceptLink, checkAppointmentEsignStatus, getAppointmentResendOptions,
} from "./appointmentLetterResend.service.js";
import { parseResendRequest, maskEmailAddress } from "./appointmentLetterResendRecipients.js";
import { renderAppointmentLetterPdf } from "./appointmentLetterPdf.service.js";
import { resolveEmployeeLetterhead, assertPrintableLetterhead } from "../org/branchAddress.service.js";
import { resolveAppointmentLetterSalary } from "./appointmentLetterData.service.js";
import { AcceptedCopyError, loadAcceptedCopy } from "./appointmentLetterSignedCopy.service.js";
import { auditAppointmentLetter } from "./appointmentLetterAudit.js";

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

// `payroll` is how a payroll_hr user actually presents (see the header above).
// payroll_hr is kept alongside it: it is what this list MEANS, and it starts
// working on its own the day the alias is removed.
const ISSUE_ROLES = ["super_admin", "admin", "payroll", "payroll_hr", "payroll_head", "hr"] as const;
const VIEW_ROLES = [...ISSUE_ROLES, "branch_head"] as const;

router.use(requireAuth);

/**
 * Branch RBAC.
 *
 * requireRole() above only asks *what* the user is; every route here also has to
 * ask *whose employees* they may act on. A branch HR holds the same `hr` role as
 * a head-office HR, so without this the queue, the issued list and every
 * per-employee action were org-wide for all of them.
 *
 * The axis is the branch alone, as decided for this screen: a scope row of any
 * other type (process, department, team) contributes nothing and leaves the user
 * with an empty queue rather than a wider one. scope_type='all' — which every
 * payroll_head and the head-office admin/hr accounts hold — still means org-wide,
 * and super_admin bypasses inside buildScopeWhereClause().
 */
async function branchScope(req: AuthenticatedRequest, branchColumn: string) {
  return buildScopeWhereClause(req.authUser!.id, [...VIEW_ROLES], { branchId: branchColumn });
}

/**
 * True when this employee sits inside the actor's branch scope.
 *
 * Issuing, previewing and eligibility all take an employee id from the URL, so
 * list-level scoping alone would leave the whole flow reachable by guessing or
 * remembering an id from another branch.
 */
async function employeeInScope(req: AuthenticatedRequest, employeeId: string): Promise<boolean> {
  const scope = await branchScope(req, "e.branch_id");
  if (scope.sql === "1=1") return true;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 AS ok FROM employees e WHERE e.id = ? AND (${scope.sql}) LIMIT 1`,
    [employeeId, ...scope.params],
  );
  return (rows as RowDataPacket[]).length > 0;
}

const OUT_OF_SCOPE = "Forbidden: this employee is outside your assigned branch scope";

/** The work list: who can be issued to, and why the rest cannot. */
router.get("/appointment-letters/queue", requireRole(...VIEW_ROLES), h(async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 200) || 200, 500);
  const scope = await branchScope(req, "e.branch_id");
  const rows = await listAppointmentLetterQueue(limit, {
    scopeSql: scope.sql,
    scopeParams: scope.params,
    search: typeof req.query.search === "string" ? req.query.search : null,
  });
  return res.json({
    success: true,
    data: {
      eligible: rows.filter((r) => r.eligible),
      blocked: rows.filter((r) => !r.eligible),
      counts: { eligible: rows.filter((r) => r.eligible).length, blocked: rows.filter((r) => !r.eligible).length },
      scope: scope.sql === "1=1" ? "all" : "branch",
    },
  });
}));

router.get("/appointment-letters/eligibility/:employeeId", requireRole(...VIEW_ROLES), h(async (req, res) => {
  if (!(await employeeInScope(req, req.params.employeeId))) {
    return res.status(403).json({ success: false, message: OUT_OF_SCOPE });
  }
  return res.json({ success: true, data: await evaluateAppointmentLetterEligibility(req.params.employeeId) });
}));

/** Issue. Warnings need force=true; critical blockers can never be forced. */
router.post("/appointment-letters/:employeeId/issue", requireRole(...ISSUE_ROLES), h(async (req, res) => {
  if (!(await employeeInScope(req, req.params.employeeId))) {
    return res.status(403).json({ success: false, message: OUT_OF_SCOPE });
  }
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
  // The letter row carries its own branch_id, but the employee's is the one that
  // stays current if they move, so the employee's is preferred and the letter's
  // is the fallback for a letter whose employee row has since gone.
  const scope = await branchScope(req, "COALESCE(e.branch_id, i.branch_id)");
  const conds = [`(${scope.sql})`];
  const params: unknown[] = [...scope.params];

  const search = String(req.query.search ?? "").trim();
  if (search) {
    conds.push("(i.employee_name LIKE ? OR i.employee_code LIKE ? OR i.letter_number LIKE ?)");
    const term = appointmentLetterSearchTerm(search);
    params.push(term, term, term);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT i.id, i.letter_number, i.employee_id, i.employee_code, i.employee_name, i.designation,
            i.branch_name, i.date_of_joining, i.is_ca_issued, i.employee_esign_status,
            i.employee_esign_at, i.status, i.issued_at, i.revoked_at,
            EXISTS (SELECT 1 FROM appointment_letter_esign_transaction t
                     WHERE t.issue_id = i.id AND t.status = 'signed' AND t.signed_file_path IS NOT NULL) AS has_accepted_copy,
            (SELECT t.signed_file_sha256 FROM appointment_letter_esign_transaction t
              WHERE t.issue_id = i.id AND t.status = 'signed' AND t.signed_file_path IS NOT NULL
              ORDER BY t.completed_at DESC, t.initiated_at DESC LIMIT 1) AS accepted_copy_sha256
       FROM appointment_letter_issue i
       LEFT JOIN employees e ON e.id = i.employee_id
      WHERE ${conds.join(" AND ")}
      ORDER BY i.issued_at DESC
      LIMIT ${Math.min(Number(req.query.limit ?? 100) || 100, 500)}`,
    params,
  );
  // EXISTS comes back as 0/1; the screen wants a real boolean.
  const data = (rows as RowDataPacket[]).map((r) => ({ ...r, has_accepted_copy: Number(r.has_accepted_copy) === 1 }));
  return res.json({ success: true, data });
}));

/**
 * Download a letter PDF.
 *
 *  ?copy=original (default)  the company-signed letter, exactly as before.
 *  ?copy=accepted            the copy the employee signed with Aadhaar eSign,
 *                            served from the newest signed eSign transaction.
 *  ?inline=1                 render in the browser instead of attaching.
 */
router.get("/appointment-letters/:issueId/download", requireRole(...VIEW_ROLES), h(async (req, res) => {
  const copy = String(req.query.copy ?? "original").toLowerCase();
  if (copy !== "original" && copy !== "accepted") {
    return res.status(400).json({ success: false, message: "copy must be 'original' or 'accepted'" });
  }
  // Scoped in the lookup rather than after it: the PDF carries the employee's
  // salary, so an out-of-branch letter must not even be read back here.
  const scope = await branchScope(req, "COALESCE(e.branch_id, i.branch_id)");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT i.letter_number, i.signed_file_path
       FROM appointment_letter_issue i
       LEFT JOIN employees e ON e.id = i.employee_id
      WHERE i.id = ? AND (${scope.sql}) LIMIT 1`,
    [req.params.issueId, ...scope.params],
  );
  const r = (rows as RowDataPacket[])[0];
  if (!r) return res.status(404).json({ success: false, message: "Letter not found" });

  const inline = req.query.inline === "1" || req.query.inline === "true";

  if (copy === "accepted") {
    try {
      const file = await loadAcceptedCopy(req.params.issueId, String(r.letter_number));
      await auditAppointmentLetter(req.params.issueId, "SIGNED_COPY_VIEWED", req.authUser!.id, {
        transactionId: file.transactionId, inline,
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Length", String(file.bytes.length));
      res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${file.fileName.replace(/"/g, "")}"`);
      return res.end(file.bytes);
    } catch (error) {
      if (error instanceof AcceptedCopyError) {
        return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
      }
      throw error;
    }
  }

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
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${r.letter_number}.pdf"`);
  return fs.createReadStream(p).pipe(res);
}));

/**
 * Preview the appointment letter as a PDF — no saving, no signing, no DB writes.
 * Uses real employee data where available; falls back to placeholder salary if
 * salary_component_assignments has no record yet.
 */
router.get("/appointment-letters/preview/:employeeId", requireRole(...VIEW_ROLES), h(async (req, res) => {
  const { employeeId } = req.params;
  if (!(await employeeInScope(req, employeeId))) {
    return res.status(403).json({ success: false, message: OUT_OF_SCOPE });
  }
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.full_name, e.date_of_joining, e.salary_start_date,
            d.designation_name
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
      WHERE e.id = ? LIMIT 1`,
    [employeeId],
  );
  const emp = (empRows as RowDataPacket[])[0];
  if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });

  // Resolve letterhead — falls back to city/state if no full address
  const { EMPTY_LETTERHEAD } = await import("../org/branchAddress.service.js");
  const letterhead = await resolveEmployeeLetterhead(employeeId).then(assertPrintableLetterhead).catch(() => ({
    ...EMPTY_LETTERHEAD,
    branchName: "Head Office",
    addressLines: ["MAS Callnet India Pvt. Ltd.", "Noida, Uttar Pradesh"],
    hasAddress: true,
  }));

  // Resolve salary — the Payroll-Head-approved package, or a marked placeholder.
  //
  // Preview is a draft: no letter number, no signature, no DB write, nothing
  // sent. So it may render without an approved package, where issuance may not.
  // What it must never do is show a plausible-looking salary that nobody
  // approved, so the fallback is explicit zeros carrying the reason the real
  // figures are absent — the renderer prints unavailableLines on the letter.
  let salary: Awaited<ReturnType<typeof resolveAppointmentLetterSalary>>;
  try {
    salary = await resolveAppointmentLetterSalary(employeeId);
  } catch (err) {
    salary = {
      basic: 0, hra: 0, lta: 0, conveyance: 0, otherAllowance: 0,
      specialAllowance: 0, bonus: 0, medicalAllowance: 0, portfolio: 0,
      pli: 0, gross: 0, esicEmployee: 0, epfEmployee: 0, netSalary: 0,
      esicEmployer: 0, epfEmployer: 0, adminCharges: 0, ctc: 0,
      source: "payroll_head_approved_package", sourceRef: null,
      approvedBy: null, approvedAt: null, packageEffectiveFrom: null,
      pfApplicable: false, esicApplicable: false,
      unavailableLines: [
        `PREVIEW ONLY — no approved salary: ${err instanceof Error ? err.message : "reason unknown"}`,
      ],
    };
  }

  const pdfBytes = await renderAppointmentLetterPdf({
    employeeName: String(emp.full_name ?? ""),
    employeeCode: String(emp.employee_code ?? ""),
    designation: String(emp.designation_name ?? ""),
    dateOfJoining: emp.date_of_joining ?? null,
    salaryStartDate: emp.salary_start_date ?? null,
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

/**
 * True when this issued letter sits inside the actor's branch scope. Resend and
 * status-check act on a letter id from the URL, so scope is resolved here in the
 * lookup rather than trusted from the list the button came from.
 */
async function issuedLetterInScope(req: AuthenticatedRequest, issueId: string): Promise<boolean> {
  const scope = await branchScope(req, "COALESCE(e.branch_id, i.branch_id)");
  const [owned] = await db.execute<RowDataPacket[]>(
    `SELECT 1 AS ok
       FROM appointment_letter_issue i
       LEFT JOIN employees e ON e.id = i.employee_id
      WHERE i.id = ? AND (${scope.sql}) LIMIT 1`,
    [issueId, ...scope.params],
  );
  return (owned as RowDataPacket[]).length > 0;
}

/**
 * Re-email the employee's Review & Accept link. Mirrors the joining kit's
 * "resend": a fresh token is minted (only hashes are stored), the provider is
 * never touched.
 *
 * With no body this goes to the addresses on the employee record, as always.
 * With `{ recipients, reason }` it goes ONLY to those addresses (see
 * appointmentLetterResend.service.ts). Same roles and the same branch scope
 * either way — the scope check runs before the body is even read.
 */
router.post("/appointment-letters/:issueId/resend-link", requireRole(...ISSUE_ROLES), h(async (req, res) => {
  if (!(await issuedLetterInScope(req, req.params.issueId))) {
    return res.status(403).json({ success: false, message: OUT_OF_SCOPE });
  }
  const custom = parseResendRequest(req.body); // throws a 400 with a readable message
  const out = await resendAppointmentAcceptLink({ issueId: req.params.issueId, actorUserId: req.authUser!.id, custom });
  if (!out.resent) {
    return res.status(out.status ?? 409).json({ success: false, message: out.message, data: { resent: false, message: out.message } });
  }
  const emailedTo = (out.emailedTo ?? []).map(maskEmailAddress);
  const message = `Accept link ${custom ? "sent" : "re-sent"} to ${emailedTo.join(", ")}.`;
  return res.json({
    success: true,
    message,
    data: { letterNumber: out.letterNumber, emailedTo, sentAt: out.sentAt },
  });
}));

/**
 * What the Resend dialog shows: the employee's registered addresses (masked) and
 * the resend history. Same roles as the resend itself, and the same branch scope.
 */
router.get("/appointment-letters/:issueId/resend-options", requireRole(...ISSUE_ROLES), h(async (req, res) => {
  if (!(await issuedLetterInScope(req, req.params.issueId))) {
    return res.status(403).json({ success: false, message: OUT_OF_SCOPE });
  }
  return res.json({ success: true, data: await getAppointmentResendOptions(req.params.issueId) });
}));

/** Pull the employee's signature state from the provider now (HR does not have to wait for the scheduled check). */
router.post("/appointment-letters/:issueId/esign/check", requireRole(...ISSUE_ROLES), h(async (req, res) => {
  if (!(await issuedLetterInScope(req, req.params.issueId))) {
    return res.status(403).json({ success: false, message: OUT_OF_SCOPE });
  }
  const data = await checkAppointmentEsignStatus(req.params.issueId);
  return res.json({ success: true, data });
}));

router.post("/appointment-letters/:issueId/revoke", requireRole("super_admin", "admin", "payroll_head"), h(async (req, res) => {
  // admin is a branch-scoped role for some holders, so revoke is scoped too.
  const scope = await branchScope(req, "COALESCE(e.branch_id, i.branch_id)");
  const [owned] = await db.execute<RowDataPacket[]>(
    `SELECT 1 AS ok
       FROM appointment_letter_issue i
       LEFT JOIN employees e ON e.id = i.employee_id
      WHERE i.id = ? AND (${scope.sql}) LIMIT 1`,
    [req.params.issueId, ...scope.params],
  );
  if ((owned as RowDataPacket[]).length === 0) {
    return res.status(403).json({ success: false, message: OUT_OF_SCOPE });
  }
  const reason = String((req.body as Record<string, unknown>).reason ?? "");
  await revokeAppointmentLetter({ issueId: req.params.issueId, actorUserId: req.authUser!.id, reason });
  return res.json({ success: true, message: "Appointment letter revoked." });
}));

export const appointmentLetterRouter = router;
