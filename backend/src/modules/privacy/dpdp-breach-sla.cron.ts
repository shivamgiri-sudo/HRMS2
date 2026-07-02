/**
 * DPDP Act 2023 — Breach SLA Alert Cron
 *
 * Runs every 30 minutes. Checks data_breach_log for unnotified breaches and
 * sends escalating email alerts to Grievance Officer / DPO at:
 *   1 hour  → initial alert
 *   48 hours → escalation
 *   71 hours → critical (within 1 hour of 72-hour DPBI deadline)
 *
 * Requires: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS env vars (same as existing mail config).
 * Guarded by ENABLE_SCHEDULERS — call startBreachSlaCron() only when schedulers are enabled.
 */

import nodemailer from "nodemailer";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";

type BreachRow = RowDataPacket & {
  id: string;
  breach_ref: string;
  detected_at: Date | string;
  severity: string;
  description: string;
  alert_sent_at_1h: Date | string | null;
  alert_sent_at_48h: Date | string | null;
  alert_sent_at_71h: Date | string | null;
  notified_authority_at: Date | string | null;
};

function getTransporter() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT ?? 587);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpHost || !smtpUser || !smtpPass) return null;
  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });
}

async function getRecipients(): Promise<string[]> {
  const emails: string[] = [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT config_key, config_value FROM dpdp_config
      WHERE config_key IN ('grievance_officer_email', 'dpo_email') AND config_value != ''`
  );
  for (const r of rows as RowDataPacket[]) {
    const v = String(r.config_value ?? "").trim();
    if (v && !emails.includes(v)) emails.push(v);
  }
  return emails;
}

async function sendAlert(to: string[], subject: string, body: string): Promise<boolean> {
  const transport = getTransporter();
  if (!transport || !to.length) {
    console.warn("[dpdp-breach-sla] SMTP not configured or no recipients — alert not sent:", subject);
    return false;
  }
  try {
    await transport.sendMail({
      from: `"MAS Callnet HRMS Compliance" <${process.env.SMTP_USER}>`,
      to: to.join(", "),
      subject,
      html: `<pre style="font-family:sans-serif;white-space:pre-wrap;">${body}</pre>`,
    });
    return true;
  } catch (err) {
    console.error("[dpdp-breach-sla] Email send failed:", err);
    return false;
  }
}

function hoursAgo(date: Date | string): number {
  return (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60);
}

async function checkBreaches() {
  // Only process breaches that are not resolved and not yet officially notified to authority
  const [breaches] = await db.execute<RowDataPacket[]>(
    `SELECT id, breach_ref, detected_at, severity, description,
            alert_sent_at_1h, alert_sent_at_48h, alert_sent_at_71h, notified_authority_at
       FROM data_breach_log
      WHERE status NOT IN ('resolved') AND notified_authority_at IS NULL
      ORDER BY detected_at ASC
      LIMIT 50`
  );

  if (!(breaches as RowDataPacket[]).length) return;

  const recipients = await getRecipients();
  const orgName = "MAS Callnet";

  for (const b of breaches as BreachRow[]) {
    const hours = hoursAgo(b.detected_at);

    // 1-hour alert
    if (hours >= 1 && !b.alert_sent_at_1h) {
      const sent = await sendAlert(
        recipients,
        `[DPDP ALERT] Data Breach ${b.breach_ref} — Notification Required Within 72 Hours`,
        `DPDP Act 2023 — Breach Notification Required\n\n` +
        `Organisation: ${orgName}\n` +
        `Breach Reference: ${b.breach_ref}\n` +
        `Detected At: ${b.detected_at}\n` +
        `Severity: ${b.severity}\n` +
        `Description: ${b.description}\n\n` +
        `ACTION REQUIRED: Under DPDP Act 2023 §8, you must notify the Data Protection Board of India (DPBI) within 72 hours of detecting a breach.\n\n` +
        `Hours elapsed since detection: ${Math.round(hours)} hours\n` +
        `Deadline: within ${Math.round(72 - hours)} hours\n\n` +
        `Log in to HRMS > Compliance > DPDP > Data Breaches to update the notification status.`
      );
      if (sent) {
        await db.execute(
          `UPDATE data_breach_log SET alert_sent_at_1h = NOW() WHERE id = ?`,
          [b.id]
        ).catch(() => { /* column may not exist until migration 336 runs */ });
      }
    }

    // 48-hour escalation
    if (hours >= 48 && !b.alert_sent_at_48h) {
      const sent = await sendAlert(
        recipients,
        `[DPDP ESCALATION] Breach ${b.breach_ref} — 48 Hours Elapsed — 24 Hours Remaining`,
        `DPDP Breach Notification — ESCALATION\n\n` +
        `Breach Reference: ${b.breach_ref}\n` +
        `Hours elapsed: ${Math.round(hours)} hours\n` +
        `Hours remaining before DPBI deadline: ${Math.round(72 - hours)} hours\n\n` +
        `This breach has NOT yet been notified to the Data Protection Board of India (DPBI).\n` +
        `Failure to notify within 72 hours is an offence under DPDP Act 2023 §8 carrying penalty up to ₹200 Crore.\n\n` +
        `IMMEDIATE ACTION REQUIRED: Notify DPBI and update the breach record in HRMS.`
      );
      if (sent) {
        await db.execute(
          `UPDATE data_breach_log SET alert_sent_at_48h = NOW() WHERE id = ?`,
          [b.id]
        ).catch(() => { /* column may not exist until migration 336 runs */ });
      }
    }

    // 71-hour critical alert (1 hour before deadline)
    if (hours >= 71 && !b.alert_sent_at_71h) {
      const sent = await sendAlert(
        recipients,
        `[DPDP CRITICAL] Breach ${b.breach_ref} — DEADLINE IN 1 HOUR — DPBI Notification OVERDUE`,
        `⚠️ CRITICAL — DPDP DPBI NOTIFICATION DEADLINE IMMINENT\n\n` +
        `Breach Reference: ${b.breach_ref}\n` +
        `Hours elapsed: ${Math.round(hours)} hours\n` +
        `DPBI 72-hour notification window expires in approximately 1 HOUR.\n\n` +
        `Immediate action required. Notify the Data Protection Board of India now.\n` +
        `Non-compliance: penalty up to ₹200 Crore under DPDP Act 2023.\n\n` +
        `DPBI portal: https://www.meity.gov.in (check DPBI section for filing procedure)`
      );
      if (sent) {
        await db.execute(
          `UPDATE data_breach_log SET alert_sent_at_71h = NOW() WHERE id = ?`,
          [b.id]
        ).catch(() => { /* column may not exist until migration 336 runs */ });
      }
    }
  }
}

export function startBreachSlaCron(): void {
  if (!env.ENABLE_SCHEDULERS) return;

  // Run immediately on startup, then every 30 minutes
  setTimeout(() => {
    checkBreaches().catch((err) => console.error("[dpdp-breach-sla] check failed:", err));
  }, 5000);

  setInterval(() => {
    checkBreaches().catch((err) => console.error("[dpdp-breach-sla] check failed:", err));
  }, 30 * 60 * 1000);

  console.log("[dpdp-breach-sla] DPDP breach SLA cron started (checks every 30 min)");
}
