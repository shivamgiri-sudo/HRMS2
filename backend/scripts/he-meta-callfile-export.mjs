/**
 * Hiring Engine: Meta calling file in the Bulk-calls upload format -- read-only, emailed to the requester.
 *   node scripts/he-meta-callfile-export.mjs
 * Columns: phone, name, role, interview_date, interview_time, branch_address, reference_id.
 * Same rules as "Prepare from campaigns" (he-bulk-call-prepare.service.ts): qualified, future interview slot (>30 min),
 * not declined, not walk-in confirmed, invite sent, requisition approved/open -- plus no final bot answer yet.
 * The recently-exported filter is NOT applied (nothing is written); counts of what was left out are in the mail body.
 */
import { createRequire } from "node:module";

await import("dotenv/config");
const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");
const nodemailer = require("nodemailer");
const MAIL_TO = "shivam.giri@teammas.in";
const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const conn = await mysql.createConnection({
  host: strip(process.env.DB_HOST), port: Number(strip(process.env.DB_PORT) || 3306),
  user: strip(process.env.DB_USER), password: strip(process.env.DB_PASSWORD), database: strip(process.env.DB_NAME),
  connectTimeout: 20000, dateStrings: true,
});
const esc = (v) => { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const FUTURE = "TIMESTAMP(ml.interview_date, ml.interview_time) > DATE_ADD(NOW(), INTERVAL 30 MINUTE)";
const OPEN_REQ = "jr.approval_status = 'approved' AND jr.active_status = 1 AND jr.joined_headcount < CEIL(jr.requested_headcount * 1.3)";
const PH = "RIGHT(REGEXP_REPLACE(ml.parsed_phone, '[^0-9]', ''), 10)";
const BOT_FINAL = `EXISTS (SELECT 1 FROM he_lead hl JOIN he_call c ON c.lead_id = hl.id
   WHERE hl.mobile10 = ${PH} AND c.outcome IN ('WALKIN_CONFIRMED_YES','WALKIN_DECLINED_NEEDS_FOLLOWUP'))`;
try {
  await conn.query("SET SESSION TRANSACTION READ ONLY");
  const [ex] = await conn.query(
    `SELECT CASE
              WHEN ml.interview_date IS NULL OR ml.interview_time IS NULL THEN 'no_interview_assigned'
              WHEN NOT (${FUTURE}) THEN 'interview_date_passed'
              WHEN ml.walkin_declined = 1 THEN 'declined'
              WHEN NOT (${OPEN_REQ}) THEN 'requisition_closed_or_filled'
              WHEN ml.walkin_confirmed = 1 THEN 'already_confirmed'
              WHEN ml.notification_sent_at IS NULL THEN 'invite_not_sent_yet'
              WHEN ${BOT_FINAL} THEN 'bot_already_answered'
              ELSE 'included' END reason, COUNT(*) n
       FROM meta_lead_raw ml JOIN job_requisition jr ON jr.id = ml.requisition_id
      WHERE ml.screening_result = 'qualified' GROUP BY reason ORDER BY n DESC`);
  const summary = ex.map((r) => `${r.reason}: ${r.n}`).join("\n");
  console.log(summary);
  const [rows] = await conn.query(
    `SELECT REPLACE(ml.parsed_phone, 'p:', '') phone, ml.parsed_name name, jr.designation_name role,
            DATE_FORMAT(ml.interview_date, '%Y-%m-%d') interview_date, TIME_FORMAT(ml.interview_time, '%H:%i') interview_time,
            bm.address branch_address, REPLACE(ml.meta_lead_id, 'l:', '') reference_id
       FROM meta_lead_raw ml
       JOIN job_requisition jr ON jr.id = ml.requisition_id
       LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
      WHERE ml.screening_result = 'qualified' AND ml.interview_date IS NOT NULL AND ml.interview_time IS NOT NULL AND ${FUTURE}
        AND ml.walkin_declined = 0 AND ml.walkin_confirmed = 0 AND ml.notification_sent_at IS NOT NULL
        AND ${OPEN_REQ} AND NOT ${BOT_FINAL}
      ORDER BY ml.interview_date, ml.interview_time, ml.id`);
  const seen = new Set();
  const out = rows.filter((r) => { const k = String(r.phone).slice(-10); if (seen.has(k)) return false; seen.add(k); return true; });
  console.log(`rows=${rows.length} unique mobiles=${out.length}`);
  const cols = ["phone", "name", "role", "interview_date", "interview_time", "branch_address", "reference_id"];
  const csv = "﻿" + [cols.join(","), ...out.map((r) => cols.map((k) => esc(k === "branch_address" ? String(r[k] ?? "").replace(/\s*\n\s*/g, ", ") : r[k])).join(","))].join("\n");
  const t = nodemailer.createTransport({
    host: strip(process.env.SMTP_HOST) || "smtp.gmail.com", port: Number(strip(process.env.SMTP_PORT) || 587), secure: false,
    auth: { user: strip(process.env.SMTP_USER), pass: strip(process.env.SMTP_PASS) },
  });
  const info = await t.sendMail({
    from: `"${strip(process.env.SMTP_FROM_NAME) || "HRMS"}" <${strip(process.env.SMTP_FROM) || strip(process.env.SMTP_USER)}>`,
    to: MAIL_TO, subject: `HE Meta calling file (${out.length} rows) - bulk call format`,
    text: `Bulk-calls upload format (phone, name, role, interview_date, interview_time, branch_address, reference_id).\nRows: ${out.length}\n\nQualified Meta leads by status:\n${summary}\n\nContains candidate PII.`,
    attachments: out.length ? [{ filename: "he_meta_calling_file.csv", content: csv, contentType: "text/csv; charset=utf-8" }] : [],
  });
  console.log("mail sent:", info.messageId, "accepted:", JSON.stringify(info.accepted));
} finally { await conn.end(); }
