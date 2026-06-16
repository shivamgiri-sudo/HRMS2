import { app } from "./app.js";
import { env } from "./config/env.js";
import { runPendingMigrations } from "./db/runPendingMigrations.js";
import { startTenureBadgeScheduler } from "./modules/engagement/tenure.cron.js";
import { startCommunicationCleanup } from "./modules/communication/cleanup.cron.js";
import { startAttendanceEngineScheduler } from "./modules/wfm/attendance-engine.cron.js";
import { startCosecSyncWorker } from "./modules/wfm/cosec-sync.worker.js";
import { legacySyncWorker } from "./workers/legacy-sync-worker.js";
import { startAccessExpiryScheduler } from "./workers/access-expiry.worker.js";
import { startOfficialEmailComplianceScheduler } from "./workers/official-email-compliance.worker.js";
import { startIntegrationScheduler } from "./workers/integration-scheduler.worker.js";
import { migrateLegacyIntegrationSecrets } from "./modules/external-db/external-db.service.js";

function startServer() {
  app.listen(env.PORT, () => {
    startOfficialEmailComplianceScheduler();
    startIntegrationScheduler();
    startCosecSyncWorker();
    console.log("[scheduler] official-email, integration, and COSEC sync checks completed");
    if (env.ENABLE_SCHEDULERS) {
      startTenureBadgeScheduler();
      startCommunicationCleanup();
      startAttendanceEngineScheduler();
      legacySyncWorker.start();
      startAccessExpiryScheduler();
      console.log(`[schedulers] tenure, communication, attendance, legacy-sync, access-expiry started`);
    } else {
      console.log(`[schedulers] disabled (set ENABLE_SCHEDULERS=true to enable)`);
    }
    console.log(`MCN HRMS backend running on http://localhost:${env.PORT}`);
  });
}

runPendingMigrations()
  .then(async () => {
    await migrateLegacyIntegrationSecrets();
    startServer();
  })
  .catch((error) => {
    console.error("[startup] migration runner failed:", error instanceof Error ? error.message : error);

    if (env.NODE_ENV === "production") {
      console.error("[startup] production server was not started because the database schema is incomplete.");
      throw error;
    }

    console.warn("[startup] development mode: starting with degraded migration health.");
    startServer();
  });
