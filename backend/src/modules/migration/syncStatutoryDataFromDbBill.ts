import { PAN_REGEX } from '../ats/bgv-config.js';
import { getBillPool } from '../../db/billDb.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { logSensitiveAction } from '../../shared/auditLog.js';

interface SyncOptions {
  dryRun?: boolean;
  employeeCodeFilter?: string;
  actorUserId?: string;
}

interface SyncResult {
  scanned: number;
  matched: number;
  updated: number;
  skipped: number;
  errors: string[];
  details: Array<{
    employee_code: string;
    fields_updated: string[];
    error?: string;
  }>;
}

interface MasHrmsEmployee extends RowDataPacket {
  id: string;
  employee_code: string;
  uan_number: string | null;
  epf_number: string | null;
  pan_number: string | null;
  esic_number: string | null;
  bank_account_number: string | null;
  bank_name: string | null;
  ifsc_code: string | null;
  account_holder_name: string | null;
}

interface MasjclrEntry extends RowDataPacket {
  EmpCode: string;
  UAN: string | null;
  NewEpfNo: string | null;
  EPFNo: string | null;
  PanNo: string | null;
  ESICNo: string | null;
  AcNo: string | null;
  AcBank: string | null;
  IFSCCode: string | null;
  AccHolder: string | null;
}

function isEmpty(value: string | null | undefined): boolean {
  return value === null || value === undefined || String(value).trim() === '' || value === '0';
}

/**
 * Placeholders that db_bill stores where an identifier is unknown.
 *
 * `isEmpty` above catches the exact string '0' and nothing else, so every other
 * placeholder was copied into `employees` as though it were a real statutory number.
 * Measured against live db_bill.employee_master (35,902 rows): PanNo holds **3,875**
 * such tokens — 'NA' 2,863, 'N/A' 897, 'A' 62, 'AN' 32, 'N' 11, '0' 5 — against only
 * 651 correctly formatted PANs. EPFNo has 113 and ESICNo 115.
 *
 * A placeholder in `pan_number` is worse than a NULL: NULL reads as "we must collect
 * this", while 'NA' reads as collected, passes any presence check, and reaches Form 16
 * and the TDS return, where an unusable PAN means deduction at the higher §206AA rate.
 * mas_hrms already carries four active employees whose PAN is the single character '0',
 * shared between four different people across two branches, with 60-65 payroll lines
 * each. Note '0' with surrounding whitespace also defeats the `value === '0'` check
 * above, since that compares the untrimmed value.
 *
 * Deliberately applied to the SOURCE only. Widening `isEmpty` itself would also change
 * the target test, letting the sync overwrite existing values it currently leaves
 * alone — a much larger behaviour change than declining to import junk.
 */
const PLACEHOLDER_VALUES = new Set([
  '0', '-', '--', '.', ',', 'NA', 'N/A', 'N.A.', 'NAN', 'NIL', 'NONE', 'NOT APPLICABLE',
  'NOTAPPLICABLE', 'NULL', 'X', 'XX', 'XXX', 'XXXX', 'ABC', 'TEST', 'PENDING', 'NOTAVAILABLE',
]);

export function isUsable(value: string | null | undefined): boolean {
  if (isEmpty(value)) return false;
  const normalised = String(value).trim().toUpperCase();

  // Anything one or two characters long is junk for every field this sync writes.
  // db_bill holds 'A' (62 rows), 'N' (11) and 'AN' (32) in PanNo, and no real PAN, UAN,
  // ESIC, EPF, IFSC, account number, bank name or account-holder name in this dataset is
  // that short. Enumerating such fragments as tokens does not scale — the first version
  // of this list missed exactly these three.
  if (normalised.length <= 2) return false;

  return !PLACEHOLDER_VALUES.has(normalised);
}

