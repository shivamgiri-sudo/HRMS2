/**
 * HR "Resend link": re-email an issued letter's Review & Accept link.
 *
 * Only hashes are stored, so the link that was originally emailed cannot be
 * rebuilt — a resend has to mint a NEW accept token and email that, exactly as
 * resendKitEsignLink does for the joining kit. The verification token
 * (verify_token_hash, printed as a QR on the signed PDF) is never touched:
 * rotating it would break verification of letters already handed to banks and
 * landlords. That is why the accept link has its own column.
 *
 * Side effect worth knowing: minting an accept token retires the older link for
 * that letter, including the legacy link that carries the verification token
 * (see appointmentLetterPublic.service.ts). The employee is emailed the new one.
 */
import fs from "fs";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { mintAcceptToken, acceptUrl } from "./appointmentLetterAcceptToken.js";
import { auditAppointmentLetter } from "./appointmentLetterAudit.js";
import { buildAppointmentLetterEmailHtml } from "./appointmentLetterIssue.service.js";
import { istDisplayDate } from "./letterFormat.js";
import { syncAppointmentEsignForIssue, type AppointmentSyncOutcome } from "./appointmentLetterEsign.service.js";

const frontendBaseUrl = () => String(env.FRONTEND_URL ?? "https://mcnhrms.teammas.in").replace(/\/+$/, "");

export type ResendOutcome = { resent: boolean; message: string; emailedTo?: string[] };

export async function resendAppointmentAcceptLink(params: {
  issueId: string; actorUserId: string;
}): Promise<ResendOutcome> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT i.id, i.letter_number, i.employee_code, i.employee_name, i.designation,
            i.date_of_joining, i.signed_file_path, i.status, i.revoked_at,
            i.employee_esign_status, i.accept_token_hash,
            e.personal_email,
            COALESCE(NULLIF(TRIM(e.official_email), ''), NULLIF(TRIM(e.office_email), ''), e.email) AS official_email,
            pm.process_name,
            COALESCE(NULLIF(TRIM(mgr.full_name), ''), mgr.employee_code) AS reporting_manager_name
       FROM appointment_letter_issue i
       LEFT JOIN employees e ON e.id = i.employee_id
       LEFT JOIN process_master pm ON pm.id = e.process_id
       LEFT JOIN employees mgr ON mgr.id = COALESCE(e.reporting_manager_id, e.manager_id)
      WHERE i.id = ? LIMIT 1`,
    [params.issueId],
  );
  const letter = (rows as RowDataPacket[])[0];
  if (!letter) throw Object.assign(new Error("Letter not found"), { statusCode: 404 });

  if (letter.revoked_at || String(letter.status) === "revoked") {
    return { resent: false, message: "This letter has been revoked — there is nothing to resend." };
  }
  if (["signed", "completed"].includes(String(letter.employee_esign_status ?? ""))) {
    return { resent: false, message: "The employee has already accepted this letter — there is nothing to resend." };
  }
  const recipients = [letter.personal_email, letter.official_email]
    .filter((e): e is string => typeof e === "string" && e.includes("@"));
  if (recipients.length === 0) {
    return { resent: false, message: "This employee has no email address on record." };
  }

  const previousHash: string | null = letter.accept_token_hash ? String(letter.accept_token_hash) : null;
  const { token, tokenHash } = mintAcceptToken();
  await db.execute(`UPDATE appointment_letter_issue SET accept_token_hash = ? WHERE id = ?`, [tokenHash, params.issueId]);

  const attachments: Array<{ filename: string; content: Buffer }> = [];
  if (letter.signed_file_path) {
    try {
      attachments.push({
        filename: `${letter.letter_number}.pdf`,
        content: await fs.promises.readFile(String(letter.signed_file_path)),
      });
    } catch { /* the link still carries the letter; send without the attachment */ }
  }

  const emailedTo: string[] = [];
  try {
    const { emailService } = await import("../communication/email.service.js");
    const html = buildAppointmentLetterEmailHtml({
      employeeName: String(letter.employee_name ?? ""),
      employeeCode: letter.employee_code ? String(letter.employee_code) : null,
      processName: letter.process_name ? String(letter.process_name) : null,
      reportingManagerName: letter.reporting_manager_name ? String(letter.reporting_manager_name) : null,
      letterNumber: String(letter.letter_number),
      designation: String(letter.designation ?? ""),
      dateOfJoining: istDisplayDate(letter.date_of_joining),
      // The verification link needs the verification token, which is not stored
      // in plaintext and must not be rotated — so it is simply not repeated here.
      verifyUrl: null,
      acceptUrl: acceptUrl(frontendBaseUrl(), token),
    });
    for (const addr of [...new Set(recipients)]) {
      await emailService.send({
        to: addr,
        subject: `Reminder: accept your Appointment Letter — ${letter.letter_number} — MAS Callnet`,
        html,
        attachments,
      });
      emailedTo.push(addr);
    }
  } catch (error) {
    // Nothing reached the employee: put the previous link back rather than
    // leaving them with none that works.
    await db.execute(
      `UPDATE appointment_letter_issue SET accept_token_hash = ? WHERE id = ? AND accept_token_hash = ?`,
      [previousHash, params.issueId, tokenHash],
    ).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    await auditAppointmentLetter(params.issueId, "LINK_RESEND_EMAIL_FAILED", params.actorUserId, { error: message });
    return { resent: false, message: `The email could not be sent: ${message}` };
  }

  await auditAppointmentLetter(params.issueId, "LINK_RESENT", params.actorUserId, { emailedTo });
  return { resent: true, message: `Accept link re-sent to ${emailedTo.join(", ")}.`, emailedTo };
}

/** HR "Check status": pull the employee's signature state from the provider now. */
export async function checkAppointmentEsignStatus(issueId: string): Promise<AppointmentSyncOutcome> {
  return syncAppointmentEsignForIssue(issueId);
}
