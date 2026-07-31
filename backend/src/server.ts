import type { Server } from "http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { db } from "./db/mysql.js";
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
import { startDashboardSnapshotScheduler } from "./modules/dashboards/dashboard-snapshot.cron.js";
import { startPerformanceIngestionScheduler, stopPerformanceIngestionScheduler } from "./modules/performance-ingestion/performance-scheduler.service.js";
import { startAttendanceEngineScheduler } from "./modules/wfm/attendance-engine.cron.js";
import { startAttendanceReconciliationWorker } from "./modules/wfm/attendance-reconciliation.worker.js";
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
import { startEmployeeLifecycleWorker } from "./workers/employee-lifecycle.worker.js";
import { startTatEscalationWorker } from "./workers/tat-escalation.worker.js";
import { startReportSubscriptionWorker } from "./workers/report-subscription.worker.js";
import { registerNotificationDeliverer } from "./modules/communication/notification.deliverer.js";
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
    stopPerformanceIngestionScheduler();

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
    // GOVERNANCE: These always run (essential schedulers)
    // Binds the notification gateway to SMTP. Without it a live event throws NOT_WIRED
    // rather than silently doing nothing. Events are still individually gated by
    // notification_event_config, so registering this does not make anything send.
    registerNotificationDeliverer();
    startOfficialEmailComplianceScheduler();
    startIntegrationScheduler();
    console.log("[scheduler] official-email and integration scheduler started");

    if (env.ENABLE_SCHEDULERS) {
      if (!WORKERS_EXTERNAL) {
        // Start all schedulers in API process
        startTenureBadgeScheduler();
        startCommunicationCleanup();
        startAttendanceEngineScheduler();
        startAttendanceReconciliationWorker();
        legacySyncWorker.start();
        startAccessExpiryScheduler();
        startITProvisioningLockScheduler();
        startLeaveMonthlyWorker();
        startAnnualLeaveWorker();
        startPayrollWindowClosureScheduler();
        // Records the daily metric baseline every dashboard trend arrow compares against.
        startDashboardSnapshotScheduler();
        startPerformanceIngestionScheduler();
        initBusinessActionSyncJobs();
        startBreachSlaCron();
        startRetentionCron();
        startAtsRemindersScheduler();
        // Activates employees whose joining date has arrived, and retries failed
        // provisioning. Previously only registered in workers/all-workers.ts,
        // which has no npm script and no importer — so anyone approved before
        // their joining date was never activated at all.
        startEmployeeLifecycleWorker();
        // Registered here AND in workers/all-workers.ts. Production runs the workers
        // process (WORKERS_PROCESS=external), so this branch is skipped there — but a
        // worker registered in only one of the two files silently never runs in the
        // other topology, which is exactly what happened to ats-reminders.
        // Gated by worker_config.enabled (0 by default) regardless of which starts it.
        startTatEscalationWorker();
        startReportSubscriptionWorker();
        console.log(
          "[schedulers] tenure, communication, attendance, attendance-reconciliation, legacy-sync, access-expiry, it-provisioning, leave-monthly, leave-annual, payroll-window, performance-ingestion, business-action-sync, breach-sla, privacy-retention, ats-reminders, employee-lifecycle started",
        );

        // Start heavy workers (with distributed lock protection)
        startAprVicidialSyncWorker().catch((error) =>
          console.error("[apr-sync] startup error:", error instanceof Error ? error.message : String(error)),
        );
        startPayrollNightlyRecalcWorker().catch((error) =>
          console.error("[payroll-nightly-recalc] startup error:", error instanceof Error ? error.message : String(error)),
        );
        startKpiDailySyncWorker().catch((error) =>
          console.error("[kpi-sync] startup error:", error instanceof Error ? error.message : String(error)),
        );
        startSLABreachWorker().catch((error) =>
          console.error("[sla-breach] startup error:", error instanceof Error ? error.message : String(error)),
        );
        startLmsSyncWorker().catch((error) =>
          console.error("[lms-sync] startup error:", error instanceof Error ? error.message : String(error)),
        );

        console.log(
          "[workers] apr-sync, payroll-nightly-recalc, kpi-sync, sla-breach, lms-sync started inline",
        );
        console.log(
          "[workers] biometric attendance sync is handled by the integration scheduler / cosec-sync worker",
        );
      } else {
        console.log(
          "[workers] WORKERS_PROCESS=external - ALL schedulers/workers handled by external process",
        );
      }
    } else {
      console.log("[schedulers] disabled (set ENABLE_SCHEDULERS=true to enable)");
    }
    console.log(`MCN HRMS backend running on http://localhost:${env.PORT}`);
  });

  // Without this, a listen failure surfaces as an unhandled 'error' event and
  // takes the process down with a raw stack trace. The realistic cause is a
  // restart overlapping the previous listener's hold on the port — a watch-mode
  // reload in development, or a pm2 restart in production — where the old socket
  // has not been released yet. Both are worth retrying rather than dying for.
  httpServer.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EADDRINUSE") {
      console.error("[startup] HTTP server error:", error.message);
      throw error;
    }

    listenRetries += 1;
    if (listenRetries > MAX_LISTEN_RETRIES) {
      console.error(
        `[startup] port ${env.PORT} is still in use after ${MAX_LISTEN_RETRIES} attempts. ` +
        `Another process is bound to it — stop that process, or set PORT to something else.`,
      );
      process.exit(1);
    }

    console.warn(
      `[startup] port ${env.PORT} busy (attempt ${listenRetries}/${MAX_LISTEN_RETRIES}), retrying in ${LISTEN_RETRY_MS}ms`,
    );
    setTimeout(startServer, LISTEN_RETRY_MS);
  });
}

