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
        if (isEmpty(employee.uan_number) && !isEmpty(legacy.UAN)) {
          fieldsToUpdate.push('uan_number');
          updateData.uan_number = String(legacy.UAN).trim();
        }

        // Check EPF (prefer NewEpfNo, fallback to EPFNo)
        if (isEmpty(employee.epf_number)) {
          const epfValue = !isEmpty(legacy.NewEpfNo) ? legacy.NewEpfNo : legacy.EPFNo;
          if (!isEmpty(epfValue)) {
            fieldsToUpdate.push('epf_number');
            updateData.epf_number = String(epfValue).trim();
          }
        }

        // Check PAN
        if (isEmpty(employee.pan_number) && !isEmpty(legacy.PanNo)) {
          fieldsToUpdate.push('pan_number');
          updateData.pan_number = String(legacy.PanNo).trim().toUpperCase();
        }

        // Check ESIC
        if (isEmpty(employee.esic_number) && !isEmpty(legacy.ESICNo)) {
          fieldsToUpdate.push('esic_number');
          updateData.esic_number = String(legacy.ESICNo).trim();
        }

        // Check Bank Account
        if (isEmpty(employee.bank_account_number) && !isEmpty(legacy.AcNo)) {
          fieldsToUpdate.push('bank_account_number');
          updateData.bank_account_number = String(legacy.AcNo).trim();

          if (!isEmpty(legacy.AcBank)) {
            fieldsToUpdate.push('bank_name');
            updateData.bank_name = String(legacy.AcBank).trim();
          }
          if (!isEmpty(legacy.IFSCCode)) {
            fieldsToUpdate.push('ifsc_code');
            updateData.ifsc_code = String(legacy.IFSCCode).trim().toUpperCase();
          }
          if (!isEmpty(legacy.AccHolder)) {
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
