import { cosecSyncService } from "./cosec-sync.service.js";

let intervalHandle: NodeJS.Timeout | null = null;

function positiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function dateOnly(value: Date): string {
  // IST = UTC + 5:30 — must use IST date so the sync window aligns with the
  // calendar day on the COSEC server (which stores wall-clock IST times).
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(value.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function startCosecSyncWorker() {
  if (intervalHandle) return;
  const explicitlyDisabled = process.env.NCOSEC_SYNC_ENABLED === "false";
  const configured = Boolean(
    process.env.NCOSEC_DB_HOST
    && process.env.NCOSEC_DB_USER
    && process.env.NCOSEC_DB_PASSWORD
  );
  if (explicitlyDisabled || !configured) {
    console.log("[cosec-sync] disabled");
    return;
  }

  const intervalMs = positiveNumber("NCOSEC_SYNC_INTERVAL_MS", 300000);
  const lookbackDays = positiveNumber("NCOSEC_SYNC_LOOKBACK_DAYS", 1);

  const execute = async () => {
    if (cosecSyncService.isRunning()) return;
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - lookbackDays);

    try {
      const result = await cosecSyncService.sync({
        from: dateOnly(from),
        to: dateOnly(to),
      });
      console.log(`[cosec-sync] migrated=${result.migratedDays} pulled=${result.pulledEvents} unmapped=${result.unmappedUsers.length} failed=${result.failed.length}`);
    } catch (error) {
      console.error("[cosec-sync] error", error instanceof Error ? error.message : String(error));
    }
  };

  intervalHandle = setInterval(execute, intervalMs);
  void execute();
  console.log(`[cosec-sync] started intervalMs=${intervalMs} lookbackDays=${lookbackDays}`);
}

export function stopCosecSyncWorker() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
