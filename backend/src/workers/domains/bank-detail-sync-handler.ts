import { db } from '../../db/mysql.js';
import { DomainSyncBase } from './domain-sync-base.js';
import { encryptAccountForSync } from '../../shared/syncPiiEncryption.js';

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

      const acNo = row.AcNo?.trim() ?? null;
      if (!acNo) { skipped++; continue; }

      // Refuses under the all-zeros dev key and returns null, rather than writing ciphertext
      // production could never decrypt. A refusal deliberately no longer skips the row: the
      // previous `catch { skipped++; continue; }` dropped the entire bank detail, and a row
      // carrying plaintext with no ciphertext is recoverable — resolveAccountNumber() falls
      // back to account_number — where a missing bank account is not.
      let acNoEnc: string | null;
      try { acNoEnc = encryptAccountForSync(acNo, 'bank-detail-sync'); }
      catch { skipped++; continue; }

      try {
        const [res] = await db.execute<any>(
          // Two columns here never existed, so every legacy bank-detail import threw
          // ER_BAD_FIELD_ERROR — silently, because the whole block sits in a bare
          // try/catch. The column is bank_branch, not bank_branch_name.
          //
          // verified_status did not exist either, and it is not a rename: the code wrote the
          // string 'legacy_imported' while the real column, verified, is tinyint(1). That
          // string is provenance, not a verification state. A legacy-imported account has
          // NOT been verified by anyone, so it is recorded as verified = 0 — which is both
          // true and the safe default. Provenance is already implied by this handler being
          // the writer; inventing a column to carry it would be a schema change, not a fix.
          `INSERT INTO employee_bank_detail
             (id, employee_id, account_number, account_number_enc, bank_name, bank_branch,
              ifsc_code, account_holder_name, is_primary, verified, created_at)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, 1, 0, NOW())
           ON DUPLICATE KEY UPDATE
             -- Guarded, not unconditional. Under a dev key VALUES(account_number_enc) is
             -- NULL, and the previous unconditional assignment would have destroyed a good
             -- production ciphertext on every re-sync. A refusal must never be able to
             -- delete protection that already exists.
             account_number_enc  = IF(VALUES(account_number_enc) IS NOT NULL, VALUES(account_number_enc), account_number_enc),
             bank_name           = VALUES(bank_name),
             bank_branch         = VALUES(bank_branch),
             ifsc_code           = VALUES(ifsc_code),
             account_holder_name = VALUES(account_holder_name),
             updated_at          = NOW()`,
          [
            empId,
            Buffer.from(acNo, 'utf8'),
            acNoEnc,
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
