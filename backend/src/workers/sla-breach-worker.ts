import { notifySLABreach } from "../services/ats-notification.helper.js";
import { inboxService } from "../modules/inbox/inbox.service.js";
import { isWorkerEnabled, markWorkerRun } from "../shared/worker-config.js";
import { shouldAlert, markAlerted, cleanupCooldowns } from "../shared/alert-cooldown.js";

// Database connection
let db: any;
try {
  const dbModule = await import("../db/mysql.js");
  db = dbModule.db;
} catch {
  console.error("[SLABreachWorker] Database module not found - worker will not run");
  process.exit(1);
}

// ── Configuration ────────────────────────────────────────────────────────────

// Original hardcoded value, now read from tat_matrix_master.ATS_QUEUE_WAIT
// const SLA_THRESHOLD_MINUTES = 30;
// Must match the worker_config.worker_name row exactly, or the kill switch
// silently does nothing (isWorkerEnabled fails open on a missing row).
const WORKER_NAME = "sla-breach";
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // Don't re-alert same candidate for 1 hour
const STARTUP_DELAY_MS = 30 * 1000;
const CANDIDATE_SCAN_LIMIT = 100;
const MAX_ALERTS_PER_RUN = 10;

/**
 * Read SLA threshold from tat_matrix_master. Falls back to 30 min if not configured.
 */
async function getSlaThresholdMinutes(): Promise<number> {
  try {
    const [rows]: any = await db.execute(
      `SELECT default_tat_hours FROM tat_matrix_master
       WHERE task_type = 'ATS_QUEUE_WAIT' AND is_active = 1 LIMIT 1`
    );
    const hours = rows?.[0]?.default_tat_hours ?? 0.5;
    return Math.round(hours * 60);
  } catch {
    return 30; // fallback to original hardcoded value
  }
}

let startupTimeoutRef: ReturnType<typeof setTimeout> | undefined;
let intervalRef: ReturnType<typeof setInterval> | undefined;

// ── Alert Tracking ───────────────────────────────────────────────────────────
//
// The cooldown used to be a module-level Map. ecosystem.config.cjs permits 10 pm2
// restarts and each one emptied it, re-alerting every waiting candidate — which is
// how 18,959 SLA mails accumulated, 6,510 of them in a single day. It now lives in
// the alert_cooldown table so a restart no longer resets it.

let isProcessing = false;

// ── Worker Logic ─────────────────────────────────────────────────────────────

/**
 * Find candidates waiting beyond SLA threshold
 */
async function findSLABreachCandidates(slaThresholdMinutes: number): Promise<any[]> {
  try {
    const [rows]: any = await db.execute(
      `SELECT
         c.id AS candidate_id,
         c.full_name AS candidate_name,
         c.applied_for_branch AS branch,
         c.applied_for_process AS role_applied,
         c.recruiter_assigned_name AS recruiter_name,
         qt.token AS q_token,
         TIMESTAMPDIFF(MINUTE, COALESCE(qt.arrival_time, qt.created_at), NOW()) AS pending_minutes,
         -- employees.user_id is the HRMS portal user id in mas_hrms
         emp.user_id AS recruiter_user_id
       FROM ats_candidate c
       LEFT JOIN ats_queue_token qt ON qt.candidate_id = c.id AND qt.status = 'active'
       LEFT JOIN ats_recruiter_roster rr ON rr.id = c.recruiter_id
       LEFT JOIN employees emp ON emp.id = rr.employee_id
       WHERE c.status = 'Waiting'
         -- The queue token is the truth about whether somebody is still in the
         -- lobby; ats_candidate.status is not. A candidate who walks out is
         -- marked no_show on the token, but nothing moves them off 'Waiting'
         -- unless the recruiter submits feedback — so filtering on status alone
         -- re-alerted people who had already left, every 5 minutes for 24 hours.
         -- Live on 2026-08-02: the single candidate this worker was alerting on
         -- had queue_status = 'no_show' and had been "waiting" 1,107 minutes.
         -- 'in_interview' is excluded here too: that is what
         -- interview-delay-alert.worker.ts is for, and "waiting to be called" is
         -- the wrong thing to say about somebody already in the room.
         AND qt.queue_status = 'waiting'
         AND c.recruiter_assigned_name IS NOT NULL
         AND TIMESTAMPDIFF(MINUTE, COALESCE(qt.arrival_time, qt.created_at), NOW()) >= ?
         AND COALESCE(qt.arrival_time, qt.created_at) >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       ORDER BY pending_minutes ASC
       LIMIT ${CANDIDATE_SCAN_LIMIT}`,
      [slaThresholdMinutes]
    );

    return rows || [];
  } catch (error: any) {
    console.error("[SLABreachWorker] Failed to fetch candidates:", error.message);
    return [];
  }
}

