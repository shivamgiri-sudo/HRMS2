import { db } from '../../db/mysql.js';
import { DomainSyncBase } from './domain-sync-base.js';

const SYNC_MAP_ID = 'a1000000-0000-0000-0000-000000000003';

interface LegacySalary {
  id: number;
  EmpCode: string;
  CTC: number | null;
  Gross: number | null;
  NetInHand: number | null;
  Basic: number | null;
  HRA: number | null;
  DA: number | null;
  TA: number | null;
  Other: number | null;
  lastUpdated: Date | null;
  EntryDate: Date | null;
}

export class SalarySnapshotSyncHandler extends DomainSyncBase {
  constructor() {
    super('salary_snapshot', SYNC_MAP_ID);
  }

  protected async fetchBatch(lastWatermark: string, batchSize: number): Promise<LegacySalary[]> {
    const pool = await this.getLegacy();
    // masjclrentry has salary columns inline; only pull rows where salary changed
    const [rows] = await pool.execute<any[]>(
      `SELECT id, EmpCode, CTC, Gross, NetInHand, Basic, HRA, DA, TA, Other,
              lastUpdated, EntryDate
       FROM db_bill.masjclrentry
       WHERE (lastUpdated >= ? OR (lastUpdated IS NULL AND EntryDate >= ?))
         AND (Gross > 0 OR CTC > 0)
       ORDER BY COALESCE(lastUpdated, EntryDate) ASC
       LIMIT ?`,
      [lastWatermark, lastWatermark, batchSize]
    );
    return rows as LegacySalary[];
  }

  protected extractWatermark(rows: LegacySalary[]): string | null {
    const last = [...rows].reverse().find(r => r.lastUpdated || r.EntryDate);
    if (!last) return null;
    const d = new Date((last.lastUpdated ?? last.EntryDate)!);
    d.setSeconds(d.getSeconds() + 1);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }

  protected async processBatch(rows: LegacySalary[]): Promise<{
    inserted: number; updated: number; skipped: number; failed: number;
  }> {
    const empMap = await this.loadEmployeeMap();
    let inserted = 0, updated = 0, skipped = 0, failed = 0;

    for (const row of rows) {
      const empId = this.resolveEmployeeId(empMap, row.EmpCode);
      if (!empId) { skipped++; continue; }

      const gross = Number(row.Gross ?? 0);
      const ctc   = Number(row.CTC   ?? 0) || gross * 12;

      try {
        const [res] = await db.execute<any>(
          `INSERT INTO employee_salary_snapshot
             (id, employee_id, ctc, gross, net_inhand, basic, hra, da, ta,
              other_allowance, snapshot_month, created_at)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_FORMAT(NOW(), '%Y-%m'), NOW())
           ON DUPLICATE KEY UPDATE
             ctc             = IF(VALUES(ctc) > 0, VALUES(ctc), ctc),
             gross           = IF(VALUES(gross) > 0, VALUES(gross), gross),
             net_inhand      = IF(VALUES(net_inhand) > 0, VALUES(net_inhand), net_inhand),
             basic           = IF(VALUES(basic) > 0, VALUES(basic), basic),
             hra             = IF(VALUES(hra) > 0, VALUES(hra), hra),
             da              = IF(VALUES(da) > 0, VALUES(da), da),
             ta              = IF(VALUES(ta) > 0, VALUES(ta), ta),
             other_allowance = IF(VALUES(other_allowance) > 0, VALUES(other_allowance), other_allowance),
             updated_at      = NOW()`,
          [
            empId, ctc, gross,
            Number(row.NetInHand ?? 0),
            Number(row.Basic     ?? 0),
            Number(row.HRA       ?? 0),
            Number(row.DA        ?? 0),
            Number(row.TA        ?? 0),
            Number(row.Other     ?? 0),
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

export const salarySnapshotSyncHandler = new SalarySnapshotSyncHandler();
