STAT:
commit 5d6d1a428fbfebdd42d37730330f3075de8aa2f5
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 03:46:12 2026 +0530

    feat: register nightly employee performance snapshot scheduler
    
    Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

 .../performance-scorecard-snapshot.cron.ts         | 58 ++++++++++++++++++++++
 backend/src/server.ts                              |  2 +
 backend/src/workers/all-workers.ts                 |  9 ++++
 3 files changed, 69 insertions(+)

FULL DIFF:
commit 5d6d1a428fbfebdd42d37730330f3075de8aa2f5
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 03:46:12 2026 +0530

    feat: register nightly employee performance snapshot scheduler
    
    Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

diff --git a/backend/src/modules/performance-scorecard/performance-scorecard-snapshot.cron.ts b/backend/src/modules/performance-scorecard/performance-scorecard-snapshot.cron.ts
new file mode 100644
index 00000000..83cc4e56
--- /dev/null
+++ b/backend/src/modules/performance-scorecard/performance-scorecard-snapshot.cron.ts
@@ -0,0 +1,58 @@
+import { writeEmployeePerformanceSnapshots } from "./performance-scorecard-snapshot.service.js";
+import { getIstDateString } from "../../utils/dateUtils.js";
+
+let _timer: ReturnType<typeof setInterval> | null = null;
+let _lastRunDate: string | null = null;
+let _running = false;
+
+const RUN_AT_HOUR_IST = 3; // 03:00 IST, after the dashboard snapshot (02:00) and attendance reconciliation.
+const CHECK_INTERVAL_MS = 30 * 60 * 1000;
+
+function istHour(): number {
+  return Number(
+    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()),
+  );
+}
+
+async function runPerformanceScorecardSnapshot(): Promise<void> {
+  if (_running) return;
+  _running = true;
+  try {
+    const date = getIstDateString();
+    const yesterday = new Date(date);
+    yesterday.setDate(yesterday.getDate() - 1);
+    const targetDate = yesterday.toISOString().slice(0, 10);
+    const { written, errors } = await writeEmployeePerformanceSnapshots(targetDate);
+    console.log(`[performance-scorecard-cron] wrote ${written} snapshot rows for ${targetDate}`);
+    if (errors.length > 0) {
+      console.error(
+        `[performance-scorecard-cron] ${errors.length} employee(s) failed for ${targetDate}:`,
+        errors.slice(0, 10),
+      );
+    }
+  } catch (err) {
+    console.error("[performance-scorecard-cron] snapshot run failed", err);
+  } finally {
+    _running = false;
+  }
+}
+
+export function startPerformanceScorecardSnapshotScheduler(): void {
+  if (_timer) return;
+  const tick = () => {
+    const today = getIstDateString();
+    if (_lastRunDate === today) return;
+    if (istHour() !== RUN_AT_HOUR_IST) return;
+    _lastRunDate = today;
+    void runPerformanceScorecardSnapshot();
+  };
+  _timer = setInterval(tick, CHECK_INTERVAL_MS);
+  console.log(`[performance-scorecard-cron] scheduler started (daily at ${RUN_AT_HOUR_IST}:00 IST)`);
+}
+
+export function stopPerformanceScorecardSnapshotScheduler(): void {
+  if (_timer) {
+    clearInterval(_timer);
+    _timer = null;
+  }
+}
diff --git a/backend/src/server.ts b/backend/src/server.ts
index beea38c6..a2a0a5a4 100644
--- a/backend/src/server.ts
+++ b/backend/src/server.ts
@@ -12,20 +12,21 @@ import { initBusinessActionSyncJobs } from "./cron/business-action-sync.cron.js"
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
+import { startPerformanceScorecardSnapshotScheduler } from "./modules/performance-scorecard/performance-scorecard-snapshot.cron.js";
 import { startPerformanceIngestionScheduler, stopPerformanceIngestionScheduler } from "./modules/performance-ingestion/performance-scheduler.service.js";
 import { startAttendanceEngineScheduler } from "./modules/wfm/attendance-engine.cron.js";
 import { startAttendanceReconciliationWorker } from "./modules/wfm/attendance-reconciliation.worker.js";
 // D-1 Daily Manager Intelligence Briefing Engine — dual-registered here AND in
 // workers/all-workers.ts, same convention as every other scheduler in this file
 // (see the ats-reminders/sla-breach note below this block for why a single-file
 // registration silently never runs in the WORKERS_PROCESS=external topology).
 // Off by default: MANAGER_DAILY_BRIEF_ENABLED must be explicitly "true".
 import { startManagerDailyBriefScheduler } from "./modules/management/daily-brief/daily-brief.cron.js";
 import { bootstrapCosecIntegration } from "./modules/wfm/cosec-integration.bootstrap.js";
