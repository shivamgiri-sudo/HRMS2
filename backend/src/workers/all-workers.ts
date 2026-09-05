import "dotenv/config";
import { readBuildInfo } from "../shared/buildInfo.js";

import { startAccessExpiryScheduler, stopAccessExpiryScheduler } from "./access-expiry.worker.js";
import { startMobilityTransferWorker, stopMobilityTransferWorker } from "./mobility-transfer.worker.js";
import { startIntegrationScheduler, stopIntegrationScheduler } from "./integration-scheduler.worker.js";
import { startKpiDailySyncWorker, stopKpiDailySyncWorker } from "./kpi-daily-sync.worker.js";
import { startAnnualLeaveWorker, stopAnnualLeaveWorker } from "./leave-annual-el-credit.worker.js";
import { startLeaveMonthlyWorker, stopLeaveMonthlyWorker } from "./leave-monthly-credit.worker.js";
import { startOfficialEmailComplianceScheduler, stopOfficialEmailComplianceScheduler } from "./official-email-compliance.worker.js";
import { startSLABreachWorker, stopSLABreachWorker } from "./sla-breach-worker.js";
import { startInterviewDelayAlertWorker, stopInterviewDelayAlertWorker } from "./interview-delay-alert.worker.js";
import { startLmsSyncWorker, stopLmsSyncWorker } from "./lms-sync.worker.js";
import { startPayrollNightlyRecalcWorker, stopPayrollNightlyRecalcWorker } from "./payroll-nightly-recalc.worker.js";
import { startPayrollRecalcDrainerWorker, stopPayrollRecalcDrainerWorker } from "./payroll-recalc-drainer.worker.js";
// NOTE: the LMS due-date reminder scheduler is PARKED, not deleted — see the WORKERS
// array below for what is missing and how to restore it.
import { startDbBillFinanceSyncWorker, stopDbBillFinanceSyncWorker } from "./db-bill-finance-sync.worker.js";
import { startDbBillHrSyncWorker, stopDbBillHrSyncWorker } from "./db-bill-hr-sync.worker.js";
import { startGstExportAutoWorker, stopGstExportAutoWorker } from "./gst-export-auto.worker.js";
import { startAprVicidialSyncWorker, stopAprVicidialSyncWorker } from "./apr-vicidial-sync.worker.js";
import { startEsignComplianceWorker, stopEsignComplianceWorker } from "./esign-compliance.worker.js";
import { startEsignReconciliationWorker, stopEsignReconciliationWorker } from "./esign-reconciliation.worker.js";
import { legacySyncWorker } from "./legacy-sync-worker.js";
import { startMcnmeetCron, stopMcnmeetCron } from "../modules/mcnmeet/mcnmeet.cron.js";
import { startSocialFeedCron } from "../modules/social-feed/social-feed.cron.js";
import { startTenureBadgeScheduler, stopTenureBadgeScheduler } from "../modules/engagement/tenure.cron.js";
import { startCelebrationScheduler, stopCelebrationScheduler } from "../modules/engagement/celebration.cron.js";
import { startFestivalGreetingScheduler, stopFestivalGreetingScheduler } from "../modules/engagement/festival-greeting.cron.js";
import { startDailyGamesScheduler, stopDailyGamesScheduler } from "../modules/engagement/daily-games.cron.js";
import { startCommunicationCleanup, stopCommunicationCleanup } from "../modules/communication/cleanup.cron.js";
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
import {
  startPerformanceScorecardSnapshotScheduler,
  stopPerformanceScorecardSnapshotScheduler,
} from "../modules/performance-scorecard/performance-scorecard-snapshot.cron.js";
import { startAttendanceReconciliationWorker, stopAttendanceReconciliationWorker } from "../modules/wfm/attendance-reconciliation.worker.js";
// D-1 Daily Manager Intelligence Briefing Engine — dual-registered here AND in
// server.ts (see the "These five were registered in server.ts ONLY" note above for
// why a single-file registration silently never runs in one of the two worker
// topologies). No-ops unless MANAGER_DAILY_BRIEF_ENABLED=true.
import { startManagerDailyBriefScheduler, stopManagerDailyBriefScheduler } from "../modules/management/daily-brief/daily-brief.cron.js";
import { startRetentionCron } from "./privacy-retention.worker.js";
import { startAtsRemindersScheduler } from "../modules/ats/ats-reminders.cron.js";
import { startAtsDailyReportScheduler, stopAtsDailyReportScheduler } from "../modules/ats/ats-daily-report.cron.js";
import { startPayrollWindowClosureScheduler, stopPayrollWindowClosureScheduler } from "../modules/payroll/payroll-window.cron.js";
import { startPerformanceIngestionScheduler } from "../modules/performance-ingestion/performance-scheduler.service.js";
import { startBreachSlaCron, stopBreachSlaCron } from "../modules/privacy/dpdp-breach-sla.cron.js";
import { startCosecSyncWorker, stopCosecSyncWorker } from "../modules/wfm/cosec-sync.worker.js";
import { startRtaNightlyCron, stopRtaNightlyCron } from "../modules/rta/rta-nightly.cron.js";
import { startWalkinSlaCron, stopWalkinSlaCron } from "./walkin-sla.cron.js";
import { startHelpdeskSlaCron, stopHelpdeskSlaCron } from "../modules/helpdesk/helpdesk-sla.cron.js";
import { startInboxReconciliationWorker, stopInboxReconciliationWorker } from "./inbox-reconciliation.worker.js";
import { startAttendanceCorrectionReconciliationWorker, stopAttendanceCorrectionReconciliationWorker } from "./attendance-correction-reconciliation.worker.js";
import { startReportGenerationWorker, stopReportGenerationWorker } from "./report-generation.worker.js";
import { startReportEmailDeliveryWorker, stopReportEmailDeliveryWorker } from "./report-email-delivery.worker.js";
import { startReportStaleRecoveryWorker, stopReportStaleRecoveryWorker } from "./report-stale-recovery.worker.js";
import { startTatEscalationWorker, stopTatEscalationWorker } from "./tat-escalation.worker.js";
import { startReportSubscriptionWorker, stopReportSubscriptionWorker } from "./report-subscription.worker.js";
import { registerNotificationDeliverer } from "../modules/communication/notification.deliverer.js";
import { startPayrollPrepReminderWorker, stopPayrollPrepReminderWorker } from "./payroll-prep-reminder.worker.js";
import { startBudgetClosureReminderWorker, stopBudgetClosureReminderWorker } from "./budget-closure-reminder.worker.js";
import { startPayrollReadinessRefreshWorker, stopPayrollReadinessRefreshWorker } from "./payroll-readiness-refresh.worker.js";
import { startAutoRosterSchedulerWorker, stopAutoRosterSchedulerWorker } from "./auto-roster-scheduler.worker.js";
import { startUatJobRunner, stopUatJobRunner } from "../modules/uat-pipeline/uat-job-runner.js";
import { registerUatJobHandlers } from "../modules/uat-pipeline/uat-jobs.handlers.js";
import { startMiraTriageScheduler } from "../modules/ai/mira-triage-scheduler.js";
import { startHcGapAlertScheduler, stopHcGapAlertScheduler } from "../modules/workforce-mandate/hc-gap-alert.cron.js";
import { registerRosterIntelligenceCrons } from "../modules/wfm/roster-intelligence.cron.js";
import { clearAllTimers } from "./worker-utils.js";

