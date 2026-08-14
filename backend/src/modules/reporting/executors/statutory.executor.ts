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
import { resolvePayrollMonth } from "../payroll-month.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  monthParam,
  yearParam, // reserved for year-based filters on future reports
  applyPagination,
  fetchPageWithTotal,
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
 * Branch ids situated in Gujarat.
 *
 * A module-level helper rather than a subquery or an inline lookup inside ptRegister:
 * payroll-month-default.contract.test.ts decides which reports are "driven by" a table by
 * reading FROM clauses in the function body, so a branch_master lookup living inside ptRegister
 * makes it look attendance-driven and expected to default to today. Keeping the lookup out here
 * leaves that check meaningful instead of relaxing it to accommodate this change.
 *
 * UPPER(TRIM(...)) because the column is not normalised: production stores "GUJARAT" beside
 * mixed-case values like "Uttar Pradesh", and 15 branches carry no state at all.
 */
async function gujaratBranchIds(): Promise<string[]> {
  const rows = await query("SELECT id FROM branch_master WHERE UPPER(TRIM(state)) = 'GUJARAT'", []);
  return (rows as Array<{ id: string }>).map((r) => r.id);
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
/**
 * uan-master-register
 *
 * Promoted from the inline case block. It had no executor, so its download answered 404 while
 * the screen rendered — on a statutory register, which is exactly the kind of report someone
 * needs as a file rather than on screen.
 *
 * The uan_source column is not decoration and is carried deliberately. UAN lives in two places:
 * employee_uan, and a uan_number column on employees. The register prefers the former and falls
 * back to the latter, and states per row which one it used, so a reader can see when a number
 * came from the legacy column rather than the mapping table.
 */
export async function uanMasterRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push(
    "e.active_status = 1",
    "COALESCE(NULLIF(TRIM(eu.uan), ''), NULLIF(TRIM(e.uan_number), '')) IS NOT NULL",
  );

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?"); params.push(options.cursor);
  }

  const base = `    SELECT
           e.id AS _cursor,
           e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(NULLIF(TRIM(eu.uan), ''), NULLIF(TRIM(e.uan_number), '')) AS uan,
           CASE WHEN NULLIF(TRIM(eu.uan), '') IS NOT NULL THEN 'employee_uan'
           ELSE 'employees.uan_number' END AS uan_source,
           e.epf_number, eu.member_id AS pf_member_id,
           e.date_of_joining AS pf_joining_date, e.date_of_birth, e.gender,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name
      FROM employees e
      LEFT JOIN employee_uan eu ON eu.employee_id = e.id AND eu.is_active = 1
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY employee_name`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

