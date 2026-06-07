import { app } from "./app.js";
import { env } from "./config/env.js";
import { runPendingMigrations } from "./db/runPendingMigrations.js";
import { startTenureBadgeScheduler } from "./modules/engagement/tenure.cron.js";
import { startCommunicationCleanup } from "./modules/communication/cleanup.cron.js";
import { startAttendanceEngineScheduler } from "./modules/wfm/attendance-engine.cron.js";
import { legacySyncWorker } from "./workers/legacy-sync-worker.js";

function startServer() {
  app.listen(env.PORT, () => {
    startTenureBadgeScheduler();
    startCommunicationCleanup();
    startAttendanceEngineScheduler();
    legacySyncWorker.start();
    console.log(`MCN HRMS backend running on http://localhost:${env.PORT}`);
  });
}

runPendingMigrations()
  .then(() => startServer())
  .catch((error) => {
    console.error("[startup] migration runner failed:", error instanceof Error ? error.message : error);

    if (env.NODE_ENV === "production") {
      console.error("[startup] production server was not started because the database schema is incomplete.");
      return;
    }

    console.warn("[startup] development mode: starting with degraded migration health.");
    startServer();
  });
