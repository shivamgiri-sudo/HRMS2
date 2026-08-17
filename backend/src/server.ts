import type { Server } from "http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { db } from "./db/mysql.js";
import { runPendingMigrations, verifySchemaVersion } from "./db/runPendingMigrations.js";
import { checkRequiredTables, REQUIRED_TABLES } from "./db/schema-presence-check.js";

// MIGRATION GOVERNANCE: When enabled, API startup only verifies schema version
// instead of running migrations. Use `npm run migrate` to apply migrations separately.
const MIGRATIONS_VERIFY_ONLY = process.env.MIGRATIONS_VERIFY_ONLY === "true";
import { initBusinessActionSyncJobs } from "./cron/business-action-sync.cron.js";
import { startCommunicationCleanup } from "./modules/communication/cleanup.cron.js";
import { startTenureBadgeScheduler } from "./modules/engagement/tenure.cron.js";
import { startCelebrationScheduler } from "./modules/engagement/celebration.cron.js";
import { startDailyGamesScheduler, stopDailyGamesScheduler } from "./modules/engagement/daily-games.cron.js";
import { startMcnmeetCron, stopMcnmeetCron } from "./modules/mcnmeet/mcnmeet.cron.js";
import { startSocialFeedCron } from "./modules/social-feed/social-feed.cron.js";
import { migrateLegacyIntegrationSecrets } from "./modules/external-db/external-db.service.js";
import { startITProvisioningLockScheduler } from "./modules/it-provisioning/it-provisioning.cron.js";
import { startPayrollWindowClosureScheduler } from "./modules/payroll/payroll-window.cron.js";
import { startDashboardSnapshotScheduler } from "./modules/dashboards/dashboard-snapshot.cron.js";
import { startPerformanceIngestionScheduler, stopPerformanceIngestionScheduler } from "./modules/performance-ingestion/performance-scheduler.service.js";
import { startAttendanceEngineScheduler } from "./modules/wfm/attendance-engine.cron.js";
import { startAttendanceReconciliationWorker } from "./modules/wfm/attendance-reconciliation.worker.js";
import { bootstrapCosecIntegration } from "./modules/wfm/cosec-integration.bootstrap.js";
import { startCosecSyncWorker } from "./modules/wfm/cosec-sync.worker.js";
import { startAccessExpiryScheduler } from "./workers/access-expiry.worker.js";
import { startMobilityTransferWorker } from "./workers/mobility-transfer.worker.js";
import { startAnnualLeaveWorker } from "./workers/leave-annual-el-credit.worker.js";
import { startLeaveMonthlyWorker } from "./workers/leave-monthly-credit.worker.js";
import { legacySyncWorker } from "./workers/legacy-sync-worker.js";
import { startOfficialEmailComplianceScheduler } from "./workers/official-email-compliance.worker.js";
import { startIntegrationScheduler, stopIntegrationScheduler } from "./workers/integration-scheduler.worker.js";
import { startAprVicidialSyncWorker } from "./workers/apr-vicidial-sync.worker.js";
import { startKpiDailySyncWorker } from "./workers/kpi-daily-sync.worker.js";
import { startPayrollNightlyRecalcWorker, stopPayrollNightlyRecalcWorker } from "./workers/payroll-nightly-recalc.worker.js";
import { startPayrollRecalcDrainerWorker, stopPayrollRecalcDrainerWorker } from "./workers/payroll-recalc-drainer.worker.js";
import { startSLABreachWorker } from "./workers/sla-breach-worker.js";
import { startLmsSyncWorker } from "./workers/lms-sync.worker.js";
// NOTE: the LMS due-date reminder scheduler is PARKED, not deleted — see the
// block at its former start site below for what is missing and how to restore it.
import { startMiraTriageScheduler } from "./modules/ai/mira-triage-scheduler.js";
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
    stopPayrollRecalcDrainerWorker();
    stopPerformanceIngestionScheduler();
    stopDailyGamesScheduler();

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
    // Tells PM2 (ecosystem.config.cjs sets wait_ready:true) that the port is bound and
    // this instance can actually take traffic. Without this call, PM2 has no real
    // readiness signal and falls back to "process spawned" as its cue to consider a
    // restart complete — which can be true well before the app is actually listening,
    // widening the real user-facing gap during any restart. No-op outside PM2 (process.send
    // is undefined when not launched by a process manager), so this is safe in every
    // environment including plain `node dist/src/server.js` and local dev.
    if (process.send) {
      process.send("ready");
    }

    // GOVERNANCE: These always run (essential schedulers)
    // Binds the notification gateway to SMTP. Without it a live event throws NOT_WIRED
    // rather than silently doing nothing. Events are still individually gated by
    // notification_event_config, so registering this does not make anything send.
    registerNotificationDeliverer();

    // SKIP_MIGRATIONS=true in production means a deploy applies no schema, so code can ship
    // against a table nobody created. Name them once here rather than discovering it later
    // from a drip of runtime errors — employee_geofence_alerts logged 167 before anyone
    // noticed. Reports only; a missing optional table must not stop the server booting.
    void checkRequiredTables(db, REQUIRED_TABLES)
      .then(({ missing }) => {
        if (missing.length > 0) {
          console.error(
            `[schema] ${missing.length} required table(s) MISSING — run the matching migration: ${missing.join(", ")}`,
          );
        } else {
          console.log(`[schema] all ${REQUIRED_TABLES.length} required tables present`);
        }
      })
      .catch((err: unknown) => {
        console.warn("[schema] presence check skipped:", (err as Error).message);
      });

    // These three sat OUTSIDE both guards, so they ran in the API unconditionally
    // — while all-workers.ts registers all three as well. In the production
    // topology (WORKERS_PROCESS=external on hrms-api) that meant official-email,
    // integration and daily-games each executed TWICE, once per process. That is
    // the exact failure worker-registration-parity documents for sla-breach:
    // "every job executing twice, which is why sla-breach alerted the same person
    // seconds apart and why the DB circuit breaker kept tripping."
    //
    // Guarded now, so the workers process owns them in production and a
    // single-process dev run still gets them. Deliberately NOT also placed behind
    // env.ENABLE_SCHEDULERS: these three never were, and moving that line too
    // would silently stop them in any environment that leaves it false.
    if (!WORKERS_EXTERNAL) {
      startOfficialEmailComplianceScheduler();
      startIntegrationScheduler();
      startDailyGamesScheduler(); // fills daily tip/trivia/brain-teaser/word-puzzle 14 days ahead
      // Moved off app.ts module scope, where they ran on any import of the app —
      // ungoverned, unregistered and impossible to stop without a deploy.
      startSocialFeedCron();
      startMcnmeetCron();
      console.log("[scheduler] official-email, integration, daily-games, social-feed and mcnmeet started");
    }

    if (env.ENABLE_SCHEDULERS) {
      if (!WORKERS_EXTERNAL) {
        // Start all schedulers in API process
        startTenureBadgeScheduler();
        startCelebrationScheduler(); // birthday + work-anniversary posts & emails daily at 8 AM
        startCommunicationCleanup();
        startAttendanceEngineScheduler();
        startAttendanceReconciliationWorker();
        // Pulls biometric punches from the NCOSEC SQL Server — the only feed that
        // populates integration_biometric_daily, and so the source every non-Operations
        // employee's payroll attendance is built from.
        //
        // This was registered in workers/all-workers.ts ONLY, the same single-file
        // registration that silently killed ats-reminders (see the note below). In the
        // API-process topology it therefore never started, while the upstream stayed
        // healthy: on 2026-08-06 NCOSEC held 938 punching users for Aug 5 and 753 for
        // Aug 6, of which HRMS had ingested 22 and 8. The pull itself is fine — the
        // GROUP BY returns in 3.5s, well inside the 55s cancel guard — nothing was
        // running it.
        //
        // Self-guarding: no-ops unless NCOSEC_DB_HOST/USER/PASSWORD are set, and skips
        // when NCOSEC_SYNC_ENABLED=false, so this is inert where COSEC isn't configured.
        startCosecSyncWorker();
        legacySyncWorker.start();
        startAccessExpiryScheduler();
        startMobilityTransferWorker();
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
        // ── Onboarding reminders: FIXED BUT DELIBERATELY NOT STARTED ──────────
        //
        // This cron read three columns ats_onboarding_bridge does not have
        // (onboarding_link, joining_status, reminder_sent_at), so it threw on
        // every tick and no reminder has ever been sent. The query is now
        // correct and migration 1071 adds reminder_sent_at.
        //
        // It stays off because enabling it is an outward-facing action, not a
        // bug fix: the first tick would email every candidate with incomplete
        // onboarding, including ~299 bridge rows sitting at 'pending', some
        // months old. Some of those people have since joined or dropped out.
        //
        // To enable: set ATS_REMINDERS_ENABLED=true, having decided that burst
        // is wanted. Owner's call, made explicitly rather than as a side effect
        // of a schema fix.
        if (process.env.ATS_REMINDERS_ENABLED === "true") {
          startAtsRemindersScheduler();
        }
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
        // Same dual registration. This one was in NEITHER file: the worker was written
        // and the report_subscription table shipped, but nothing ever imported it, so a
        // scheduled report could never have run however it was configured. Gated by
        // worker_config.enabled (0) and every subscription is_active=0.
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
        // LMS due-date reminders (7d / 3d / 1d before batch end) are PARKED.
        //
        // This import was committed without its implementation: modules/lms/lms-reminders.cron.ts
        // has never existed in any commit or ref of this repository — it lives only as an untracked
        // file in a shared working tree. So tracked main did not typecheck and `npm run build`
        // could not produce dist at all (TS2307 here and in workers/all-workers.ts). The env gate
        // below it was never the protection it looked like: a missing module is a COMPILE-time
        // failure, and LMS_REMINDERS_ENABLED only ever gated RUNTIME.
        //
        // Deliberately parked rather than reconstructed, because the feature is incomplete on four
        // independent counts, any one of which is disqualifying:
        //   1. the cron source is untracked (in no git object anywhere);
        //   2. it calls lmsCourseReminderEmail(), which tracked professional-email-templates.ts
        //      does not export — a second dangling dependency, also untracked;
        //   3. its migration 1223_lms_reminder_log.sql is untracked AND absent from
        //      MIGRATION_MANIFEST (so it would never run at boot) AND written with
        //      ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS, which this MySQL 8.0.42
        //      rejects with ER_PARSE_ERROR while still recording the migration as applied;
        //   4. lms_learning_progress_snapshot.due_date does not exist. Not merely unwritten —
        //      absent from the base table (020_lms_integration.sql) AND absent from production:
        //      sql/schema-snapshot.json (mas_hrms, 946 tables) lists exactly 10 columns for it,
        //      id/employee_id/lms_learner_id/course_id/course_name/completion_pct/score/status/
        //      last_accessed/synced_at. The sweep filters on `s.due_date IS NOT NULL`, so with
        //      1223 unapplied every run raises ER_BAD_FIELD_ERROR, and with it applied the column
        //      has no writer anywhere and stays NULL. Broken either way.
        //
        // To restore: land the cron, the email template and a MySQL-8-guarded 1223 as one reviewed
        // commit with a manifest entry, tests, and a writer for due_date; re-add the start call
        // here AND the WORKERS entry in all-workers.ts together (parity test), keeping this exact
        // env gate — the first sweep emails every qualifying learner.
        // Drains payroll_recalculation_queue. Registered in all-workers.ts too — a worker in only
        // one of the two files silently never runs in the other topology.
        startPayrollRecalcDrainerWorker();
        startMiraTriageScheduler();

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
