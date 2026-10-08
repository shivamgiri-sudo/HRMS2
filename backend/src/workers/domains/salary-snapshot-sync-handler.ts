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
    //
    // BROKEN - left as found, deliberately. This query raises
    // ER_BAD_FIELD_ERROR: Unknown column 'Basic' in 'field list' on every call, verified live
    // against db_bill. masjclrentry has no Basic, TA or Other; its component columns are
    // bs, hra, conv, da, portf, ma, lta, mob, sa, oa (CTC, Gross and NetInhand do exist).
    //
    // Basic -> bs is obvious, but which of conv / lta is "TA" and which of oa / sa is "Other" is a
    // payroll-semantics question, not a rename. Guessing here would silently populate a salary
    // snapshot with the wrong component and no error, so the mapping needs whoever owns payroll to
    // state it. Nothing imports salarySnapshotSyncHandler today, so this query never runs.
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
          // Five of this statement's column names did not exist, so the legacy salary sync
          // has never written a row. The correct names were established from the codebase
          // and the data, not guessed:
          //
          //   ctc            -> ctc_offered   employee-creation-orchestrator writes BOTH
          //                                   ctc_offered and offered_ctc with the same
          //                                   value, a legacy duplicate pair. Production
          //                                   settles which is real: ctc_offered is populated
          //                                   on 31,142 of 33,443 rows, offered_ctc on 1.
          //   net_inhand     -> net_in_hand   underscore; 17,124 rows populated.
          //   ta             -> conveyance    TA is the legacy name for the conveyance
          //                                   component. Seven read sites use s.conveyance
          //                                   and none reads a column called ta.
          //   snapshot_month -> snapshot_date the column is a DATE, not a '%Y-%m' string, so
          //                                   the month is stored as its first day.
          //   updated_at                      does not exist on this table at all; dropped
          //                                   from the upsert rather than invented.
          //
          // ON DUPLICATE KEY is genuine here — employee_id carries its own UNIQUE index, so
          // one snapshot per employee is the intended shape and the clause really fires.
          `INSERT INTO employee_salary_snapshot
             (id, employee_id, ctc_offered, gross, net_in_hand, basic, hra, da, conveyance,
              other_allowance, snapshot_date, created_at)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_FORMAT(NOW(), '%Y-%m-01'), NOW())
           ON DUPLICATE KEY UPDATE
             ctc_offered     = IF(VALUES(ctc_offered) > 0, VALUES(ctc_offered), ctc_offered),
             gross           = IF(VALUES(gross) > 0, VALUES(gross), gross),
             net_in_hand     = IF(VALUES(net_in_hand) > 0, VALUES(net_in_hand), net_in_hand),
             basic           = IF(VALUES(basic) > 0, VALUES(basic), basic),
             hra             = IF(VALUES(hra) > 0, VALUES(hra), hra),
             da              = IF(VALUES(da) > 0, VALUES(da), da),
             conveyance      = IF(VALUES(conveyance) > 0, VALUES(conveyance), conveyance),
             other_allowance = IF(VALUES(other_allowance) > 0, VALUES(other_allowance), other_allowance),
             snapshot_date   = VALUES(snapshot_date)`,
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
