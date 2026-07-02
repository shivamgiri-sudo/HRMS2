import { env } from '../config/env.js';
import { employeeSyncHandler } from './domains/employee-sync-handler.js';

/**
 * Legacy Sync Worker - MySQL Timestamp-Based
 * Syncs masjclrentry (32K employees) → employees table
 */
export class LegacySyncWorker {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start the sync worker
   */
  start(): void {
    if (!env.LEGACY_SYNC_ENABLED) {
      console.log('[LegacySync] Worker disabled (LEGACY_SYNC_ENABLED=false)');
      return;
    }

    console.log(`[LegacySync] Worker starting (interval: ${env.LEGACY_SYNC_INTERVAL_MS}ms, batch: ${env.LEGACY_SYNC_BATCH_SIZE})`);

    // Run immediately
    this.runSyncCycle().catch(err => {
      console.error('[LegacySync] Initial sync failed:', err);
    });

    // Then run on interval
    this.intervalId = setInterval(() => {
      this.runSyncCycle().catch(err => {
        console.error('[LegacySync] Sync cycle failed:', err);
      });
    }, env.LEGACY_SYNC_INTERVAL_MS);
  }

  /**
   * Stop the sync worker
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[LegacySync] Worker stopped');
    }
  }

  /**
   * Run one sync cycle
   */
  private async runSyncCycle(): Promise<void> {
    if (this.isRunning) {
      console.log('[LegacySync] Skipping cycle (previous cycle still running)');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      console.log('[LegacySync] === Sync cycle starting ===');

      // Get last sync checkpoint
      const lastSyncTime = await employeeSyncHandler.getLastSyncTime();
      console.log(`[LegacySync] Last sync: ${lastSyncTime.toISOString()}`);

      // Fetch changed employees from legacy
      const legacyRecords = await employeeSyncHandler.fetchChanges(lastSyncTime, env.LEGACY_SYNC_BATCH_SIZE);

      if (legacyRecords.length === 0) {
        console.log('[LegacySync] No changes detected');
        await employeeSyncHandler.logSyncRun('success', 0, 0);
        return;
      }

      console.log(`[LegacySync] Found ${legacyRecords.length} changed employees`);

      // Transform legacy records to HRMS format
      const transformedRecords = legacyRecords.map(record => employeeSyncHandler.transform(record));

      // Sync to HRMS database
      const result = await employeeSyncHandler.syncToHRMS(transformedRecords);

      console.log(`[LegacySync] Sync complete: inserted=${result.inserted}, updated=${result.updated}, errors=${result.errors}`);

      // Update checkpoint (use latest timestamp from batch)
      const latestTimestamp = legacyRecords.reduce((latest, record) => {
        const recordTime = record.lastUpdated || record.EntryDate || record.CreateDate;
        if (!recordTime) return latest;
        const recordDate = new Date(recordTime);
        return recordDate > latest ? recordDate : latest;
      }, lastSyncTime);

      await employeeSyncHandler.updateCheckpoint(latestTimestamp);

      // Log sync run
      await employeeSyncHandler.logSyncRun(
        result.errors === 0 ? 'success' : 'failure',
        result.inserted + result.updated,
        result.errors
      );

      const duration = Date.now() - startTime;
      console.log(`[LegacySync] === Cycle complete (${duration}ms) ===`);

    } catch (error: any) {
      console.error('[LegacySync] Sync cycle failed:', error);
      await employeeSyncHandler.logSyncRun('failure', 0, 0, error.message);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Trigger manual sync (for testing)
   */
  async triggerManualSync(): Promise<{ success: boolean; message: string }> {
    if (this.isRunning) {
      return { success: false, message: 'Sync already running' };
    }

    try {
      await this.runSyncCycle();
      return { success: true, message: 'Manual sync completed' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }
}

export const legacySyncWorker = new LegacySyncWorker();
