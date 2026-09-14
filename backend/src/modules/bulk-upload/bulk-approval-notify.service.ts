/**
 * Telling the batch creator what happened to their upload.
 *
 * Before this, the uploader heard back in exactly one case: a PARTIAL apply, where
 * `sendPartialApplyEmail` mailed them the failed rows. A rejection — the case they most
 * need to act on — wrote `upload_batch.approval_remarks`, audited it, and told nobody.
 * The person who uploaded a 400-row incentive file found out it had been refused by
 * going back and looking.
 *
 * Three channels, fanned out here so no caller has to know about any of them:
 *
 *   email      — live and reliable (907 sent all-time). Carries the full detail.
 *   work inbox — live. `work_inbox_item` is what the bell and the Work Inbox page read.
 *   SMS        — SmartPing, using the DLT-registered `bulk_upload_failed` template.
 *                See the delivery caveat on sendCreatorSms() below.
 *
 * EVERY channel is independently caught. A notification failure must never roll back or
 * fail an approval decision that has already been committed — the money is either moved
 * or it is not, and an SMTP timeout has no business changing that answer.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { emailService } from "../communication/email.service.js";
import { sendSMS } from "../communication/sms.helper.js";
import { inboxService } from "../inbox/inbox.service.js";
import type { ApprovalStage, BatchRecord } from "./bulk-approval.service.js";

/** What happened, in the creator's terms. */
export type CreatorEvent = "rejected" | "rows_discarded" | "approved" | "partially_applied";

export interface DiscardedLine {
  rowNo: number;
  employeeCode: string;
  employeeName?: string | null;
  amount?: number | null;
  reason: string;
}

export const TYPE_LABEL: Record<string, string> = {
  LEAVE_APPLICATION_BULK: "Leave Application",
  ATTENDANCE_REGULARIZATION_BULK: "Attendance Regularization",
  INCENTIVE_BULK: "Incentive",
  DEDUCTION_BULK: "Deduction",
};

export const STAGE_LABEL: Record<ApprovalStage, string> = {
  branch: "Branch Head",
  payroll: "Payroll Head",
};

interface Creator {
  userId: string;
  email: string | null;
  mobile: string | null;
  name: string;
}

/**
 * Who uploaded this, and how do we reach them?
 *
 * `auth_user` holds the login identity; the phone number lives on `employees`, joined
 * through `employees.user_id`. A user with no employee row (a service account, an admin
 * created directly) simply has no mobile, which the SMS branch treats as "skip", not
 * as an error.
 */
