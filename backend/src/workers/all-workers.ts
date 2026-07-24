import "dotenv/config";

import { startAccessExpiryScheduler, stopAccessExpiryScheduler } from "./access-expiry.worker.js";
import { startIntegrationScheduler, stopIntegrationScheduler } from "./integration-scheduler.worker.js";
import { startKpiDailySyncWorker, stopKpiDailySyncWorker } from "./kpi-daily-sync.worker.js";
import { startAnnualLeaveWorker, stopAnnualLeaveWorker } from "./leave-annual-el-credit.worker.js";
import { startLeaveMonthlyWorker, stopLeaveMonthlyWorker } from "./leave-monthly-credit.worker.js";
import { startOfficialEmailComplianceScheduler, stopOfficialEmailComplianceScheduler } from "./official-email-compliance.worker.js";
import { startSLABreachWorker, stopSLABreachWorker } from "./sla-breach-worker.js";
import { startInterviewDelayAlertWorker, stopInterviewDelayAlertWorker } from "./interview-delay-alert.worker.js";
import { startLmsSyncWorker, stopLmsSyncWorker } from "./lms-sync.worker.js";
import { startPayrollNightlyRecalcWorker, stopPayrollNightlyRecalcWorker } from "./payroll-nightly-recalc.worker.js";
import { startAprVicidialSyncWorker, stopAprVicidialSyncWorker } from "./apr-vicidial-sync.worker.js";
import { startEsignComplianceWorker, stopEsignComplianceWorker } from "./esign-compliance.worker.js";
import { legacySyncWorker } from "./legacy-sync-worker.js";
import { startTenureBadgeScheduler, stopTenureBadgeScheduler } from "../modules/engagement/tenure.cron.js";
import { startCommunicationCleanup, stopCommunicationCleanup } from "../modules/communication/cleanup.cron.js";
import { startAttendanceEngineScheduler, stopAttendanceEngineScheduler } from "../modules/wfm/attendance-engine.cron.js";
import { startITProvisioningLockScheduler, stopITProvisioningLockScheduler } from "../modules/it-provisioning/it-provisioning.cron.js";
import { startEmployeeLifecycleWorker, stopEmployeeLifecycleWorker } from "./employee-lifecycle.worker.js";
import { startPayrollWindowClosureScheduler, stopPayrollWindowClosureScheduler } from "../modules/payroll/payroll-window.cron.js";
import { startBreachSlaCron, stopBreachSlaCron } from "../modules/privacy/dpdp-breach-sla.cron.js";
import { startCosecSyncWorker, stopCosecSyncWorker } from "../modules/wfm/cosec-sync.worker.js";
import { startRtaNightlyCron, stopRtaNightlyCron } from "../modules/rta/rta-nightly.cron.js";
import { startWalkinSlaCron, stopWalkinSlaCron } from "./walkin-sla.cron.js";

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
    name: "tenure-badge",
    start: () => { startTenureBadgeScheduler(); return Promise.resolve(); },
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
    name: "payroll-nightly-recalc",
    start: startPayrollNightlyRecalcWorker,
  },
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
];

async function startAllWorkers(): Promise<void> {
  console.log("\n================================================");
  console.log("  HRMS Unified Worker Runner");
  console.log(`  Workers: ${WORKERS.map(w => w.name).join(", ")}`);
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
  stopAccessExpiryScheduler();
  stopIntegrationScheduler();
  stopEsignComplianceWorker();
  stopTenureBadgeScheduler();
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
  stopAprVicidialSyncWorker();
  stopITProvisioningLockScheduler();
  stopPayrollWindowClosureScheduler();
  stopBreachSlaCron();
  stopWalkinSlaCron();
  console.log("[workers] Clean shutdown complete.");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

startAllWorkers().catch(err => {
  console.error("[workers] Fatal startup error:", err);
  process.exit(1);
});
