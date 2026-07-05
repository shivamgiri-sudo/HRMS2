import { app } from "./app.js";
import { env } from "./config/env.js";
import { runPendingMigrations } from "./db/runPendingMigrations.js";
import { startTenureBadgeScheduler } from "./modules/engagement/tenure.cron.js";
import { startCommunicationCleanup } from "./modules/communication/cleanup.cron.js";
import { startAttendanceEngineScheduler } from "./modules/wfm/attendance-engine.cron.js";
import { bootstrapCosecIntegration } from "./modules/wfm/cosec-integration.bootstrap.js";
import { legacySyncWorker } from "./workers/legacy-sync-worker.js";
import { startAccessExpiryScheduler } from "./workers/access-expiry.worker.js";
import { startITProvisioningLockScheduler } from "./modules/it-provisioning/it-provisioning.cron.js";
import { startPayrollWindowClosureScheduler } from "./modules/payroll/payroll-window.cron.js";
import { startOfficialEmailComplianceScheduler } from "./workers/official-email-compliance.worker.js";
import { startIntegrationScheduler } from "./workers/integration-scheduler.worker.js";
import { startLeaveMonthlyWorker } from "./workers/leave-monthly-credit.worker.js";
import { startAnnualLeaveWorker } from "./workers/leave-annual-el-credit.worker.js";
import { migrateLegacyIntegrationSecrets } from "./modules/external-db/external-db.service.js";
// Attendance data sync workers — APR/dialler + biometric COSEC
import { startAprVicidialSyncWorker } from "./workers/apr-vicidial-sync.worker.js";
import { runNcosecBiometricSync } from "../scripts/migrate-ncosec-biometric.js";
// Payroll nightly recalc
import { startPayrollNightlyRecalcWorker } from "./workers/payroll-nightly-recalc.worker.js";
// KPI, SLA, LMS sync
import { startKpiDailySyncWorker } from "./workers/kpi-daily-sync.worker.js";
import { startSLABreachWorker } from "./workers/sla-breach-worker.js";
import { startLmsSyncWorker } from "./workers/lms-sync.worker.js";

// Single-instance guard: if server.ts is the sole entry point, run all workers here.
// If all-workers.ts is also running (separate process), set WORKERS_PROCESS=external
// to prevent double-scheduling.
const WORKERS_EXTERNAL = process.env.WORKERS_PROCESS === "external";

const BIOMETRIC_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 h

async function startBiometricCosecWorker(): Promise<void> {
  const run = async () => {
    console.log("[biometric-cosec-sync] Starting NCOSEC sync...");
    try {
      const summary = await runNcosecBiometricSync();
      console.log(
        `[biometric-cosec-sync] Done — inserted: ${summary.attendance_inserted}, ` +
        `updated: ${summary.attendance_updated}, errors: ${summary.errors.length}`
      );
    } catch (err: any) {
      console.error("[biometric-cosec-sync] Failed:", err.message);
    }
  };
  await run();
  setInterval(run, BIOMETRIC_SYNC_INTERVAL_MS);
}

function startServer() {
  app.listen(env.PORT, () => {
    startOfficialEmailComplianceScheduler();
    startIntegrationScheduler();
    console.log("[scheduler] official-email and integration scheduler started");

    if (env.ENABLE_SCHEDULERS) {
      startTenureBadgeScheduler();
      startCommunicationCleanup();
      startAttendanceEngineScheduler();
      legacySyncWorker.start();
      startAccessExpiryScheduler();
      startITProvisioningLockScheduler();
      startLeaveMonthlyWorker();
      startAnnualLeaveWorker();
      startPayrollWindowClosureScheduler();
      console.log("[schedulers] tenure, communication, attendance, legacy-sync, access-expiry, it-provisioning, leave-monthly, leave-annual, payroll-window started");

      if (!WORKERS_EXTERNAL) {
        // Attendance data sync: APR/dialler → apr table (daily at 01:30 IST)
        startAprVicidialSyncWorker().catch(err =>
          console.error("[apr-sync] startup error:", err.message)
        );

        // Biometric COSEC → cosec_daily_agg → ADR (every 6h)
        startBiometricCosecWorker().catch(err =>
          console.error("[biometric-cosec-sync] startup error:", err.message)
        );

        // Payroll nightly recalculation (23:45 IST = 18:15 UTC)
        startPayrollNightlyRecalcWorker().catch(err =>
          console.error("[payroll-nightly-recalc] startup error:", err.message)
        );

        // KPI daily sync, SLA breach detection, LMS sync
        startKpiDailySyncWorker().catch(err =>
          console.error("[kpi-daily-sync] startup error:", err.message)
        );
        startSLABreachWorker().catch(err =>
          console.error("[sla-breach] startup error:", err.message)
        );
        startLmsSyncWorker().catch(err =>
          console.error("[lms-sync] startup error:", err.message)
        );

        console.log("[workers] apr-sync, biometric-cosec-sync, payroll-nightly-recalc, kpi-sync, sla-breach, lms-sync started inline");
      } else {
        console.log("[workers] WORKERS_PROCESS=external — skipping inline workers (handled by all-workers process)");
      }
    } else {
      console.log("[schedulers] disabled (set ENABLE_SCHEDULERS=true to enable)");
    }
    console.log(`MCN HRMS backend running on http://localhost:${env.PORT}`);
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]).catch(err => { console.warn(`[startup] ${label} skipped:`, err.message); return null; });
}

async function initializeRuntime() {
  await withTimeout(migrateLegacyIntegrationSecrets(), 8000, 'migrateLegacyIntegrationSecrets');
  const cosecActive = await withTimeout(bootstrapCosecIntegration(), 8000, 'bootstrapCosecIntegration');
  console.log(`[cosec-sync] automatic schedule ${cosecActive ? "active" : "inactive"}`);
  startServer();
}

runPendingMigrations()
  .then(initializeRuntime)
  .catch(async (error) => {
    console.error("[startup] migration runner failed:", error instanceof Error ? error.message : error);

    if (env.NODE_ENV === "production") {
      console.error("[startup] production server was not started because the database schema is incomplete.");
      throw error;
    }

    console.warn("[startup] development mode: starting with degraded migration health.");
    await initializeRuntime();
  });
