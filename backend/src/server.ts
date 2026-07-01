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

function startServer() {
  app.listen(env.PORT, () => {
    startOfficialEmailComplianceScheduler();
    startIntegrationScheduler();
    console.log("[scheduler] official-email, integration, and COSEC sync checks completed");
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
      console.log(`[schedulers] tenure, communication, attendance, legacy-sync, access-expiry, it-provisioning, leave-monthly, leave-annual, payroll-window started`);
    } else {
      console.log(`[schedulers] disabled (set ENABLE_SCHEDULERS=true to enable)`);
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
