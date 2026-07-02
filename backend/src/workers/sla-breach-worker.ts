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

// ── In-Memory Alert Tracking ─────────────────────────────────────────────────

const alertedCandidates = new Map<string, number>(); // candidateId → lastAlertTimestamp

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
       ORDER BY pending_minutes DESC`,
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
  console.log("[SLABreachWorker] Checking for SLA breaches...");

  const candidates = await findSLABreachCandidates();

  if (candidates.length === 0) {
    console.log("[SLABreachWorker] No SLA breaches found");
    return;
  }

  console.log(`[SLABreachWorker] Found ${candidates.length} candidates beyond SLA`);

  for (const candidate of candidates) {
    if (!shouldAlert(candidate.candidate_id)) {
      console.log(`[SLABreachWorker] Skipping ${candidate.candidate_name} (cooldown)`);
      continue;
    }

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
  }

  // Cleanup old alert cache
  cleanupAlertCache();
}

/**
 * Start worker (main loop)
 */
async function startWorker(): Promise<void> {
  console.log("[SLABreachWorker] Starting...");
  console.log(`[SLABreachWorker] SLA threshold: ${SLA_THRESHOLD_MINUTES} minutes`);
  console.log(`[SLABreachWorker] Check interval: ${CHECK_INTERVAL_MS / 1000} seconds`);

  // Run immediately on start
  await processSLABreaches();

  // Then run periodically
  setInterval(async () => {
    await processSLABreaches();
  }, CHECK_INTERVAL_MS);
}

// ── Start Worker ─────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  // Running as standalone script
  startWorker().catch((error) => {
    console.error("[SLABreachWorker] Fatal error:", error);
    process.exit(1);
  });
}

export { startWorker as startSLABreachWorker, processSLABreaches };
