/**
 * Employee Master snapshot refresher.
 *
 * Computes the full 73-column employee-master row set (via employeeMasterLive() — the full
 * computation, never the snapshot-reading fast path, or this would be circular) and writes it
 * into employee_master_snapshot (migration 1615), so the report can read a plain table instead
 * of re-running two cross-database fallback fetches plus a dozen mas_hrms joins on every
 * request.
 *
 * Called on a schedule by cron/employee-master-snapshot.cron.ts. Also exported for a manual
 * "refresh now" trigger if one is added later.
 */
import { db } from "../../db/mysql.js";
import { employeeMasterLive } from "./executors/employee.executor.js";
import type { ExecScope, ExecOptions } from "./executors/types.js";

// The 73 columns this table mirrors from report-catalog.ts's "employee-master" entry, in the
// same order the INSERT below lists them. employee_code is the key and is never null (the
// executor's WHERE clause never emits a row without one).
const SNAPSHOT_COLUMNS = [
  "employee_code", "biometric_code", "employment_type", "employee_name", "father_husband_name",
  "father_husband_relation", "gender", "nominee_name", "nominee_relation", "nominee_dob",
  "date_of_birth", "date_of_joining", "designation_name", "billable_status", "department_name",
  "emp_for", "profile_type", "branch_name", "cost_centre_name", "qualification",
  "qualification_details", "passed_out_year", "passed_out_state", "passed_out_city",
  "passed_out_percentage", "working_experience", "experience_years", "marital_status",
  "family_annual_income", "count_of_dependents", "reporting_manager", "reporting_manager_mobile",
  "blood_group", "permanent_address_line1", "permanent_city", "permanent_state",
  "permanent_pincode", "current_address_line1", "current_city", "current_state",
  "current_pincode", "contact_number", "permanent_landline", "temporary_mobile",
  "temporary_landline", "email", "document_done", "gross", "ctc_offered", "net_in_hand",
  "bank_account_number", "ifsc_code", "bank_name", "bank_branch", "passport_no", "dl_no",
  "uan_number", "epf_number", "pf_eligible", "esi_number", "esi_eligible", "entry_date",
  "status", "date_of_leaving", "left_remarks", "source_type", "source", "box_file_no",
  "aadhaar_number", "pan_number", "work_status", "manual_update_by", "manual_update_date",
] as const;

const FULL_ORG_SCOPE: ExecScope = {
  companyId: "1",
  isSuperAdmin: true,
  branchScope: { mode: "all", ids: [] },
  processScope: { mode: "all", ids: [] },
  departmentScope: { mode: "all", ids: [] },
  costCentreScope: { mode: "all", ids: [] },
  canViewAllEmployees: true,
  canViewSensitiveFields: true,
  canExportSensitiveReports: true,
  roles: ["super_admin"],
};

export interface SnapshotRefreshResult {
  rowsFetched: number;
  rowsWritten: number;
  durationMs: number;
}

/**
 * Deletes and reloads employee_master_snapshot from scratch. Simpler and safer than a
 * per-row upsert-and-diff for a half-hourly batch job over ~59k rows that has no external
 * foreign-key references pointing at it (it's a read-only cache table) — a partial failure
 * mid-run is caught by the transaction and leaves the previous snapshot untouched rather than
 * a half-updated table.
 *
 * DELETE, not TRUNCATE: TRUNCATE is DDL and implicitly commits in MySQL/InnoDB, which would
 * silently end the transaction right here — any later failure would then only roll back the
 * INSERT batches, leaving the table's prior contents already gone. (Caught this exact failure
 * mode during first deployment: a batch INSERT hit ER_DATA_TOO_LONG partway through, the
 * "rollback" that followed did nothing because TRUNCATE had already committed, and 15,000
 * partial rows were left in the table.) DELETE FROM is a normal DML statement and rolls back
 * correctly with everything else in this transaction.
 */
export async function refreshEmployeeMasterSnapshot(): Promise<SnapshotRefreshResult> {
  const start = Date.now();

  const options: ExecOptions = {
    limit: 100_000,
    offset: 0,
    cursor: null,
    includeTotal: true,
    mode: "export",
  };

  const result = await employeeMasterLive({}, FULL_ORG_SCOPE, options);
  const rows = result.rows as Record<string, unknown>[];

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM employee_master_snapshot");

    const placeholders = `(${SNAPSHOT_COLUMNS.map(() => "?").join(", ")})`;
    const insertSql =
      `INSERT INTO employee_master_snapshot (${SNAPSHOT_COLUMNS.join(", ")}) VALUES `;

    // Batch in chunks of 500 rows per statement — comfortably under MySQL's default
    // max_allowed_packet for 73 mostly-short text columns, while still avoiding 59k
    // individual round-trips.
    const BATCH_SIZE = 500;
    let written = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE).filter((r) => r.employee_code);
      if (batch.length === 0) continue;

      const values: unknown[] = [];
      const rowPlaceholders: string[] = [];
      for (const row of batch) {
        rowPlaceholders.push(placeholders);
        for (const col of SNAPSHOT_COLUMNS) {
          const v = row[col];
          values.push(v === undefined ? null : v);
        }
      }

      await conn.query(insertSql + rowPlaceholders.join(", "), values);
      written += batch.length;
    }

    await conn.commit();
    return { rowsFetched: rows.length, rowsWritten: written, durationMs: Date.now() - start };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