@@ -223,20 +224,21 @@ function startServer() {
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
+        startPerformanceScorecardSnapshotScheduler();
         startPerformanceIngestionScheduler();
         initBusinessActionSyncJobs();
         startBreachSlaCron();
         startRetentionCron();
         // D-SLA-01: replaces the inline refreshSlaBreachFlags() call removed from
         // GET /helpdesk/dashboard in 4829f0a6 — without this, sla_breached flags
         // and the Support Command Center's breach badges never update.
         startHelpdeskSlaCron();
         // ── Onboarding reminders: FIXED BUT DELIBERATELY NOT STARTED ──────────
         //
diff --git a/backend/src/workers/all-workers.ts b/backend/src/workers/all-workers.ts
index 525daf88..c069deac 100644
--- a/backend/src/workers/all-workers.ts
+++ b/backend/src/workers/all-workers.ts
@@ -32,20 +32,24 @@ import { startCommunicationCleanup, stopCommunicationCleanup } from "../modules/
 import { startAttendanceEngineScheduler, stopAttendanceEngineScheduler } from "../modules/wfm/attendance-engine.cron.js";
 import { startITProvisioningLockScheduler, stopITProvisioningLockScheduler } from "../modules/it-provisioning/it-provisioning.cron.js";
 import { startEmployeeLifecycleWorker, stopEmployeeLifecycleWorker } from "./employee-lifecycle.worker.js";
 // These five were registered in server.ts ONLY. Production runs both processes
 // with WORKERS_PROCESS unset, so the API was starting every worker alongside this
 // process — 20 of them running twice. Turning that guard on without adding these
 // here first would have silently stopped all five, exactly as happened to
 // ats-reminders when it lived in one file only.
 import { initBusinessActionSyncJobs, stopBusinessActionSyncJobs } from "../cron/business-action-sync.cron.js";
 import { startDashboardSnapshotScheduler, stopDashboardSnapshotScheduler } from "../modules/dashboards/dashboard-snapshot.cron.js";
+import {
+  startPerformanceScorecardSnapshotScheduler,
+  stopPerformanceScorecardSnapshotScheduler,
+} from "../modules/performance-scorecard/performance-scorecard-snapshot.cron.js";
 import { startAttendanceReconciliationWorker, stopAttendanceReconciliationWorker } from "../modules/wfm/attendance-reconciliation.worker.js";
 // D-1 Daily Manager Intelligence Briefing Engine — dual-registered here AND in
 // server.ts (see the "These five were registered in server.ts ONLY" note above for
 // why a single-file registration silently never runs in one of the two worker
 // topologies). No-ops unless MANAGER_DAILY_BRIEF_ENABLED=true.
 import { startManagerDailyBriefScheduler, stopManagerDailyBriefScheduler } from "../modules/management/daily-brief/daily-brief.cron.js";
 import { startRetentionCron } from "./privacy-retention.worker.js";
 import { startAtsRemindersScheduler } from "../modules/ats/ats-reminders.cron.js";
 import { startPayrollWindowClosureScheduler, stopPayrollWindowClosureScheduler } from "../modules/payroll/payroll-window.cron.js";
 import { startPerformanceIngestionScheduler } from "../modules/performance-ingestion/performance-scheduler.service.js";
@@ -232,20 +236,24 @@ const WORKERS: Array<{ name: string; start: () => Promise<void> }> = [
     start: () => { startAttendanceReconciliationWorker(); return Promise.resolve(); },
   },
   {
     name: "manager-daily-brief",
     start: () => { startManagerDailyBriefScheduler(); return Promise.resolve(); },
   },
   {
     name: "dashboard-snapshot",
     start: () => { startDashboardSnapshotScheduler(); return Promise.resolve(); },
   },
+  {
+    name: "performance-scorecard-snapshot",
+    start: () => { startPerformanceScorecardSnapshotScheduler(); return Promise.resolve(); },
+  },
   {
     name: "privacy-retention",
     start: () => { startRetentionCron(); return Promise.resolve(); },
   },
   {
     name: "business-action-sync",
     start: () => { initBusinessActionSyncJobs(); return Promise.resolve(); },
   },
   {
     name: "lms-sync",
@@ -405,20 +413,21 @@ async function startAllWorkers(): Promise<void> {
 
   console.log("\n[workers] All workers running. Press Ctrl+C to stop.\n");
 }
 
 function shutdown(): void {
   console.log("\n[workers] Shutting down...");
   // Newly moved here from server.ts. privacy-retention and ats-reminders export
   // no stop function, so they are not listed — their timers die with the process.
   stopBusinessActionSyncJobs();
   stopDashboardSnapshotScheduler();
+  stopPerformanceScorecardSnapshotScheduler();
   stopAttendanceReconciliationWorker();
   stopManagerDailyBriefScheduler();
   stopAccessExpiryScheduler();
   stopIntegrationScheduler();
   stopEsignComplianceWorker();
   // social-feed exports no stop — its timers are unref'd and die with the process.
   stopMcnmeetCron();
   stopEsignReconciliationWorker();
   stopTenureBadgeScheduler();
   stopCelebrationScheduler();
