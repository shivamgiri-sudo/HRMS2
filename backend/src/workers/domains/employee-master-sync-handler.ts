import { db } from '../../db/mysql.js';
import { DomainSyncBase } from './domain-sync-base.js';

const SYNC_MAP_ID = 'a1000000-0000-0000-0000-000000000001';

interface LegacyEmployee {
  id: number;
  EmpCode: string;
  BioCode: string | null;
  EmpName: string | null;
  Title: string | null;
  Gendar: string | null;
  DOB: Date | null;
  DOJ: Date | null;
  DOL: Date | null;
  Mobile: string | null;
  EmailId: string | null;
  OfficeEmailId: string | null;
  PanNo: string | null;
  AdharId: string | null;
  PassportNo: string | null;
  EPFNo: string | null;
  ESICNo: string | null;
  UAN: string | null;
  Dept: string | null;
  Desgination: string | null;
  BranchName: string | null;
  ClientName: string | null;
  Process: string | null;
  CostCenter: string | null;
  MaritalStatus: string | null;
  BloodGruop: string | null;
  Qualification: string | null;
  Adrress1: string | null;
  Adrress2: string | null;
  City: string | null;
  State: string | null;
  PinCode: string | null;
  Status: string;
  lastUpdated: Date | null;
  EntryDate: Date | null;
  CreateDate: Date | null;
}

export class EmployeeMasterSyncHandler extends DomainSyncBase {
  constructor() {
    super('employee', SYNC_MAP_ID);
  }

  protected async fetchBatch(lastWatermark: string, batchSize: number): Promise<LegacyEmployee[]> {
    const pool = await this.getLegacy();
    const [rows] = await pool.execute<any[]>(
      `SELECT id, EmpCode, BioCode, EmpName, Title, Gendar, DOB, DOJ, DOL,
              Mobile, EmailId, OfficeEmailId, PanNo, AdharId, PassportNo,
              EPFNo, ESICNo, UAN, Dept, Desgination, BranchName, ClientName,
              Process, CostCenter, MaritalStatus, BloodGruop, Qualification,
              Adrress1, Adrress2, City, State, PinCode, Status,
              lastUpdated, EntryDate, CreateDate
       FROM db_bill.masjclrentry
       WHERE (lastUpdated >= ? OR (lastUpdated IS NULL AND (EntryDate >= ? OR CreateDate >= ?)))
       ORDER BY COALESCE(lastUpdated, EntryDate, CreateDate) ASC
       LIMIT ?`,
      [lastWatermark, lastWatermark, lastWatermark, batchSize]
    );
    return rows as LegacyEmployee[];
  }

  protected extractWatermark(rows: LegacyEmployee[]): string | null {
    const last = [...rows].reverse().find(r => r.lastUpdated || r.EntryDate || r.CreateDate);
    if (!last) return null;
    const d = new Date((last.lastUpdated ?? last.EntryDate ?? last.CreateDate)!);
    d.setSeconds(d.getSeconds() + 1);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }

  protected async processBatch(rows: LegacyEmployee[]): Promise<{
    inserted: number; updated: number; skipped: number; failed: number;
  }> {
    let inserted = 0, updated = 0, skipped = 0, failed = 0;

    for (const row of rows) {
      if (!row.EmpCode?.trim()) { skipped++; continue; }

      const nameParts = (row.EmpName ?? '').trim().split(/\s+/);
      const firstName = nameParts[0] || 'Unknown';
      const lastName  = nameParts.slice(1).join(' ') || null;

      const aadhaarLast4 = row.AdharId
        ? row.AdharId.replace(/\s/g, '').slice(-4)
        : null;

      try {
        const [res] = await db.execute<any>(
          `INSERT INTO employees (
             id, employee_code, biometric_code, first_name, last_name, title, gender,
             date_of_birth, date_of_joining, date_of_leaving,
             mobile, email, official_email,
             pan_number, aadhaar_last4, passport_number, epf_number, esic_number, uan,
             department, designation, branch, client_name, process, cost_center,
             marital_status, blood_group, qualification,
             address_line1, address_line2, city, state, pincode,
             active_status, legacy_last_updated, legacy_emp_id,
             created_at, updated_at
           ) VALUES (
             UUID(), ?, ?, ?, ?, ?, ?,
             ?, ?, ?,
             ?, ?, ?,
             ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?,
             ?, ?, ?,
             ?, ?, ?, ?, ?,
             ?, ?, ?,
             NOW(), NOW()
           )
           ON DUPLICATE KEY UPDATE
             biometric_code      = VALUES(biometric_code),
             first_name          = VALUES(first_name),
             last_name           = VALUES(last_name),
             title               = VALUES(title),
             gender              = VALUES(gender),
             date_of_birth       = VALUES(date_of_birth),
             date_of_joining     = VALUES(date_of_joining),
             date_of_leaving     = VALUES(date_of_leaving),
             mobile              = VALUES(mobile),
             email               = VALUES(email),
             official_email      = VALUES(official_email),
             pan_number          = VALUES(pan_number),
             aadhaar_last4       = VALUES(aadhaar_last4),
             passport_number     = VALUES(passport_number),
             epf_number          = VALUES(epf_number),
             esic_number         = VALUES(esic_number),
             uan                 = VALUES(uan),
             department          = VALUES(department),
             designation         = VALUES(designation),
             branch              = VALUES(branch),
             client_name         = VALUES(client_name),
             process             = VALUES(process),
             cost_center         = VALUES(cost_center),
             marital_status      = VALUES(marital_status),
             blood_group         = VALUES(blood_group),
             qualification       = VALUES(qualification),
             address_line1       = VALUES(address_line1),
             address_line2       = VALUES(address_line2),
             city                = VALUES(city),
             state               = VALUES(state),
             pincode             = VALUES(pincode),
             active_status       = VALUES(active_status),
             legacy_last_updated = VALUES(legacy_last_updated),
             legacy_emp_id       = VALUES(legacy_emp_id),
             updated_at          = NOW()`,
          [
            row.EmpCode.trim(), row.BioCode, firstName, lastName, row.Title, row.Gendar,
            row.DOB, row.DOJ, row.DOL,
            row.Mobile, row.EmailId, row.OfficeEmailId,
            row.PanNo, aadhaarLast4, row.PassportNo, row.EPFNo, row.ESICNo, row.UAN,
            row.Dept, row.Desgination, row.BranchName, row.ClientName, row.Process, row.CostCenter,
            row.MaritalStatus, row.BloodGruop, row.Qualification,
            row.Adrress1, row.Adrress2, row.City, row.State, row.PinCode,
            row.Status === '1',
            row.lastUpdated,
            row.id,
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

export const employeeMasterSyncHandler = new EmployeeMasterSyncHandler();
