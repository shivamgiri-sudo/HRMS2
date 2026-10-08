import { db } from '../../db/mysql.js';
import { DomainSyncBase } from './domain-sync-base.js';
import { encryptPanForSync, blindIndexPan } from '../../shared/syncPiiEncryption.js';

const SYNC_MAP_ID = 'a1000000-0000-0000-0000-000000000004';

interface LegacyStatutory {
  id: number;
  EmpCode: string;
  EPFNo: string | null;
  ESICNo: string | null;
  UAN: string | null;
  PanNo: string | null;
  lastUpdated: Date | null;
  EntryDate: Date | null;
}

export class StatutorySyncHandler extends DomainSyncBase {
  constructor() {
    super('statutory', SYNC_MAP_ID);
  }

  protected async fetchBatch(lastWatermark: string, batchSize: number): Promise<LegacyStatutory[]> {
    const pool = await this.getLegacy();
    const [rows] = await pool.execute<any[]>(
      `SELECT id, EmpCode, EPFNo, ESICNo, UAN, PanNo, lastUpdated, EntryDate
       FROM db_bill.masjclrentry
       WHERE (lastUpdated >= ? OR (lastUpdated IS NULL AND EntryDate >= ?))
         AND (EPFNo IS NOT NULL OR ESICNo IS NOT NULL OR UAN IS NOT NULL OR PanNo IS NOT NULL)
       ORDER BY COALESCE(lastUpdated, EntryDate) ASC
       LIMIT ?`,
      [lastWatermark, lastWatermark, batchSize]
    );
    return rows as LegacyStatutory[];
  }

  protected extractWatermark(rows: LegacyStatutory[]): string | null {
    const last = [...rows].reverse().find(r => r.lastUpdated || r.EntryDate);
    if (!last) return null;
    const d = new Date((last.lastUpdated ?? last.EntryDate)!);
    d.setSeconds(d.getSeconds() + 1);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }

  protected async processBatch(rows: LegacyStatutory[]): Promise<{
    inserted: number; updated: number; skipped: number; failed: number;
  }> {
    const empMap = await this.loadEmployeeMap();
    let inserted = 0, updated = 0, skipped = 0, failed = 0;

    for (const row of rows) {
      const empId = this.resolveEmployeeId(empMap, row.EmpCode);
      if (!empId) { skipped++; continue; }

      // Computed once and reused for all three PAN columns, so the plaintext, the
      // ciphertext and the blind index can never be derived from different values.
      const panNumber = row.PanNo?.trim() || null;

      try {
        // employee_statutory_info uses employee_id as primary key (one row per employee)
        //
        // pan_number_encrypted / pan_blind_index are written alongside the plaintext, the
        // same dual-write the two employees sync handlers do. This handler is dormant
        // (LEGACY_SYNC_ENABLED=false) but its source is not empty: db_bill.masjclrentry
        // holds 28,721 PANs (measured live 2026-08-11), so flipping that flag without this
        // would pour all of them in as plaintext with no ciphertext.
        //
        // Both helpers return null under a dev key, which writes NULL rather than
        // ciphertext production could never decrypt. The plaintext write still lands, so
        // the degradation is safe.
        //
        // In the ON DUPLICATE clause below, pan_number_encrypted and pan_blind_index are
        // keyed on VALUES(pan_number) — the plaintext condition — deliberately, and never
        // on their own. This handler fills only when the incoming value is non-empty;
        // switching those two onto VALUES(pan_number_encrypted) would leave the plaintext
        // updated and the ciphertext stale whenever a helper returns null. Pinned by
        // "keys the statutory ciphertext rule to its own plaintext rule" in
        // src/shared/__tests__/syncPiiEncryption.test.ts.
        const [res] = await db.execute<any>(
          `INSERT INTO employee_statutory_info
             (id, employee_id, epf_number, esi_number, uan_number, pan_number,
              pan_number_encrypted, pan_blind_index, created_at)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             epf_number  = IF(VALUES(epf_number)  IS NOT NULL AND VALUES(epf_number)  != '', VALUES(epf_number),  epf_number),
             esi_number = IF(VALUES(esi_number) IS NOT NULL AND VALUES(esi_number) != '', VALUES(esi_number), esi_number),
             uan_number  = IF(VALUES(uan_number)  IS NOT NULL AND VALUES(uan_number)  != '', VALUES(uan_number),  uan_number),
             pan_number  = IF(VALUES(pan_number)  IS NOT NULL AND VALUES(pan_number)  != '', VALUES(pan_number),  pan_number),
             pan_number_encrypted = IF(VALUES(pan_number) IS NOT NULL AND VALUES(pan_number) != '', VALUES(pan_number_encrypted), pan_number_encrypted),
             pan_blind_index      = IF(VALUES(pan_number) IS NOT NULL AND VALUES(pan_number) != '', VALUES(pan_blind_index),      pan_blind_index),
             updated_at  = NOW()`,
          [
            empId,
            row.EPFNo?.trim()  || null,
            row.ESICNo?.trim() || null,
            row.UAN?.trim()    || null,
            panNumber,
            encryptPanForSync(panNumber, 'statutory-sync'),
            blindIndexPan(panNumber, 'statutory-sync'),
          ]
        );
        if (res.affectedRows === 1) inserted++;
        else updated++;
      } catch {
        failed++;
      }
    }

    return { inserted, updated, skipped, failed };
  }
}

export const statutorySyncHandler = new StatutorySyncHandler();
