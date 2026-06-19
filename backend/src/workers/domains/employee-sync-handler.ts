import { getLegacyPool } from '../../db/legacyDb.js';
import { db as mysqlDb } from '../../db/mysql.js';
import { randomUUID } from 'crypto';

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
  AcNo: string | null;
  AcBank: string | null;
  AcBranch: string | null;
  IFSCCode: string | null;
  AccHolder: string | null;
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

interface TransformedEmployee {
  employee_code: string;
  biometric_code: string | null;
  first_name: string;
  last_name: string | null;
  title: string | null;
  gender: string | null;
  date_of_birth: Date | null;
  date_of_joining: Date | null;
  date_of_leaving: Date | null;
  mobile: string | null;
  email: string | null;
  official_email: string | null;
  pan_number: string | null;
  aadhaar_last4: string | null;
  passport_number: string | null;
  epf_number: string | null;
  esic_number: string | null;
  uan: string | null;
  department: string | null;
  designation: string | null;
  branch: string | null;
  client_name: string | null;
  process: string | null;
  cost_center: string | null;
  bank_account_number: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  ifsc_code: string | null;
  account_holder_name: string | null;
  marital_status: string | null;
  blood_group: string | null;
  qualification: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  active_status: boolean;
  legacy_last_updated: Date | null;
  legacy_emp_id: number;
  created_at: Date | null;
}

export class EmployeeSyncHandler {
  private domain = 'employee';

  /**
   * Fetch changed employees from legacy database
   * Uses timestamp-based incremental sync (MySQL doesn't have Change Tracking)
   */
  async fetchChanges(lastSyncTime: Date, batchSize: number = 1000): Promise<LegacyEmployee[]> {
    const pool = await getLegacyPool();

    const [rows] = await pool.execute<any[]>(`
      SELECT *
      FROM masjclrentry
      WHERE lastUpdated > ?
         OR (lastUpdated IS NULL AND (EntryDate > ? OR CreateDate > ?))
      ORDER BY COALESCE(lastUpdated, EntryDate, CreateDate) ASC
      LIMIT ?
    `, [lastSyncTime, lastSyncTime, lastSyncTime, batchSize]);

    return rows as LegacyEmployee[];
  }

  /**
   * Transform legacy record to HRMS format
   */
  transform(legacyRecord: LegacyEmployee): TransformedEmployee {
    // Split name: "DEEPAK KASHYAP" → first="DEEPAK", last="KASHYAP"
    const nameParts = (legacyRecord.EmpName || '').trim().split(/\s+/);
    const firstName = nameParts[0] || 'Unknown';
    const lastName = nameParts.slice(1).join(' ') || null;

    // Mask Aadhaar (SECURITY: only last 4 digits)
    const aadhaarLast4 = legacyRecord.AdharId
      ? legacyRecord.AdharId.replace(/\s/g, '').slice(-4)
      : null;

    return {
      employee_code: legacyRecord.EmpCode,
      biometric_code: legacyRecord.BioCode,
      first_name: firstName,
      last_name: lastName,
      title: legacyRecord.Title,
      gender: legacyRecord.Gendar, // Note: typo in legacy
      date_of_birth: legacyRecord.DOB,
      date_of_joining: legacyRecord.DOJ,
      date_of_leaving: legacyRecord.DOL,
      mobile: legacyRecord.Mobile,
      email: legacyRecord.EmailId,
      official_email: legacyRecord.OfficeEmailId,
      pan_number: legacyRecord.PanNo,
      aadhaar_last4: aadhaarLast4,
      passport_number: legacyRecord.PassportNo,
      epf_number: legacyRecord.EPFNo,
      esic_number: legacyRecord.ESICNo,
      uan: legacyRecord.UAN,
      department: legacyRecord.Dept,
      designation: legacyRecord.Desgination, // Note: typo in legacy
      branch: legacyRecord.BranchName,
      client_name: legacyRecord.ClientName,
      process: legacyRecord.Process,
      cost_center: legacyRecord.CostCenter,
      bank_account_number: legacyRecord.AcNo,
      bank_name: legacyRecord.AcBank,
      bank_branch: legacyRecord.AcBranch,
      ifsc_code: legacyRecord.IFSCCode,
      account_holder_name: legacyRecord.AccHolder,
      marital_status: legacyRecord.MaritalStatus,
      blood_group: legacyRecord.BloodGruop, // Note: typo in legacy
      qualification: legacyRecord.Qualification,
      address_line1: legacyRecord.Adrress1, // Note: typo in legacy
      address_line2: legacyRecord.Adrress2,
      city: legacyRecord.City,
      state: legacyRecord.State,
      pincode: legacyRecord.PinCode,
      active_status: legacyRecord.Status === '1',
      legacy_last_updated: legacyRecord.lastUpdated,
      legacy_emp_id: legacyRecord.id,
      created_at: legacyRecord.EntryDate || legacyRecord.CreateDate,
    };
  }

