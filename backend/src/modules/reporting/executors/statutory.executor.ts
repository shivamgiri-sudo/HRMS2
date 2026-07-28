/**
 * Statutory / Compliance executor
 *
 * Covers codes: pf-contribution-register, pf-ecr-format,
 * esic-contribution-register, pt-register, tds-computation-register,
 * form-16-status, investment-declaration-status, gratuity-liability-register
 *
 * UAN, PAN, ESIC numbers are highly_restricted PII — masked when
 * scope.canViewSensitiveFields is false.
 *
 * Every query includes WHERE e.company_id = :companyId to enforce tenant isolation.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  monthParam,
  yearParam, // reserved for year-based filters on future reports
  applyPagination,
} from "./types.js";

// Suppress unused-var lint; yearParam is imported per executor contract and
// available for callers that extend this file.
void yearParam;

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

/**
 * Returns the current Indian financial year as a string, e.g. "2024-25".
 * Jan–Mar → previous calendar year start; Apr–Dec → current calendar year start.
 */
function currentFinancialYear(): string {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-indexed
  const year = now.getFullYear();
  if (month <= 3) {
    return `${year - 1}-${String(year).slice(-2)}`;
  }
  return `${year}-${String(year + 1).slice(-2)}`;
}

// ---------------------------------------------------------------------------
// pf-contribution-register
// ---------------------------------------------------------------------------
export async function pfContributionRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const runMonth = monthParam(filters.month);
  const uanCol = scope.canViewSensitiveFields
    ? "e.uan_number"
    : "'***MASKED***' AS uan_number";

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[] = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("spr.run_month = ?", "COALESCE(e.pf_applicable, 1) = 1");
  params.push(runMonth);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("spl.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT spl.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           ${uanCol},
           b.branch_name, p.process_name,
           spr.run_month,
           COALESCE(spl.pf_employee, 0) AS pf_employee,
           COALESCE(spl.pf_employer, 0) AS pf_employer,
           COALESCE(spl.pf_employee, 0) + COALESCE(spl.pf_employer, 0) AS total_pf,
           e.pf_number,
           COALESCE(spl.basic_pay, 0) AS pf_wage
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY spl.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number)
    : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// pf-ecr-format
