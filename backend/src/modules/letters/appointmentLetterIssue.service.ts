/**
 * Issuing an appointment letter.
 *
 * The last step of joining formalities: Payroll HR pushes it, and only to people
 * who have genuinely finished everything it depends on. The order matters —
 * the company signs first, then the employee receives it and accepts with their
 * own Aadhaar eSign.
 *
 *   eligibility -> salary -> branch letterhead -> render PDF -> company DSC
 *   -> store -> email the employee -> employee Aadhaar eSign
 *
 * Nothing here degrades quietly. A missing certificate, an unresolvable salary
 * or a branch without an address stops issuance with a named reason, because a
 * letter that is wrong is worse than a letter that is late.
 */
import { randomUUID, createHash } from "crypto";
import fs from "fs";
import path from "path";
import QRCode from "qrcode";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { evaluateAppointmentLetterEligibility } from "./appointmentLetterEligibility.service.js";
import { resolveAppointmentLetterSalary } from "./appointmentLetterData.service.js";
import { resolveEmployeeLetterhead, assertPrintableLetterhead } from "../org/branchAddress.service.js";
import { renderAppointmentLetterPdf } from "./appointmentLetterPdf.service.js";
import { signPdfAsCompany } from "./dscSigner.service.js";
import { allocateLetterNumber, mintVerificationToken, verificationUrl } from "./appointmentLetterVerify.service.js";
import { istDisplayDate } from "./letterFormat.js";

const STORAGE_ROOT = () => path.resolve(process.cwd(), "private-storage", "appointment-letters");

function frontendBaseUrl(): string {
  return String(env.FRONTEND_URL ?? "https://mcnhrms.teammas.in").replace(/\/+$/, "");
}

export type IssueResult = {
  issueId: string;
  letterNumber: string;
  verificationUrl: string;
  signedFilePath: string;
  isCaIssued: boolean;
  notice: string | null;
  emailedTo: string[];
  employeeEsignUrl: string | null;
};

async function audit(issueId: string | null, action: string, actorUserId: string | null, detail: unknown) {
  await db.execute(
    `INSERT INTO appointment_letter_issue_audit (id, issue_id, action, actor_user_id, detail_json)
     VALUES (?, ?, ?, ?, CAST(? AS JSON))`,
    [randomUUID(), issueId, action, actorUserId, JSON.stringify(detail ?? {})],
  ).catch(() => undefined);
}

/**
 * Issue the letter.
 *
 * `force` lets Payroll HR proceed past WARNINGS only (an unusual single-word
 * name, a missing designation). It can never bypass a critical blocker — BGV,
 * outstanding documents, no salary, no branch address — because those change
 * what the letter would say, not merely how confident we are about it.
 */
