/**
 * ATS Reminders Scheduler
 *
 * Three nightly/morning jobs:
 *  1. Onboarding incomplete reminder  — 9 PM daily
 *     Candidates selected 3+ days ago whose onboarding portal is not submitted
 *  2. Joining date reminder for HR    — 8 AM daily
 *     Requisitions / candidates whose target joining date is in 2 days
 *  3. Requisition approval nudge      — 8 AM daily
 *     Requisitions pending approval for 2+ days
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { inboxService } from "../inbox/inbox.service.js";
import { sendOnboardingTokenEmail } from "./ats.email.service.js";

const HOUR_MS = 60 * 60 * 1000;

// ── 1. Onboarding incomplete reminder ────────────────────────────────────────

async function runOnboardingIncompleteReminders(): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       c.id AS candidate_id,
       c.full_name,
       c.email,
       c.applied_for_branch,
       c.branch_display_name,
       ob.id AS bridge_id,
       ob.onboarding_link,
       ob.created_at AS bridge_created,
       -- find the recruiter user id to notify
       r.employee_id AS recruiter_employee_id
     FROM ats_candidate c
     JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id
     LEFT JOIN ats_recruiter_roster r ON r.id = c.preferred_recruiter_id
     WHERE c.current_stage IN ('Selected','Offered')
       AND ob.joining_status NOT IN ('joined','documents_complete','employee_created')
       AND DATEDIFF(NOW(), ob.created_at) >= 3
       AND ob.reminder_sent_at IS NULL
       OR (ob.reminder_sent_at IS NOT NULL AND DATEDIFF(NOW(), ob.reminder_sent_at) >= 3)
     LIMIT 100`
  );

  for (const row of rows) {
    try {
      // Email to candidate if onboarding link exists
      if (row.email && row.onboarding_link) {
        await sendOnboardingTokenEmail({
          candidateId: row.candidate_id as string,
          to: row.email as string,
          candidateName: (row.full_name ?? 'Candidate') as string,
          onboardingLink: row.onboarding_link as string,
        }).catch((e: unknown) => console.warn('[onboarding-reminder email]', e));
      }

      // Mark reminder sent
      await db.execute(
        `UPDATE ats_onboarding_bridge SET reminder_sent_at = NOW() WHERE id = ?`,
        [row.bridge_id]
      );

      // Recruiter inbox nudge
      if (row.recruiter_employee_id) {
        const [userRows] = await db.execute<RowDataPacket[]>(
          `SELECT id FROM users WHERE employee_id = ? LIMIT 1`,
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
        `SELECT u.id FROM users u
         WHERE u.active_status = 1
           AND u.role IN ('super_admin','hr','branch_head','management')
           AND (u.branch_name = ? OR u.role IN ('super_admin','management'))
         LIMIT 20`,
        [row.branch_name]
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

  // Run onboarding reminder at 9 PM IST daily
  const runEvening = () => {
    runOnboardingIncompleteReminders().catch((e: unknown) =>
      console.error('[ats-reminders] onboarding job error:', e)
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