async function resolveCreator(userId: string): Promise<Creator | null> {
  if (!userId) return null;
  // NOTE: auth_user has NO full_name column (verified live 2026-09-03 — its columns are
  // id, email, password_hash and login/lockout bookkeeping only). The display name lives
  // on `employees`, joined through employees.user_id, with the login email as the
  // fallback. Two existing call sites selected auth_user.full_name and could only ever
  // raise ER_BAD_FIELD_ERROR; both are fixed in this change.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT au.id,
            au.email,
            COALESCE(NULLIF(TRIM(e.full_name), ''),
                     NULLIF(TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))), ''),
                     au.email) AS display_name,
            NULLIF(TRIM(e.mobile), '') AS mobile
       FROM auth_user au
       LEFT JOIN employees e ON e.user_id = au.id
      WHERE au.id = ?
      LIMIT 1`,
    [userId],
  );
  const row = (rows as RowDataPacket[])[0];
  if (!row) return null;
  return {
    userId: String(row.id),
    email: row.email ? String(row.email) : null,
    mobile: row.mobile ? String(row.mobile) : null,
    name: String(row.display_name ?? "there"),
  };
}

const HEADLINE: Record<CreatorEvent, string> = {
  rejected: "was rejected",
  rows_discarded: "had rows discarded",
  approved: "was approved",
  partially_applied: "was partially applied",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function buildHtml(params: {
  creatorName: string;
  batchNo: string;
  typeLabel: string;
  stageLabel: string;
  event: CreatorEvent;
  actorName: string;
  reason: string | null;
  lines: DiscardedLine[];
}): string {
  const rows = params.lines
    .map(
      (l) => `<tr>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;color:#64748b">${l.rowNo}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;font-weight:600">${escapeHtml(l.employeeCode)}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0">${escapeHtml(l.employeeName ?? "")}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right">${
        l.amount === null || l.amount === undefined
          ? ""
          : `₹${Number(l.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
      }</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;color:#dc2626">${escapeHtml(l.reason)}</td>
    </tr>`,
    )
    .join("");

  const linesBlock = params.lines.length
    ? `<h3 style="font-size:14px;margin:20px 0 8px;color:#dc2626">Discarded rows</h3>
       <div style="overflow-x:auto">
         <table style="border-collapse:collapse;font-size:12px;width:100%">
           <thead><tr>
             ${["Row #", "Employee Code", "Employee", "Amount", "Reason"]
               .map(
                 (h) =>
                   `<th style="padding:6px 10px;border:1px solid #cbd5e1;background:#f8fafc;text-align:left">${h}</th>`,
               )
               .join("")}
           </tr></thead>
           <tbody>${rows}</tbody>
         </table>
       </div>`
    : "";

  return `
<div style="font-family:Inter,Arial,sans-serif;max-width:900px;margin:0 auto;color:#1e293b">
  <div style="background:linear-gradient(135deg,#2563eb,#4f46e5);padding:20px 28px;border-radius:12px 12px 0 0">
    <h2 style="margin:0;color:#fff;font-size:18px">MAS Callnet PeopleOS — Upload Decision</h2>
  </div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;padding:24px 28px;border-radius:0 0 12px 12px">
    <p>Hi ${escapeHtml(params.creatorName)},</p>
    <p>Your <strong>${escapeHtml(params.typeLabel)}</strong> upload
       <strong>${escapeHtml(params.batchNo)}</strong> ${HEADLINE[params.event]}
       by the <strong>${escapeHtml(params.stageLabel)}</strong> (${escapeHtml(params.actorName)}).</p>
    ${
      params.reason
        ? `<p style="background:#fef2f2;border-left:3px solid #dc2626;padding:10px 14px;margin:14px 0;font-size:13px">
             <strong>Reason:</strong> ${escapeHtml(params.reason)}
           </p>`
        : ""
    }
    ${linesBlock}
    <p style="margin-top:20px;font-size:13px;color:#64748b">
      Open <a href="https://mcnhrms.teammas.in/bulk-upload/approvals" style="color:#2563eb">Bulk Upload Approvals</a>
      to see the batch, or <a href="https://mcnhrms.teammas.in/bulk-upload" style="color:#2563eb">Bulk Upload</a>
      to correct and re-submit.
    </p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
    <p style="font-size:11px;color:#94a3b8">MAS Callnet PeopleOS · Automated notification — do not reply</p>
  </div>
</div>`;
}

/**
 * SMS via SmartPing.
 *
 * `bulk_upload_failed` is a genuinely DLT-registered template (content id
 * 1707178393433983201) whose three variables — name, upload_type, reason — are exactly
 * this message, so this is a legitimate use of the channel rather than a template
 * borrowed to fit.
 *
 * ⚠️ DELIVERY HAS NEVER BEEN OBSERVED WORKING ON THIS SYSTEM. All-time counts are email
 * 907 sent / SMS 0 sent, 901 failed, and SmartPing answers HTTP 200 even when it refuses
 * a send — so a success in the log proves nothing. The raw provider result is logged at
 * info level precisely so that when someone finally checks a handset, there is something
 * to compare against. Email and the Work Inbox carry the same reason regardless, so
 * nothing depends on this landing.
 *
 * The reason is truncated to 120 chars: DLT templates have a fixed registered length and
 * an over-long variable is one of the ways SmartPing silently refuses.
 */
async function sendCreatorSms(
  creator: Creator,
  typeLabel: string,
  reason: string,
): Promise<void> {
  if (!creator.mobile) return;
  const result = await sendSMS(creator.mobile, "bulk_upload_failed", {
    name: creator.name,
    upload_type: typeLabel,
    reason: reason.slice(0, 120),
  });
  logger.info(
    `[bulk-upload] creator SMS ${result.success ? "accepted" : "refused"} ` +
      `(provider success=${result.success}, id=${result.message_id ?? "-"}, error=${result.error ?? "-"}) ` +
      `— note SmartPing returns 200 on refusal; treat as unverified until a handset confirms.`,
  );
}