const MAX_LISTEN_RETRIES = 5;
const LISTEN_RETRY_MS = 1_000;
let listenRetries = 0;

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  label: string,
): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((_resolve, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${milliseconds}ms`)),
        milliseconds,
      ),
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
    "migrateLegacyIntegrationSecrets",
  );
  const cosecActive = await withTimeout(
    bootstrapCosecIntegration(),
    8000,
    "bootstrapCosecIntegration",
  );
  console.log(
    `[cosec-sync] automatic schedule ${cosecActive ? "active" : "inactive"}`,
  );
  startServer();
}

async function handleMigrations(): Promise<void> {
  if (MIGRATIONS_VERIFY_ONLY) {
    // GOVERNANCE: Verify the startup-managed migration set without modifying schema.
    console.log("[startup] MIGRATIONS_VERIFY_ONLY=true - verifying schema version...");
    const schemaStatus = await verifySchemaVersion();

    if (!schemaStatus.valid) {
      const message =
        `Schema validation failed: ${schemaStatus.pendingCount} pending migrations. ` +
        `Run 'npm run migrate' before starting the API. ` +
        `Pending: ${schemaStatus.pendingFiles.join(", ")}${schemaStatus.pendingFiles.length > 10 ? "..." : ""}`;

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

  // Default behavior: run migrations at startup. One governed runner (advisory-locked,
  // checksummed, ~470-file manifest) covers everything, including the finance range
  // (411-424) — the two ungoverned supplemental/hardening runners that used to also run here
  // were retired once their coverage was confirmed fully redundant with this manifest.
  await runPendingMigrations();
}

handleMigrations()
  .then(initializeRuntime)
  .catch(async (error) => {
    console.error(
      "[startup] migration/schema verification failed:",
      error instanceof Error ? error.message : error,
    );

    if (env.NODE_ENV === "production") {
      console.error(
        "[startup] production server was not started because the database schema is incomplete.",
      );
      throw error;
    }

    console.warn(
      "[startup] development mode: starting with degraded migration health.",
    );
    await initializeRuntime();
  });
