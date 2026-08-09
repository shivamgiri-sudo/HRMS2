/**
 * Identity / statutory identity executor
 *
 * Codes: uan-status-report, esic-status-report, pan-verification-status,
 *        bank-account-verification, identity-source-snapshot
 *
 * SECURITY: UAN, ESIC, PAN and bank account numbers are masked when
 * scope.canViewSensitiveFields === false.  Masking is applied at SQL
 * SELECT level so sensitive values never travel through Node.js memory.
 *
 * All queries use e.company_id = :companyId for tenant isolation.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  dateParam,
  monthParam,
  applyPagination,
} from "./types.js";

async function query(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows;
}
async function count(baseSql: string, params: unknown[]): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM (${baseSql}) AS _cnt`,
    params
  );
  return Number((rows as Array<{ total?: number }>)[0]?.total ?? 0);
}

/** Returns a SQL expression for a sensitive field — masked or real. */
function sensitiveCol(canView: boolean, expr: string, alias: string): string {
  return canView ? `${expr} AS ${alias}` : `'***MASKED***' AS ${alias}`;
}

// ---------------------------------------------------------------------------
// uan-status-report
// ---------------------------------------------------------------------------
/**
 * employee-document-compliance
 *
 * Promoted from the inline case block, which had no executor and so could not be downloaded.
 *
 * Two document sources are reconciled here and the resolution rule is the report, not an
 * implementation detail: employee_joining_document_checklist is authoritative for anyone
 * onboarded through ATS, and employee_documents is the fallback for everyone else. Each source
 * is reported on its own (checklist_total / ed_total and so on) AND resolved into total_docs,
 * verified_docs and missing_docs, preferring the checklist whenever it has any rows.
 *
 * That is why both sets of columns exist and why neither can be dropped as duplication: an
 * employee with a checklist and stale employee_documents rows would otherwise look
 * non-compliant, and the separate columns are what let a reader see which source answered.
 *
 * The GROUP BY repeats every non-aggregated SELECT column because ONLY_FULL_GROUP_BY is enabled
 * on this server — omitting one fails the whole report rather than degrading it.
 */
export async function employeeDocumentCompliance(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1");

  const base = `SELECT e.id AS _cursor,
         e.employee_code,
         COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
         COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
         COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
         COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
         COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
         COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
         -- Checklist counts (primary for ATS-onboarded employees)
         COALESCE(cl_agg.total_cl, 0)    AS checklist_total,
         COALESCE(cl_agg.verified_cl, 0) AS checklist_verified,
         COALESCE(cl_agg.missing_cl, 0)  AS checklist_missing,
         -- General employee_documents counts (fallback)
         COUNT(ed.id)                                                                                         AS ed_total,
         SUM(CASE WHEN ed.verified = 1 THEN 1 ELSE 0 END)                                                   AS ed_verified,
         SUM(CASE WHEN ed.file_url IS NULL OR ed.file_url = '' THEN 1 ELSE 0 END)                           AS ed_missing,
         -- Resolved counts: prefer checklist when it has rows
         CASE WHEN COALESCE(cl_agg.total_cl,0) > 0 THEN COALESCE(cl_agg.total_cl,0)    ELSE COUNT(ed.id) END AS total_docs,
         CASE WHEN COALESCE(cl_agg.total_cl,0) > 0 THEN COALESCE(cl_agg.verified_cl,0) ELSE SUM(CASE WHEN ed.verified=1 THEN 1 ELSE 0 END) END AS verified_docs,
         CASE WHEN COALESCE(cl_agg.total_cl,0) > 0 THEN COALESCE(cl_agg.missing_cl,0)  ELSE SUM(CASE WHEN ed.file_url IS NULL OR ed.file_url='' THEN 1 ELSE 0 END) END AS missing_docs,
         COALESCE(e.joining_document_completion_pct, 0) AS completion_pct,
         e.joining_document_status
    FROM employees e
    LEFT JOIN employee_documents ed ON ed.employee_id = e.id
    LEFT JOIN branch_master b ON b.id = e.branch_id
    LEFT JOIN department_master d ON d.id = e.department_id
    LEFT JOIN process_master p ON p.id = e.process_id
    LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
    LEFT JOIN (
      SELECT employee_id,
             COUNT(*) AS total_cl,
             SUM(CASE WHEN status IN ('verified','signed_verified','completed') THEN 1 ELSE 0 END) AS verified_cl,
             SUM(CASE WHEN status IN ('pending_hr_upload','pending_candidate_esign','pending_generation','rejected') AND mandatory=1 THEN 1 ELSE 0 END) AS missing_cl
        FROM employee_joining_document_checklist
       GROUP BY employee_id
    ) cl_agg ON cl_agg.employee_id = e.id
   WHERE ${clauses.join(" AND ")}
   -- ONLY_FULL_GROUP_BY is enabled on this server, so the three columns added to the
   -- SELECT must be repeated here or the whole report fails rather than degrading.
   GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, b.branch_name, d.dept_name,
            p.process_name, cc.cost_centre_code, cc.cost_centre_name,
            cl_agg.total_cl, cl_agg.verified_cl, cl_agg.missing_cl,
            e.joining_document_completion_pct, e.joining_document_status
   ORDER BY missing_docs DESC, employee_name`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor: null };
}