export async function issueAppointmentLetter(params: {
  employeeId: string;
  actorUserId: string;
  force?: boolean;
  overrideReason?: string | null;
}): Promise<IssueResult> {
  const eligibility = await evaluateAppointmentLetterEligibility(params.employeeId);

  if (eligibility.alreadyIssued) {
    throw Object.assign(
      new Error(`An appointment letter (${eligibility.existingLetterNumber}) has already been issued to this employee. Revoke it before issuing another.`),
      { statusCode: 409, code: "already_issued" },
    );
  }
  if (eligibility.blockers.length > 0) {
    // Critical blockers are never forceable.
    throw Object.assign(
      new Error(`Cannot issue: ${eligibility.blockers.map((b) => b.reason).join(" ")}`),
      { statusCode: 409, code: "not_eligible", blockers: eligibility.blockers },
    );
  }
  if (eligibility.warnings.length > 0 && !params.force) {
    throw Object.assign(
      new Error(`Confirm before issuing: ${eligibility.warnings.map((w) => w.reason).join(" ")}`),
      { statusCode: 409, code: "needs_confirmation", warnings: eligibility.warnings },
    );
  }

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.branch_id, e.date_of_joining, e.personal_email,
            COALESCE(NULLIF(TRIM(e.official_email), ''), NULLIF(TRIM(e.office_email), ''), e.email) AS official_email,
            COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS full_name,
            d.designation_name, b.branch_name,
            (SELECT ab.candidate_id FROM ats_onboarding_bridge ab WHERE ab.employee_id = e.id LIMIT 1) AS candidate_id
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
      WHERE e.id = ? LIMIT 1`,
    [params.employeeId],
  );
  const emp = (empRows as RowDataPacket[])[0];
  if (!emp) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });

  const salary = await resolveAppointmentLetterSalary(params.employeeId);
  const letterhead = assertPrintableLetterhead(await resolveEmployeeLetterhead(params.employeeId));

  // The letter number is allocated under a transaction so two concurrent
  // issuances cannot mint the same one.
  const conn = await db.getConnection();
  let letterNumber: string, letterSeq: number, letterYear: number;
  try {
    await conn.beginTransaction();
    ({ letterNumber, letterSeq, letterYear } = await allocateLetterNumber(conn));
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => undefined);
    throw e;
  } finally {
    conn.release();
  }

  const { token, tokenHash } = mintVerificationToken();
  const verifyUrl = verificationUrl(frontendBaseUrl(), token);
  const qr = await QRCode.toDataURL(verifyUrl, { width: 220, margin: 1 }).catch(() => null);

  const unsigned = await renderAppointmentLetterPdf({
    employeeName: String(emp.full_name ?? ""),
    employeeCode: String(emp.employee_code ?? ""),
    designation: String(emp.designation_name ?? ""),
    dateOfJoining: (emp.date_of_joining as Date | string | null) ?? null,
    letterNumber,
    verificationUrl: verifyUrl,
    qrPngDataUrl: qr,
    letterhead,
    salary,
    // Placeholders replaced by the real signer identity below; the block is
    // drawn before signing because a PDF cannot be edited afterwards without
    // invalidating the signature.
    signerName: "",
    signerDesignation: "",
  });

  // Sign, then re-render with the real signer identity. Two passes because the
  // signature block names the signatory, and that name comes from the active
  // certificate rather than from the caller.
  const { requireSigningCertificate } = await import("./dscSigner.service.js");
  const cert = await requireSigningCertificate();
  const finalUnsigned = await renderAppointmentLetterPdf({
    employeeName: String(emp.full_name ?? ""),
    employeeCode: String(emp.employee_code ?? ""),
    designation: String(emp.designation_name ?? ""),
    dateOfJoining: (emp.date_of_joining as Date | string | null) ?? null,
    letterNumber,
    verificationUrl: verifyUrl,
    qrPngDataUrl: qr,
    letterhead,
    salary,
    signerName: cert.signerName,
    signerDesignation: cert.signerDesignation,
    selfSignedNotice: cert.isCaIssued ? null : "Internal draft — not a CCA-licensed digital signature",
  });
  void unsigned;

  const signed = await signPdfAsCompany(finalUnsigned, {
    reason: `Appointment Letter ${letterNumber}`,
    location: letterhead.branchName || "India",
  });

  const dir = path.join(STORAGE_ROOT(), params.employeeId);
  await fs.promises.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${letterNumber}.pdf`);
  await fs.promises.writeFile(filePath, signed.bytes);
  const fileSha = createHash("sha256").update(signed.bytes).digest("hex");

  const issueId = randomUUID();
  await db.execute(
    `INSERT INTO appointment_letter_issue
       (id, letter_number, letter_seq, letter_year, employee_id, candidate_id,
        employee_code, employee_name, designation, branch_id, branch_name,
        date_of_joining, salary_source, salary_snapshot_json,
        certificate_id, signed_by_name, signed_by_designation, is_ca_issued,
        company_signed_at, signed_file_path, file_sha256, verify_token_hash,
        status, issued_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CAST(? AS JSON),?,?,?,?,NOW(),?,?,?,'issued',?)`,
    [
      issueId, letterNumber, letterSeq, letterYear, params.employeeId,
      emp.candidate_id ?? null, emp.employee_code ?? null, emp.full_name ?? null,
      emp.designation_name ?? null, emp.branch_id ?? null, emp.branch_name ?? null,
      emp.date_of_joining ?? null, salary.source, JSON.stringify(salary),
      signed.certificateId, signed.signerName, signed.signerDesignation,
      signed.isCaIssued ? 1 : 0, filePath, fileSha, tokenHash, params.actorUserId,
    ],
  );
  await audit(issueId, "ISSUE", params.actorUserId, {
    letterNumber, salarySource: salary.source, isCaIssued: signed.isCaIssued,
    forced: Boolean(params.force), overrideReason: params.overrideReason ?? null,
  });

  // Email the employee. A delivery failure must not lose the letter — it is
  // already signed and stored, and HR can resend.
  const emailedTo: string[] = [];
  try {
    const { emailService } = await import("../communication/email.service.js");
    const to = [emp.personal_email, emp.official_email]
      .filter((e): e is string => typeof e === "string" && e.includes("@"));
    for (const addr of [...new Set(to)]) {
      await emailService.send({
        to: addr,
        subject: `Your Appointment Letter — ${letterNumber} — MAS Callnet`,
        html: buildAppointmentLetterEmailHtml({
          employeeName: String(emp.full_name ?? ""),
          letterNumber,
          designation: String(emp.designation_name ?? ""),
          dateOfJoining: istDisplayDate(emp.date_of_joining as Date | null),
          verifyUrl,
          acceptUrl: `${frontendBaseUrl()}/employee/appointment-letter/${token}`,
        }),
        attachments: [{ filename: `${letterNumber}.pdf`, content: signed.bytes }],
      });
      emailedTo.push(addr);
    }
    if (emailedTo.length === 0) {
      console.warn(`[appointment-letter] ${letterNumber} not emailed — employee ${params.employeeId} has no email on record`);
    }
  } catch (err) {
    console.warn(`[appointment-letter] ${letterNumber} email failed:`, err instanceof Error ? err.message : err);
  }
  if (emailedTo.length) await audit(issueId, "EMAILED", params.actorUserId, { to: emailedTo.length });

  return {
    issueId,
    letterNumber,
    verificationUrl: verifyUrl,
    signedFilePath: filePath,
    isCaIssued: signed.isCaIssued,
    notice: signed.notice,
    emailedTo,
    employeeEsignUrl: null,
  };
}

