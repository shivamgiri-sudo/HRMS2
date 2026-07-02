import { db } from '../../db/mysql.js';
import { DomainSyncBase } from './domain-sync-base.js';

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

      try {
        // employee_statutory_info uses employee_id as primary key (one row per employee)
        const [res] = await db.execute<any>(
          `INSERT INTO employee_statutory_info
             (id, employee_id, epf_number, esic_number, uan_number, pan_number, created_at)
           VALUES (UUID(), ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             epf_number  = IF(VALUES(epf_number)  IS NOT NULL AND VALUES(epf_number)  != '', VALUES(epf_number),  epf_number),
             esic_number = IF(VALUES(esic_number) IS NOT NULL AND VALUES(esic_number) != '', VALUES(esic_number), esic_number),
             uan_number  = IF(VALUES(uan_number)  IS NOT NULL AND VALUES(uan_number)  != '', VALUES(uan_number),  uan_number),
             pan_number  = IF(VALUES(pan_number)  IS NOT NULL AND VALUES(pan_number)  != '', VALUES(pan_number),  pan_number),
             updated_at  = NOW()`,
          [
            empId,
            row.EPFNo?.trim()  || null,
            row.ESICNo?.trim() || null,
            row.UAN?.trim()    || null,
            row.PanNo?.trim()  || null,
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
