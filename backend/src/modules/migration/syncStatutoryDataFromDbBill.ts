import { PAN_REGEX } from '../ats/bgv-config.js';
import { getBillPool } from '../../db/billDb.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { logSensitiveAction } from '../../shared/auditLog.js';
import { encryptPanForSync, blindIndexPan } from '../../shared/syncPiiEncryption.js';

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
  full_name: string | null;
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
  EmpName: string | null;
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
 * Measured against the table this sync actually reads — db_bill.masjclrentry, 33,144
 * rows, matched on EmpCode. Of 19,248 non-blank PanNo values only **15,323** are a
 * valid PAN; the guard blocks **3,925**, almost all of them 'NA' (2,477) and 'N/A'
 * (907), with 'AN' 32, 'NO' 24, 'N' 8, '-' 8. UAN and EPFNo are clean in this table;
 * ESICNo loses 4, AcNo 5, IFSCCode 8.
 *
 * (An earlier version of this comment quoted db_bill.employee_master. That table has
 * far worse data — 651 valid PANs in 35,902 rows — but nothing reads it, so its
 * numbers say nothing about this sync.)
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
  // masjclrentry holds 'AN' (32 rows), 'NO' (24), 'N' (8) and 'NS' (2) in PanNo, and no
  // real PAN, UAN, ESIC, EPF, IFSC, account number, bank name or account-holder name in
  // this dataset is that short. Enumerating such fragments as tokens does not scale —
  // the first version of this list missed exactly these.
  if (normalised.length <= 2) return false;

  return !PLACEHOLDER_VALUES.has(normalised);
}

/**
 * Do these two names plausibly describe the same person?
 *
 * Deliberately generous, because the two systems spell people differently — initials,
 * dropped middle names, "MOHAMMED" vs "MOHD", trailing spaces, honorifics. Requiring an
 * exact match would refuse legitimate rows: of 691 EmpCode matches, 669 agree exactly
 * but 12 only partially, and those 12 are the same people written two ways.
 *
 * One shared word of 3+ characters is enough. That is a low bar on purpose — this is a
 * corroboration check on an identifier that is already supposed to be unique, not an
 * identity resolver. It separates "SOFIYA SULTAN vs NAYANDEEP KAUR" from
 * "NAGORI MOHAMMED SAMIR MOHAMMED vs NAGORI MOHAMMED SAMIR", which is all it needs to do.
 *
 * A blank name on either side fails closed: unverifiable is not the same as verified.
 */
export function namesCorroborate(a: string | null | undefined, b: string | null | undefined): boolean {
  const clean = (value: string | null | undefined) =>
    String(value ?? '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();

  const left = clean(a);
  const right = clean(b);
  if (!left || !right) return false;
  if (left === right) return true;

  const words = (value: string) => new Set(value.split(' ').filter((w) => w.length > 2));
  const rightWords = words(right);
  for (const word of words(left)) {
    if (rightWords.has(word)) return true;
  }
  return false;
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
    let employeeQuery = 'SELECT id, employee_code, full_name, uan_number, epf_number, pan_number, esic_number, bank_account_number, bank_name, ifsc_code, account_holder_name FROM employees WHERE active_status = 1';
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
          'SELECT EmpCode, EmpName, UAN, NewEpfNo, EPFNo, PanNo, ESICNo, AcNo, AcBank, IFSCCode, AccHolder FROM masjclrentry WHERE EmpCode = ? LIMIT 1',
          [employee.employee_code]
        );

        if (!legacyRows.length) {
          continue; // No match in legacy DB
        }

        const legacy = legacyRows[0];

        // EmpCode alone does not identify a person. Corroborate with the name.
        //
        // Employee codes have been reused. Measured across the 756 active employees this
        // sync would consider: 691 match an EmpCode in masjclrentry, 669 of those names
        // agree exactly and 12 partially — but **10 name a completely different human**.
        // MAS62921 is SHEELU GARG here and KRISHNA there; MAS63086 is SOFIYA SULTAN here
        // and NAYANDEEP KAUR there. Both are real employees, not fixtures.
        //
        // Without this check the sync writes that stranger's UAN, EPF, ESIC, PAN — and
        // `bank_account_number`, which is where salary is paid. A wrong PAN misfiles a
        // tax return; a wrong account number pays the wrong person. Neither announces
        // itself, because every value written is individually well-formed.
        //
        // Counted as skipped rather than matched, and surfaced in errors, because an
        // identity mismatch is a finding someone should look at, not a silent no-op.
        if (!namesCorroborate(employee.full_name, legacy.EmpName)) {
          result.skipped++;
          result.errors.push(
            `${employee.employee_code}: name mismatch — mas_hrms "${employee.full_name ?? ''}" vs db_bill "${legacy.EmpName ?? ''}"; skipped, EmpCode appears to be reused`,
          );
          continue;
        }

        result.matched++;
        const fieldsToUpdate: string[] = [];
        // Widened from Record<string, string> when the PAN ciphertext columns were added:
        // encryptPanForSync/blindIndexPan return null under a dev key (a deliberate refusal,
        // not an error) and pan_enc_key_version is numeric. The only consumer is the params
        // array built below, and mysql2 binds string, number and null alike.
        const updateData: Record<string, string | number | null> = {};

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

            // employees is the ONE table whose PAN ciphertext is fully backfilled —
            // 23,341 rows, every one key version 1 (measured live 2026-08-11). A writer
            // that fills only the plaintext column therefore degrades that coverage on
            // every run. Same dual-write the two legacy sync handlers do; this route was
            // missed because it lives in the migration module rather than in workers/.
            //
            // All three columns are derived from `pan`, the same normalised value that is
            // stored as plaintext, so a row written here lands in the same blind-index
            // space as the same row written by
            // scripts/statutory-identifier-encrypt-backfill.ts.
            //
            // The helpers return null under a dev key rather than writing ciphertext
            // production could never decrypt; the plaintext write still lands, so the
            // degradation is safe. The plaintext write stays regardless — the
            // duplicate-employee guard still reads e.pan_number by equality.
            fieldsToUpdate.push('pan_number_encrypted');
            updateData.pan_number_encrypted = encryptPanForSync(pan, 'statutory-migration');

            fieldsToUpdate.push('pan_blind_index');
            updateData.pan_blind_index = blindIndexPan(pan, 'statutory-migration');

            // Pinned to the version encryptPanForSync writes, so the row stays
            // self-consistent rather than relying on the column default.
            fieldsToUpdate.push('pan_enc_key_version');
            updateData.pan_enc_key_version = 1;
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
