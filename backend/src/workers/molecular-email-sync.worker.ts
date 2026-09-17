import {
  EMAIL_DASHBOARD_SOURCES,
  syncRecentEmailTickets,
} from "../modules/process-live-dashboard/molecular-email-sync.service.js";
import { closeMolecularEmailPools } from "../db/molecularEmailDb.js";

const WORKER_NAME = "molecular-email-sync";

let intervalRef: ReturnType<typeof setInterval> | undefined;

async function runSync(): Promise<void> {
  try {
    const results = await syncRecentEmailTickets(2);
    for (const r of results) {
      console.log(`[${WORKER_NAME}] ${r.dashboardLabel}: ${r.daysUpserted} day(s) upserted`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${WORKER_NAME}] sync failed:`, message);
  }
}

export async function startMolecularEmailSyncWorker(): Promise<void> {
  console.log(`[${WORKER_NAME}] Sources: ${EMAIL_DASHBOARD_SOURCES.map((s) => s.database).join(", ")}`);
  await runSync();

  const SYNC_INTERVAL_MS = 60 * 60 * 1000;
  console.log(`[${WORKER_NAME}] Scheduled hourly sync (every 60 min)`);
  intervalRef = setInterval(() => void runSync(), SYNC_INTERVAL_MS);
}

export function stopMolecularEmailSyncWorker(): void {
  if (intervalRef) {
    clearInterval(intervalRef);
    intervalRef = undefined;
  }
  void closeMolecularEmailPools();
  console.log(`[${WORKER_NAME}] Stopped`);
}