const WORKERS: Array<{ name: string; start: () => Promise<void> }> = [
  {
    name: "official-email-compliance",
    start: () => { startOfficialEmailComplianceScheduler(); return Promise.resolve(); },
  },
  {
    name: "integration-scheduler",
    start: () => { startIntegrationScheduler(); return Promise.resolve(); },
  },
  {
    name: "access-expiry",
    start: () => { startAccessExpiryScheduler(); return Promise.resolve(); },
  },
  {
    // Applies approved transfers on their effective_date. Registered here AND in server.ts:
    // a worker present in only one of the two never runs in the deployment that uses the other.
    name: "mobility-transfer",
    start: () => { startMobilityTransferWorker(); return Promise.resolve(); },
  },
  {
    name: "tenure-badge",
    start: () => { startTenureBadgeScheduler(); return Promise.resolve(); },
  },
  {
    name: "celebration",
    start: () => { startCelebrationScheduler(); return Promise.resolve(); },
  },
  {
    name: "festival-greetings",
    start: () => { startFestivalGreetingScheduler(); return Promise.resolve(); },
  },
  {
    name: "daily-games",
    start: () => { startDailyGamesScheduler(); return Promise.resolve(); },
  },
  {
    name: "communication-cleanup",
    start: () => { startCommunicationCleanup(); return Promise.resolve(); },
  },
  {
    name: "attendance-engine",
    start: () => { startAttendanceEngineScheduler(); return Promise.resolve(); },
  },
  {
    name: "legacy-sync",
    start: () => { legacySyncWorker.start(); return Promise.resolve(); },
  },
  {
    // Both were started at app.ts module scope and registered in no worker file,
    // so they ran in the API process only — outside every guard, absent from
    // worker_config, and stoppable only by a deploy. mcnmeet mails meeting
    // reminders every 5 minutes and self-disables unless MCNMEET_ENABLED=true,
    // which is the only reason it has not already behaved like esign-compliance.
    name: "social-feed",
    start: () => { startSocialFeedCron(); return Promise.resolve(); },
  },
  {
    name: "mcnmeet",
    start: () => { startMcnmeetCron(); return Promise.resolve(); },
  },
  {
    name: "it-provisioning-lock",
    start: () => { startITProvisioningLockScheduler(); return Promise.resolve(); },
  },
  {
    name: "leave-monthly-credit",
    start: startLeaveMonthlyWorker,
  },
  {
    name: "leave-annual-el-credit",
    start: startAnnualLeaveWorker,
  },
  {
    name: "payroll-window-closure",
    start: () => { startPayrollWindowClosureScheduler(); return Promise.resolve(); },
  },
  {
    name: "performance-ingestion",
    start: () => { startPerformanceIngestionScheduler(); return Promise.resolve(); },
  },
  {
    // db_bill is where finance raises invoices, budgets and GRNs; mas_hrms mirrors them and the
    // P&L reads the mirror. Nothing called the sync before, so it only advanced when someone ran
    // it by hand — the invoice snapshot was nine days stale and no August rows would ever have
    // appeared.
    name: "db-bill-finance-sync",
    start: () => { startDbBillFinanceSyncWorker(); return Promise.resolve(); },
  },
  {
    name: "db-bill-hr-sync",
    start: () => { startDbBillHrSyncWorker(); return Promise.resolve(); },
  },
  {
    // Builds the outward GST batch and its exception worklist for every registration before
    // anyone asks, so the month's unfilable rows surface while there is still time to fix the
    // underlying invoice rather than on the due date. Registered here only, matching
    // db-bill-finance-sync above: this file owns the production workers process, and a
    // server.ts-only registration is exactly what silently never runs under
    // WORKERS_PROCESS=external.
    name: "gst-export-auto",
    start: () => { startGstExportAutoWorker(); return Promise.resolve(); },
  },
  {
    name: "payroll-nightly-recalc",
    start: startPayrollNightlyRecalcWorker,
  },
  {
    // Drains payroll_recalculation_queue. Distinct from payroll-nightly-recalc above, which
    // recalculates whole open runs and never reads that queue. The queue's only drain was a
    // 200-row call at the tail of a COSEC sync, so it backlogged by construction: 912 pending for
    // 270 active employees when this was written, oldest 12 days.
    name: "payroll-recalc-drainer",
    start: () => { startPayrollRecalcDrainerWorker(); return Promise.resolve(); },
  },
  // "lms-reminders" is PARKED here, matching server.ts. 4128d4d6 added this registration to
  // restore parity with the server.ts start call — but the module both sides import,
  // modules/lms/lms-reminders.cron.ts, exists in no commit or ref of this repository, so
  // parity was restored onto a file that was never tracked and this file stopped compiling
  // too (TS2307). Re-adding it here doubled the breakage rather than fixing it.
  //
  // The cron source, its lmsCourseReminderEmail template and migration 1223 are all untracked,
  // 1223 is unmanifested and uses MySQL-8-invalid ADD COLUMN IF NOT EXISTS, and nothing writes
  // the due_date column the sweep filters on — see the long note at the parked start site in
  // server.ts. Restore both registrations together, never one alone: a job registered in only
  // one of these two files silently never runs in the other topology.
  {
    name: "kpi-daily-sync",
    start: startKpiDailySyncWorker,
  },
  {
    name: "sla-breach",
    start: startSLABreachWorker,
  },
  {
    name: "interview-delay-alert",
    start: () => { startInterviewDelayAlertWorker(); return Promise.resolve(); },
  },
  // ── Previously server.ts-only (see the import block above) ──
  {
    // server.ts gates this behind ATS_REMINDERS_ENABLED — "stays off because enabling it
    // is an outward-facing action... Owner's call, made explicitly rather than as a side
    // effect." But ecosystem.config.cjs sets WORKERS_PROCESS=external on hrms-api (so its
    // own gated call never even runs there) and hrms-workers is the process that actually
    // executes this list, unconditionally, with no gate of its own. Found 2026-08-19: since
    // this entry was added (2026-08-02) and the cron itself was fixed to actually work
    // (2026-08-04), the candidate-facing onboarding-reminder email has likely been sending
    // in production the whole time, bypassing the explicit-enable decision entirely. Same
    // gate, applied where the scheduler is actually started, so the deliberate "off" takes
    // effect rather than being silently bypassed.
    name: "ats-reminders",
    start: () => {
      if (process.env.ATS_REMINDERS_ENABLED === "true") startAtsRemindersScheduler();
      // Separate switch — see ats-daily-report.cron.ts for why it is not the one above.
      if (process.env.ATS_DAILY_REPORT_ENABLED === "true") startAtsDailyReportScheduler();
      return Promise.resolve();
    },
  },
  {
    name: "attendance-reconciliation",
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
  {
    name: "performance-scorecard-snapshot",
    start: () => { startPerformanceScorecardSnapshotScheduler(); return Promise.resolve(); },
  },
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
    start: startLmsSyncWorker,
  },
  {
    name: "cosec-sync",
    start: () => { startCosecSyncWorker(); return Promise.resolve(); },
  },
  {
    name: "apr-vicidial-sync",
    start: startAprVicidialSyncWorker,
  },
  {
    name: "esign-compliance",
    start: startEsignComplianceWorker,
  },
  {
    // Pulls signed artefacts the provider never pushed. Self-disables unless
    // ESIGN_RECONCILIATION_ENABLED=true.
    name: "esign-reconciliation",
    start: startEsignReconciliationWorker,
  },
  {
    name: "dpdp-breach-sla",
    start: () => { startBreachSlaCron(); return Promise.resolve(); },
  },
  {
    name: "employee-lifecycle",
    start: () => { startEmployeeLifecycleWorker(); return Promise.resolve(); },
  },
  {
    name: "rta-nightly",
    start: () => { startRtaNightlyCron(); return Promise.resolve(); },
  },
  {
    name: "walkin-sla",
    start: () => { startWalkinSlaCron(); return Promise.resolve(); },
  },
  {
    // D-SLA-01: replaces the inline refreshSlaBreachFlags() call removed from
    // GET /helpdesk/dashboard in 4829f0a6 — without this, sla_breached flags
    // and the Support Command Center's breach badges never update.
    name: "helpdesk-sla",
    start: () => { startHelpdeskSlaCron(); return Promise.resolve(); },
  },
  {
    name: "inbox-reconciliation",
    start: () => { startInboxReconciliationWorker(); return Promise.resolve(); },
  },
  {
    // Notices approved attendance changes that never reached the record. Read-only; the write
    // guard prevents the known causes, this catches causes we do not know about yet.
    name: "attendance-correction-reconciliation",
    start: () => { startAttendanceCorrectionReconciliationWorker(); return Promise.resolve(); },
  },
  {
    name: "report-generation",
    start: startReportGenerationWorker,
  },
  {
    name: "report-email-delivery",
    start: startReportEmailDeliveryWorker,
  },
  {
    name: "report-stale-recovery",
    start: startReportStaleRecoveryWorker,
  },
  {
    // Gated twice over: worker_config.enabled = 0 (migration 1023) stops it running at
    // all, and every SLA event ships dispatch_mode='shadow' so even when it runs it
    // resolves and claims without delivering.
    name: "tat-escalation",
    start: () => { startTatEscalationWorker(); return Promise.resolve(); },
  },
  {
    // Was registered in NEITHER this file nor server.ts. The worker existed and
    // report_subscription shipped with it, so the feature looked complete — but nothing
    // imported it, meaning a scheduled report could never have fired under either
    // topology. Gated the same way: worker_config.enabled = 0 (migration 1025) and every
    // subscription is_active = 0.
    name: "report-subscription",
    start: () => { startReportSubscriptionWorker(); return Promise.resolve(); },
  },
  {
    name: "payroll-prep-reminder",
    start: startPayrollPrepReminderWorker,
  },
  {
    // Owner requirement 2026-08-21: monthly business-case close/reopen, reminder only (no
    // auto-close, no submission block) — fires on the 7th of the month for the previous
    // month's still-open head/sub-heads. See budget-closure-reminder.worker.ts.
    name: "budget-closure-reminder",
    start: startBudgetClosureReminderWorker,
  },
  {
    name: "payroll-readiness-refresh",
    start: startPayrollReadinessRefreshWorker,
  },
  {
    name: "auto-roster-scheduler",
    start: () => { startAutoRosterSchedulerWorker(); return Promise.resolve(); },
  },
  {
    // Registered HERE AND ONLY HERE. A worker present in only one of server.ts /
    // all-workers.ts silently never runs — that killed the biometric payroll feed for
    // weeks — so uat-worker-registration.test.ts asserts this appears once in this file
    // and not at all in server.ts. Polling only; it dispatches no builds in Phase 2.
    name: "uat-job-runner",
    // Handlers register before the runner starts: a claimed job whose type has no handler
    // goes straight to `dead`, so registering afterwards would kill the first tick's work.
    start: () => { registerUatJobHandlers(); startUatJobRunner(); return Promise.resolve(); },
  },
  {
    // Was in server.ts only, never in this file. Production runs WORKERS_PROCESS=external,
    // so the API didn't start it — and this file never started it either. Complaints sat
    // untriaged for 15+ minutes (or forever) because the scheduler never ran at all.
    // The scheduler fires once immediately on startup (so queued complaints get triaged
    // without waiting a full interval), then every 15 minutes thereafter.
    name: "mira-triage",
    start: () => { startMiraTriageScheduler(); return Promise.resolve(); },
  },
  {
    // Daily at 06:30 IST: checks workforce mandates where coverage_pct < alert_threshold_pct
    // and fires push notifications to HR Admin + Branch Head. Deduplicates via audit_log
    // (same scope alerted in last 24h is skipped).
    name: "hc-gap-alert",
    start: () => { startHcGapAlertScheduler(); return Promise.resolve(); },
  },
  {
    // Roster Intelligence: Manager daily digest (7 AM), branch dashboard (8 AM), and
    // unplanned absence alerts (every 30 min 8 AM - 8 PM). Controlled via
    // ROSTER_INTELLIGENCE_CRON env var (default enabled).
    name: "roster-intelligence",
    start: () => { registerRosterIntelligenceCrons(); return Promise.resolve(); },
  },
];

