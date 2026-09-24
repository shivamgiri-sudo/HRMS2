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
 *
 * Two modes:
 *   - default (no `custom`): email the addresses on the employee record, as ever.
 *   - custom recipients: email ONLY the addresses HR typed (the employee lost
 *     their inbox, or gave a new one). The letter carries salary, so this mode
 *     requires a reason, is rate-limited, is audited in full, and tells the
 *     employee's registered address that a new link went elsewhere. The employee
 *     master email is never modified.
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
import { maskEmailAddress, type CustomResendRequest } from "./appointmentLetterResendRecipients.js";

const frontendBaseUrl = () => String(env.FRONTEND_URL ?? "https://mcnhrms.teammas.in").replace(/\/+$/, "");

/** Custom-recipient resends allowed per letter in any rolling hour. */
export const MAX_RESENDS_PER_HOUR = 5;
const HISTORY_LIMIT = 20;

export type ResendOutcome = {
  resent: boolean;
  message: string;
  /** Full addresses, for internal callers and the audit row. The route masks them. */
  emailedTo?: string[];
  letterNumber?: string;
  sentAt?: string;
  /** HTTP status the route should answer with when `resent` is false. Defaults to 409. */
  status?: number;
};

const escapeHtml = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const normalisedOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.includes("@") ? v.trim().toLowerCase() : null;

async function countRecentResends(issueId: string): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM appointment_letter_issue_audit
      WHERE issue_id = ? AND action = 'LINK_RESENT' AND acted_at >= (NOW() - INTERVAL 1 HOUR)`,
    [issueId],
  );
  return Number((rows as RowDataPacket[])[0]?.n ?? 0);
}

/**
 * Plain security notice to the registered address(es). Carries no link, no
 * salary and no letter contents. Best-effort: returns whether every send worked,
 * and never throws.
 */
async function sendRegisteredAddressNotice(params: {
  to: string[]; employeeName: string; letterNumber: string; maskedRecipients: string[];
}): Promise<boolean> {
  if (params.to.length === 0) return true;
  let allSent = true;
  const where = params.maskedRecipients.join(", ");
  const html = `<p style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#0f172a">Dear ${escapeHtml(params.employeeName)},</p>
