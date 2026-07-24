import { notifySLABreach } from "../services/ats-notification.helper.js";

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

const SLA_THRESHOLD_MINUTES = 30; // Send alert after 30 minutes
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // Don't re-alert same candidate for 1 hour
const STARTUP_DELAY_MS = 30 * 1000;
const CANDIDATE_SCAN_LIMIT = 100;
const MAX_ALERTS_PER_RUN = 10;

let startupTimeoutRef: ReturnType<typeof setTimeout> | undefined;
let intervalRef: ReturnType<typeof setInterval> | undefined;

// ── In-Memory Alert Tracking ─────────────────────────────────────────────────

const alertedCandidates = new Map<string, number>(); // candidateId → lastAlertTimestamp
let isProcessing = false;

/**
 * Check if we should alert for this candidate (respects cooldown)
 */
function shouldAlert(candidateId: string): boolean {
  const lastAlert = alertedCandidates.get(candidateId);
  if (!lastAlert) return true;

  const elapsed = Date.now() - lastAlert;
  return elapsed >= ALERT_COOLDOWN_MS;
}

/**
 * Mark candidate as alerted
 */
function markAlerted(candidateId: string): void {
  alertedCandidates.set(candidateId, Date.now());
}

/**
 * Clean up old alert records (older than 2 hours)
 */
function cleanupAlertCache(): void {
  const cutoff = Date.now() - (2 * ALERT_COOLDOWN_MS);
  for (const [candidateId, timestamp] of alertedCandidates.entries()) {
    if (timestamp < cutoff) {
      alertedCandidates.delete(candidateId);
    }
  }
}

// ── Worker Logic ─────────────────────────────────────────────────────────────

/**
 * Find candidates waiting beyond SLA threshold
 */
async function findSLABreachCandidates(): Promise<any[]> {
  try {
    const [rows]: any = await db.execute(
      `SELECT
         c.id AS candidate_id,
         c.full_name AS candidate_name,
         c.applied_for_branch AS branch,
         c.applied_for_process AS role_applied,
         c.recruiter_assigned_name AS recruiter_name,
         qt.token AS q_token,
         TIMESTAMPDIFF(MINUTE, CONCAT(c.created_date, ' ', c.created_time), NOW()) AS pending_minutes
       FROM ats_candidate c
       LEFT JOIN ats_queue_token qt ON qt.candidate_id = c.id AND qt.status = 'active'
       WHERE c.status = 'Waiting'
         AND c.recruiter_assigned_name IS NOT NULL
         AND TIMESTAMPDIFF(MINUTE, CONCAT(c.created_date, ' ', c.created_time), NOW()) >= ?
         AND CONCAT(c.created_date, ' ', c.created_time) >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       ORDER BY pending_minutes ASC
       LIMIT ${CANDIDATE_SCAN_LIMIT}`,
      [SLA_THRESHOLD_MINUTES]
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
  if (isProcessing) {
    console.log("[SLABreachWorker] Previous check is still running; skipping overlap");
    return;
  }

  isProcessing = true;
  try {
    console.log("[SLABreachWorker] Checking for SLA breaches...");

    const candidates = await findSLABreachCandidates();

    if (candidates.length === 0) {
      console.log("[SLABreachWorker] No SLA breaches found");
      return;
    }

    console.log(`[SLABreachWorker] Found ${candidates.length} recent candidates beyond SLA`);
    let alertsSent = 0;

    for (const candidate of candidates) {
      if (alertsSent >= MAX_ALERTS_PER_RUN) break;
      if (!shouldAlert(candidate.candidate_id)) continue;

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

      markAlerted(candidate.candidate_id);
      alertsSent += 1;
    }

    cleanupAlertCache();
  } finally {
    isProcessing = false;
  }
}

/**
 * Start worker (main loop)
 */
function startWorker(): Promise<void> {
  console.log("[SLABreachWorker] Starting...");
  console.log(`[SLABreachWorker] SLA threshold: ${SLA_THRESHOLD_MINUTES} minutes`);
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