export async function revokeAppointmentLetter(params: {
  issueId: string; actorUserId: string; reason: string;
}): Promise<void> {
  if (!params.reason?.trim()) {
    throw Object.assign(new Error("A reason is required to revoke an appointment letter."), { statusCode: 400 });
  }
  const [r] = await db.execute<RowDataPacket[]>(
    `SELECT status FROM appointment_letter_issue WHERE id = ?`, [params.issueId]);
  if (!(r as RowDataPacket[])[0]) throw Object.assign(new Error("Letter not found"), { statusCode: 404 });

  await db.execute(
    `UPDATE appointment_letter_issue
        SET status = 'revoked', revoked_at = NOW(), revoked_by = ?, revoke_reason = ?
      WHERE id = ?`,
    [params.actorUserId, params.reason.trim(), params.issueId],
  );
  await audit(params.issueId, "REVOKE", params.actorUserId, { reason: params.reason.trim() });
}

function buildAppointmentLetterEmailHtml(d: {
  employeeName: string; letterNumber: string; designation: string;
  dateOfJoining: string; verifyUrl: string; acceptUrl: string;
}): string {
  return `<!doctype html><html><body style="margin:0;background:#0f172a;font-family:Segoe UI,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:28px 12px">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
        <tr><td style="background:linear-gradient(135deg,#0891b2,#2563eb);padding:22px 26px">
          <div style="color:#e0f2fe;font-size:11px;letter-spacing:2px;font-weight:800">MAS CALLNET INDIA PVT. LTD.</div>
          <div style="color:#ffffff;font-size:21px;font-weight:800;margin-top:5px">Your Appointment Letter</div>
        </td></tr>
        <tr><td style="padding:26px">
          <p style="margin:0 0 14px;color:#0f172a;font-size:15px">Dear ${d.employeeName},</p>
          <p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.6">
            Congratulations. Your appointment letter is attached to this email, digitally signed by the company.
          </p>
          <table width="100%" style="background:#f1f5f9;border-radius:10px;padding:14px;margin:0 0 18px">
            <tr><td style="color:#475569;font-size:13px;padding:3px 0">Letter ID</td>
                <td style="color:#0f172a;font-size:13px;font-weight:700;text-align:right">${d.letterNumber}</td></tr>
            <tr><td style="color:#475569;font-size:13px;padding:3px 0">Designation</td>
                <td style="color:#0f172a;font-size:13px;font-weight:700;text-align:right">${d.designation || "—"}</td></tr>
            <tr><td style="color:#475569;font-size:13px;padding:3px 0">Date of joining</td>
                <td style="color:#0f172a;font-size:13px;font-weight:700;text-align:right">${d.dateOfJoining || "—"}</td></tr>
          </table>
          <p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.6">
            Please review it and confirm your acceptance by signing electronically.
          </p>
          <a href="${d.acceptUrl}" style="display:block;background:#0891b2;color:#ffffff;text-decoration:none;padding:14px;border-radius:10px;font-weight:700;text-align:center;font-size:15px">Review &amp; Accept</a>
          <p style="margin:16px 0 0;color:#64748b;font-size:12px;line-height:1.6">
            Anyone can confirm this letter is genuine at<br>
            <a href="${d.verifyUrl}" style="color:#0891b2;word-break:break-all">${d.verifyUrl}</a>
          </p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:14px 26px;color:#94a3b8;font-size:11px;text-align:center">
          This is an automated message from MAS Callnet HRMS.
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}
