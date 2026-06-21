import 'dotenv/config';

import { startAccessExpiryScheduler, stopAccessExpiryScheduler } from './access-expiry.worker.js';
import { startIntegrationScheduler, stopIntegrationScheduler } from './integration-scheduler.worker.js';
import { startKpiDailySyncWorker } from './kpi-daily-sync.worker.js';
import { startAnnualLeaveWorker } from './leave-annual-el-credit.worker.js';
import { startLeaveMonthlyWorker } from './leave-monthly-credit.worker.js';
import { startOfficialEmailComplianceScheduler } from './official-email-compliance.worker.js';
import { startSLABreachWorker } from './sla-breach-worker.js';
import { startLmsSyncWorker } from './lms-sync.worker.js';
import { runNcosecBiometricSync } from '../../scripts/migrate-ncosec-biometric.js';

const BIOMETRIC_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

async function startBiometricCosecWorker(): Promise<void> {
  const run = async () => {
    console.log('[biometric-cosec-sync] Starting NCOSEC sync...');
    try {
      const summary = await runNcosecBiometricSync();
      console.log(`[biometric-cosec-sync] Done — inserted: ${summary.attendance_inserted}, updated: ${summary.attendance_updated}, errors: ${summary.errors.length}`);
    } catch (err: any) {
      console.error('[biometric-cosec-sync] Failed:', err.message);
    }
  };

  await run();
  setInterval(run, BIOMETRIC_SYNC_INTERVAL_MS);
}

const WORKERS: Array<{ name: string; start: () => Promise<void> }> = [
  {
    name: 'access-expiry',
    start: () => { startAccessExpiryScheduler(); return Promise.resolve(); },
  },
  {
    name: 'integration-scheduler',
    start: () => { startIntegrationScheduler(); return Promise.resolve(); },
  },
  {
    name: 'kpi-daily-sync',
    start: startKpiDailySyncWorker,
  },
  {
    name: 'leave-annual-el-credit',
    start: startAnnualLeaveWorker,
  },
  {
    name: 'leave-monthly-credit',
    start: startLeaveMonthlyWorker,
  },
  {
    name: 'official-email-compliance',
    start: () => { startOfficialEmailComplianceScheduler(); return Promise.resolve(); },
  },
  {
    name: 'sla-breach',
    start: startSLABreachWorker,
  },
  {
    name: 'lms-sync',
    start: startLmsSyncWorker,
  },
  {
    name: 'biometric-cosec-sync',
    start: startBiometricCosecWorker,
  },
];

async function startAllWorkers(): Promise<void> {
  console.log('\n================================================');
  console.log('  HRMS Unified Worker Runner');
  console.log(`  Workers: ${WORKERS.map(w => w.name).join(', ')}`);
  console.log('================================================\n');

  for (const worker of WORKERS) {
    try {
      await worker.start();
      console.log(`  ✓ ${worker.name}`);
    } catch (err: any) {
      console.error(`  ✗ ${worker.name} failed to start: ${err.message}`);
    }
  }

  console.log('\n[workers] All workers running. Press Ctrl+C to stop.\n');
}

function shutdown(): void {
  console.log('\n[workers] Shutting down...');
  stopAccessExpiryScheduler();
  stopIntegrationScheduler();
  console.log('[workers] Clean shutdown complete.');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

startAllWorkers().catch(err => {
  console.error('[workers] Fatal startup error:', err);
  process.exit(1);
});
