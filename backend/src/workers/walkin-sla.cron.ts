/**
 * Walk-in SLA Cron
 *
 * Two checks, every 5 minutes:
 *
 * 1. 90-min submission SLA
 *    Candidates whose arrival_time was >90 min ago but interview_completed_at is still NULL.
 *    Notifies the assigned recruiter to close out the interview.
 *
 * 2. Pending feedback reminder
 *    Candidates completed today where the recruiter has NOT yet logged a selection/rejection
 *    decision (candidate_status still 'registered' or 'in_interview' after completion).
 *    Notifies the recruiter once every 30 min until the decision is recorded.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { inboxService } from "../modules/inbox/inbox.service.js";

const CHECK_INTERVAL_MS     = 5  * 60 * 1000;  // poll every 5 min
const SUBMISSION_SLA_MINS   = 90;               // 90 min from arrival → must submit
const FEEDBACK_COOLDOWN_MS  = 30 * 60 * 1000;  // re-alert every 30 min

// In-memory cooldown maps: entityId → lastAlertTimestamp
const submissionAlerted = new Map<string, number>();
const feedbackAlerted   = new Map<string, number>();

function shouldAlert(map: Map<string, number>, id: string, cooldownMs: number): boolean {
  const last = map.get(id);
  return !last || (Date.now() - last) >= cooldownMs;
}

function cleanupMap(map: Map<string, number>, ttlMs: number): void {
  const cutoff = Date.now() - ttlMs;
  for (const [k, v] of map.entries()) {
    if (v < cutoff) map.delete(k);
  }
}

// ── Check 1: 90-min submission SLA ───────────────────────────────────────────

async function checkSubmissionSla(): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       qt.id                                              AS token_id,
       COALESCE(qt.token_number, qt.token)                AS token_number,
       c.id                                               AS candidate_id,
       c.full_name                                        AS candidate_name,
       COALESCE(c.role_applied, c.applied_for_process)    AS applied_role,
       COALESCE(qt.branch_name, c.branch_display_name)    AS branch_name,
       TIMESTAMPDIFF(MINUTE, COALESCE(qt.arrival_time, qt.created_at), NOW()) AS mins_since_arrival,
       u.id                                               AS recruiter_user_id,
       rr.name                                            AS recruiter_name
     FROM ats_queue_token qt
     JOIN ats_candidate c ON c.id = qt.candidate_id
     LEFT JOIN ats_recruiter_roster rr ON rr.id = COALESCE(qt.recruiter_id, qt.assigned_recruiter_id)
     LEFT JOIN employees emp ON emp.id = rr.employee_id
     LEFT JOIN users u ON u.employee_id = emp.id
     WHERE qt.queue_status = 'in_interview'
       AND qt.interview_completed_at IS NULL
       AND TIMESTAMPDIFF(MINUTE, COALESCE(qt.arrival_time, qt.created_at), NOW()) >= ?
       AND DATE(COALESCE(qt.arrival_time, qt.created_at)) = CURDATE()
     ORDER BY mins_since_arrival DESC
     LIMIT 50`,
    [SUBMISSION_SLA_MINS]
  ).catch(() => [[]] as [RowDataPacket[]]);

  for (const row of rows as RowDataPacket[]) {
    const tokenId = String(row.token_id ?? "");
    if (!row.recruiter_user_id || !shouldAlert(submissionAlerted, tokenId, FEEDBACK_COOLDOWN_MS)) continue;

    const elapsed = Number(row.mins_since_arrival ?? SUBMISSION_SLA_MINS);
    const hours   = Math.floor(elapsed / 60);
    const mins    = elapsed % 60;
    const label   = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    await inboxService.createItem({
      user_id:     String(row.recruiter_user_id),
      type:        "walkin_submission_sla",
      title:       `Interview not submitted — ${String(row.candidate_name ?? "Candidate")}`,
      description: `Token ${String(row.token_number ?? "N/A")} (${String(row.applied_role ?? "Role")}) arrived ${label} ago. Interview result must be submitted within ${SUBMISSION_SLA_MINS} min of arrival. Please submit now.`,
      entity_type: "ats_candidate",
      entity_id:   String(row.candidate_id),
      action_url:  "/ats/walkin-queue",
      priority:    "urgent",
    }).catch((e: unknown) => console.warn("[walkin-sla] submission SLA inbox write failed:", e));

    submissionAlerted.set(tokenId, Date.now());
    console.log(`[walkin-sla] submission SLA breach — ${String(row.candidate_name ?? "")} (${elapsed}min)`);
  }
}

// ── Check 2: Pending feedback reminder ───────────────────────────────────────

async function checkPendingFeedback(): Promise<void> {
  // Completed today: queue_status = 'completed' but candidate_status has not been
  // updated to a terminal stage (Selected / Rejected / On Hold etc).
  // We treat anything still in 'registered' or 'in_process' as feedback-pending.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       qt.id                                              AS token_id,
       COALESCE(qt.token_number, qt.token)                AS token_number,
       c.id                                               AS candidate_id,
       c.full_name                                        AS candidate_name,
       COALESCE(c.role_applied, c.applied_for_process)    AS applied_role,
       COALESCE(qt.branch_name, c.branch_display_name)    AS branch_name,
       TIMESTAMPDIFF(MINUTE, qt.interview_completed_at, NOW()) AS mins_since_complete,
       u.id                                               AS recruiter_user_id,
       rr.name                                            AS recruiter_name
     FROM ats_queue_token qt
     JOIN ats_candidate c ON c.id = qt.candidate_id
     LEFT JOIN ats_recruiter_roster rr ON rr.id = COALESCE(qt.recruiter_id, qt.assigned_recruiter_id)
     LEFT JOIN employees emp ON emp.id = rr.employee_id
     LEFT JOIN users u ON u.employee_id = emp.id
     WHERE qt.queue_status = 'completed'
       AND qt.interview_completed_at IS NOT NULL
       AND c.candidate_status IN ('registered', 'in_process', 'walkin_registered')
       AND DATE(qt.interview_completed_at) = CURDATE()
       AND TIMESTAMPDIFF(MINUTE, qt.interview_completed_at, NOW()) >= 10
     ORDER BY mins_since_complete DESC
     LIMIT 100`,
    []
  ).catch(() => [[]] as [RowDataPacket[]]);

  for (const row of rows as RowDataPacket[]) {
    const tokenId = String(row.token_id ?? "");
    if (!row.recruiter_user_id || !shouldAlert(feedbackAlerted, tokenId, FEEDBACK_COOLDOWN_MS)) continue;

    const elapsed = Number(row.mins_since_complete ?? 10);
    const hours   = Math.floor(elapsed / 60);
    const mins    = elapsed % 60;
    const label   = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    await inboxService.createItem({
      user_id:     String(row.recruiter_user_id),
      type:        "walkin_feedback_pending",
      title:       `Interview feedback pending — ${String(row.candidate_name ?? "Candidate")}`,
      description: `Token ${String(row.token_number ?? "N/A")} (${String(row.applied_role ?? "Role")}) interview completed ${label} ago but no selection/rejection decision has been recorded. Please submit your feedback.`,
      entity_type: "ats_candidate",
      entity_id:   String(row.candidate_id),
      action_url:  "/ats/walkin-queue",
      priority:    "high",
    }).catch((e: unknown) => console.warn("[walkin-sla] feedback pending inbox write failed:", e));

    feedbackAlerted.set(tokenId, Date.now());
    console.log(`[walkin-sla] feedback pending — ${String(row.candidate_name ?? "")} (${elapsed}min since completion)`);
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────

let intervalRef: ReturnType<typeof setInterval> | undefined;

async function run(): Promise<void> {
  await checkSubmissionSla().catch((e: unknown) => console.error("[walkin-sla] submission check error:", e));
  await checkPendingFeedback().catch((e: unknown) => console.error("[walkin-sla] feedback check error:", e));
  cleanupMap(submissionAlerted, 4 * 60 * 60 * 1000);
  cleanupMap(feedbackAlerted,   4 * 60 * 60 * 1000);
}

export function startWalkinSlaCron(): void {
  console.log(`[walkin-sla] Starting — submission SLA: ${SUBMISSION_SLA_MINS}min, interval: ${CHECK_INTERVAL_MS / 60000}min`);
  void run();
  intervalRef = setInterval(() => { void run(); }, CHECK_INTERVAL_MS);
}

export function stopWalkinSlaCron(): void {
  if (intervalRef) {
    clearInterval(intervalRef);
    intervalRef = undefined;
  }
  console.log("[walkin-sla] Stopped");
}
