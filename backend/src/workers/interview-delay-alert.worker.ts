import { randomUUID } from 'crypto';
import { db } from '../db/mysql.js';
import { env } from '../config/env.js';
import nodemailer from 'nodemailer';
import { inboxService } from '../modules/inbox/inbox.service.js';
import { isWorkerEnabled, markWorkerRun } from '../shared/worker-config.js';
import { shouldAlert, markAlerted, cleanupCooldowns } from '../shared/alert-cooldown.js';

// ── Configuration ─────────────────────────────────────────────────────────────

// Must match the worker_config.worker_name row seeded by migration 1054, or the
// kill switch silently does nothing — isWorkerEnabled fails open on a missing row.
const WORKER_NAME = 'interview-delay-alert';
const DELAY_THRESHOLD_MINUTES = 120;         // Alert after 2 hours in called/in_interview
const CHECK_INTERVAL_MS = 10 * 60 * 1000;   // Poll every 10 minutes
const ALERT_COOLDOWN_MS  = 2 * 60 * 60 * 1000; // Re-alert cooldown: 2 hours per token

let intervalRef: ReturnType<typeof setInterval> | undefined;

// Dedup lives in the alert_cooldown table rather than a Map: this worker mails
// through its own nodemailer transport (see below) and a pm2 restart used to
// re-alert every delayed interview.

// ── Email ─────────────────────────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
  host:   env.SMTP_HOST   || '',
  port:   Number(env.SMTP_PORT || 587),
  secure: false,
  auth: { user: env.SMTP_USER || '', pass: env.SMTP_PASS || '' },
});

function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendDelayAlert(row: {
  token_id: string;
  token_number: string;
  candidate_id: string;
  candidate_name: string;
  branch_name: string;
  applied_role: string;
  recruiter_name: string;
  recruiter_email: string | null;
  reporting_manager_email: string | null;
  delay_minutes: number;
}): Promise<void> {
  const to = row.reporting_manager_email?.trim();
  if (!to || !to.includes('@')) {
    console.warn(`[InterviewDelayAlert] No reporting_manager email for recruiter "${row.recruiter_name}" — skipping candidate ${row.candidate_id}`);
    return;
  }
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    console.warn('[InterviewDelayAlert] SMTP not configured — skipping alert');
    return;
  }

  const hours = Math.floor(row.delay_minutes / 60);
  const mins  = row.delay_minutes % 60;
  const delayStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  const subject = `[Interview Delay Alert] ${escapeHtml(row.candidate_name)} pending ${delayStr} — ${escapeHtml(row.branch_name)}`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f0f2f8;font-family:'DM Sans',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <tr><td style="background:linear-gradient(130deg,#b45309,#d97706);padding:28px 32px;color:#ffffff">
    <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;opacity:.85">MAS Callnet HRMS — Interview Delay Alert</p>
    <h1 style="margin:0;font-size:22px;font-weight:900">Candidate Pending ${escapeHtml(delayStr)}</h1>
  </td></tr>
  <tr><td style="padding:28px 32px;font-size:15px;color:#1e293b;line-height:1.7">
    <p>Dear Manager,</p>
    <p>A candidate assigned to recruiter <strong>${escapeHtml(row.recruiter_name)}</strong> has been in interview status for over <strong>${escapeHtml(delayStr)}</strong> without a submitted result. Please follow up.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
      <tr style="background:#f8fafc"><td style="padding:10px 16px;font-size:12px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:#64748b;width:40%">Candidate</td><td style="padding:10px 16px;font-weight:600">${escapeHtml(row.candidate_name)}</td></tr>
      <tr><td style="padding:10px 16px;font-size:12px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:#64748b;border-top:1px solid #f1f5f9">Token</td><td style="padding:10px 16px;font-weight:600;border-top:1px solid #f1f5f9;font-family:monospace">${escapeHtml(row.token_number)}</td></tr>
      <tr style="background:#f8fafc"><td style="padding:10px 16px;font-size:12px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:#64748b;border-top:1px solid #f1f5f9">Branch</td><td style="padding:10px 16px;font-weight:600;border-top:1px solid #f1f5f9">${escapeHtml(row.branch_name)}</td></tr>
      <tr><td style="padding:10px 16px;font-size:12px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:#64748b;border-top:1px solid #f1f5f9">Role Applied</td><td style="padding:10px 16px;font-weight:600;border-top:1px solid #f1f5f9">${escapeHtml(row.applied_role)}</td></tr>
      <tr style="background:#f8fafc"><td style="padding:10px 16px;font-size:12px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:#64748b;border-top:1px solid #f1f5f9">Recruiter</td><td style="padding:10px 16px;font-weight:600;border-top:1px solid #f1f5f9">${escapeHtml(row.recruiter_name)}</td></tr>
      <tr><td style="padding:10px 16px;font-size:12px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:#64748b;border-top:1px solid #f1f5f9">Time Pending</td><td style="padding:10px 16px;font-weight:700;color:#b45309;border-top:1px solid #f1f5f9">${escapeHtml(delayStr)}</td></tr>
    </table>
    <p style="font-size:13px;color:#64748b">Please log in to HRMS and ensure the recruiter submits the interview result at the earliest.</p>
  </td></tr>
  <tr><td style="padding:16px 32px;border-top:1px solid #f1f5f9;font-size:12px;color:#94a3b8;text-align:center">
    MAS Callnet PeopleOS &mdash; Automated Interview Delay Alert
  </td></tr>