/**
 * Process SLA breach alerts
 */
async function processSLABreaches(): Promise<void> {
  // Kill switch. This worker mails candidates' recruiters and HR directly via
  // ats-notification.helper -> emailService, a path that consults neither
  // notification_event_config nor anything else — so turning every event off in
  // the notifications admin screen had no effect on it, and there was no way to
  // stop it short of a deploy. worker_config.enabled is that way.
  //
  // isWorkerEnabled fails OPEN, so the existing 'sla-breach' row (enabled = 1)
  // keeps current behaviour until somebody sets it to 0.
  if (!(await isWorkerEnabled(WORKER_NAME))) {
    return;
  }

  if (isProcessing) {
    console.log("[SLABreachWorker] Previous check is still running; skipping overlap");
    return;
  }

  isProcessing = true;
  try {
    const slaThreshold = await getSlaThresholdMinutes();
    console.log(`[SLABreachWorker] Checking for SLA breaches (threshold: ${slaThreshold} min)...`);

    const candidates = await findSLABreachCandidates(slaThreshold);

    if (candidates.length === 0) {
      console.log("[SLABreachWorker] No SLA breaches found");
      return;
    }

    console.log(`[SLABreachWorker] Found ${candidates.length} recent candidates beyond SLA`);
    let alertsSent = 0;

    for (const candidate of candidates) {
      if (alertsSent >= MAX_ALERTS_PER_RUN) break;
      if (!(await shouldAlert(WORKER_NAME, candidate.candidate_id, ALERT_COOLDOWN_MS))) continue;

      console.log(`[SLABreachWorker] Alerting for ${candidate.candidate_name} (${candidate.pending_minutes} mins)`);

      await notifySLABreach({
        candidateId: candidate.candidate_id,
        candidateName: candidate.candidate_name,
        qToken: candidate.q_token || "N/A",
        recruiterName: candidate.recruiter_name,
        branch: candidate.branch || "N/A",
        roleApplied: candidate.role_applied || "N/A",
        slaMinutes: candidate.pending_minutes,
      });

      // Inbox alert so the recruiter sees a toast + bell notification
      if (candidate.recruiter_user_id) {
        await inboxService.createItem({
          user_id: candidate.recruiter_user_id,
          type: "sla_breach_uncalled",
          title: `Candidate not called — ${candidate.candidate_name}`,
          description: `Token ${candidate.q_token || "N/A"} has been waiting ${candidate.pending_minutes} min without being called. SLA threshold: ${slaThreshold} min.`,
          entity_type: "ats_candidate",
          entity_id: candidate.candidate_id,
          action_url: "/ats/walkin-queue",
          priority: "urgent",
        }).catch((e: unknown) => console.warn("[SLABreachWorker] inbox write failed:", e));
      }

      await markAlerted(WORKER_NAME, candidate.candidate_id);
      alertsSent += 1;
    }

    await cleanupCooldowns(WORKER_NAME, 2 * ALERT_COOLDOWN_MS);
    // Every worker_config row currently reads last_run_at = never, which makes it
    // impossible to tell a disabled worker from a stalled one.
    await markWorkerRun(WORKER_NAME);
  } finally {
    isProcessing = false;
  }
}

/**
 * Start worker (main loop)
 */
function startWorker(): Promise<void> {
  console.log("[SLABreachWorker] Starting...");
  console.log(`[SLABreachWorker] Check interval: ${CHECK_INTERVAL_MS / 1000} seconds`);

  // Let the API finish warming up before any external notification work begins.
  startupTimeoutRef = setTimeout(() => {
    void processSLABreaches();
  }, STARTUP_DELAY_MS);

  intervalRef = setInterval(() => {
    void processSLABreaches();
  }, CHECK_INTERVAL_MS);

  return Promise.resolve();
}

function stopWorker(): void {
  if (startupTimeoutRef) {
    clearTimeout(startupTimeoutRef);
    startupTimeoutRef = undefined;
  }
  if (intervalRef) {
    clearInterval(intervalRef);
    intervalRef = undefined;
  }
  console.log("[SLABreachWorker] Stopped");
}

// ── Start Worker ─────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  // Running as standalone script
  startWorker().catch((error) => {
    console.error("[SLABreachWorker] Fatal error:", error);
    process.exit(1);
  });
}

export { startWorker as startSLABreachWorker, stopWorker as stopSLABreachWorker, processSLABreaches };
