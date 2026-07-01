import { getLegacyPool } from '../../db/legacyDb.js';
import { db } from '../../db/mysql.js';
import { randomUUID } from 'crypto';

export interface SyncResult {
  domain: string;
  syncMapId: string;
  rowsRead: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsFailed: number;
  durationMs: number;
  newWatermark: string | null;
}

/**
 * Base class for all db_bill → mas_hrms domain sync handlers.
 *
 * Each subclass implements:
 *   fetchBatch()  — query db_bill since lastWatermark
 *   processBatch() — upsert into mas_hrms, returns counts
 *   extractWatermark() — pull max watermark value from the raw batch
 */
export abstract class DomainSyncBase {
  protected readonly syncMapId: string;
  readonly domain: string;

  constructor(domain: string, syncMapId: string) {
    this.domain = domain;
    this.syncMapId = syncMapId;
  }

  // ── Abstract interface ────────────────────────────────────────────────────

  protected abstract fetchBatch(
    lastWatermark: string,
    batchSize: number
  ): Promise<any[]>;

  protected abstract processBatch(
    rows: any[]
  ): Promise<{ inserted: number; updated: number; skipped: number; failed: number }>;

  protected abstract extractWatermark(rows: any[]): string | null;

  // ── Public run interface ──────────────────────────────────────────────────

  async run(batchSize = 1000): Promise<SyncResult> {
    const start = Date.now();
    const runId = randomUUID();

    const lastWatermark = await this.getCheckpoint();

    await this.insertRunLog(runId, lastWatermark);

    let rows: any[] = [];
    let inserted = 0, updated = 0, skipped = 0, failed = 0;
    let newWatermark: string | null = null;

    try {
      rows = await this.fetchBatch(lastWatermark, batchSize);

      if (rows.length > 0) {
        const counts = await this.processBatch(rows);
        inserted = counts.inserted;
        updated  = counts.updated;
        skipped  = counts.skipped;
        failed   = counts.failed;
        newWatermark = this.extractWatermark(rows);
        if (newWatermark) await this.saveCheckpoint(newWatermark);
      }

      await this.finaliseRunLog(runId, 'success', rows.length, inserted, updated, skipped, failed);
    } catch (err: any) {
      await this.finaliseRunLog(runId, 'failed', rows.length, inserted, updated, skipped, failed, err.message);
      throw err;
    }

    return {
      domain: this.domain,
      syncMapId: this.syncMapId,
      rowsRead:     rows.length,
      rowsInserted: inserted,
      rowsUpdated:  updated,
      rowsSkipped:  skipped,
      rowsFailed:   failed,
      durationMs:   Date.now() - start,
      newWatermark,
    };
  }

  // ── Checkpoint helpers ────────────────────────────────────────────────────

  async getCheckpoint(): Promise<string> {
    const [rows] = await db.execute<any[]>(
      `SELECT last_watermark_value FROM legacy_sync_checkpoint
       WHERE sync_map_id = ? LIMIT 1`,
      [this.syncMapId]
    );
    return rows[0]?.last_watermark_value ?? '2025-04-01 00:00:00';
  }

  async saveCheckpoint(watermark: string): Promise<void> {
    await db.execute(
      `UPDATE legacy_sync_checkpoint
       SET last_watermark_value = ?, last_success_at = NOW(), last_run_status = 'success', updated_at = NOW()
       WHERE sync_map_id = ?`,
      [watermark, this.syncMapId]
    );
  }

  async resetCheckpoint(toDate = '2025-04-01 00:00:00'): Promise<void> {
    await db.execute(
      `UPDATE legacy_sync_checkpoint
       SET last_watermark_value = ?, last_run_status = 'reset', updated_at = NOW()
       WHERE sync_map_id = ?`,
      [toDate, this.syncMapId]
    );
  }

  // ── Run log helpers ───────────────────────────────────────────────────────

  private async insertRunLog(runId: string, watermark: string): Promise<void> {
    await db.execute(
      `INSERT INTO legacy_sync_run_log
         (id, sync_map_id, run_type, started_at, rows_read, rows_inserted,
          rows_updated, rows_skipped, rows_failed, status)
       VALUES (?, ?, 'incremental', NOW(), 0, 0, 0, 0, 0, 'running')`,
      [runId, this.syncMapId]
    );
  }

  private async finaliseRunLog(
    runId: string, status: string,
    read: number, ins: number, upd: number, skip: number, fail: number,
    error?: string
  ): Promise<void> {
    await db.execute(
      `UPDATE legacy_sync_run_log
       SET finished_at = NOW(), status = ?,
           rows_read = ?, rows_inserted = ?, rows_updated = ?,
           rows_skipped = ?, rows_failed = ?, error_message = ?
       WHERE id = ?`,
      [status, read, ins, upd, skip, fail, error ?? null, runId]
    );
  }

  // ── Shared utility ────────────────────────────────────────────────────────

  protected async getLegacy() {
    return getLegacyPool();
  }

  protected resolveEmployeeId(cache: Map<string, string>, empCode: string): string | null {
    return cache.get(empCode?.trim()) ?? null;
  }

  /** Load full employee_code → id map from mas_hrms once per run */
  protected async loadEmployeeMap(): Promise<Map<string, string>> {
    const [rows] = await db.execute<any[]>(
      `SELECT id, employee_code FROM employees WHERE active_status = 1`
    );
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.employee_code, r.id);
    return m;
  }
}
