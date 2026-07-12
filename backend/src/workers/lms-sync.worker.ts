import { db } from "../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { runFullSync } from "../modules/lms/lms.sync.service.js";

// ── Configuration ──────────────────────────────────────────────────────────

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// ── Schedule helpers ───────────────────────────────────────────────────────

async function isScheduleEnabled(): Promise<boolean> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT enabled FROM integration_schedule WHERE integration_key = 'lms_sync' LIMIT 1`
    );
    if (!(rows as any[]).length) return true; // default enabled if no row
    return Boolean((rows as any[])[0].enabled);
  } catch {
    return true; // fail-open: run sync if we can't check
  }
}

async function updateLastRun(): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO integration_schedule (id, integration_key, cron_expression, enabled, last_run_at)
       VALUES (UUID(), 'lms_sync', '0 0 * * * *', 1, NOW())
       ON DUPLICATE KEY UPDATE last_run_at = NOW()`
    );
  } catch (e) {
    console.warn("[lms-worker] failed to update last_run_at:", e);
  }
}

// ── Worker Logic ───────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  if (!(await isScheduleEnabled())) {
    console.log("[lms-worker] skipped — schedule disabled");
    return;
  }

  try {
    const result = await runFullSync();
    await updateLastRun();
    console.log("[lms-worker] sync complete:", result);

    if (result.errors && result.errors.length > 0) {
      console.warn("[lms-worker] errors encountered:");
      result.errors.slice(0, 5).forEach((err: string) => console.warn(`  - ${err}`));
      if (result.errors.length > 5) {
        console.warn(`  ... and ${result.errors.length - 5} more errors`);
      }
    }
  } catch (e) {
    console.error("[lms-worker] sync error:", e);
  }
}

// ── Scheduler ──────────────────────────────────────────────────────────────

async function startWorker(): Promise<void> {
  console.log("[lms-worker] starting — will run every hour");
  tick(); // run immediately on startup
  setInterval(tick, INTERVAL_MS);
}

// ── Entry Point ────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker().catch((err) => {
    console.error("[lms-worker] fatal error:", err);
    process.exit(1);
  });
}

export { startWorker as startLmsSyncWorker, tick as runLmsSync };