export async function syncEmployeeStatutoryData(options: SyncOptions): Promise<SyncResult> {
  const { dryRun = false, employeeCodeFilter, actorUserId } = options;

  const result: SyncResult = {
    scanned: 0,
    matched: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    details: [],
  };

  try {
    const billPool = await getBillPool();

    // Fetch all active employees from mas_hrms
    let employeeQuery = 'SELECT id, employee_code, uan_number, epf_number, pan_number, esic_number, bank_account_number, bank_name, ifsc_code, account_holder_name FROM employees WHERE active_status = 1';
    const params: any[] = [];

    if (employeeCodeFilter) {
      employeeQuery += ' AND employee_code = ?';
      params.push(employeeCodeFilter);
    }

    const [employees] = await db.execute<MasHrmsEmployee[]>(employeeQuery, params);
    result.scanned = employees.length;

    for (const employee of employees) {
      try {
        // Query masjclrentry for this employee
        const [legacyRows] = await billPool.execute<MasjclrEntry[]>(
          'SELECT EmpCode, UAN, NewEpfNo, EPFNo, PanNo, ESICNo, AcNo, AcBank, IFSCCode, AccHolder FROM masjclrentry WHERE EmpCode = ? LIMIT 1',
          [employee.employee_code]
        );

        if (!legacyRows.length) {
          continue; // No match in legacy DB
        }

        result.matched++;
        const legacy = legacyRows[0];
        const fieldsToUpdate: string[] = [];
        const updateData: Record<string, string> = {};

        // Check UAN
        if (isEmpty(employee.uan_number) && isUsable(legacy.UAN)) {
          fieldsToUpdate.push('uan_number');
          updateData.uan_number = String(legacy.UAN).trim();
        }

        // Check EPF (prefer NewEpfNo, fallback to EPFNo)
        if (isEmpty(employee.epf_number)) {
          const epfValue = isUsable(legacy.NewEpfNo) ? legacy.NewEpfNo : legacy.EPFNo;
          if (isUsable(epfValue)) {
            fieldsToUpdate.push('epf_number');
            updateData.epf_number = String(epfValue).trim();
          }
        }

        // Check PAN
        //
        // Format-checked, not just placeholder-checked. PAN is the one field here with a
        // government-defined shape (ABCDE1234F), the codebase already has PAN_REGEX, and
        // db_bill holds 3,898 values that fail it against 651 that pass — so a token list
        // alone would still let malformed 8- and 9-character entries through. An unusable
        // PAN is not a cosmetic defect: it drives Form 16 and the TDS return.
        if (isEmpty(employee.pan_number) && isUsable(legacy.PanNo)) {
          const pan = String(legacy.PanNo).trim().toUpperCase();
          if (PAN_REGEX.test(pan)) {
            fieldsToUpdate.push('pan_number');
            updateData.pan_number = pan;
          }
        }

        // Check ESIC
        if (isEmpty(employee.esic_number) && isUsable(legacy.ESICNo)) {
          fieldsToUpdate.push('esic_number');
          updateData.esic_number = String(legacy.ESICNo).trim();
        }

        // Check Bank Account
        if (isEmpty(employee.bank_account_number) && isUsable(legacy.AcNo)) {
          fieldsToUpdate.push('bank_account_number');
          updateData.bank_account_number = String(legacy.AcNo).trim();

          if (isUsable(legacy.AcBank)) {
            fieldsToUpdate.push('bank_name');
            updateData.bank_name = String(legacy.AcBank).trim();
          }
          if (isUsable(legacy.IFSCCode)) {
            fieldsToUpdate.push('ifsc_code');
            updateData.ifsc_code = String(legacy.IFSCCode).trim().toUpperCase();
          }
          if (isUsable(legacy.AccHolder)) {
            fieldsToUpdate.push('account_holder_name');
            updateData.account_holder_name = String(legacy.AccHolder).trim();
          }
        }

        if (fieldsToUpdate.length === 0) {
          result.skipped++;
          continue;
        }

        // Build UPDATE query
        const setClauses = fieldsToUpdate.map(f => `${f} = ?`).join(', ');
        const values = fieldsToUpdate.map(f => updateData[f]);

        if (!dryRun) {
          await db.execute(
            `UPDATE employees SET ${setClauses}, updated_at = NOW() WHERE id = ?`,
            [...values, employee.id]
          );

          // Audit log
          if (actorUserId) {
            await logSensitiveAction({
              actor_user_id: actorUserId,
              action_type: 'EMPLOYEE_STATUTORY_DATA_SYNCED',
              module_key: 'migration',
              entity_type: 'employee',
              entity_id: employee.id,
              employee_id: employee.id,
              change_summary: {
                employee_code: employee.employee_code,
                fields_updated: fieldsToUpdate,
                source: 'db_bill.masjclrentry',
              },
            }).catch(() => {}); // Non-blocking
          }
        }

        result.updated++;
        result.details.push({
          employee_code: employee.employee_code,
          fields_updated: fieldsToUpdate,
        });
      } catch (err: any) {
        const errorMsg = `${employee.employee_code}: ${err.message}`;
        result.errors.push(errorMsg);
        result.details.push({
          employee_code: employee.employee_code,
          fields_updated: [],
          error: err.message,
        });
      }
    }
  } catch (err: any) {
    result.errors.push(`Fatal: ${err.message}`);
  }

  return result;
}