</table></td></tr></table>
</body></html>`;

  const fromAddr = env.SMTP_FROM || env.SMTP_USER;
  const ccList: string[] = [];
  if (row.recruiter_email?.includes('@')) ccList.push(row.recruiter_email);

  try {
    await transporter.sendMail({
      from: `"MAS Callnet HRMS" <${fromAddr}>`,
      to,
      cc: ccList.join(',') || undefined,
      subject,
      html,
    });
    await db.execute(
      `INSERT IGNORE INTO ats_email_log (id, candidate_id, email_type, sent_to, status)
       VALUES (?, ?, 'interview_delay_alert', ?, 'sent')`,
      [randomUUID(), row.candidate_id, to]
    );
    console.log(`[InterviewDelayAlert] Sent alert for ${row.candidate_name} to ${to}`);
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? String(err);
    console.error(`[InterviewDelayAlert] Failed to send for ${row.candidate_name}: ${msg}`);
    await db.execute(
      `INSERT IGNORE INTO ats_email_log (id, candidate_id, email_type, sent_to, status, error_message)
       VALUES (?, ?, 'interview_delay_alert', ?, 'failed', ?)`,
      [randomUUID(), row.candidate_id, to, msg]
    ).catch(() => {});
  }
}

// ── Query ─────────────────────────────────────────────────────────────────────

async function findDelayedInterviews(): Promise<any[]> {
  try {
    const [rows]: any = await db.execute(
      `SELECT
         qt.id                                            AS token_id,
         COALESCE(qt.token_number, qt.token)             AS token_number,
         c.id                                            AS candidate_id,
         c.full_name                                     AS candidate_name,
         COALESCE(qt.branch_name, c.branch_display_name, c.applied_for_branch) AS branch_name,
         COALESCE(c.role_applied, c.applied_for_process) AS applied_role,
         COALESCE(rr.name, 'Unassigned')                 AS recruiter_name,
         COALESCE(NULLIF(rr.email, ''), NULLIF(recruiter_user.email, '')) AS recruiter_email,
         COALESCE(
           CASE
             WHEN rr.reporting_manager IS NOT NULL AND rr.reporting_manager LIKE '%@%' THEN rr.reporting_manager
             ELSE NULL
           END,
           NULLIF(manager_user.email, ''),
           NULLIF(manager_emp.email, '')
         )                                              AS reporting_manager_email,
         TIMESTAMPDIFF(MINUTE, qt.called_at, NOW())      AS delay_minutes,
         emp.user_id                                     AS recruiter_user_id
       FROM ats_queue_token qt
       JOIN ats_candidate c ON c.id = qt.candidate_id
       LEFT JOIN ats_recruiter_roster rr ON rr.id = COALESCE(qt.recruiter_id, qt.assigned_recruiter_id)
       LEFT JOIN employees emp ON emp.id = rr.employee_id
       LEFT JOIN auth_user recruiter_user ON recruiter_user.id = emp.user_id
       LEFT JOIN employees manager_emp ON manager_emp.id = emp.reporting_manager_id
       LEFT JOIN auth_user manager_user ON manager_user.id = manager_emp.user_id
       WHERE qt.queue_status IN ('called', 'in_interview')
         AND qt.called_at IS NOT NULL
         AND TIMESTAMPDIFF(MINUTE, qt.called_at, NOW()) >= ?
         AND DATE(COALESCE(qt.arrival_time, qt.created_at)) = CURDATE()
       ORDER BY delay_minutes DESC`,
      [DELAY_THRESHOLD_MINUTES]
    );
    return rows || [];
  } catch (err: any) {
    console.error('[InterviewDelayAlert] Query failed:', err.message);
    return [];
  }
}

// ── Main Loop ─────────────────────────────────────────────────────────────────

async function checkDelays(): Promise<void> {
  // Kill switch. This worker mails through a private nodemailer transport that
  // consults neither notification_event_config nor notification_log, so nothing
  // in the notifications admin screen could stop it. worker_config.enabled can.
  if (!(await isWorkerEnabled(WORKER_NAME))) {
    return;
  }

  console.log('[InterviewDelayAlert] Checking for delayed interviews...');
  const rows = await findDelayedInterviews();

  if (rows.length === 0) {
    console.log('[InterviewDelayAlert] No delayed interviews found');
    return;
  }

  console.log(`[InterviewDelayAlert] Found ${rows.length} delayed interview(s)`);

  for (const row of rows) {
    if (!(await shouldAlert(WORKER_NAME, row.token_id, ALERT_COOLDOWN_MS))) {
      console.log(`[InterviewDelayAlert] Skipping ${row.candidate_name} (cooldown active)`);
      continue;
    }
    await sendDelayAlert(row);

    // Inbox alert so the recruiter sees a toast + bell in the app
    if (row.recruiter_user_id) {
      const hours = Math.floor(row.delay_minutes / 60);
      const mins  = row.delay_minutes % 60;
      const delayStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      await inboxService.createItem({
        user_id: row.recruiter_user_id,
        type: "interview_submission_overdue",
        title: `Interview result not submitted — ${row.candidate_name}`,
        description: `Token ${row.token_number} (${row.applied_role}) has been in interview for ${delayStr} without a submission. Please close out this interview.`,
        entity_type: "ats_candidate",
        entity_id: row.candidate_id,
        action_url: "/ats/walkin-queue",
        priority: "urgent",
      }).catch((e: unknown) => console.warn("[InterviewDelayAlert] inbox write failed:", e));
    }

    await markAlerted(WORKER_NAME, row.token_id);
  }

  await cleanupCooldowns(WORKER_NAME, 2 * ALERT_COOLDOWN_MS);
  await markWorkerRun(WORKER_NAME);
}

export function startInterviewDelayAlertWorker(): void {
  console.log(`[InterviewDelayAlert] Starting — threshold: ${DELAY_THRESHOLD_MINUTES}min, interval: ${CHECK_INTERVAL_MS / 60000}min`);
  void checkDelays();
  intervalRef = setInterval(() => { void checkDelays(); }, CHECK_INTERVAL_MS);
}

export function stopInterviewDelayAlertWorker(): void {
  if (intervalRef) {
    clearInterval(intervalRef);
    intervalRef = undefined;
  }
  console.log("[InterviewDelayAlert] Stopped");
}