// ---------------------------------------------------------------------------
export async function pfEcrFormat(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const runMonth = monthParam(filters.month);
  const uanCol = scope.canViewSensitiveFields
    ? "e.uan_number"
    : "'***MASKED***' AS uan_number";

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[] = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("spr.run_month = ?", "COALESCE(e.pf_applicable, 1) = 1");
  params.push(runMonth);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("spl.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT spl.id AS _cursor,
           e.employee_code,
           ${uanCol},
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS member_name,
           COALESCE(spl.pf_wage, spl.basic_pay, 0) AS pf_wages,
           COALESCE(spl.pf_employee, 0) AS epf_employee,
           COALESCE(spl.pf_employer, 0) AS eps_employer,
           spr.run_month
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY spl.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number)
    : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// esic-contribution-register
// ---------------------------------------------------------------------------
export async function esicContributionRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const runMonth = monthParam(filters.month);
  const esicCol = scope.canViewSensitiveFields
    ? "e.esic_number"
    : "'***MASKED***' AS esic_number";

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[] = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("spr.run_month = ?", "COALESCE(e.esic_applicable, 1) = 1");
  params.push(runMonth);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("spl.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT spl.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           ${esicCol},
           b.branch_name, p.process_name,
           spr.run_month,
           COALESCE(spl.esic_wage, spl.gross_salary, 0) AS esic_wages,
           COALESCE(spl.esic_employee, 0) AS esic_employee,
           COALESCE(spl.esic_employer, 0) AS esic_employer,
           COALESCE(spl.esic_employee, 0) + COALESCE(spl.esic_employer, 0) AS total_esic
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY spl.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number)
    : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// pt-register
// ---------------------------------------------------------------------------
export async function ptRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const runMonth = monthParam(filters.month);

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[] = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("spr.run_month = ?", "COALESCE(spl.professional_tax, 0) > 0");
  params.push(runMonth);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("spl.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT spl.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           b.branch_name, p.process_name,
           spr.run_month,
           COALESCE(spl.professional_tax, 0) AS pt_amount,
           COALESCE(spl.gross_salary, 0) AS gross_salary,
           e.pt_state
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY spl.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number)
    : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// tds-computation-register
// ---------------------------------------------------------------------------
export async function tdsComputationRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const runMonth = monthParam(filters.month);
  const panCol = scope.canViewSensitiveFields
    ? "e.pan_number"
    : "'***MASKED***' AS pan_number";

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[] = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("spr.run_month = ?");
  params.push(runMonth);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("spl.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT spl.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           b.branch_name, p.process_name,
           spr.run_month,
           ${panCol},
           COALESCE(spl.projected_annual_income, 0) AS projected_annual_income,
           COALESCE(spl.tds_exemptions, 0) AS exemptions,
           COALESCE(spl.taxable_income, 0) AS taxable_income,
           COALESCE(spl.tds, 0) AS monthly_tds,
           COALESCE(spl.annual_tax_liability, 0) AS annual_tax_liability
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY spl.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number)
    : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// form-16-status
// Tries form_16_record table; falls back to a simulation query over employees
// when the table does not yet exist (ER_NO_SUCH_TABLE).
// ---------------------------------------------------------------------------
export async function form16Status(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const fy = (typeof filters.financialYear === "string" && filters.financialYear)
    ? filters.financialYear
    : currentFinancialYear();
  const panCol = scope.canViewSensitiveFields
    ? "e.pan_number"
    : "'***MASKED***' AS pan_number";

  // Build base scope/filter conditions (may throw ReportScopeAccessDeniedError — intentional)
  const baseClauses: string[] = ["e.company_id = ?"];
  const baseParams: unknown[] = [scope.companyId];
  appendScopeConditions(scope, baseClauses, baseParams);
  appendFilterConditions(filters, baseClauses, baseParams);
  baseClauses.push("e.active_status = 1");

  // --- Primary path: form_16_record table ---
  const f16Clauses = [...baseClauses, "f16.financial_year = ?"];
  const f16Params: unknown[] = [...baseParams, fy];
  if (options.mode === "worker" && options.cursor != null) {
    f16Clauses.push("f16.id > ?");
    f16Params.push(options.cursor);
  }

  const f16Base = `
    SELECT f16.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           ${panCol},
           b.branch_name,
           f16.financial_year,
           COALESCE(f16.status, 'NOT_GENERATED') AS form16_status,
           f16.generated_at AS generated_date
      FROM form_16_record f16
      JOIN employees e ON e.id = f16.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${f16Clauses.join(" AND ")}
     ORDER BY f16.id ASC`;

  try {
    const total = options.includeTotal ? await count(f16Base, f16Params) : 0;
    const sql = options.mode === "worker" ? `${f16Base} LIMIT ${options.limit}` : applyPagination(f16Base, options);
    const rows = await query(sql, f16Params) as Record<string, unknown>[];
    const nextCursor = (options.mode === "worker" && rows.length > 0)
      ? (rows[rows.length - 1]._cursor as number)
      : null;
    const out = rows.map(({ _cursor: _, ...rest }) => rest);
    return {
      rows: out,
      rowCount: options.includeTotal ? total : rows.length,
      isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
      nextCursor,
    };
  } catch (err: unknown) {
    // Only swallow missing-table errors; re-throw everything else
    const mysqlCode = (err as Record<string, unknown>)?.["code"];
    if (mysqlCode !== "ER_NO_SUCH_TABLE" && mysqlCode !== "ER_BAD_TABLE_ERROR") throw err;
  }

  // --- Fallback: simulate from employees ---
  const simClauses = [...baseClauses];
  const whereParams: unknown[] = [...baseParams];
  if (options.mode === "worker" && options.cursor != null) {
    simClauses.push("e.id > ?");
    whereParams.push(options.cursor);
  }

  // ? AS financial_year is the first positional param in the SELECT clause
  const simBase = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           ${panCol},
           b.branch_name,
           ? AS financial_year,
           'NOT_GENERATED' AS form16_status,
           NULL AS generated_date
      FROM employees e
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${simClauses.join(" AND ")}
     ORDER BY e.id ASC`;

  const simParams = [fy, ...whereParams];
  const total = options.includeTotal ? await count(simBase, simParams) : 0;
  const sql = options.mode === "worker" ? `${simBase} LIMIT ${options.limit}` : applyPagination(simBase, options);
  const rows = await query(sql, simParams) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number)
    : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// investment-declaration-status
// Returns empty result set when investment_declaration table does not exist.
// ---------------------------------------------------------------------------
export async function investmentDeclarationStatus(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const fy = (typeof filters.financialYear === "string" && filters.financialYear)
    ? filters.financialYear
    : currentFinancialYear();

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[] = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("id_decl.financial_year = ?");
  params.push(fy);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("id_decl.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT id_decl.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           b.branch_name, p.process_name,
           id_decl.financial_year,
           id_decl.declaration_status,
           id_decl.submitted_at,
           id_decl.total_declared_amount,
           id_decl.verified_amount
      FROM investment_declaration id_decl
      JOIN employees e ON e.id = id_decl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY id_decl.id ASC`;

  try {
    const total = options.includeTotal ? await count(base, params) : 0;
    const sql = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
    const rows = await query(sql, params) as Record<string, unknown>[];
    const nextCursor = (options.mode === "worker" && rows.length > 0)
      ? (rows[rows.length - 1]._cursor as number)
      : null;
    const out = rows.map(({ _cursor: _, ...rest }) => rest);
    return {
      rows: out,
      rowCount: options.includeTotal ? total : rows.length,
      isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
      nextCursor,
    };
  } catch (err: unknown) {
    const mysqlCode = (err as Record<string, unknown>)?.["code"];
    if (mysqlCode !== "ER_NO_SUCH_TABLE" && mysqlCode !== "ER_BAD_TABLE_ERROR") throw err;
    return { rows: [], rowCount: 0, isTruncated: false, nextCursor: null };
  }
}

// ---------------------------------------------------------------------------
// gratuity-liability-register
// Includes employees with >= 4 years service (approaching or eligible for
// the statutory 5-year threshold). Formula: basic * years * 15 / 26.
// ---------------------------------------------------------------------------
export async function gratuityLiabilityRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[] = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push(
    "e.active_status = 1",
    "TIMESTAMPDIFF(YEAR, e.date_of_joining, CURDATE()) >= 4"
  );

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           b.branch_name, p.process_name,
           e.date_of_joining,
           TIMESTAMPDIFF(YEAR, e.date_of_joining, CURDATE()) AS years_of_service,
           COALESCE(e.last_drawn_basic, 0) AS last_drawn_basic,
           ROUND(
             COALESCE(e.last_drawn_basic, 0)
             * TIMESTAMPDIFF(YEAR, e.date_of_joining, CURDATE())
             * 15 / 26,
           2) AS gratuity_liability
      FROM employees e
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number)
    : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}
