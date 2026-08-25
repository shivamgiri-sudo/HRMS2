/**
 * ATS Reminders Scheduler
 *
 * Five nightly/morning jobs:
 *  1. Onboarding incomplete reminder  — 9 PM daily
 *     Candidates selected 3+ days ago whose onboarding portal is not submitted
 *  1b. Joining docs incomplete reminder — 9 PM daily
 *     Employees joined in the last 90 days with an incomplete mandatory document
 *  2. Joining date reminder for HR    — 8 AM daily
 *     Requisitions / candidates whose target joining date is in 2 days
 *  3. Requisition approval nudge      — 8 AM daily
 *     Requisitions pending approval for 2+ days
 *  4. Daily Hiring Report          — 8 PM daily
 *     Branch-wise recruiter performance and pending submissions
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { inboxService } from "../inbox/inbox.service.js";
import { sendOnboardingTokenEmail } from "./ats.email.service.js";
import { env } from "../../config/env.js";
import { triggerOnboardingStuck, triggerJoiningDocsIncomplete } from "../work-inbox/work-inbox.triggers.js";
import { computeBranchReport } from "./ats-daily-report.service.js";
import { buildDailyReportEmail } from "./ats-daily-report.template.js";
import nodemailer from "nodemailer";

const HOUR_MS = 60 * 60 * 1000;

// ── 1. Onboarding incomplete reminder ────────────────────────────────────────

// Exported for direct testing (matching tat-escalation.worker.ts's runTatEscalationSweep) —
// otherwise only reachable through the internal 24h setTimeout loop in
// startAtsRemindersScheduler below.
export async function runOnboardingIncompleteReminders(): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       c.id AS candidate_id,
       c.full_name,
       c.email,
       c.applied_for_branch,
       c.branch_display_name,
       ob.id AS bridge_id,
       -- There is no onboarding_link column; the bridge stores the raw token and
       -- the link is composed from it, the same way ats.onboarding.service.ts
       -- does when the link is first issued.
       ob.onboarding_token,
       ob.created_at AS bridge_created,
       -- find the recruiter user id to notify
       r.employee_id AS recruiter_employee_id
     FROM ats_candidate c
     JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id
     LEFT JOIN ats_recruiter_roster r ON r.id = c.preferred_recruiter_id
     WHERE c.current_stage IN ('Selected','Offered')
       -- The column is status, not joining_status.
       AND ob.status NOT IN ('joined','documents_complete','employee_created')
       -- HR marked this candidate as not joining (markCandidateNotJoining) —
       -- no further automated email/WhatsApp/inbox-nag once that's set.
       AND COALESCE(c.candidate_status, '') <> 'not_joining'
       AND ob.onboarding_token IS NOT NULL
       -- Do not chase a link that has already expired — the candidate cannot use it.
       AND (ob.onboarding_token_expires_at IS NULL OR ob.onboarding_token_expires_at > NOW())
       AND DATEDIFF(NOW(), ob.created_at) >= 3
       -- Parenthesised. Without the brackets the trailing OR bound to the whole
       -- WHERE, so any row reminded 3+ days ago matched regardless of stage or
       -- onboarding state — it would have mailed people who had already joined.
       AND (
         ob.reminder_sent_at IS NULL
         OR DATEDIFF(NOW(), ob.reminder_sent_at) >= 3
       )
     LIMIT 100`
  );

  for (const row of rows) {
    try {
      // Compose the link from the stored raw token, matching how it is built
      // when first issued (ats.onboarding.service.ts).
      const onboardingLink = row.onboarding_token
        ? `${env.FRONTEND_URL || 'http://localhost:5173'}/onboard-full?token=${row.onboarding_token}`
        : null;

      if (row.email && onboardingLink) {
        await sendOnboardingTokenEmail({
          candidateId: row.candidate_id as string,
          to: row.email as string,
          candidateName: (row.full_name ?? 'Candidate') as string,
          onboardingLink,
        }).catch((e: unknown) => console.warn('[onboarding-reminder email]', e));
      }

      // Mark reminder sent
      await db.execute(
        `UPDATE ats_onboarding_bridge SET reminder_sent_at = NOW() WHERE id = ?`,
        [row.bridge_id]
      );

      // ONBOARDING_STUCK was a registered Work Inbox item_type with zero producers
      // anywhere in the app (delta-audit 2026-08-14, Stage 7b, user-approved) —
      // triggerOnboardingStuck() existed, fully written, but nothing called it. This job
      // is already the canonical "onboarding incomplete" detector (candidates 3+ days
      // past selection with an unsubmitted portal), so it's the correct trigger point.
      // Separate from and additional to the inboxService nudge below — that is a
      // different, older notification system this job already fed; Work Inbox is the
      // newer catalogue-driven one. branchId omitted deliberately: applied_for_branch is
      // free-text (sometimes an id, sometimes a name, sometimes a code — see
      // branch-head-scope.ts), and a wrong branch scope on a work item is worse than no
      // branch scope on one that's still assigned_to_role: "hr" and visible either way.
      await triggerOnboardingStuck(row.candidate_id as string, (row.full_name ?? "Candidate") as string)
        .catch((e: unknown) => console.warn(`[onboarding-reminder] work-item creation failed for ${row.candidate_id as string}:`, e));

      // Recruiter inbox nudge
      if (row.recruiter_employee_id) {
        const [userRows] = await db.execute<RowDataPacket[]>(
          `SELECT user_id AS id FROM employees WHERE id = ? AND active_status = 1 LIMIT 1`,
          [row.recruiter_employee_id]
        );
        const userId = userRows[0]?.id as string | null;
        if (userId) {
          await inboxService.createItem({
            user_id: userId,
            type: 'onboarding_overdue',
            title: `Onboarding Incomplete: ${row.full_name ?? 'Candidate'}`,
            description: `${row.full_name ?? 'Candidate'} has not completed their onboarding form in 3+ days. Follow up to avoid a joining delay.`,
            entity_type: 'ats_candidate',
            entity_id: row.candidate_id as string,
            action_url: '/ats/onboarding-bridge',
            priority: 'high',
          });
        }
      }
    } catch (err) {
      console.warn(`[onboarding-reminder] failed for candidate ${row.candidate_id as string}:`, err);
    }
  }

  if (rows.length > 0) {
    console.log(`[ats-reminders] onboarding incomplete: notified ${rows.length} candidate(s)`);
  }
}

// ── 1b. Joining documents incomplete reminder ────────────────────────────────

// JOINING_DOCS_INCOMPLETE was a registered Work Inbox item_type with zero producers
// anywhere in the app. "Complete" is defined exactly the way
// employeeJoiningDocuments.service.ts already defines it for its own progress
// calculation (mandatory_completed / completed_count) — reusing that set rather than
// inventing a second, possibly-diverging definition of done.
export async function runJoiningDocsIncompleteReminders(): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id,
            COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS full_name,
            e.branch_id
       FROM employees e
       JOIN employee_joining_document_checklist c ON c.employee_id = e.id
      WHERE e.active_status = 1
        AND e.date_of_joining >= DATE_SUB(NOW(), INTERVAL 90 DAY)
        AND c.mandatory = 1
        AND c.status NOT IN ('verified','signed_verified','completed','esign_completed','wet_signed_uploaded')
      GROUP BY e.id, full_name, e.branch_id
      LIMIT 200`
  );

  for (const row of rows) {
    try {
      await triggerJoiningDocsIncomplete(
        row.employee_id as string,
        (row.full_name ?? "Employee") as string,
        (row.branch_id as string | null) ?? undefined
      );
    } catch (err) {
      console.warn(`[joining-docs-reminder] failed for employee ${row.employee_id as string}:`, err);
    }
  }

  if (rows.length > 0) {
    console.log(`[ats-reminders] joining docs incomplete: notified ${rows.length} employee(s)`);
  }
}

// ── 2. Joining date reminder for HR ─────────────────────────────────────────

async function runJoiningDateReminders(): Promise<void> {
  // Find approved requisitions whose target_joining_date is in exactly 2 days
  const [jrRows] = await db.execute<RowDataPacket[]>(
    `SELECT jr.id, jr.requisition_code, jr.designation_name, jr.branch_name,
            jr.requested_headcount, jr.fulfilled_headcount, jr.requested_by,
            jr.target_joining_date
     FROM job_requisition jr
     WHERE jr.approval_status = 'approved'
       AND DATE(jr.target_joining_date) = DATE(NOW() + INTERVAL 2 DAY)
       AND jr.active_status = 1
     LIMIT 50`
  );

  for (const row of jrRows) {
    try {
      // Notify HR/recruiter who raised the requisition
      await inboxService.createItem({
        user_id: row.requested_by as string,
        type: 'joining_date_approaching',
        title: `Joining Date in 2 Days: ${row.requisition_code as string}`,
        description: `${row.designation_name as string} at ${row.branch_name as string} — joining date is ${(row.target_joining_date as Date)?.toISOString().slice(0, 10) ?? 'soon'}. ${(row.requested_headcount as number) - (row.fulfilled_headcount as number)} positions still open.`,
        entity_type: 'job_requisition',
        entity_id: row.id as string,
        action_url: '/recruitment/job-requisition',
        priority: 'urgent',
      });
    } catch (err) {
      console.warn(`[joining-reminder] failed for requisition ${row.id as string}:`, err);
    }
  }

  if (jrRows.length > 0) {
    console.log(`[ats-reminders] joining date in 2 days: notified for ${jrRows.length} requisition(s)`);
  }
}

// ── 3. Requisition approval nudge ────────────────────────────────────────────

async function runRequisitionApprovalNudge(): Promise<void> {
  // Requisitions pending approval for 2+ days — re-notify approvers
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT jr.id, jr.requisition_code, jr.designation_name, jr.branch_name,
            jr.requested_headcount, jr.requested_by, jr.created_at
     FROM job_requisition jr
     WHERE jr.approval_status = 'pending_approval'
       AND DATEDIFF(NOW(), jr.updated_at) >= 2
       AND jr.active_status = 1
     LIMIT 50`
  );

  for (const row of rows) {
    try {
      // Notify all approver-role users for the branch
      const [approvers] = await db.execute<RowDataPacket[]>(
        `SELECT DISTINCT ur.user_id AS id
           FROM user_roles ur
           LEFT JOIN employees e
             ON e.user_id = ur.user_id
            AND e.active_status = 1
           LEFT JOIN branch_master b
             ON b.id = e.branch_id
         WHERE ur.active_status = 1
           AND ur.role_key IN ('super_admin','hr','branch_head','management')
           AND (
             ur.role_key IN ('super_admin','management')
             OR b.branch_name = ?
             OR b.branch_code = ?
           )
         LIMIT 20`,
        [row.branch_name, row.branch_name]
      );

      await Promise.allSettled(
        (approvers as RowDataPacket[]).map((u) =>
          inboxService.createItem({
            user_id: u.id as string,
            type: 'requisition_approval_overdue',
            title: `Approval Overdue: ${row.requisition_code as string}`,
            description: `${row.designation_name as string} at ${row.branch_name as string} has been waiting for approval for 2+ days.`,
            entity_type: 'job_requisition',
            entity_id: row.id as string,
            action_url: '/recruitment/job-requisition',
            priority: 'high',
          })
        )
      );
    } catch (err) {
      console.warn(`[approval-nudge] failed for requisition ${row.id as string}:`, err);
    }
  }

  if (rows.length > 0) {
    console.log(`[ats-reminders] approval nudge: sent for ${rows.length} overdue requisition(s)`);
  }
}

// ── 4. Daily Hiring Report ───────────────────────────────────────────────────

export async function runDailyHiringReport(forDate?: string, testEmail?: string): Promise<any> {
  const BRANCHES = ['NOIDA', 'NOIDA-2', 'AHMEDABAD-JALDARSHAN'];
  const reports: any[] = [];
  const targetDate = forDate || new Date().toISOString().slice(0, 10);

  console.log(`[ats-daily-report] Generating report for date: ${targetDate}`);

  for (const branch of BRANCHES) {
    try {
      const report = await computeBranchReport(branch, targetDate);
      reports.push(report);
      console.log(`[ats-daily-report] ${branch}: ${report.ftd.walkin} walk-ins, ${report.ftd.selected} selected, ${report.ftd.pending} pending`);
    } catch (error) {
      console.error(`[ats-daily-report] Error computing ${branch}:`, error);
    }
  }

  // If testEmail provided, just return the data for preview
  if (testEmail === 'preview') {
    return { reports, targetDate };
  }

  // Build combined email
  const dashboardUrl = `${env.FRONTEND_URL || 'https://mcnhrms.teammas.in'}/recruitment/candidates`;
  const combinedFtd = reports.reduce((acc, r) => ({
    walkin: acc.walkin + r.ftd.walkin,
    selected: acc.selected + r.ftd.selected,
    pending: acc.pending + r.ftd.pending
  }), { walkin: 0, selected: 0, pending: 0 });

  // Combine all intervention points
  const allInterventions: any[] = [];
  for (const report of reports) {
    allInterventions.push(...report.interventions);
  }

  // Get branch head emails
  const [branchHeadRows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT au.email
     FROM auth_user au
     JOIN user_roles ur ON ur.user_id = au.id
     WHERE ur.role_key IN ('branch_head', 'hr_admin', 'super_admin', 'management')
       AND ur.active_status = 1
       AND au.email IS NOT NULL`,
    []
  );

  const recipients = testEmail || branchHeadRows.map(r => r.email).join(',') || 'shivam.giri@teammas.in';

  // Create a simple combined HTML email
  let interventionHtml = '';
  if (allInterventions.length > 0) {
    interventionHtml = `<h3 style="color:#dc2626;">⚠ Top Management Intervention Points</h3><ul>`;
    for (const int of allInterventions) {
      interventionHtml += `<li>${int.message}</li>`;
    }
    interventionHtml += `</ul>`;
  }

  let branchTables = '';
  for (const report of reports) {
    branchTables += `<h3>${report.branchName} - FTD Metrics</h3>
      <table border="1" cellpadding="5" style="border-collapse:collapse;">
        <tr><td>Walk-ins</td><td>${report.ftd.walkin}</td></tr>
        <tr><td>Selected</td><td>${report.ftd.selected}</td></tr>
        <tr><td>Rejected</td><td>${report.ftd.rejected}</td></tr>
        <tr><td>Pending Submission</td><td style="color:${report.ftd.pending > 0 ? '#dc2626' : '#000'}"><strong>${report.ftd.pending}</strong></td></tr>
        <tr><td>Selection %</td><td>${report.ftd.selectionPct}</td></tr>
      </table>`;

    if (report.recruiterFtd.length > 0) {
      branchTables += `<h4>Recruiter Breakdown</h4><table border="1" cellpadding="5" style="border-collapse:collapse;"><tr><th>Recruiter</th><th>Sourced</th><th>Attended</th><th>Pending</th></tr>`;
      for (const rec of report.recruiterFtd) {
        if (rec.pendingCount > 0) {
          branchTables += `<tr><td>${rec.recruiter}</td><td>${rec.sourced}</td><td>${rec.attended}</td><td style="color:#dc2626"><strong>${rec.pendingCount}</strong></td></tr>`;
        }
      }
      branchTables += `</table>`;
    }
  }

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;">
    <h2>Daily Hiring Report - ${targetDate}</h2>
    <p>Combined: ${combinedFtd.walkin} walk-ins, ${combinedFtd.selected} selected, <strong style="color:#dc2626">${combinedFtd.pending} pending</strong></p>
    ${interventionHtml}
    ${branchTables}
    <hr>
    <p><a href="${dashboardUrl}">Open ATS Dashboard</a></p>
  </body></html>`;

  const subject = `[Daily Report] ${targetDate} | ${combinedFtd.walkin} Walk-ins · ${combinedFtd.selected} Selected · ${combinedFtd.pending} Pending`;

  // Send email
  try {
    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(env.SMTP_PORT || 587),
      secure: false,
      auth: {
        user: env.SMTP_USER || '',
        pass: env.SMTP_PASS || '',
      },
    });

    const result = await transporter.sendMail({
      from: `"MAS HRMS Daily Report" <${env.SMTP_FROM || env.SMTP_USER}>`,
      to: recipients,
      subject,
      html,
    });

    console.log(`[ats-daily-report] Email sent to ${recipients}: ${result.messageId}`);
    return { success: true, messageId: result.messageId, recipients, stats: combinedFtd };
  } catch (error) {
    console.error('[ats-daily-report] Email send failed:', error);
    return { success: false, error: String(error), stats: combinedFtd };
  }
}

// ── Scheduler bootstrap ──────────────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null;

function getNextRunDelay(targetHour: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(targetHour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function startAtsRemindersScheduler(): void {
  if (_timer) return;

  // Run onboarding + joining-docs reminders at 9 PM IST daily
  const runEvening = () => {
    runOnboardingIncompleteReminders().catch((e: unknown) =>
      console.error('[ats-reminders] onboarding job error:', e)
    );
    runJoiningDocsIncompleteReminders().catch((e: unknown) =>
      console.error('[ats-reminders] joining-docs job error:', e)
    );
    setTimeout(runEvening, 24 * HOUR_MS);
  };
  setTimeout(runEvening, getNextRunDelay(21));

  // Run joining-date + approval nudge at 8 AM IST daily
  const runMorning = () => {
    Promise.all([
      runJoiningDateReminders(),
      runRequisitionApprovalNudge(),
    ]).catch((e: unknown) => console.error('[ats-reminders] morning job error:', e));
    setTimeout(runMorning, 24 * HOUR_MS);
  };
  setTimeout(runMorning, getNextRunDelay(8));

  // Mark started (use dummy interval to satisfy the guard)
  _timer = setInterval(() => {/* keepalive */}, 24 * HOUR_MS);

  console.log('[ats-reminders] scheduler started (evening 9 PM + morning 8 AM)');
}