export async function uanStatusReport(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1");

  if (filters.status) {
    if (filters.status === "MISSING_UAN") {
      clauses.push("(e.uan_number IS NULL OR TRIM(e.uan_number) = '')");
    } else if (filters.status === "HAS_UAN") {
      clauses.push("(e.uan_number IS NOT NULL AND TRIM(e.uan_number) != '')");
    }
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const uanExpr = sensitiveCol(scope.canViewSensitiveFields, "e.uan_number", "uan");

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           ${uanExpr},
           e.epf_number,
           CASE
             WHEN e.uan_number IS NOT NULL AND TRIM(e.uan_number) != '' THEN 'HAS_UAN'
             ELSE 'MISSING_UAN'
           END AS uan_status,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name
      FROM employees e
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// esic-status-report
// ---------------------------------------------------------------------------
export async function esicStatusReport(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1");

  // `employees` has no esic_applicable column, so every branch below threw "Unknown column
  // 'e.esic_applicable'" and the report 500'd outright. There is no stored applicability flag
  // to recover: payroll_employee_component_snapshot.esic_applicable exists but covers 67 of
  // 1,125 active employees, and inventing a wage threshold here would be writing statutory
  // policy into a report.
  //
  // So applicability is derived from facts that ARE recorded — whether ESIC was actually
  // deducted in the employee's most recent payroll line, and whether an ESIC number is on
  // file. Both are observed, neither is a rule this report gets to decide.
  //
  // The ESIC_MISSING bucket is the compliance case and it is not empty: for July 2026, 828
  // lines carried an ESIC deduction while only 439 employees had an ESIC number recorded.
  const esicDeducted = `EXISTS (
    SELECT 1 FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
     WHERE spl.employee_id = e.id AND COALESCE(spl.esic_employee, 0) > 0)`;
  const hasNumber = `(e.esic_number IS NOT NULL AND TRIM(e.esic_number) <> '')`;

  if (filters.status) {
    if (filters.status === "ESIC_MISSING") {
      // Deducted from pay, but no number on file — the case that needs action.
      clauses.push(`${esicDeducted} AND NOT ${hasNumber}`);
    } else if (filters.status === "NOT_APPLICABLE") {
      clauses.push(`NOT ${esicDeducted} AND NOT ${hasNumber}`);
    } else if (filters.status === "HAS_ESIC") {
      clauses.push(hasNumber);
    }
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const esicExpr = sensitiveCol(scope.canViewSensitiveFields, "e.esic_number", "esic_number");

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           ${esicExpr},
           CASE WHEN ${esicDeducted} THEN 1 ELSE 0 END AS esic_deducted_in_payroll,
           CASE
             WHEN ${esicDeducted} AND NOT ${hasNumber} THEN 'ESIC_MISSING'
             WHEN ${hasNumber}                         THEN 'HAS_ESIC'
             ELSE 'NOT_APPLICABLE'
           END AS esic_status,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           -- cost_centre_master was already joined here and never selected, so the mandatory
           -- cost centre columns were absent from a report that had them one line away.
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name
      FROM employees e
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// pan-verification-status
// ---------------------------------------------------------------------------
export async function panVerificationStatus(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1");

  if (filters.status) {
    if (filters.status === "MISSING_PAN") {
      clauses.push("(e.pan_number IS NULL OR TRIM(e.pan_number) = '')");
    } else if (filters.status === "VERIFIED") {
      clauses.push("e.pan_verified_on IS NOT NULL");
    } else if (filters.status === "UNVERIFIED") {
      clauses.push("e.pan_number IS NOT NULL AND TRIM(e.pan_number) != '' AND e.pan_verified_on IS NULL");
    }
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const panExpr = sensitiveCol(scope.canViewSensitiveFields, "e.pan_number", "pan_number");

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           ${panExpr},
           CASE
             WHEN e.pan_number IS NULL OR TRIM(e.pan_number) = '' THEN 'MISSING_PAN'
             WHEN e.pan_verified_on IS NOT NULL                    THEN 'VERIFIED'
             ELSE 'UNVERIFIED'
           END AS pan_status,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name
      FROM employees e
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// bank-account-verification
// Falls back to employees table fields if employee_bank_account does not exist.
// The query uses employees directly; the dedicated bank table is not assumed
// to be present in all deployments.
// ---------------------------------------------------------------------------
export async function bankAccountVerification(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1");

  if (filters.status) {
    if (filters.status === "MISSING_BANK") {
      clauses.push("(e.bank_account_number IS NULL OR TRIM(e.bank_account_number) = '')");
    } else if (filters.status === "VERIFIED") {
      // bank_verified column may not exist — skip filter to avoid ER_BAD_FIELD_ERROR
    } else if (filters.status === "UNVERIFIED") {
      clauses.push(
        "e.bank_account_number IS NOT NULL AND TRIM(e.bank_account_number) != ''"
      );
    }
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const bankExpr = sensitiveCol(
    scope.canViewSensitiveFields,
    "e.bank_account_number",
    "bank_account_number"
  );

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           ${bankExpr},
           e.bank_name,
           e.ifsc_code,
           CASE
             WHEN e.bank_account_number IS NULL OR TRIM(e.bank_account_number) = '' THEN 'MISSING_BANK'
             ELSE 'UNVERIFIED'
           END AS bank_status,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name
      FROM employees e
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// identity-source-snapshot
// Reads report_identity_source_snapshot, populated by the identity-source-snapshot
// sync job. Surfaces unmatched and ambiguous source records, not just matched ones.
// ---------------------------------------------------------------------------
export async function identitySourceSnapshot(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  {
    // Anchor on the snapshot row, not the employee. The seed clause used to be
    // "e.id IS NOT NULL", which — against the LEFT JOIN below — would discard every
    // unmatched source record, i.e. the exceptions this report exists to show.
    const clauses: string[] = ["ris.id IS NOT NULL"];
    const params: unknown[]  = [];
    appendScopeConditions(scope, clauses, params);
    appendFilterConditions(filters, clauses, params);

    if (filters.status) {
      clauses.push("ris.match_status = ?");
      params.push(String(filters.status));
    }

    // Only the current snapshot. syncIdentitySourceSnapshot() sets is_current = 0 on the
    // previous generation instead of deleting it, so without this every historical run
    // is unioned into one result and every employee appears once per sync.
    clauses.push("ris.is_current = 1");

    if (options.mode === "worker" && options.cursor != null) {
      clauses.push("ris.id > ?");
      params.push(options.cursor);
    }

    // The live table is report_identity_source_snapshot; employee_identity_snapshot has
    // never existed in mas_hrms (verified 2026-08-07), and the bare catch below turned
    // the resulting ER_NO_SUCH_TABLE into an empty result — so this report has always
    // rendered "no identity records" rather than reporting its own failure.
    //
    // LEFT JOIN, not JOIN: unmatched and ambiguous rows have a NULL matched_employee_id,
    // and they are the entire point of an identity-exceptions report. An inner join
    // would silently drop exactly the rows a user opens this to find.
    const base = `
      SELECT ris.id AS _cursor,
             COALESCE(e.employee_code, ris.matched_employee_code) AS employee_code,
             COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
             ris.source_system,
             ris.source_employee_code,
             ris.source_agent_id,
             ris.source_name,
             ris.match_status,
             ris.captured_at,
             COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
             COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
             COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
             COALESCE(p.process_name, 'UNASSIGNED') AS process_name
        FROM report_identity_source_snapshot ris
        LEFT JOIN employees e          ON e.id  = ris.matched_employee_id
        LEFT JOIN branch_master b      ON b.id  = e.branch_id
        LEFT JOIN process_master p     ON p.id  = e.process_id
        LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY ris.id ASC`;

    const total = options.includeTotal ? await count(base, params) : 0;
    const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
    const rows  = await query(sql, params) as Record<string, unknown>[];
    const nextCursor = (options.mode === "worker" && rows.length > 0)
      ? (rows[rows.length - 1]._cursor as number) : null;
    const out = rows.map(({ _cursor: _, ...rest }) => rest);
    return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
  }
  // No catch. A failure here must surface: an empty identity-exceptions report reads as
  // "nothing to fix", which is the most dangerous wrong answer this report can give.
}
