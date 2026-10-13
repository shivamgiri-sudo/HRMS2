/**
 * "Submit to Client" — emails an APPROVED tax invoice's PDF to the client and keeps a
 * permanent log (who sent it, when, to whom, outcome). Legacy parity: I-Spark's
 * Submit-to-Client step after Download PDF / Letterhead.
 *
 * Uses the platform mail service (communication/email.service.ts, SMTP via nodemailer) —
 * the same sender every other module uses. A send failure is logged as a 'failed'
 * submission row (never silently swallowed) and surfaced to the caller as a 502.
 */
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { emailService } from "../communication/email.service.js";
import { clientBillingPdfService } from "./client-billing-pdf.service.js";

const MAX_RECIPIENTS = 10;
const EMAIL_RE = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;

function clientError(message: string, statusCode = 400): Error {
  return Object.assign(new Error(message), { statusCode });
}

export function parseRecipients(
  raw: string | string[] | undefined | null,
  label: string,
): string[] {
  const parts = Array.isArray(raw) ? raw : String(raw ?? "").split(/[,;\n]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const email = String(part ?? "")
      .trim()
      .toLowerCase();
    if (!email) continue;
    if (!EMAIL_RE.test(email) || email.length > 254) {
      throw clientError(
        `${label}: "${email.slice(0, 60)}" is not a valid email address`,
      );
    }
    if (!seen.has(email)) {
      seen.add(email);
      out.push(email);
    }
  }
  return out;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface SubmitToClientInput {
  invoiceId: string;
  to: string[] | string;
  cc?: string[] | string;
  subject?: string;
  message?: string;
  letterhead?: boolean;
  userId: string;
}

export interface SubmitToClientResult {
  submissionId: string;
  billNo: string;
  to: string[];
  cc: string[];
  sentAt: string;
}

async function submitToClient(
  input: SubmitToClientInput,
): Promise<SubmitToClientResult> {
  const to = parseRecipients(input.to, "To");
  const cc = parseRecipients(input.cc, "Cc");
  if (to.length === 0) throw clientError("At least one recipient is required");
  if (to.length + cc.length > MAX_RECIPIENTS) {
    throw clientError(`At most ${MAX_RECIPIENTS} recipients are allowed`);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, invoice_status, bill_no, grand_total, invoice_date, month_label, finance_year
     FROM client_invoice WHERE id = ? LIMIT 1`,
    [input.invoiceId],
  );
  const invoice = rows[0];
  if (!invoice) throw clientError(`Invoice ${input.invoiceId} not found`, 404);
  if (invoice.invoice_status !== "approved" || !invoice.bill_no) {
    throw clientError(
      "Only an approved tax invoice with a bill number can be submitted to the client",
    );
  }

  const withLetterhead = input.letterhead !== false;
  const billNo = String(invoice.bill_no);
  const subject =
    String(input.subject ?? "")
      .trim()
      .slice(0, 300) || `Tax Invoice ${billNo} — MAS Callnet India Pvt. Ltd.`;
  const note = String(input.message ?? "")
    .trim()
    .slice(0, 2000);

  const pdf = await clientBillingPdfService.generateInvoicePdf(
    input.invoiceId,
    withLetterhead,
  );
  const safeFile = billNo.replace(/[^A-Za-z0-9._-]+/g, "_");

  const html = `<p>Dear Sir/Madam,</p>
<p>Please find attached Tax Invoice <b>${escapeHtml(billNo)}</b> for ${escapeHtml(String(invoice.month_label))}
(amount &#8377;${Number(invoice.grand_total).toLocaleString("en-IN", { minimumFractionDigits: 2 })}).</p>
${note ? `<p>${escapeHtml(note).replace(/\n/g, "<br/>")}</p>` : ""}
<p>Regards,<br/>MAS Callnet India Pvt. Ltd.<br/>care@teammas.in</p>`;

  const submissionId = randomUUID();
  let messageId: string | null = null;
  let failure: string | null = null;
  try {
    const sent = await emailService.send({
      to: to.join(", "),
      ...(cc.length > 0 ? { cc: cc.join(", ") } : {}),
      subject,
      html,
      attachments: [
        {
          filename: `${safeFile}.pdf`,
          content: pdf,
          contentType: "application/pdf",
        },
      ],
    });
    messageId = sent.messageId ?? null;
  } catch (error) {
    failure = error instanceof Error ? error.message : "Email send failed";
  }

  await db.execute(
    `INSERT INTO client_invoice_submission
       (id, invoice_id, to_emails, cc_emails, subject, with_letterhead, send_status, message_id, error_message, sent_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      submissionId,
      input.invoiceId,
      to.join(", "),
      cc.length > 0 ? cc.join(", ") : null,
      subject,
      withLetterhead ? 1 : 0,
      failure ? "failed" : "sent",
      messageId,
      failure ? failure.slice(0, 500) : null,
      input.userId,
    ],
  );

  if (failure) {
    throw clientError(`Could not send the invoice email: ${failure}`, 502);
  }

  await db.execute(
    `UPDATE client_invoice SET last_sent_at = NOW(), last_sent_by = ? WHERE id = ?`,
    [input.userId, input.invoiceId],
  );
  await db.execute(
    `INSERT INTO client_invoice_audit_log (id, invoice_id, action, actor_id, reason) VALUES (?, ?, 'submitted_to_client', ?, ?)`,
    [
      randomUUID(),
      input.invoiceId,
      input.userId,
      `to ${to.join(", ")}`.slice(0, 1000),
    ],
  );

  return {
    submissionId,
    billNo,
    to,
    cc,
    sentAt: new Date().toISOString(),
  };
}

async function listSubmissions(invoiceId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, invoice_id, to_emails, cc_emails, subject, with_letterhead, send_status,
            message_id, error_message, sent_by, sent_at
     FROM client_invoice_submission WHERE invoice_id = ? ORDER BY sent_at DESC LIMIT 50`,
    [invoiceId],
  );
  return rows;
}

export const clientBillingSubmitService = { submitToClient, listSubmissions };
