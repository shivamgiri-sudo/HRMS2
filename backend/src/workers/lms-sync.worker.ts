import { runFullSync } from '../modules/lms/lms.sync.service.js';

// ── Configuration ──────────────────────────────────────────────────────────
// Run every hour at :05 (5 minutes past each hour)
const HOURLY_INTERVAL_MS = 60 * 60 * 1000;

function msUntilNextHourFive(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(next.getHours(), 5, 0, 0);
  if (next <= now) {
    next.setHours(next.getHours() + 1);
  }
  return next.getTime() - now.getTime();
}

// ── Worker Logic ───────────────────────────────────────────────────────────

async function runLmsSync(): Promise<void> {
  console.log('[LMS Sync] Starting full LMS synchronization...');

  try {
    const result = await runFullSync();
    console.log(
      `[LMS Sync] Complete — mapped: ${result.mapped}, progress: ${result.progress}, certifications: ${result.certifications}, errors: ${result.errors.length}`
    );

    if (result.errors.length > 0) {
      console.warn('[LMS Sync] Errors encountered:');
      result.errors.slice(0, 5).forEach((err) => console.warn(`  - ${err}`));
      if (result.errors.length > 5) {
        console.warn(`  ... and ${result.errors.length - 5} more errors`);
      }
    }
  } catch (err: any) {
    console.error('[LMS Sync] Sync failed:', err.message);
  }
}

// ── Scheduler ──────────────────────────────────────────────────────────────

async function startWorker(): Promise<void> {
  console.log('[LMS Sync] Worker starting — will run hourly at :05');

  const delay = msUntilNextHourFive();
  console.log(`[LMS Sync] First run in ${Math.round(delay / 60000)} minutes`);

  setTimeout(async () => {
    await runLmsSync();
    // Then repeat every 60 minutes
    setInterval(runLmsSync, HOURLY_INTERVAL_MS);
  }, delay);
}

// ── Entry Point ────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker().catch((err) => {
    console.error('[LMS Sync] Fatal error:', err);
    process.exit(1);
  });
}

export { startWorker as startLmsSyncWorker, runLmsSync };