async function startAllWorkers(): Promise<void> {
  // The workers process sends most notifications, so it needs the deliverer too.
  registerNotificationDeliverer();
  console.log("\n================================================");
  console.log("  HRMS Unified Worker Runner");
  console.log(`  Workers: ${WORKERS.map(w => w.name).join(", ")}`);
  // Which code this process is actually running. The release certificate has to prove the
  // worker's SHA, not infer it from having restarted alongside the API — a worker left on a
  // stale artifact satisfies that inference silently. Same loader the API /health/version
  // uses, so the two cannot disagree about what "the build" is. "unknown" here is a
  // certificate FAILURE, not a cosmetic gap.
  const build = readBuildInfo();
  console.log(`  Build: commit=${build.commit} branch=${build.branch} builtAt=${build.builtAt}`);
  console.log("================================================\n");
  console.log("[workers] biometric attendance sync uses cosec-sync worker; legacy migrate-ncosec script is manual-only");

  for (const worker of WORKERS) {
    try {
      await worker.start();
      console.log(`  ✓ ${worker.name}`);
    } catch (err: any) {
      console.error(`  ✗ ${worker.name} failed to start: ${err.message}`);
    }
  }

  console.log("\n[workers] All workers running. Press Ctrl+C to stop.\n");
}

function shutdown(): void {
  console.log("\n[workers] Shutting down...");
  // Newly moved here from server.ts. privacy-retention and ats-reminders export
  // no stop function, so they are not listed — their timers die with the process.
  stopBusinessActionSyncJobs();
  stopDashboardSnapshotScheduler();
  stopPerformanceScorecardSnapshotScheduler();
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
  stopFestivalGreetingScheduler();
  stopDailyGamesScheduler();
  stopCommunicationCleanup();
  stopAttendanceEngineScheduler();
  stopCosecSyncWorker();
  stopRtaNightlyCron();
  stopEmployeeLifecycleWorker();
  legacySyncWorker.stop();
  stopKpiDailySyncWorker();
  stopAnnualLeaveWorker();
  stopLeaveMonthlyWorker();
  stopOfficialEmailComplianceScheduler();
  stopSLABreachWorker();
  stopInterviewDelayAlertWorker();
  stopLmsSyncWorker();
  stopPayrollNightlyRecalcWorker();
  stopPayrollRecalcDrainerWorker();
  stopDbBillFinanceSyncWorker();
  stopDbBillHrSyncWorker();
  stopGstExportAutoWorker();
  stopPayrollPrepReminderWorker();
  stopBudgetClosureReminderWorker();
  stopPayrollReadinessRefreshWorker();
  stopAprVicidialSyncWorker();
  stopITProvisioningLockScheduler();
  stopPayrollWindowClosureScheduler();
  stopBreachSlaCron();
  stopWalkinSlaCron();
  stopHelpdeskSlaCron();
  stopInboxReconciliationWorker();
  stopAttendanceCorrectionReconciliationWorker();
  stopReportGenerationWorker();
  stopReportEmailDeliveryWorker();
  stopReportStaleRecoveryWorker();
  stopTatEscalationWorker();
  stopAtsDailyReportScheduler();
  stopReportSubscriptionWorker();
  stopAutoRosterSchedulerWorker();
  stopUatJobRunner();
  stopHcGapAlertScheduler();
  clearAllTimers();
  console.log("[workers] Clean shutdown complete.");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

startAllWorkers().catch(err => {
  console.error("[workers] Fatal startup error:", err);
  process.exit(1);
});
