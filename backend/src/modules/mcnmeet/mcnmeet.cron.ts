import { ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startMcnmeetCron() {
  if (!env.MCNMEET_ENABLED) {
    console.log("[mcnmeet-cron] Module disabled, skipping cron setup");
    return;
  }

  // Initial run after 30s startup delay
  const initialDelay = setTimeout(async () => {
    console.log("[mcnmeet-cron] initial status transition started");
    try {
      await transitionMeetingStatuses();
      console.log("[mcnmeet-cron] initial status transition done");
    } catch (err) {
      console.error("[mcnmeet-cron] initial status transition error:", err);
    }
  }, 30_000);

  // Run every 5 minutes
  intervalHandle = setInterval(async () => {
    try {
      await transitionMeetingStatuses();
    } catch (err) {
      console.error("[mcnmeet-cron] status transition error:", err);
    }
  }, INTERVAL_MS);

  // Don't keep process alive on shutdown
  if (typeof initialDelay.unref === 'function') initialDelay.unref();
  if (intervalHandle && typeof intervalHandle.unref === 'function') intervalHandle.unref();

  console.log("[mcnmeet-cron] Status transition cron started (every 5 min)");
}

export function stopMcnmeetCron() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("[mcnmeet-cron] Cron stopped");
  }
}

async function transitionMeetingStatuses() {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // Transition scheduled -> live (when start_at has passed)
  const [liveResult] = await db.execute<ResultSetHeader>(
    `UPDATE mcnmeet_meeting
     SET status = 'live', updated_at = NOW()
     WHERE status = 'scheduled' AND start_at <= ?`,
    [now]
  );

  if (liveResult.affectedRows > 0) {
    console.log(`[mcnmeet-cron] Transitioned ${liveResult.affectedRows} meeting(s) to 'live'`);
  }

  // Transition live -> completed (when end_at has passed, or 3 hours after start if no end_at)
  const [completedResult] = await db.execute<ResultSetHeader>(
    `UPDATE mcnmeet_meeting
     SET status = 'completed', updated_at = NOW()
     WHERE status = 'live'
     AND (
       (end_at IS NOT NULL AND end_at <= ?)
       OR (end_at IS NULL AND DATE_ADD(start_at, INTERVAL 3 HOUR) <= ?)
     )`,
    [now, now]
  );

  if (completedResult.affectedRows > 0) {
    console.log(`[mcnmeet-cron] Transitioned ${completedResult.affectedRows} meeting(s) to 'completed'`);
  }

  // Also mark meetings that were never started but their end time passed as completed
  const [missedResult] = await db.execute<ResultSetHeader>(
    `UPDATE mcnmeet_meeting
     SET status = 'completed', updated_at = NOW()
     WHERE status = 'scheduled'
     AND (
       (end_at IS NOT NULL AND end_at <= ?)
       OR (end_at IS NULL AND DATE_ADD(start_at, INTERVAL 3 HOUR) <= ?)
     )`,
    [now, now]
  );

  if (missedResult.affectedRows > 0) {
    console.log(`[mcnmeet-cron] Marked ${missedResult.affectedRows} missed meeting(s) as 'completed'`);
  }
}

// Export for manual triggering/testing
export { transitionMeetingStatuses };
