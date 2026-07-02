import { db } from '../../db/mysql.js';
import { DomainSyncBase } from './domain-sync-base.js';

const SYNC_MAP_ID = 'a1000000-0000-0000-0000-000000000002';

interface LegacyBank {
  id: number;
  EmpCode: string;
  AcNo: string | null;
  AcBank: string | null;
  AcBranch: string | null;
  IFSCCode: string | null;
  AccHolder: string | null;
  lastUpdated: Date | null;
  EntryDate: Date | null;
}

export class BankDetailSyncHandler extends DomainSyncBase {
  constructor() {
    super('bank_detail', SYNC_MAP_ID);
  }

  protected async fetchBatch(lastWatermark: string, batchSize: number): Promise<LegacyBank[]> {
    const pool = await this.getLegacy();
    const [rows] = await pool.execute<any[]>(
      `SELECT id, EmpCode, AcNo, AcBank, AcBranch, IFSCCode, AccHolder,
              lastUpdated, EntryDate
       FROM db_bill.masjclrentry
       WHERE (lastUpdated >= ? OR (lastUpdated IS NULL AND EntryDate >= ?))
         AND AcNo IS NOT NULL AND AcNo != ''
         AND IFSCCode IS NOT NULL AND IFSCCode != ''
       ORDER BY COALESCE(lastUpdated, EntryDate) ASC
       LIMIT ?`,
      [lastWatermark, lastWatermark, batchSize]
    );
    return rows as LegacyBank[];
  }

  protected extractWatermark(rows: LegacyBank[]): string | null {
    const last = [...rows].reverse().find(r => r.lastUpdated || r.EntryDate);
    if (!last) return null;
    const d = new Date((last.lastUpdated ?? last.EntryDate)!);
    d.setSeconds(d.getSeconds() + 1);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }

  protected async processBatch(rows: LegacyBank[]): Promise<{
    inserted: number; updated: number; skipped: number; failed: number;
  }> {
    const empMap = await this.loadEmployeeMap();
    let inserted = 0, updated = 0, skipped = 0, failed = 0;

    for (const row of rows) {
      const empId = this.resolveEmployeeId(empMap, row.EmpCode);
      if (!empId) { skipped++; continue; }

      // account_number is VARBINARY(500) — store as UTF-8 bytes
      const acNo = row.AcNo?.trim() ?? null;
      if (!acNo) { skipped++; continue; }

      try {
        const [res] = await db.execute<any>(
          `INSERT INTO employee_bank_detail
             (id, employee_id, account_number, bank_name, bank_branch_name,
              ifsc_code, account_holder_name, is_primary, verified_status, created_at)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?, 1, 'legacy_imported', NOW())
           ON DUPLICATE KEY UPDATE
             account_number      = VALUES(account_number),
             bank_name           = VALUES(bank_name),
             bank_branch_name    = VALUES(bank_branch_name),
             ifsc_code           = VALUES(ifsc_code),
             account_holder_name = VALUES(account_holder_name),
             updated_at          = NOW()`,
          [
            empId,
            Buffer.from(acNo, 'utf8'),
            row.AcBank?.trim()   ?? null,
            row.AcBranch?.trim() ?? null,
            row.IFSCCode?.trim() ?? null,
            row.AccHolder?.trim() ?? null,
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

export const bankDetailSyncHandler = new BankDetailSyncHandler();
