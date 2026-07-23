import type { Server } from "http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { db } from "./db/mysql.js";
import { runFinanceSchemaHardeningMigrations } from "./db/runFinanceSchemaHardeningMigrations.js";
import { runFinanceSupplementalMigrations } from "./db/runFinanceSupplementalMigrations.js";
import { runPendingMigrations, verifySchemaVersion } from "./db/runPendingMigrations.js";

// MIGRATION GOVERNANCE: When enabled, API startup only verifies schema version
// instead of running migrations. Use `npm run migrate` to apply migrations separately.
// MIGRATION_VERIFY_ONLY is deprecated - production always verifies only
// Use RUN_MIGRATIONS_ON_STARTUP=true in development to run migrations at startup
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
import { startIntegrationScheduler, stopIntegrationScheduler } from "./workers/integration-scheduler.worker.js";
import { startAprVicidialSyncWorker } from "./workers/apr-vicidial-sync.worker.js";
import { startKpiDailySyncWorker } from "./workers/kpi-daily-sync.worker.js";
import { startPayrollNightlyRecalcWorker, stopPayrollNightlyRecalcWorker } from "./workers/payroll-nightly-recalc.worker.js";
import { startSLABreachWorker } from "./workers/sla-breach-worker.js";
import { startLmsSyncWorker } from "./workers/lms-sync.worker.js";
import { startBreachSlaCron } from "./modules/privacy/dpdp-breach-sla.cron.js";
import { startRetentionCron } from "./workers/privacy-retention.worker.js";
import { startAtsRemindersScheduler } from "./modules/ats/ats-reminders.cron.js";
import { clearAllTimers } from "./workers/worker-utils.js";

// WORKER GOVERNANCE: When WORKERS_PROCESS=external, ALL workers run in separate process
const WORKERS_EXTERNAL = process.env.WORKERS_PROCESS === "external";

// Track HTTP server for graceful shutdown
let httpServer: Server | null = null;
let isShuttingDown = false;

// Graceful shutdown timeout (wait for active requests)
const SHUTDOWN_TIMEOUT_MS = 30000;