/**
 * Tell the creator what happened. Never throws.
 *
 * Returns which channels were attempted so the caller can surface it in the API
 * response — an approver who discards a line deserves to know whether the uploader
 * could actually be reached.
 */
export async function notifyBatchCreator(params: {
  batch: BatchRecord;
  event: CreatorEvent;
  stage: ApprovalStage;
  actorUserId: string;
  reason: string | null;
  lines?: DiscardedLine[];
}): Promise<{ email: boolean; inbox: boolean; sms: boolean }> {
  const outcome = { email: false, inbox: false, sms: false };

  const creator = await resolveCreator(params.batch.uploaded_by).catch(() => null);
  if (!creator) return outcome;

  const typeLabel = TYPE_LABEL[params.batch.upload_type_code] ?? params.batch.upload_type_code;
  const stageLabel = STAGE_LABEL[params.stage];
  const lines = params.lines ?? [];

  const [actorRows] = await db
    .execute<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(TRIM(e.full_name), ''), au.email) AS display
         FROM auth_user au
         LEFT JOIN employees e ON e.user_id = au.id
        WHERE au.id = ? LIMIT 1`,
      [params.actorUserId],
    )
    .catch(() => [[]] as unknown as [RowDataPacket[]]);
  const actorName = String((actorRows as RowDataPacket[])[0]?.display ?? stageLabel);

  const summaryLine =
    params.event === "rows_discarded"
      ? `${lines.length} row(s) discarded from ${params.batch.upload_batch_no} by the ${stageLabel}`
      : `${typeLabel} batch ${params.batch.upload_batch_no} ${HEADLINE[params.event]} by the ${stageLabel}`;

  // 1. Email — the full detail, including the discarded-row table.
  if (creator.email && emailService.isConfigured()) {
    try {
      await emailService.send({
        to: creator.email,
        subject: `[PeopleOS] ${typeLabel} upload ${params.batch.upload_batch_no} — ${HEADLINE[params.event]}`,
        html: buildHtml({
          creatorName: creator.name,
          batchNo: params.batch.upload_batch_no,
          typeLabel, stageLabel,
          event: params.event,
          actorName,
          reason: params.reason,
          lines,
        }),
        text:
          `Hi ${creator.name},\n\n${summaryLine}.\n` +
          (params.reason ? `\nReason: ${params.reason}\n` : "") +
          (lines.length
            ? `\nDiscarded rows:\n${lines
                .map((l) => `  Row ${l.rowNo} — ${l.employeeCode}: ${l.reason}`)
                .join("\n")}\n`
            : "") +
          `\nMAS Callnet PeopleOS`,
      });
      outcome.email = true;
    } catch (err) {
      logger.warn(`[bulk-upload] creator email failed for ${params.batch.upload_batch_no}: ${String(err)}`);
    }
  }

  // 2. Work Inbox — an actionable item with a deep link back to the batch.
  try {
    await inboxService.createItem({
      user_id: creator.userId,
      type: params.event === "approved" ? "bulk_upload_approved" : "bulk_upload_returned",
      title: summaryLine,
      description: params.reason ?? undefined,
      entity_type: "upload_batch",
      entity_id: params.batch.id,
      action_url: `/bulk-upload/approvals?batchId=${params.batch.id}`,
      priority: params.event === "approved" ? "normal" : "high",
    });
    outcome.inbox = true;
  } catch (err) {
    logger.warn(`[bulk-upload] creator inbox item failed for ${params.batch.upload_batch_no}: ${String(err)}`);
  }

  // 3. SMS — only for the cases the creator has to act on. An approval needs no SMS.
  if (params.event !== "approved") {
    try {
      await sendCreatorSms(creator, typeLabel, params.reason ?? summaryLine);
      outcome.sms = Boolean(creator.mobile);
    } catch (err) {
      logger.warn(`[bulk-upload] creator SMS failed for ${params.batch.upload_batch_no}: ${String(err)}`);
    }
  }

  return outcome;
}