  /**
   * Validate transformed record
   */
  validate(record: TransformedEmployee): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!record.employee_code) {
      errors.push('Missing employee_code');
    }

    if (!record.first_name) {
      errors.push('Missing first_name');
    }

    if (!record.mobile && !record.email) {
      errors.push('Missing both mobile and email');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Sync employees to HRMS database
   * Upserts records: INSERT new, UPDATE existing (legacy wins)
   */
  async syncToHRMS(records: TransformedEmployee[]): Promise<{ inserted: number; updated: number; errors: number }> {
    let inserted = 0;
    let updated = 0;
    let errors = 0;

    for (const record of records) {
      const validation = this.validate(record);
      if (!validation.valid) {
        console.error(`[Employee Sync] Validation failed for ${record.employee_code}:`, validation.errors);
        errors++;
        continue;
      }

      try {
        // Upsert: try insert, on duplicate key update
        // For bank/statutory fields, only overwrite if HRMS value is NULL (protect user-updated data)
        const [result] = await mysqlDb.execute<any>(`
          INSERT INTO employees (
            id, employee_code, biometric_code, first_name, last_name, title, gender,
            date_of_birth, date_of_joining, date_of_leaving,
            mobile, email, official_email,
            pan_number, aadhaar_last4, passport_number, epf_number, esic_number, uan,
            department, designation, branch, client_name, process, cost_center,
            bank_account_number, bank_name, bank_branch, ifsc_code, account_holder_name,
            marital_status, blood_group, qualification,
            address_line1, address_line2, city, state, pincode,
            active_status, legacy_last_updated, legacy_emp_id, created_at, updated_at
          ) VALUES (
            UUID(), ?, ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, NOW()
          )
          ON DUPLICATE KEY UPDATE
            biometric_code = VALUES(biometric_code),
            first_name = VALUES(first_name),
            last_name = VALUES(last_name),
            title = VALUES(title),
            gender = VALUES(gender),
            date_of_birth = VALUES(date_of_birth),
            date_of_joining = VALUES(date_of_joining),
            date_of_leaving = VALUES(date_of_leaving),
            mobile = VALUES(mobile),
            email = VALUES(email),
            official_email = VALUES(official_email),
            pan_number = IF(pan_number IS NULL, VALUES(pan_number), pan_number),
            aadhaar_last4 = IF(aadhaar_last4 IS NULL, VALUES(aadhaar_last4), aadhaar_last4),
            passport_number = VALUES(passport_number),
            epf_number = IF(epf_number IS NULL, VALUES(epf_number), epf_number),
            esic_number = IF(esic_number IS NULL, VALUES(esic_number), esic_number),
            uan = IF(uan IS NULL, VALUES(uan), uan),
            department = VALUES(department),
            designation = VALUES(designation),
            branch = VALUES(branch),
            client_name = VALUES(client_name),
            process = VALUES(process),
            cost_center = VALUES(cost_center),
            bank_account_number = IF(bank_account_number IS NULL, VALUES(bank_account_number), bank_account_number),
            bank_name = IF(bank_name IS NULL, VALUES(bank_name), bank_name),
            bank_branch = IF(bank_branch IS NULL, VALUES(bank_branch), bank_branch),
            ifsc_code = IF(ifsc_code IS NULL, VALUES(ifsc_code), ifsc_code),
            account_holder_name = IF(account_holder_name IS NULL, VALUES(account_holder_name), account_holder_name),
            marital_status = VALUES(marital_status),
            blood_group = VALUES(blood_group),
            qualification = VALUES(qualification),
            address_line1 = VALUES(address_line1),
            address_line2 = VALUES(address_line2),
            city = VALUES(city),
            state = VALUES(state),
            pincode = VALUES(pincode),
            active_status = VALUES(active_status),
            legacy_last_updated = VALUES(legacy_last_updated),
            legacy_emp_id = VALUES(legacy_emp_id),
            updated_at = NOW()
        `, [
          record.employee_code, record.biometric_code, record.first_name, record.last_name,
          record.title, record.gender,
          record.date_of_birth, record.date_of_joining, record.date_of_leaving,
          record.mobile, record.email, record.official_email,
          record.pan_number, record.aadhaar_last4, record.passport_number,
          record.epf_number, record.esic_number, record.uan,
          record.department, record.designation, record.branch,
          record.client_name, record.process, record.cost_center,
          record.bank_account_number, record.bank_name, record.bank_branch,
          record.ifsc_code, record.account_holder_name,
          record.marital_status, record.blood_group, record.qualification,
          record.address_line1, record.address_line2, record.city, record.state, record.pincode,
          record.active_status, record.legacy_last_updated, record.legacy_emp_id,
          record.created_at,
        ]);

        // Check if INSERT or UPDATE based on affectedRows and insertId
        if (result.insertId) {
          inserted++;
        } else {
          updated++;
        }
      } catch (error: any) {
        console.error(`[Employee Sync] Failed to sync ${record.employee_code}:`, error.message);
        errors++;
      }
    }

    return { inserted, updated, errors };
  }

  /**
   * Get last sync checkpoint
   */
  async getLastSyncTime(): Promise<Date> {
    const [rows] = await mysqlDb.execute<any[]>(`
      SELECT last_sync_time
      FROM legacy_sync_checkpoint
      WHERE domain = ?
      LIMIT 1
    `, [this.domain]);

    if (rows.length > 0 && rows[0].last_sync_time) {
      return new Date(rows[0].last_sync_time);
    }

    // Default: start from 6 months ago for initial sync
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    return sixMonthsAgo;
  }

  /**
   * Update sync checkpoint
   */
  async updateCheckpoint(lastSyncTime: Date): Promise<void> {
    await mysqlDb.execute(`
      INSERT INTO legacy_sync_checkpoint (domain, last_sync_time, updated_at)
      VALUES (?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        last_sync_time = VALUES(last_sync_time),
        updated_at = NOW()
    `, [this.domain, lastSyncTime]);
  }

  /**
   * Log sync run
   */
  async logSyncRun(status: 'success' | 'failure', recordsProcessed: number, recordsFailed: number, errorMessage?: string): Promise<void> {
    await mysqlDb.execute(`
      INSERT INTO legacy_sync_run_log
        (id, domain, status, records_processed, records_failed, error_message, started_at, completed_at)
      VALUES
        (UUID(), ?, ?, ?, ?, ?, NOW(), NOW())
    `, [this.domain, status, recordsProcessed, recordsFailed, errorMessage || null]);
  }
}

export const employeeSyncHandler = new EmployeeSyncHandler();
