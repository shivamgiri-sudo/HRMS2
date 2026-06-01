import { app } from "./app.js";
import { env } from "./config/env.js";
import { startTenureBadgeScheduler } from "./modules/engagement/tenure.cron.js";
import { startCommunicationCleanup } from "./modules/communication/cleanup.cron.js";
import { startAttendanceEngineScheduler } from "./modules/wfm/attendance-engine.cron.js";

app.listen(env.PORT, () => {
  startTenureBadgeScheduler();
  startCommunicationCleanup();
  startAttendanceEngineScheduler();
  console.log(`MCN HRMS backend running on http://localhost:${env.PORT}`);
});