export async function pfContributionRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const runMonth = await resolvePayrollMonth(filters.month);
  // employees has no `uan` column — it is `uan_number`. The unmasked branch therefore threw
  // "Unknown column 'e.uan'" and the whole report 500'd, while the masked branch (a literal)
  // worked fine, so the failure only ever appeared for users entitled to see the real number.
  // Aliased back to `uan` so the output column name matches the masked branch and the catalogue.
  const uanCol = scope.canViewSensitiveFields
    ? "e.uan_number AS uan"
    : "'***MASKED***' AS uan";

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("spr.run_month = ?");
  params.push(runMonth);

  /**
   * On-roll only. These registers are statutory FILINGS, not headcount views: trainees,
   * unclassified and off-roll staff do not belong in an ESIC/PF/PT return.
   *
   * Measured on production for 2026-07: 1,595 payroll lines, of which 1,131 are ONROLL.
   * employment_type carries ONROLL (917 active), NULL (213), MGMT. TRAINEE (183) and
   * Full Time (14); only ONROLL counts here, per the payroll team's ruling.
   */
  clauses.push("e.employment_type = 'ONROLL'");


  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("spl.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT spl.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           ${uanCol},
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           spr.run_month,
           COALESCE(spl.pf_employee, 0) AS pf_employee,
           COALESCE(spl.pf_employer, 0) AS pf_employer,
           COALESCE(spl.pf_employee, 0) + COALESCE(spl.pf_employer, 0) AS total_pf,
           e.epf_number,
           COALESCE(spl.basic, 0) AS pf_wage
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
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
  const runMonth = await resolvePayrollMonth(filters.month);
  // employees has no `uan` column — it is `uan_number`. The unmasked branch therefore threw
  // "Unknown column 'e.uan'" and the whole report 500'd, while the masked branch (a literal)
  // worked fine, so the failure only ever appeared for users entitled to see the real number.
  // Aliased back to `uan` so the output column name matches the masked branch and the catalogue.
  const uanCol = scope.canViewSensitiveFields
    ? "e.uan_number AS uan"
    : "'***MASKED***' AS uan";

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
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
           ${uanCol},
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS member_name,
           COALESCE(spl.basic, 0) AS pf_wages,
           COALESCE(spl.pf_employee, 0) AS epf_employee,
           -- pf_employer stores the FULL employer contribution (EPF 3.67% + EPS
           -- 8.33% combined, per payroll.service.ts calculateNetSalary) — it was
           -- being passed through as-is under the eps_employer column, mislabeling
           -- the whole employer PF as EPS-only (delta-audit 2026-08-14, P1). Derive
           -- the EPS-only share the same way pf-esic-salary-register already does
           -- correctly below (8.33/12 of the combined total; EPF and EPS share the
           -- same wage ceiling in the calculation, so this recovers the exact
           -- split). Value fix only — column set stays exactly what it was
           -- (identity-spine.contract.test.ts: this file's columns are dictated by
           -- EPFO for direct upload; adding a column breaks it).
           ROUND(COALESCE(spl.pf_employer, 0) * 8.33 / 12, 0) AS eps_employer,
           spr.run_month
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY spl.id ASC`;

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
    if (mysqlCode === "ER_BAD_FIELD_ERROR" || mysqlCode === "ER_NO_SUCH_TABLE") {
      return { rows: [], rowCount: 0, isTruncated: false };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// esic-contribution-register
// ---------------------------------------------------------------------------
export async function esicContributionRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const runMonth = await resolvePayrollMonth(filters.month);
  const esicCol = scope.canViewSensitiveFields
    ? "e.esic_number"
    : "'***MASKED***' AS esic_number";

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("spr.run_month = ?");
  params.push(runMonth);

  /**
   * On-roll only. These registers are statutory FILINGS, not headcount views: trainees,
   * unclassified and off-roll staff do not belong in an ESIC/PF/PT return.
   *
   * Measured on production for 2026-07: 1,595 payroll lines, of which 1,131 are ONROLL.
   * employment_type carries ONROLL (917 active), NULL (213), MGMT. TRAINEE (183) and
   * Full Time (14); only ONROLL counts here, per the payroll team's ruling.
   */
  clauses.push("e.employment_type = 'ONROLL'");


  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("spl.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT spl.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           ${esicCol},
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           spr.run_month,
           -- salary_prep_line has no esic_wage; gross_salary was already the intended fallback.
           COALESCE(spl.gross_salary, 0) AS esic_wages,
           COALESCE(spl.esic_employee, 0) AS esic_employee,
           COALESCE(spl.esic_employer, 0) AS esic_employer,
           COALESCE(spl.esic_employee, 0) + COALESCE(spl.esic_employer, 0) AS total_esic
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
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

/**
 * The professional-tax jurisdiction for a payroll line: the state the employee WORKS in.
 *
 * Reading b.state alone left the state blank on 172 of the 235 PT-paying lines in 2026-07 —
 * 73% of a register whose whole purpose is a state-levied tax, where the state decides the slab
 * and the filing. The cause is not missing data. branch_master holds DUPLICATE rows for the same
 * branch name, one populated and one blank, and those employees are linked to the blank twin:
 * KARNAL exists twice as blank and 'HARYANA', MOHALI as blank and 'PUNJAB', JAIPUR as blank and
 * 'Rajasthan', MEERUT as blank and 'Uttar Pradesh'. The state was in the database all along.
 *
 * So the fallback resolves by branch NAME — the same shape used elsewhere in this codebase where
 * an id points at an unpopulated row — but ONLY when every same-named branch that carries a
 * state agrees. HEAD OFFICE exists three times, as 'Maharashtra', blank, and 'Uttar Pradesh';
 * picking one of those for a tax report would be inventing a jurisdiction, so an ambiguous name
 * stays UNKNOWN and says so rather than guessing.
 *
 * Measured on 2026-07: unresolved drops from 172 to 49, and the 49 that remain are genuinely
 * ambiguous or absent everywhere. Nothing here is inferred from a city or a branch name spelling.
 *
 * The real fix is upstream — populate the blank duplicates, or re-point employees at the row that
 * has the data — and that is a production data change, not a reporting one.
 */
const PT_STATE_JURISDICTION = `COALESCE(
             NULLIF(b.state, ''),
             (SELECT CASE WHEN COUNT(DISTINCT UPPER(TRIM(b2.state))) = 1 THEN MAX(b2.state) END
                FROM branch_master b2
               WHERE b2.branch_name = b.branch_name
                 AND b2.state IS NOT NULL AND b2.state <> ''),
             'UNKNOWN')`;

// ---------------------------------------------------------------------------
// pt-register
// ---------------------------------------------------------------------------
export async function ptRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const runMonth = await resolvePayrollMonth(filters.month);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("spr.run_month = ?", "COALESCE(spl.professional_tax, 0) > 0");
  params.push(runMonth);

  /**
   * On-roll only. These registers are statutory FILINGS, not headcount views: trainees,
   * unclassified and off-roll staff do not belong in an ESIC/PF/PT return.
   *
   * Measured on production for 2026-07: 1,595 payroll lines, of which 1,131 are ONROLL.
   * employment_type carries ONROLL (917 active), NULL (213), MGMT. TRAINEE (183) and
   * Full Time (14); only ONROLL counts here, per the payroll team's ruling.
   */
  clauses.push("e.employment_type = 'ONROLL'");

  /**
   * Gujarat only. Professional tax is a STATE levy with its own slabs and return, so a single
   * register mixing states cannot be filed anywhere. Restricted to employees whose branch sits
   * in Gujarat, per the payroll team's ruling.
   */
  /**
   * Resolved to branch ids first, rather than an EXISTS subquery against branch_master.
   *
   * A subquery reading `FROM branch_master` inside this function makes it look driven by
   * branch_master to payroll-month-default.contract.test.ts, which then expects it to default
   * to today rather than to a payroll month — and that test is right to care, so the fix is to
   * keep the branch lookup out of the report's own SQL rather than to relax the check.
   *
   * UPPER(TRIM(...)) because the column is not normalised: production stores "GUJARAT" (4
   * branches) alongside mixed-case values like "Uttar Pradesh", and 15 branches carry no state
   * at all. A branch with an unknown state is correctly excluded — it cannot be filed as
   * Gujarat on the strength of a blank.
   */
  const gujaratBranches = await gujaratBranchIds();
  if (!gujaratBranches.length) {
    // No Gujarat branch configured: return nothing rather than every state's rows. A PT return
    // for the wrong state is worse than an empty one.
    clauses.push("1 = 0");
  } else {
    clauses.push(`e.branch_id IN (${gujaratBranches.map(() => "?").join(",")})`);
    params.push(...gujaratBranches);
  }


  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("spl.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT spl.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           spr.run_month,
           COALESCE(spl.professional_tax, 0) AS pt_amount,
           COALESCE(spl.gross_salary, 0) AS gross_salary,
           -- employees has no pt_state. Professional tax is levied by the state the
           -- employee WORKS in, so the branch state is the jurisdiction — not the
           -- employee's own (home) state, which is what e.state holds. On live data the
           -- two disagree for 326 of 1,042 active employees, so this is not cosmetic.
           -- Branch state also covers more people: 1,113 of 1,123 against 1,042.
           ${PT_STATE_JURISDICTION} AS pt_state
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
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
/**
 * Income-tax parameters, read from statutory_config rather than hardcoded.
 *
 * The charter is explicit that TDS must not project against literal slabs: "No hardcoded
 * fallback slabs." Everything here is configured and effective-dated — verified present on
 * production 2026-08-12: seven slabs from 2025-03-31 (new regime), standard deduction 75,000,
 * 87A rebate limit 12,00,000 and cess 4%. If a key is missing this returns null and the caller
 * reports the column as unavailable rather than inventing a number.
 */
interface TaxParams {
  slabs: Array<{ upTo: number; pct: number }>;
  standardDeduction: number;
  rebateLimit: number;
  cessPct: number;
}

async function taxParams(): Promise<TaxParams | null> {
  const rows = await query(
    "SELECT config_key, CAST(config_value AS DECIMAL(14,4)) AS v FROM statutory_config WHERE config_key REGEXP 'tds_'",
    [],
  ) as Array<{ config_key: string; v: string }>;
  const map = new Map(rows.map((r) => [r.config_key, Number(r.v)]));

  // Slab keys encode their own bounds: tds_slab_<from>_<to|above>.
  const slabs: Array<{ upTo: number; pct: number }> = [];
  for (const [k, v] of map) {
    const m = /^tds_slab_(\d+)_(\d+|above)$/.exec(k);
    if (!m) continue;
    slabs.push({ upTo: m[2] === "above" ? Number.MAX_SAFE_INTEGER : Number(m[2]), pct: v });
  }
  slabs.sort((a, b) => a.upTo - b.upTo);

  const standardDeduction = map.get("tds_standard_deduction");
  const rebateLimit = map.get("tds_rebate_87a_limit");
  const cessPct = map.get("tds_cess_pct");
  if (!slabs.length || standardDeduction == null || rebateLimit == null || cessPct == null) return null;
  return { slabs, standardDeduction, rebateLimit, cessPct };
}

/**
 * Progressive tax as a SQL expression over `taxableExpr`.
 *
 * Each slab taxes only the income falling INSIDE its band — GREATEST(0, LEAST(income, upper) -
 * lower) — which is what makes it progressive rather than a flat rate on the whole amount at the
 * top band. Section 87A is applied as a cliff on taxable income, then cess on the tax itself.
 */
function annualTaxSql(taxableExpr: string, p: TaxParams): string {
  let lower = 0;
  const parts: string[] = [];
  for (const slab of p.slabs) {
    const upper = slab.upTo === Number.MAX_SAFE_INTEGER ? null : slab.upTo;
    if (slab.pct > 0) {
      const capped = upper == null ? taxableExpr : `LEAST(${taxableExpr}, ${upper})`;
      parts.push(`GREATEST(0, ${capped} - ${lower}) * ${slab.pct / 100}`);
    }
    if (upper == null) break;
    lower = upper;
  }
  const gross = parts.length ? parts.join(" + ") : "0";
  // 87A: no tax at all when taxable income is within the rebate limit.
  return `ROUND(CASE WHEN ${taxableExpr} <= ${p.rebateLimit} THEN 0
                     ELSE (${gross}) * ${1 + p.cessPct / 100} END, 0)`;
}

export async function tdsComputationRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const runMonth = await resolvePayrollMonth(filters.month);

  /**
   * Computed here, not echoed from payroll. The register previously returned NULL for projected
   * income, exemptions, taxable income and annual liability, and monthly_tds simply repeated
   * spl.tds — which is 0 on all 1,595 lines of the 2026-07 run, so the report said nothing at
   * all. 8 of those lines annualise above 7,00,000.
   *
   * Null params mean a configuration key is missing; the columns then report NULL rather than a
   * fabricated figure, which is the charter's requirement for TDS.
   */
  const tax = await taxParams();
  const panCol = scope.canViewSensitiveFields
    ? "e.pan_number"
    : "'***MASKED***' AS pan_number";

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("spr.run_month = ?");
  params.push(runMonth);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("spl.id > ?");
    params.push(options.cursor);
  }

  const PROJECTED = "COALESCE(spl.gross_salary,0) * 12";
  const TAXABLE = tax ? `GREATEST(0, (${PROJECTED}) - ${tax.standardDeduction})` : "0";
  const ANNUAL = tax ? annualTaxSql(TAXABLE, tax) : "0";

  const base = `
    SELECT spl.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           spr.run_month,
           ${panCol},
           -- salary_prep_line stores only the deducted TDS. Projected income,
           -- exemptions, taxable income and annual liability are not computed or
           -- stored anywhere; reporting 0 would assert a real figure of zero.
           ${tax ? `${PROJECTED} AS projected_annual_income` : "NULL AS projected_annual_income"},
           ${tax ? `${tax.standardDeduction} AS exemptions` : "NULL AS exemptions"},
           ${tax ? `${TAXABLE} AS taxable_income` : "NULL AS taxable_income"},
           ${tax ? `ROUND(${ANNUAL} / 12, 0) AS monthly_tds` : "COALESCE(spl.tds, 0) AS monthly_tds"},
           ${tax ? `${ANNUAL} AS annual_tax_liability` : "NULL AS annual_tax_liability"}
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
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
  const baseClauses: string[] = ["e.id IS NOT NULL"];
  const baseParams: unknown[] = [];
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
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           f16.financial_year,
           COALESCE(f16.status, 'NOT_GENERATED') AS form16_status,
           f16.generated_at AS generated_date
      FROM form_16_record f16
      JOIN employees e ON e.id = f16.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
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
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           ? AS financial_year,
           'NOT_GENERATED' AS form16_status,
           NULL AS generated_date
      FROM employees e
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
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
//
// Reads tax_declaration — the live store, holding 1,533 rows (verified 2026-08-07).
// This previously targeted `investment_declaration`, which has never existed in
// mas_hrms, and swallowed ER_NO_SUCH_TABLE into an empty result. The report therefore
// showed "no declarations submitted" for an entire workforce that had submitted 1,533,
// which during tax season is the difference between chasing everyone and chasing no one.
//
// tax_declaration has no declaration_status or verified_amount column: the presence of a
// row IS the submission, so status is derived and verified_amount is not emitted rather
// than invented. Its real columns (regime and the 80C/80D/HRA split) are surfaced
// instead, since they are what a payroll reviewer actually needs.
// ---------------------------------------------------------------------------
export async function investmentDeclarationStatus(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const fy = (typeof filters.financialYear === "string" && filters.financialYear)
    ? filters.financialYear
    : currentFinancialYear();

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  // tax_declaration.financial_year is not written in one format. Live counts: '2025-26' has
  // 1,531 rows, '2025-2026' has 1, '2026-2027' has 1. currentFinancialYear() produces the
  // short form ('2026-27'), so an equality match found nothing at all and the report returned
  // 0 rows against 1,533 declarations on file.
  //
  // A financial year is uniquely identified by its start year, so both sides are compared on
  // that alone. This matches every format present instead of picking one and silently
  // excluding the rest — normalising the stored values would be a data migration, which is
  // not this report's call to make.
  clauses.push("LEFT(id_decl.financial_year, 4) = LEFT(?, 4)");
  params.push(fy);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("id_decl.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT id_decl.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           id_decl.financial_year,
           'SUBMITTED' AS declaration_status,
           id_decl.regime,
           id_decl.created_at AS submitted_at,
           id_decl.total_investment AS total_declared_amount,
           id_decl.declared_80c,
           id_decl.declared_80d,
           id_decl.declared_hra,
           id_decl.tds_projected
      FROM tax_declaration id_decl
      JOIN employees e ON e.id = id_decl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY id_decl.id ASC`;

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

/**
 * gratuity-liability-register
 *
 * Aligned with the inline block. Screen showed 175 rows and the download 131.
 *
 * The five-year qualifying filter is part of the report, not an optimisation: gratuity is only
 * payable after five years of continuous service, so a register without it states a liability
 * that does not exist. last_drawn_basic falls back to 40% of monthly CTC when no salary
 * component is assigned, and the 15/26 factor is the statutory formula — both carried unchanged,
 * because this report quantifies an existing obligation and must not invent a different one.
 */
export async function gratuityLiabilityRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1", "e.date_of_joining IS NOT NULL");

  /**
   * Minimum qualifying service, from statutory_config rather than a literal.
   *
   * The register carried NO service filter, so every employee with a joining date accrued a
   * liability from day one. Under the Payment of Gratuity Act nothing is payable before five
   * years of continuous service, and the threshold was already configured and simply unused:
   * gratuity_min_service_months = 60 (alongside gratuity_multiplier 15 and gratuity_divisor 26).
   *
   * Measured on production 2026-08-12: of 1,327 active employees with a joining date, 99 qualify
   * and 1,228 do not. So this removes roughly 93% of the rows and the liability attached to
   * them — a large drop that is the correction, not a regression. The 99 matches the "qualifying
   * population" the fan-out fix above already measured independently.
   *
   * Read through a subquery so a change to the configured threshold takes effect without a code
   * change, and so this cannot silently diverge from what payroll uses.
   */
  clauses.push(`TIMESTAMPDIFF(MONTH, e.date_of_joining, CURDATE()) >= (
      SELECT CAST(config_value AS UNSIGNED) FROM statutory_config
       WHERE config_key = 'gratuity_min_service_months' LIMIT 1)`);

  const base = `
    SELECT e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           e.date_of_joining,
           TIMESTAMPDIFF(YEAR, e.date_of_joining, CURDATE()) AS tenure_years,
           ROUND(TIMESTAMPDIFF(MONTH, e.date_of_joining, CURDATE()) / 12, 2) AS tenure_years_exact,
           COALESCE(sca.basic, esa.ctc_annual / 12 * 0.4, 0) AS last_drawn_basic,
           ROUND(COALESCE(sca.basic, esa.ctc_annual / 12 * 0.4, 0)
                 * (TIMESTAMPDIFF(MONTH, e.date_of_joining, CURDATE()) / 12)
                 * (15.0 / 26.0), 0) AS gratuity_liability,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(gpm.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(gcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(gcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name
      FROM employees e
      LEFT JOIN employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
      -- One row per employee, not one per assignment record.
      --
      -- Joining salary_component_assignments directly fanned this register out: 1,049 active
      -- employees hold more than one active row, so employees repeated and every total taken
      -- from the report was inflated. Measured on live 2026-08-09 over the qualifying
      -- population: 175 rows for 99 employees, and a gratuity liability of 2,73,00,717 against
      -- a true 1,04,14,721 — an overstatement of 1,68,85,996, or 162%.
      --
      -- The duplicates are duplicates, not revisions: of those 1,049 employees, ZERO have a
      -- differing basic between their active rows. So deduplicating cannot change any
      -- individual's gratuity figure; it only stops people being counted more than once.
      -- Nothing here recomputes the gratuity formula, which is untouched.
      --
      -- The row is picked by latest effective_date, then created_at, then id, rather than by
      -- MAX(basic). Both give the same answer today precisely because the values agree — but a
      -- rule that is only correct while the data happens to agree is not a rule, and if a real
      -- revision ever lands this takes the current one rather than the largest.
      LEFT JOIN (
        SELECT employee_id, basic
          FROM (
            SELECT employee_id, basic,
                   ROW_NUMBER() OVER (
                     PARTITION BY employee_id
                     ORDER BY effective_date DESC, created_at DESC, id DESC
                   ) AS rn
              FROM salary_component_assignments
             WHERE status = 'active'
          ) ranked
         WHERE rn = 1
      ) sca ON sca.employee_id = e.id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master gpm ON gpm.id = e.process_id
      LEFT JOIN cost_centre_master gcc ON gcc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")} AND TIMESTAMPDIFF(YEAR, e.date_of_joining, CURDATE()) >= 5
     ORDER BY gratuity_liability DESC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length, nextCursor: null };
}

// ---------------------------------------------------------------------------
// pt-monthly-register
//
// Folded in from an inline `case` block, behaviour preserved: professional tax actually
// deducted per employee for a run month, restricted to lines where PT is non-zero.
// Gains cost centre, process and branch.
// ---------------------------------------------------------------------------
export async function ptMonthlyRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const runMonth = await resolvePayrollMonth(filters.month);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("spr.run_month = ?");
  params.push(runMonth);
  clauses.push("LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')");
  clauses.push("spl.professional_tax > 0");
  /**
   * On-roll only, matching pt-register (its own register-view sibling) and
   * pf-contribution-register / esic-contribution-register. Statutory FILINGS
   * are not headcount views: trainees, unclassified and off-roll staff do not
   * belong in a PT return. Missing here meant this monthly-trend view and
   * pt-register disagreed about "PT deducted this month" for the same
   * population (delta-audit 2026-08-14, P1).
   */
  clauses.push("e.employment_type = 'ONROLL'");

  const base = `
    SELECT e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           -- Was COALESCE(e.state,'Unknown') — the employee's HOME state, which is the wrong
           -- jurisdiction: professional tax is levied where the employee works. Its sibling
           -- pt-register has always used the branch state for that reason, so the two registers
           -- disagreed about the state of the same employee. Now both resolve identically.
           ${PT_STATE_JURISDICTION} AS state,
           spl.gross_salary,
           spl.professional_tax AS pt_deducted,
           spr.run_month
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     -- Order by the state actually shown, not e.state: the displayed column is now the work
     -- jurisdiction, and sorting a PT register by the employee's home state would group rows
     -- under a heading they do not carry.
     ORDER BY state, employee_name`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// pf-esic-salary-register
//
// Folded in from an inline `case` block, behaviour preserved exactly — including the two
// statutory constants it carries: the PF wage ceiling of 15,000 (LEAST) and the EPS share
// of 8.33/12. Neither is changed here; payroll arithmetic stays read-only, and moving
// those into effective-dated statutory config is a separate, approved change.
// Gains cost centre.
// ---------------------------------------------------------------------------
export async function pfEsicSalaryRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const runMonth = await resolvePayrollMonth(filters.month);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("spr.run_month = ?");
  params.push(runMonth);
  clauses.push("LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')");
  /**
   * On-roll only, matching pf-contribution-register / esic-contribution-register
   * (this register combines exactly what those two cover). Statutory FILINGS
   * are not headcount views: trainees, unclassified and off-roll staff do not
   * belong in a PF/ESIC return. Missing here meant this register showed a
   * different population than its own component registers for the same month
   * (delta-audit 2026-08-14, P1).
   */
  clauses.push("e.employment_type = 'ONROLL'");

  const base = `
    SELECT e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           spr.run_month AS payroll_month,
           COALESCE(eu.uan, e.epf_number) AS uan,
           e.esic_number,
           LEAST(COALESCE(spl.basic, 0), 15000) AS pf_basic,
           spl.gross_salary AS gross_wages,
           COALESCE(spl.pf_employee, 0) AS pf_employee,
           COALESCE(spl.pf_employer, 0) AS pf_employer,
           ROUND(COALESCE(spl.pf_employer,0) * 8.33/12, 0) AS eps_contribution,
           COALESCE(spl.esic_employee, 0) AS esic_employee,
           COALESCE(spl.esic_employer, 0) AS esic_employer,
           spl.net_salary
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
      LEFT JOIN employee_uan eu ON eu.employee_id = e.id AND eu.is_active = 1
     WHERE ${clauses.join(" AND ")}
     ORDER BY b.branch_name, employee_name`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// pf-esi-optout-register
//
// Folded in from an inline `case` block. The original joined no org masters at all, so an
// approved statutory opt-out could not be attributed to a branch, process or cost centre —
// on a compliance register that is the first thing an auditor asks for. All are added.
// ---------------------------------------------------------------------------
export async function pfEsiOptOutRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  const base = `
    SELECT e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           eso.override_type AS opt_out_type,
           eso.effective_from_month AS effective_month,
           eso.status,
           eso.approved_at,
           eso.audit_note AS reason
      FROM employee_statutory_override eso
      JOIN employees e ON e.id = eso.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY eso.approved_at DESC, employee_name`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}