/**
 * Graceful shutdown handler.
 * Stops accepting new requests, drains active connections, and cleans up resources.
 */
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    console.log(`[shutdown] Already shutting down, ignoring ${signal}`);
    return;
  }
  isShuttingDown = true;

  console.log(`[shutdown] Received ${signal}, starting graceful shutdown...`);

  // Stop accepting new requests
  if (httpServer) {
    httpServer.close((err) => {
      if (err) {
        console.error("[shutdown] Error closing HTTP server:", err);
      } else {
        console.log("[shutdown] HTTP server closed");
      }
    });
  }

  // Stop all schedulers and workers
  console.log("[shutdown] Stopping schedulers and workers...");

  try {
    // Stop workers with exported stop functions
    stopIntegrationScheduler();
    stopPayrollNightlyRecalcWorker();

    // Clear all registered timers
    clearAllTimers();

    // Stop legacy sync worker
    legacySyncWorker.stop();

    console.log("[shutdown] Schedulers and workers stopped");
  } catch (error) {
    console.error("[shutdown] Error stopping workers:", error);
  }

  // Close database pool
  try {
    console.log("[shutdown] Closing database connections...");
    await db.end();
    console.log("[shutdown] Database connections closed");
  } catch (error) {
    console.error("[shutdown] Error closing database:", error);
  }

  console.log("[shutdown] Graceful shutdown complete");

  // Force exit after timeout if connections don't drain
  setTimeout(() => {
    console.error("[shutdown] Forced exit after timeout");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  process.exit(0);
}

// Register shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

function startServer() {
  httpServer = app.listen(env.PORT, () => {
    // GOVERNANCE: When WORKERS_PROCESS=external, the API process starts ZERO schedulers/workers
    // All recurring jobs must run in the external worker process only
    if (WORKERS_EXTERNAL) {
      console.log("[workers] WORKERS_PROCESS=external - API starts zero schedulers/workers");
      console.log("[workers] All jobs handled by external worker process (npm run workers)");
    } else if (env.ENABLE_SCHEDULERS) {
      // Start all schedulers in API process (non-external mode only)
      startOfficialEmailComplianceScheduler();
      startIntegrationScheduler();
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
        "[schedulers] official-email, integration, tenure, communication, attendance, legacy-sync, " +
        "access-expiry, it-provisioning, leave-monthly, leave-annual, payroll-window, " +
        "business-action-sync, breach-sla, privacy-retention, ats-reminders started"
      );

      // Start heavy workers (with distributed lock protection)
      startAprVicidialSyncWorker().catch((error) =>
        console.error("[apr-sync] startup error:", error instanceof Error ? error.message : String(error))
      );
      startPayrollNightlyRecalcWorker().catch((error) =>
        console.error("[payroll-nightly-recalc] startup error:", error instanceof Error ? error.message : String(error))
      );
      startKpiDailySyncWorker().catch((error) =>
        console.error("[kpi-sync] startup error:", error instanceof Error ? error.message : String(error))
      );
      startSLABreachWorker().catch((error) =>
        console.error("[sla-breach] startup error:", error instanceof Error ? error.message : String(error))
      );
      startLmsSyncWorker().catch((error) =>
        console.error("[lms-sync] startup error:", error instanceof Error ? error.message : String(error))
      );

      console.log(
        "[workers] apr-sync, payroll-nightly-recalc, kpi-sync, sla-breach, lms-sync started inline"
      );
      console.log(
        "[workers] biometric attendance sync is handled by the integration scheduler / cosec-sync worker"
      );
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
    console.warn(`[startup] ${label} skipped:`, error instanceof Error ? error.message : String(error));
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

/**
 * MIGRATION GOVERNANCE:
 *
 * Production API startup NEVER runs migrations automatically.
 * Migrations must be run separately via: npm run migrate
 *
 * Behavior by environment:
 * - production: always verifySchemaVersion() only, throws if pending
 * - development with RUN_MIGRATIONS_ON_STARTUP=true: runs migrations
 * - development without flag: verifySchemaVersion() only, warns if pending
 */
async function handleMigrations(): Promise<void> {
  const isProduction = env.NODE_ENV === "production";
  const explicitRunFlag = process.env.RUN_MIGRATIONS_ON_STARTUP === "true";

  // Production: NEVER run migrations at startup
  if (isProduction) {
    console.log("[startup] production mode - verifying schema version only...");
    const schemaStatus = await verifySchemaVersion();

    if (!schemaStatus.valid) {
      const message =
        `Schema validation failed: ${schemaStatus.pendingCount} pending migrations. ` +
        `Run 'npm run migrate' before starting the API. ` +
        `Pending: ${schemaStatus.pendingFiles.slice(0, 5).join(", ")}${schemaStatus.pendingCount > 5 ? "..." : ""}`;
      throw new Error(message);
    }

    console.log(`[startup] schema verified: ${schemaStatus.appliedCount} migrations applied`);
    return;
  }

  // Development with explicit flag: run migrations
  if (explicitRunFlag) {
    console.log("[startup] RUN_MIGRATIONS_ON_STARTUP=true - running migrations...");
    await runPendingMigrations();
    await runFinanceSupplementalMigrations();
    await runFinanceSchemaHardeningMigrations();
    return;
  }

  // Development without flag: verify only, warn if pending
  console.log("[startup] development mode - verifying schema version...");
  const schemaStatus = await verifySchemaVersion();

  if (!schemaStatus.valid) {
    console.warn(
      `[startup] ${schemaStatus.pendingCount} pending migrations. ` +
      `Run 'npm run migrate' or set RUN_MIGRATIONS_ON_STARTUP=true`
    );
    console.warn("[startup] continuing with incomplete schema in development mode.");
  } else {
    console.log(`[startup] schema verified: ${schemaStatus.appliedCount} migrations applied`);
  }
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