<p style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#334155;line-height:1.6">
A new signing link for your appointment letter ${escapeHtml(params.letterNumber)} was sent to ${escapeHtml(where)} at your HR's request.
The link in any earlier email no longer works.</p>
<p style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#334155;line-height:1.6">
If you did not expect this, please tell your HR team right away.</p>`;
  try {
    const { emailService } = await import("../communication/email.service.js");
    for (const addr of params.to) {
      try {
        await emailService.send({
          to: addr,
          subject: `Security notice: a new signing link was sent for ${params.letterNumber} — MAS Callnet`,
          html,
        });
      } catch (error) {
        allSent = false;
        console.warn("[appointment-letter] resend security notice failed:", error instanceof Error ? error.message : error);
      }
    }
  } catch (error) {
    allSent = false;
    console.warn("[appointment-letter] resend security notice unavailable:", error instanceof Error ? error.message : error);
  }
  return allSent;
}

export async function resendAppointmentAcceptLink(params: {
  issueId: string; actorUserId: string; custom?: CustomResendRequest | null;
}): Promise<ResendOutcome> {
  const custom = params.custom ?? null;
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
  const onFile = [...new Set(
    [letter.personal_email, letter.official_email]
      .map(normalisedOrNull)
      .filter((e): e is string => e !== null),
  )];

  let recipients: string[];
  if (custom) {
    if ((await countRecentResends(params.issueId)) >= MAX_RESENDS_PER_HOUR) {
      return {
        resent: false, status: 429,
        message: `This letter has already been resent ${MAX_RESENDS_PER_HOUR} times in the last hour. Please wait before trying again.`,
      };
    }
    recipients = custom.recipients;
  } else {
    // Untouched legacy behaviour: the on-file addresses exactly as stored.
    recipients = [letter.personal_email, letter.official_email]
      .filter((e): e is string => typeof e === "string" && e.includes("@"));
    if (recipients.length === 0) {
      return { resent: false, message: "This employee has no email address on record." };
    }
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
    await auditAppointmentLetter(params.issueId, "LINK_RESEND_EMAIL_FAILED", params.actorUserId, {
      error: message,
      ...(custom ? { customRecipients: true, attemptedTo: recipients, reason: custom.reason } : {}),
    });
    return { resent: false, message: `The email could not be sent: ${message}` };
  }

  const sentAt = new Date().toISOString();
  const letterNumber = String(letter.letter_number);

  if (!custom) {
    await auditAppointmentLetter(params.issueId, "LINK_RESENT", params.actorUserId, { emailedTo });
    return { resent: true, message: `Accept link re-sent to ${emailedTo.join(", ")}.`, emailedTo, letterNumber, sentAt };
  }

  // The registered address(es) hear about it — except any that just received the
  // link themselves. Best-effort: the link has already gone out.
  const noticeTo = onFile.filter((a) => !emailedTo.includes(a));
  const noticeSent = await sendRegisteredAddressNotice({
    to: noticeTo,
    employeeName: String(letter.employee_name ?? ""),
    letterNumber,
    maskedRecipients: emailedTo.map(maskEmailAddress),
  });

  await auditAppointmentLetter(params.issueId, "LINK_RESENT", params.actorUserId, {
    emailedTo,
    customRecipients: true,
    onFile: emailedTo.map((address) => ({ address, onFile: onFile.includes(address) })),
    reason: custom.reason,
    registeredAddressNotified: noticeTo.length === 0 ? null : noticeSent,
  });
  return {
    resent: true,
    message: `Accept link sent to ${emailedTo.map(maskEmailAddress).join(", ")}.`,
    emailedTo, letterNumber, sentAt,
  };
}

export type ResendHistoryEntry = {
  id: string; actedAt: string | null; actor: string | null;
  outcome: "sent" | "failed"; custom: boolean; recipients: string[]; reason: string | null;
};
export type ResendOptions = {
  letterNumber: string;
  onFile: Array<{ kind: "personal" | "official"; masked: string }>;
  history: ResendHistoryEntry[];
};

function parseDetail(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try { const v = JSON.parse(raw); return v && typeof v === "object" ? v as Record<string, unknown> : {}; } catch { return {}; }
  }
  return {};
}

/**
 * What the Resend dialog needs: the registered addresses (masked — the dialog
 * only has to show HR where the one-click option goes) and the resend history.
 * Scope is enforced by the route before this is called.
 */
export async function getAppointmentResendOptions(issueId: string): Promise<ResendOptions> {
  const [letterRows] = await db.execute<RowDataPacket[]>(
    `SELECT i.letter_number, e.personal_email,
            COALESCE(NULLIF(TRIM(e.official_email), ''), NULLIF(TRIM(e.office_email), ''), e.email) AS official_email
       FROM appointment_letter_issue i
       LEFT JOIN employees e ON e.id = i.employee_id
      WHERE i.id = ? LIMIT 1`,
    [issueId],
  );
  const letter = (letterRows as RowDataPacket[])[0];
  if (!letter) throw Object.assign(new Error("Letter not found"), { statusCode: 404 });

  const onFile: ResendOptions["onFile"] = [];
  const seen = new Set<string>();
  for (const [kind, value] of [["personal", letter.personal_email], ["official", letter.official_email]] as const) {
    const addr = normalisedOrNull(value);
    if (addr && !seen.has(addr)) { seen.add(addr); onFile.push({ kind, masked: maskEmailAddress(addr) }); }
  }

  const [auditRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, action, actor_user_id, detail_json, acted_at
       FROM appointment_letter_issue_audit
      WHERE issue_id = ? AND action IN ('LINK_RESENT', 'LINK_RESEND_EMAIL_FAILED')
      ORDER BY acted_at DESC
      LIMIT ${HISTORY_LIMIT}`,
    [issueId],
  );
  const audits = auditRows as RowDataPacket[];

  // Looked up separately rather than joined: the audit table and auth_user were
  // created with different collations, and a join on the ids would need a cast.
  const actors = new Map<string, string>();
  const actorIds = [...new Set(audits.map((a) => a.actor_user_id).filter((v): v is string => typeof v === "string" && v !== ""))];
  if (actorIds.length > 0) {
    try {
      const [users] = await db.execute<RowDataPacket[]>(
        `SELECT id, email FROM auth_user WHERE id IN (${actorIds.map(() => "?").join(",")})`,
        actorIds,
      );
      for (const u of users as RowDataPacket[]) actors.set(String(u.id), String(u.email ?? ""));
    } catch { /* names are a convenience; the history is still useful without them */ }
  }

  const history = audits.map((a): ResendHistoryEntry => {
    const detail = parseDetail(a.detail_json);
    const addrs = Array.isArray(detail.emailedTo) ? detail.emailedTo
      : Array.isArray(detail.attemptedTo) ? detail.attemptedTo : [];
    return {
      id: String(a.id),
      actedAt: a.acted_at ? new Date(a.acted_at as string | Date).toISOString() : null,
      actor: a.actor_user_id ? (actors.get(String(a.actor_user_id)) || null) : null,
      outcome: a.action === "LINK_RESENT" ? "sent" : "failed",
      custom: detail.customRecipients === true,
      recipients: addrs.filter((x): x is string => typeof x === "string").map(maskEmailAddress),
      reason: typeof detail.reason === "string" ? detail.reason : null,
    };
  });
  return { letterNumber: String(letter.letter_number), onFile, history };
}

/** HR "Check status": pull the employee's signature state from the provider now. */
export async function checkAppointmentEsignStatus(issueId: string): Promise<AppointmentSyncOutcome> {
  return syncAppointmentEsignForIssue(issueId);
}
