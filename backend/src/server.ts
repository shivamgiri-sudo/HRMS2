import { app } from "./app.js";
import { env } from "./config/env.js";
import { runFinanceSchemaHardeningMigrations } from "./db/runFinanceSchemaHardeningMigrations.js";
import { runFinanceSupplementalMigrations } from "./db/runFinanceSupplementalMigrations.js";
import { runPendingMigrations, verifySchemaVersion } from "./db/runPendingMigrations.js";

// MIGRATION GOVERNANCE: When enabled, API startup only verifies schema version
// instead of running migrations. Use `npm run migrate` to apply migrations separately.
const MIGRATIONS_VERIFY_ONLY = process.env.MIGRATIONS_VERIFY_ONLY === "true";
import { initBusinessActionSyncJobs } from "./cron/business-action-sync.cron.js";
import { startCommunicationCleanup } from "./modules/communication/cleanup.cron.js";
import { startTenureBadgeScheduler } from "./modules/engagement/tenure.cron.js";
import { migrateLegacyIntegrationSecrets } from "./modules/external-db/external-db.service.js";
import { startITProvisioningLockScheduler } from "./modules/it-provisioning/it-provisioning.cron.js";
import { startPayrollWindowClosureScheduler } from "./modules/payroll/payroll-window.cron.js";
import { startAttendanceEngineScheduler } from "./modules/wfm/attendance-engine.cron.js";
import { bootstrapCosecIntegration } from "./modules/wfm/cosec-integration.bootstrap.js";
import { startAccessExpiryScheduler } from "./workers/access-expiry.worker.js";
import { startAnnualLeaveWorker } from "./workers/leave-annual-el-credit.worker.js";
import { startLeaveMonthlyWorker } from "./workers/leave-monthly-credit.worker.js";
import { legacySyncWorker } from "./workers/legacy-sync-worker.js";
import { startOfficialEmailComplianceScheduler } from "./workers/official-email-compliance.worker.js";
import { startIntegrationScheduler } from "./workers/integration-scheduler.worker.js";
import { startAprVicidialSyncWorker } from "./workers/apr-vicidial-sync.worker.js";
import { startKpiDailySyncWorker } from "./workers/kpi-daily-sync.worker.js";
import { startPayrollNightlyRecalcWorker } from "./workers/payroll-nightly-recalc.worker.js";
import { startSLABreachWorker } from "./workers/sla-breach-worker.js";
import { startLmsSyncWorker } from "./workers/lms-sync.worker.js";
import { startBreachSlaCron } from "./modules/privacy/dpdp-breach-sla.cron.js";
import { startRetentionCron } from "./workers/privacy-retention.worker.js";
import { startAtsRemindersScheduler } from "./modules/ats/ats-reminders.cron.js";

const WORKERS_EXTERNAL = process.env.WORKERS_PROCESS === "external";

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
      initBusinessActionSyncJobs();
      startBreachSlaCron();
      startRetentionCron();
      startAtsRemindersScheduler();
      console.log(
        "[schedulers] tenure, communication, attendance, legacy-sync, access-expiry, it-provisioning, leave-monthly, leave-annual, payroll-window, business-action-sync, breach-sla, privacy-retention, ats-reminders started"
      );

      if (!WORKERS_EXTERNAL) {
        startAprVicidialSyncWorker().catch((error) =>
          console.error("[apr-sync] startup error:", error.message)
        );
        startPayrollNightlyRecalcWorker().catch((error) =>
          console.error("[payroll-nightly-recalc] startup error:", error.message)
        );
        startKpiDailySyncWorker().catch((error) =>
          console.error("[kpi-sync] startup error:", error.message)
        );
        startSLABreachWorker().catch((error) =>
          console.error("[sla-breach] startup error:", error.message)
        );
        startLmsSyncWorker().catch((error) =>
          console.error("[lms-sync] startup error:", error.message)
        );

        console.log(
          "[workers] apr-sync, payroll-nightly-recalc, kpi-sync, sla-breach, lms-sync started inline"
        );
        console.log(
          "[workers] biometric attendance sync is handled by the integration scheduler / cosec-sync worker"
        );
      } else {
        console.log(
          "[workers] WORKERS_PROCESS=external - skipping inline workers (handled by all-workers process)"
        );
      }
    } else {
      console.log("[schedulers] disabled (set ENABLE_SCHEDULERS=true to enable)");
    }
    console.log(`MCN HRMS backend running on http://localhost:${env.PORT}`);
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  label: string
): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((_resolve, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${milliseconds}ms`)),
        milliseconds
      )
    ),
  ]).catch((error) => {
    console.warn(`[startup] ${label} skipped:`, error.message);
    return null;
  });
}

async function initializeRuntime() {
  await withTimeout(
    migrateLegacyIntegrationSecrets(),
    8000,
    "migrateLegacyIntegrationSecrets"
  );
  const cosecActive = await withTimeout(
    bootstrapCosecIntegration(),
    8000,
    "bootstrapCosecIntegration"
  );
  console.log(
    `[cosec-sync] automatic schedule ${cosecActive ? "active" : "inactive"}`
  );
  startServer();
}

async function handleMigrations(): Promise<void> {
  if (MIGRATIONS_VERIFY_ONLY) {
    // GOVERNANCE: Verify schema version without running migrations
    console.log("[startup] MIGRATIONS_VERIFY_ONLY=true - verifying schema version...");
    const schemaStatus = await verifySchemaVersion();

    if (!schemaStatus.valid) {
      const message =
        `Schema validation failed: ${schemaStatus.pendingCount} pending migrations. ` +
        `Run 'npm run migrate' before starting the API. ` +
        `Pending: ${schemaStatus.pendingFiles.join(", ")}${schemaStatus.pendingCount > 10 ? "..." : ""}`;

      if (env.NODE_ENV === "production") {
        throw new Error(message);
      }
      console.warn(`[startup] ${message}`);
      console.warn("[startup] development mode: continuing with incomplete schema.");
    } else {
      console.log(`[startup] schema verified: ${schemaStatus.appliedCount} migrations applied`);
    }
    return;
  }

  // Default behavior: run migrations at startup
  await runPendingMigrations();
  await runFinanceSupplementalMigrations();
  await runFinanceSchemaHardeningMigrations();
}

handleMigrations()
  .then(initializeRuntime)
  .catch(async (error) => {
    console.error(
      "[startup] migration/schema verification failed:",
      error instanceof Error ? error.message : error
    );

    if (env.NODE_ENV === "production") {
      console.error(
        "[startup] production server was not started because the database schema is incomplete."
      );
      throw error;
    }

    console.warn(
      "[startup] development mode: starting with degraded migration health."
    );
    await initializeRuntime();
  });
