/**
 * Legacy HRMS Reports Service
 *
 * Replicates every report that exists in db_bill, sourcing data 100% from
 * mas_hrms snapshot and live tables. One query per report, same column labels
 * and format that Finance and HR recognize from the legacy system.
 *
 * Column names verified against actual mas_hrms table schemas (2026-08-22).
 */
import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";

export type LegacyFilter = {
  branch?: string;
  process?: string;     // process_name exact match
  month?: string;       // 'YYYY-MM'
  from_date?: string;   // 'YYYY-MM-DD'
  to_date?: string;     // 'YYYY-MM-DD'
  employee_code?: string;
  employee_name?: string; // partial name search
  _limit?: number;      // internal — set by service, not by user input
};

export type LegacyColumn = {
  key: string;
  label: string;
  format: "text" | "number" | "currency" | "date" | "datetime" | "status" | "boolean";
  align?: "left" | "right" | "center";
};

export type LegacyReportResult = {
  columns: LegacyColumn[];
  rows: Record<string, unknown>[];
  total: number;
  summary?: Record<string, number>;
  truncated?: boolean;   // true when rows are capped at displayLimit
  displayLimit?: number; // the limit that was applied
};

// ── query helpers ────────────────────────────────────────────────────────────

function branchWhere(col: string, branch?: string): [string, unknown[]] {
  if (!branch) return ["", []];
  return [`AND ${col} = ?`, [branch]];
}

function monthWhere(col: string, month?: string): [string, unknown[]] {
  if (!month) return ["", []];
  const d = `${month}-01`;
  return [`AND ${col} BETWEEN ? AND LAST_DAY(?)`, [d, d]];
}

function empWhere(col: string, emp?: string): [string, unknown[]] {
  if (!emp) return ["", []];
  return [`AND ${col} = ?`, [emp]];
}

function dateRangeWhere(col: string, from?: string, to?: string): [string, unknown[]] {
  const parts: string[] = []; const vals: unknown[] = [];
  if (from) { parts.push(`${col} >= ?`); vals.push(from); }
  if (to)   { parts.push(`${col} <= ?`); vals.push(to); }
  return [parts.length ? `AND ${parts.join(" AND ")}` : "", vals];
}

function processJoin(alias: string, emp: string): string {
  return `LEFT JOIN process_master ${alias} ON ${alias}.id = ${emp}.process_id`;
}

function processWhere(alias: string, process?: string): [string, unknown[]] {
  if (!process) return ["", []];
  return [`AND ${alias}.process_name = ?`, [process]];
}

function nameWhere(col: string, name?: string): [string, unknown[]] {
  if (!name) return ["", []];
  return [`AND ${col} LIKE ?`, [`%${name}%`]];
}

function numSum(rows: Record<string, unknown>[], keys: string[]): Record<string, number> {
  const s: Record<string, number> = {};
  for (const k of keys) s[k] = 0;
  for (const r of rows) for (const k of keys) s[k] += Number(r[k] ?? 0);
  for (const k of keys) s[k] = Math.round(s[k] * 100) / 100;
  return s;
}

async function q(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows;
}

// ── report registry ───────────────────────────────────────────────────────────

type ReportDef = {
  label: string;
  columns: LegacyColumn[];
  query: (f: LegacyFilter) => Promise<RowDataPacket[]>;
  sumCols?: string[];
  defaultDisplayLimit?: number; // cap for UI display; export uses 50000
};

const REPORTS: Record<string, ReportDef> = {

  // ── 1. Legacy Salary Register ─────────────────────────────────────────────
  "salary-register": {
    label: "Salary Register",
    sumCols: ["gross_salary","net_salary","pf_employee","esic_employee","pf_employer","esic_employer","tds","incentive_total","total_deduction"],
    columns: [
      { key: "employee_code",    label: "Emp Code",           format: "text" },
      { key: "employee_name",    label: "Employee Name",       format: "text" },
      { key: "cost_centre",      label: "Cost Centre",         format: "text" },
      { key: "process_name",     label: "Process Name",        format: "text" },
      { key: "department",       label: "Department",          format: "text" },
      { key: "designation",      label: "Designation",         format: "text" },
      { key: "profile",          label: "Profile",             format: "text" },
      { key: "emp_for",          label: "Employee For",        format: "text" },
      { key: "billable",         label: "Billable",            format: "text" },
      { key: "branch_name",      label: "Branch",              format: "text" },
      { key: "basic",            label: "Basic",               format: "currency", align: "right" },
      { key: "hra",              label: "HRA",                 format: "currency", align: "right" },
      { key: "bonus",            label: "Bonus",               format: "currency", align: "right" },
      { key: "conv",             label: "Conv",                format: "currency", align: "right" },
      { key: "portfolio",        label: "Portfolio",           format: "currency", align: "right" },
      { key: "medical",          label: "Medical Allow",       format: "currency", align: "right" },
      { key: "lta",              label: "LTA",                 format: "currency", align: "right" },
      { key: "special",          label: "Special Allow",       format: "currency", align: "right" },
      { key: "other_allow",      label: "Other Allow",         format: "currency", align: "right" },
      { key: "pli1",             label: "PLI1",                format: "currency", align: "right" },
      { key: "gross_salary",     label: "Gross",               format: "currency", align: "right" },
      { key: "working_days",     label: "Working Days",        format: "number",   align: "right" },
      { key: "ctc_offered",      label: "CTC Offered",         format: "currency", align: "right" },
      { key: "current_ctc",      label: "Current CTC",         format: "currency", align: "right" },
      { key: "present_days",     label: "Earned Days",         format: "number",   align: "right" },
      { key: "actual_days",      label: "Actual Days",         format: "number",   align: "right" },
      { key: "extra_day",        label: "Extra Day",           format: "number",   align: "right" },
      { key: "leave_days",       label: "Leave",               format: "number",   align: "right" },
      { key: "basic1",           label: "Basic1",              format: "currency", align: "right" },
      { key: "hra1",             label: "HRA1",                format: "currency", align: "right" },
      { key: "bonus1",           label: "Bonus1",              format: "currency", align: "right" },
      { key: "conv1",            label: "Conv1",               format: "currency", align: "right" },
      { key: "portfolio1",       label: "Portfolio1",          format: "currency", align: "right" },
      { key: "special1",         label: "Special Allow1",      format: "currency", align: "right" },
      { key: "other_allow1",     label: "Other Allow1",        format: "currency", align: "right" },
      { key: "medical1",         label: "Medical1",            format: "currency", align: "right" },
      { key: "gross1",           label: "Gross1",              format: "currency", align: "right" },
      { key: "esi_elig",         label: "ESI Elig",            format: "text" },
      { key: "pf_elig",          label: "PF Elig",             format: "text" },
      { key: "esic_employee",    label: "ESIC",                format: "currency", align: "right" },
      { key: "pf_employee",      label: "EPF",                 format: "currency", align: "right" },
      { key: "tds",              label: "Income Tax",          format: "currency", align: "right" },
      { key: "adv_taken",        label: "Adv Taken",           format: "currency", align: "right" },
      { key: "advance_recovery", label: "Adv Paid",            format: "currency", align: "right" },
      { key: "loan_taken",       label: "Loan Taken",          format: "currency", align: "right" },
      { key: "loan_ded",         label: "Loan Ded",            format: "currency", align: "right" },
      { key: "incentive_total",  label: "Incentive",           format: "currency", align: "right" },
      { key: "extra_day_inc",    label: "Extra Day Inc",       format: "currency", align: "right" },
      { key: "arrear",           label: "Arrear",              format: "currency", align: "right" },
      { key: "pli",              label: "PLI",                 format: "currency", align: "right" },
      { key: "net_salary",       label: "Net Salary",          format: "currency", align: "right" },
      { key: "esic_employer",    label: "ESIC Co",             format: "currency", align: "right" },
      { key: "pf_employer",      label: "EPF Co",              format: "currency", align: "right" },
      { key: "admin_charges",    label: "Admin Chg",           format: "currency", align: "right" },
      { key: "ctc",              label: "CTC",                 format: "currency", align: "right" },
      { key: "shsh",             label: "SHSH",                format: "currency", align: "right" },
      { key: "mobile_ded",       label: "Mobile Ded",          format: "currency", align: "right" },
      { key: "short_collection", label: "Short Collection",    format: "currency", align: "right" },
      { key: "asset_rec",        label: "Asset Recovery",      format: "currency", align: "right" },
      { key: "insurance",        label: "Insurance",           format: "currency", align: "right" },
      { key: "pt",               label: "Prof Tax",            format: "currency", align: "right" },
      { key: "lwp_deduction",    label: "Leave Ded",           format: "currency", align: "right" },
      { key: "other_deductions", label: "Other Ded",           format: "currency", align: "right" },
      { key: "other_ded_remarks",label: "Other Ded Remarks",   format: "text" },
      { key: "total_deduction",  label: "Total Deduction",     format: "currency", align: "right" },
      { key: "sal_date",         label: "Sal Date",            format: "date" },
      { key: "uan",              label: "UAN",                 format: "text" },
      { key: "epf_no",           label: "EPF No",              format: "text" },
      { key: "esic_no",          label: "ESIC No",             format: "text" },
      { key: "cheque_no",        label: "Cheque No",           format: "text" },
      { key: "cheque_date",      label: "Cheque Date",         format: "text" },
      { key: "print_date",       label: "Print Date",          format: "text" },
      { key: "left_status",      label: "Left Status",         format: "text" },
      { key: "tax_total_gross",  label: "Tax Total Gross",     format: "currency", align: "right" },
      { key: "tax_section10",    label: "Tax Section 10",      format: "currency", align: "right" },
      { key: "tax_balance",      label: "Tax Balance",         format: "currency", align: "right" },
      { key: "tax_under_hd",     label: "Tax Under Hd",        format: "currency", align: "right" },
      { key: "deduction_under24",label: "Dedn Under 24",       format: "currency", align: "right" },
      { key: "tax_gross_total",  label: "Tax Gross Total",     format: "currency", align: "right" },
      { key: "tax_agg_chapter6", label: "Tax Agg Ch6",         format: "currency", align: "right" },
      { key: "total_income",     label: "Total Income",        format: "currency", align: "right" },
      { key: "tax_on_total",     label: "Tax on Income",       format: "currency", align: "right" },
      { key: "edu_cess",         label: "Edu Cess",            format: "currency", align: "right" },
      { key: "tax_pay_edu_cess", label: "Tax+Edu Cess",        format: "currency", align: "right" },
      { key: "tax_deducted_prev",label: "Tax Prev Month",      format: "currency", align: "right" },
      { key: "balance_tax",      label: "Balance Tax",         format: "currency", align: "right" },
      { key: "salary_pay_mode",  label: "Pay Mode",            format: "text" },
      { key: "ac_no",            label: "Account No",          format: "text" },
      { key: "ifsc_code",        label: "IFSC Code",           format: "text" },
      { key: "ac_bank",          label: "Bank Name",           format: "text" },
      { key: "ac_branch",        label: "Bank Branch",         format: "text" },
    ],
    async query(f) {
      const [bw, bv] = branchWhere("bm.branch_name", f.branch);
      const month = f.month || new Date().toISOString().slice(0, 7);
      const mw = "AND spr.run_month = ?";
      const mv = [month];
      const [ew, ev] = empWhere("spl.employee_code", f.employee_code);
      const [nw, nv] = nameWhere("e.full_name", f.employee_name);
      const [pw, pv] = processWhere("pm", f.process);
      return q(`
        SELECT
          spl.employee_code,
          e.full_name                                                                AS employee_name,
          cc.cost_centre_code                                                        AS cost_centre,
          COALESCE(pm.process_name, 'UNASSIGNED')                                   AS process_name,
          COALESCE(dpm.dept_name, '')                                                AS department,
          dm.designation_name                                                        AS designation,
          COALESCE(e.profile_type, '')                                               AS profile,
          COALESCE(e.emp_type, '')                                                   AS emp_for,
          COALESCE(e.billable_status, 'No')                                          AS billable,
          bm.branch_name,
          spl.basic,
          spl.hra,
          COALESCE(MAX(CASE WHEN c.component_code='BONUS'         THEN c.amount END),0) AS bonus,
          COALESCE(MAX(CASE WHEN c.component_code='CONV'          THEN c.amount END),0) AS conv,
          COALESCE(MAX(CASE WHEN c.component_code='PORTFOLIO'     THEN c.amount END),0) AS portfolio,
          COALESCE(MAX(CASE WHEN c.component_code='MA'            THEN c.amount END),0) AS medical,
          0                                                                          AS lta,
          spl.special_allowance                                                      AS special,
          COALESCE(MAX(CASE WHEN c.component_code='OA'            THEN c.amount END),0) AS other_allow,
          0                                                                          AS pli1,
          spl.gross_salary,
          spl.working_days,
          e.ctc                                                                      AS ctc_offered,
          ROUND(spl.gross_salary + spl.pf_employer + spl.esic_employer
                + COALESCE(MAX(CASE WHEN c.component_code='ADMIN_CHG' THEN c.amount END),0), 2) AS current_ctc,
          spl.present_days,
          COALESCE(spl.active_calendar_days, 0)                                      AS actual_days,
          0                                                                          AS extra_day,
          COALESCE(spl.leave_days, 0)                                                AS leave_days,
          ROUND(spl.basic * spl.present_days / NULLIF(spl.working_days,0), 0)       AS basic1,
          ROUND(spl.hra   * spl.present_days / NULLIF(spl.working_days,0), 0)       AS hra1,
          ROUND(COALESCE(MAX(CASE WHEN c.component_code='BONUS'     THEN c.amount END),0)
                         * spl.present_days / NULLIF(spl.working_days,0), 0)        AS bonus1,
          ROUND(COALESCE(MAX(CASE WHEN c.component_code='CONV'      THEN c.amount END),0)
                         * spl.present_days / NULLIF(spl.working_days,0), 0)        AS conv1,
          ROUND(COALESCE(MAX(CASE WHEN c.component_code='PORTFOLIO' THEN c.amount END),0)
                         * spl.present_days / NULLIF(spl.working_days,0), 0)        AS portfolio1,
          ROUND(spl.special_allowance * spl.present_days / NULLIF(spl.working_days,0), 0) AS special1,
          ROUND(COALESCE(MAX(CASE WHEN c.component_code='OA'        THEN c.amount END),0)
                         * spl.present_days / NULLIF(spl.working_days,0), 0)        AS other_allow1,
          ROUND(COALESCE(MAX(CASE WHEN c.component_code='MA'        THEN c.amount END),0)
                         * spl.present_days / NULLIF(spl.working_days,0), 0)        AS medical1,
          ROUND(spl.gross_salary * spl.present_days / NULLIF(spl.working_days,0), 0) AS gross1,
          IF(spl.esic_employee > 0, 'YES', 'NO')                                    AS esi_elig,
          IF(spl.pf_employee   > 0, 'YES', 'NO')                                    AS pf_elig,
          spl.esic_employee,
          spl.pf_employee,
          COALESCE(spl.tds, MAX(CASE WHEN c.component_code='TDS'  THEN c.amount END), 0) AS tds,
          0                                                                          AS adv_taken,
          COALESCE(spl.advance_recovery, MAX(CASE WHEN c.component_code='ADV'  THEN c.amount END), 0) AS advance_recovery,
          0                                                                          AS loan_taken,
          COALESCE(spl.loan_emi, MAX(CASE WHEN c.component_code='LOAN' THEN c.amount END), 0) AS loan_ded,
          spl.incentive_total,
          COALESCE(MAX(CASE WHEN c.component_code='EXTRA_DAY_INC' THEN c.amount END),0) AS extra_day_inc,
          COALESCE(MAX(CASE WHEN c.component_code='ARREAR'        THEN c.amount END),0) AS arrear,
          0                                                                          AS pli,
          spl.net_salary,
          spl.esic_employer,
          spl.pf_employer,
          COALESCE(MAX(CASE WHEN c.component_code='ADMIN_CHG'     THEN c.amount END),0) AS admin_charges,
          ROUND(spl.gross_salary + spl.pf_employer + spl.esic_employer
                + COALESCE(MAX(CASE WHEN c.component_code='ADMIN_CHG' THEN c.amount END),0), 2) AS ctc,
          0                                                                          AS shsh,
          COALESCE(MAX(CASE WHEN c.component_code='MOBILE_DED'    THEN c.amount END),0) AS mobile_ded,
          0                                                                          AS short_collection,
          COALESCE(MAX(CASE WHEN c.component_code='ASSET_REC'     THEN c.amount END),0) AS asset_rec,
          COALESCE(MAX(CASE WHEN c.component_code='INS'           THEN c.amount END),0) AS insurance,
          COALESCE(spl.professional_tax, MAX(CASE WHEN c.component_code='PT'  THEN c.amount END), 0) AS pt,
          COALESCE(spl.lwp_deduction,    MAX(CASE WHEN c.component_code='LWP' THEN c.amount END), 0) AS lwp_deduction,
          COALESCE(spl.other_deductions, MAX(CASE WHEN c.component_code='OTHER_DED' THEN c.amount END), 0) AS other_deductions,
          COALESCE(spl.remarks, '')                                                  AS other_ded_remarks,
          ROUND(
            spl.pf_employee + spl.esic_employee
            + COALESCE(spl.tds, MAX(CASE WHEN c.component_code='TDS' THEN c.amount END), 0)
            + COALESCE(spl.professional_tax, MAX(CASE WHEN c.component_code='PT' THEN c.amount END), 0)
            + COALESCE(spl.lwp_deduction, MAX(CASE WHEN c.component_code='LWP' THEN c.amount END), 0)
            + COALESCE(spl.loan_emi, MAX(CASE WHEN c.component_code='LOAN' THEN c.amount END), 0)
            + COALESCE(spl.advance_recovery, MAX(CASE WHEN c.component_code='ADV' THEN c.amount END), 0)
            + COALESCE(spl.other_deductions, MAX(CASE WHEN c.component_code='OTHER_DED' THEN c.amount END), 0)
            + COALESCE(MAX(CASE WHEN c.component_code='MOBILE_DED' THEN c.amount END), 0)
            + COALESCE(MAX(CASE WHEN c.component_code='ASSET_REC'  THEN c.amount END), 0)
            + COALESCE(MAX(CASE WHEN c.component_code='INS'        THEN c.amount END), 0)
          , 2)                                                                       AS total_deduction,
          DATE_FORMAT(LAST_DAY(CONCAT(spr.run_month,'-01')), '%Y-%m-%d')            AS sal_date,
          COALESCE(e.uan_number, '')                                                 AS uan,
          COALESCE(e.epf_number, '')                                                 AS epf_no,
          COALESCE(e.esic_number, '')                                                AS esic_no,
          NULL AS cheque_no, NULL AS cheque_date, NULL AS print_date,
          IF(e.active_status = 1, '', 'LEFT')                                        AS left_status,
          NULL AS tax_total_gross, NULL AS tax_section10, NULL AS tax_balance,
          NULL AS tax_under_hd, NULL AS deduction_under24, NULL AS tax_gross_total,
          NULL AS tax_agg_chapter6, NULL AS total_income, NULL AS tax_on_total,
          NULL AS edu_cess, NULL AS tax_pay_edu_cess,
          NULL AS tax_deducted_prev, NULL AS balance_tax,
          COALESCE(e.account_type, '')                                               AS salary_pay_mode,
          COALESCE(e.bank_account_number, '')                                        AS ac_no,
          COALESCE(e.ifsc_code, '')                                                  AS ifsc_code,
          COALESCE(e.bank_name, '')                                                  AS ac_bank,
          COALESCE(e.bank_branch, '')                                                AS ac_branch
        FROM salary_prep_line spl
        JOIN salary_prep_run spr ON spr.id = spl.run_id
        JOIN employees e ON e.id = spl.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
        LEFT JOIN designation_master dm ON dm.id = e.designation_id
        LEFT JOIN department_master dpm ON dpm.id = e.department_id
        LEFT JOIN salary_prep_line_component c ON c.line_id = spl.id
        ${processJoin("pm", "e")}
        WHERE 1=1 ${bw} ${mw} ${ew} ${nw} ${pw}
        GROUP BY spl.id, spl.employee_code, e.full_name, bm.branch_name,
                 pm.process_name, cc.cost_centre_code, dm.designation_name,
                 dpm.dept_name, e.profile_type, e.emp_type, e.billable_status,
                 spl.working_days, spl.present_days, spl.active_calendar_days, spl.leave_days,
                 spl.basic, spl.hra, spl.special_allowance, spl.incentive_total,
                 spl.gross_salary, spl.net_salary, spl.pf_employee, spl.esic_employee,
                 spl.professional_tax, spl.tds, spl.lwp_deduction, spl.loan_emi,
                 spl.advance_recovery, spl.other_deductions, spl.pf_employer, spl.esic_employer,
                 spl.remarks, e.ctc, e.active_status, e.uan_number, e.epf_number, e.esic_number,
                 e.bank_account_number, e.ifsc_code, e.bank_name, e.bank_branch, e.account_type
        ORDER BY bm.branch_name, spl.employee_code
        LIMIT 10000
      `, [...bv, ...mv, ...ev, ...nv, ...pv]);
    },
  },

  // ── 2. Attendance Register ────────────────────────────────────────────────
  "attendance-register": {
    label: "Attendance Register",
    defaultDisplayLimit: 3000,
    columns: [
      { key: "employee_code", label: "Emp Code",     format: "text" },
      { key: "employee_name", label: "Employee Name",format: "text" },
      { key: "branch_name",   label: "Branch",       format: "text" },
      { key: "cost_center",   label: "Cost Centre",  format: "text" },
      { key: "att_date",      label: "Date",         format: "date" },
      { key: "status",        label: "Status",       format: "status" },
      { key: "old_status",    label: "Old Status",   format: "text" },
      { key: "source",        label: "Source",       format: "text" },
    ],
    async query(f) {
      const bCond = f.branch ? "AND branch_name = ?" : "";
      const eCond = f.employee_code ? "AND employee_code = ?" : "";
      // Use BETWEEN for month (avoids DATE_FORMAT full-scan on 2.2M-row snapshot)
      const monthStart = f.month ? `${f.month}-01` : null;
      const dCond = f.from_date ? `AND attend_date BETWEEN ? AND ?`
        : monthStart ? `AND attend_date BETWEEN ? AND LAST_DAY(?)` : "";
      const bv = f.branch ? [f.branch] : [];
      const ev = f.employee_code ? [f.employee_code] : [];
      const dv = f.from_date ? [f.from_date, f.to_date ?? "9999-12-31"]
        : monthStart ? [monthStart, monthStart] : [];
      const [bw2, bv2] = branchWhere("bm.branch_name", f.branch);
      const [ew2, ev2] = empWhere("e.employee_code", f.employee_code);
      const dCond2 = f.from_date ? `AND adr.record_date BETWEEN ? AND ?`
        : monthStart ? `AND adr.record_date BETWEEN ? AND LAST_DAY(?)` : "";
      return q(`
        SELECT employee_code, employee_name, branch_name, cost_center,
               attend_date AS att_date, status, old_status, 'legacy' AS source
        FROM attendance_legacy_snapshot
        WHERE 1=1 ${bCond} ${eCond} ${dCond}
        UNION ALL
        SELECT e.employee_code COLLATE utf8mb4_unicode_ci,
               e.full_name COLLATE utf8mb4_unicode_ci AS employee_name,
               bm.branch_name COLLATE utf8mb4_unicode_ci,
               cc.cost_centre_code COLLATE utf8mb4_unicode_ci AS cost_center,
               adr.record_date AS att_date,
               adr.attendance_status COLLATE utf8mb4_unicode_ci AS status,
               NULL AS old_status,
               'hrms' COLLATE utf8mb4_unicode_ci AS source
        FROM attendance_daily_record adr
        JOIN employees e ON e.id = adr.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
        WHERE 1=1 ${bw2} ${ew2} ${dCond2}
        ${f._limit != null && f._limit <= 5000 ? "" : "ORDER BY branch_name, employee_code, att_date"}
        LIMIT ${f._limit ?? 50000}
      `, [...bv, ...ev, ...dv, ...bv2, ...ev2, ...dv]);
    },
  },

  // ── 3. WFH Attendance ─────────────────────────────────────────────────────
  "wfh-attendance": {
    label: "WFH Attendance",
    columns: [
      { key: "employee_code", label: "Emp Code",     format: "text" },
      { key: "employee_name", label: "Employee Name",format: "text" },
      { key: "branch_name",   label: "Branch",       format: "text" },
      { key: "cost_center",   label: "Cost Centre",  format: "text" },
      { key: "att_date",      label: "Date",         format: "date" },
      { key: "status",        label: "Status",       format: "status" },
      { key: "old_status",    label: "Old Status",   format: "text" },
    ],
    async query(f) {
      const [bw, bv] = branchWhere("branch_name", f.branch);
      const [ew, ev] = empWhere("employee_code", f.employee_code);
      const [dw, dv] = f.from_date ? dateRangeWhere("att_date", f.from_date, f.to_date)
        : monthWhere("att_date", f.month);
      // Historical snapshot UNION live attendance_daily_record (work_mode=wfh)
      const [bw2, bv2] = branchWhere("bm.branch_name", f.branch);
      const [ew2, ev2] = empWhere("e.employee_code", f.employee_code);
      const dw2 = dw.replace(/att_date/g, "adr.record_date");
      return q(`
        SELECT employee_code, employee_name, branch_name, cost_center,
               att_date, status, old_status
        FROM wfh_attendance_snapshot
        WHERE 1=1 ${bw} ${ew} ${dw}
        UNION ALL
        SELECT e.employee_code COLLATE utf8mb4_unicode_ci,
               e.full_name COLLATE utf8mb4_unicode_ci AS employee_name,
               bm.branch_name COLLATE utf8mb4_unicode_ci,
               cc.cost_centre_code COLLATE utf8mb4_unicode_ci AS cost_center,
               adr.record_date AS att_date,
               adr.attendance_status COLLATE utf8mb4_unicode_ci AS status,
               NULL AS old_status
        FROM attendance_daily_record adr
        JOIN employees e ON e.id = adr.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
        WHERE adr.work_mode = 'wfh' ${bw2} ${ew2} ${dw2}
        ORDER BY branch_name, employee_code, att_date
        LIMIT ${f._limit ?? 50000}
      `, [...bv, ...ev, ...dv, ...bv2, ...ev2, ...dv]);
    },
  },

  // ── 4. Field Attendance ───────────────────────────────────────────────────
  "field-attendance": {
    label: "Field Attendance",
    columns: [
      { key: "employee_code", label: "Emp Code",     format: "text" },
      { key: "employee_name", label: "Employee Name",format: "text" },
      { key: "branch_name",   label: "Branch",       format: "text" },
      { key: "cost_center",   label: "Cost Centre",  format: "text" },
      { key: "att_date",      label: "Date",         format: "date" },
      { key: "status",        label: "Status",       format: "status" },
      { key: "old_status",    label: "Old Status",   format: "text" },
    ],
    async query(f) {
      const [bw, bv] = branchWhere("branch_name", f.branch);
      const [ew, ev] = empWhere("employee_code", f.employee_code);
      const [dw, dv] = f.from_date ? dateRangeWhere("attend_date", f.from_date, f.to_date)
        : monthWhere("attend_date", f.month);
      return q(`
        SELECT employee_code, employee_name, branch_name, cost_center,
               attend_date AS att_date, status, old_status
        FROM field_attendance_snapshot
        WHERE 1=1 ${bw} ${ew} ${dw}
        ORDER BY branch_name, employee_code, attend_date
        LIMIT ${f._limit ?? 50000}
      `, [...bv, ...ev, ...dv]);
    },
  },

  // ── 5. Attendance Issues / Regularization ─────────────────────────────────
  "attendance-issues": {
    label: "Attendance Issues",
    columns: [
      { key: "employee_code",       label: "Emp Code",       format: "text" },
      { key: "employee_name",       label: "Employee Name",  format: "text" },
      { key: "branch_name",         label: "Branch",         format: "text" },
      { key: "process_name",        label: "Process",        format: "text" },
      { key: "session_date",        label: "Att Date",       format: "date" },
      { key: "old_status",          label: "Current Status", format: "text" },
      { key: "new_status",          label: "Expected Status",format: "text" },
      { key: "dispute_type",        label: "Issue Type",     format: "text" },
      { key: "reason",              label: "Reason",         format: "text" },
      { key: "status",              label: "Approval Status",format: "status" },
      { key: "reviewed_at",         label: "Approved Date",  format: "date" },
      { key: "manager_review_note", label: "Approved By",    format: "text" },
    ],
    async query(f) {
      const [ew, ev] = empWhere("e.employee_code", f.employee_code);
      const [nw, nv] = nameWhere("e.full_name", f.employee_name);
      const [dw, dv] = f.from_date ? dateRangeWhere("ar.session_date", f.from_date, f.to_date)
        : monthWhere("ar.session_date", f.month);
      const [bw, bv] = branchWhere("bm.branch_name", f.branch);
      const [pw, pv] = processWhere("pm", f.process);
      return q(`
        SELECT e.employee_code, e.full_name AS employee_name,
               bm.branch_name, pm.process_name,
               ar.session_date, ar.old_status, ar.new_status,
               ar.dispute_type, ar.reason, ar.status,
               ar.reviewed_at, ar.manager_review_note
        FROM attendance_regularization ar
        JOIN employees e ON e.id = ar.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        ${processJoin("pm", "e")}
        WHERE ar.escalated_to LIKE 'BWAI:%' ${ew} ${nw} ${dw} ${bw} ${pw}
        ORDER BY bm.branch_name, e.employee_code, ar.session_date
        LIMIT ${f._limit ?? 50000}
      `, [...ev, ...nv, ...dv, ...bv, ...pv]);
    },
  },

  // ── 6. Leave Register ─────────────────────────────────────────────────────
  "leave-register": {
    label: "Leave Register",
    columns: [
      { key: "employee_code", label: "Emp Code",     format: "text" },
      { key: "employee_name", label: "Employee Name",format: "text" },
      { key: "branch_name",   label: "Branch",       format: "text" },
      { key: "process_name",  label: "Process",      format: "text" },
      { key: "cost_center",   label: "Cost Centre",  format: "text" },
      { key: "from_date",     label: "Leave From",   format: "date" },
      { key: "to_date",       label: "Leave To",     format: "date" },
      { key: "total_days",    label: "Total Days",   format: "number",   align: "right" },
      { key: "leave_type",    label: "Leave Type",   format: "text" },
      { key: "status",        label: "Status",       format: "status" },
      { key: "reason",        label: "Reason",       format: "text" },
    ],
    async query(f) {
      const [bw, bv] = branchWhere("bm.branch_name", f.branch);
      const [ew, ev] = empWhere("e.employee_code", f.employee_code);
      const [nw, nv] = nameWhere("e.full_name", f.employee_name);
      const [dw, dv] = f.from_date ? dateRangeWhere("lr.from_date", f.from_date, f.to_date)
        : monthWhere("lr.from_date", f.month);
      const [pw, pv] = processWhere("pm", f.process);
      return q(`
        SELECT e.employee_code, e.full_name AS employee_name,
               bm.branch_name, COALESCE(pm.process_name,'UNASSIGNED') AS process_name,
               cc.cost_centre_code AS cost_center,
               lr.from_date, lr.to_date, lr.total_days,
               COALESCE(lr.leave_type_code, '') AS leave_type,
               CONCAT(UPPER(SUBSTRING(lr.status,1,1)), LOWER(SUBSTRING(lr.status,2))) AS status,
               TRIM(REPLACE(lr.reason, 'Full Day ? ', '')) AS reason
        FROM leave_request lr
        JOIN employees e ON e.id = lr.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
        ${processJoin("pm", "e")}
        WHERE 1=1 ${bw} ${ew} ${nw} ${dw} ${pw}
        ORDER BY bm.branch_name, e.employee_code, lr.from_date
        LIMIT ${f._limit ?? 50000}
      `, [...bv, ...ev, ...nv, ...dv, ...pv]);
    },
  },

  // ── 7. Loan Register ──────────────────────────────────────────────────────
  "loan-register": {
    label: "Loan Register",
    sumCols: ["loan_amount", "deducted_amount", "pending_amount"],
    columns: [
      { key: "employee_code",      label: "Emp Code",          format: "text" },
      { key: "employee_name",      label: "Employee Name",     format: "text" },
      { key: "branch_name",        label: "Branch",            format: "text" },
      { key: "process_name",       label: "Process",           format: "text" },
      { key: "loan_type",          label: "Type",              format: "text" },
      { key: "loan_amount",        label: "Amount",            format: "currency", align: "right" },
      { key: "installment_amount", label: "Installment/Month", format: "currency", align: "right" },
      { key: "total_installments", label: "Installments",      format: "number",   align: "right" },
      { key: "start_date",         label: "Start Date",        format: "date" },
      { key: "end_date",           label: "End Date",          format: "date" },
      { key: "deducted_amount",    label: "Deducted",          format: "currency", align: "right" },
      { key: "pending_amount",     label: "Pending",           format: "currency", align: "right" },
      { key: "status",             label: "Status",            format: "status" },
    ],
    async query(f) {
      const [bw, bv] = branchWhere("bm.branch_name", f.branch);
      const [ew, ev] = empWhere("e.employee_code", f.employee_code);
      const [nw, nv] = nameWhere("e.full_name", f.employee_name);
      const [pw, pv] = processWhere("pm", f.process);
      return q(`
        SELECT e.employee_code, e.full_name AS employee_name,
               bm.branch_name, COALESCE(pm.process_name,'UNASSIGNED') AS process_name,
               el.loan_type,
               el.amount AS loan_amount, el.deduction_per_month AS installment_amount, el.installments AS total_installments,
               el.start_date, el.end_date,
               el.deducted_amount,
               el.pending_amount,
               el.status
        FROM employee_loans el
        JOIN employees e ON e.id = el.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        ${processJoin("pm", "e")}
        WHERE 1=1 ${bw} ${ew} ${nw} ${pw}
        ORDER BY bm.branch_name, e.employee_code
        LIMIT 10000
      `, [...bv, ...ev, ...nv, ...pv]);
    },
  },

  // ── 8. Income Tax Register ────────────────────────────────────────────────
  "income-tax-register": {
    label: "Income Tax Register",
    sumCols: ["tds_amount"],
    columns: [
      { key: "employee_code", label: "Emp Code",     format: "text" },
      { key: "employee_name", label: "Employee Name",format: "text" },
      { key: "branch_name",   label: "Branch",       format: "text" },
      { key: "tax_month",     label: "Tax Month",    format: "text" },
      { key: "tds_amount",    label: "Income Tax",   format: "currency", align: "right" },
      { key: "source",        label: "Source",       format: "text" },
    ],
    async query(f) {
      const mCond = f.month ? "AND ils.tax_month = ?" : "";
      const mv    = f.month ? [f.month] : [];
      const [bw1, bv1] = branchWhere("bm1.branch_name", f.branch);
      const [ew1, ev1] = empWhere("ils.employee_code", f.employee_code);
      const [bw2, bv2] = branchWhere("bm2.branch_name", f.branch);
      const [ew2, ev2] = empWhere("spl.employee_code", f.employee_code);
      const mCond2 = f.month ? "AND spr.run_month = ?" : "";
      return q(`
        SELECT ils.employee_code, e1.full_name AS employee_name,
               bm1.branch_name, ils.tax_month,
               ils.income_tax AS tds_amount, 'legacy' AS source
        FROM incometax_legacy_snapshot ils
        JOIN employees e1 ON e1.employee_code = ils.employee_code COLLATE utf8mb4_0900_ai_ci
        LEFT JOIN branch_master bm1 ON bm1.id = e1.branch_id
        WHERE 1=1 ${mCond} ${bw1} ${ew1}
        UNION ALL
        SELECT spl.employee_code COLLATE utf8mb4_unicode_ci,
               e2.full_name COLLATE utf8mb4_unicode_ci AS employee_name,
               bm2.branch_name COLLATE utf8mb4_unicode_ci,
               spr.run_month COLLATE utf8mb4_unicode_ci AS tax_month,
               spl.tds AS tds_amount,
               'hrms' COLLATE utf8mb4_unicode_ci AS source
        FROM salary_prep_line spl
        JOIN salary_prep_run spr ON spr.id = spl.run_id
        JOIN employees e2 ON e2.id = spl.employee_id
        LEFT JOIN branch_master bm2 ON bm2.id = e2.branch_id
        WHERE spl.tds > 0 ${mCond2} ${bw2} ${ew2}
        ORDER BY branch_name, employee_code, tax_month
        LIMIT ${f._limit ?? 50000}
      `, [...mv, ...bv1, ...ev1, ...mv, ...bv2, ...ev2]);
    },
  },

  // ── 9. OD Register ────────────────────────────────────────────────────────
  "od-register": {
    label: "OD Register",
    columns: [
      { key: "employee_code",  label: "Emp Code",    format: "text" },
      { key: "employee_name",  label: "Employee Name",format: "text" },
      { key: "branch_name",    label: "Branch",      format: "text" },
      { key: "designation",    label: "Designation", format: "text" },
      { key: "start_date",     label: "OD From",     format: "date" },
      { key: "end_date",       label: "OD To",       format: "date" },
      { key: "reason",         label: "Reason",      format: "text" },
      { key: "current_status", label: "Status",      format: "text" },
      { key: "approve_first",  label: "L1 Approval", format: "text" },
      { key: "approve_second", label: "L2 Approval", format: "text" },
      { key: "created_at",     label: "Created Date",format: "date" },
    ],
    async query(f) {
      const [bw, bv] = branchWhere("branch_name", f.branch);
      const [ew, ev] = empWhere("employee_code", f.employee_code);
      const [dw, dv] = f.from_date ? dateRangeWhere("start_date", f.from_date, f.to_date)
        : monthWhere("start_date", f.month);
      return q(`
        SELECT employee_code, employee_name, branch_name, designation,
               start_date, end_date, reason, current_status,
               approve_first, approve_second, created_at
        FROM od_register_snapshot
        WHERE 1=1 ${bw} ${ew} ${dw}
        ORDER BY branch_name, employee_code, start_date
        LIMIT 10000
      `, [...bv, ...ev, ...dv]);
    },
  },

  // ── 10. Incentive Register ────────────────────────────────────────────────
  "incentive-register": {
    label: "Incentive Register",
    sumCols: ["amount"],
    columns: [
      { key: "employee_code",  label: "Emp Code",       format: "text" },
      { key: "employee_name",  label: "Employee Name",  format: "text" },
      { key: "branch_name",    label: "Branch",         format: "text" },
      { key: "cost_center",    label: "Cost Centre",    format: "text" },
      { key: "incentive_type", label: "Incentive Type", format: "text" },
      { key: "amount",         label: "Amount",         format: "currency", align: "right" },
      { key: "salary_month",   label: "Salary Month",   format: "text" },
      { key: "approve_status", label: "Status",         format: "status" },
    ],
    async query(f) {
      const [bw, bv] = branchWhere("branch_name", f.branch);
      const [ew, ev] = empWhere("employee_code", f.employee_code);
      const [mw, mv] = monthWhere("salary_month", f.month);
      return q(`
        SELECT employee_code, employee_name, branch_name, cost_center,
               incentive_type, amount, salary_month, approve_status
        FROM incentive_upload_snapshot
        WHERE 1=1 ${bw} ${ew} ${mw}
        ORDER BY branch_name, employee_code, salary_month
        LIMIT ${f._limit ?? 50000}
      `, [...bv, ...ev, ...mv]);
    },
  },

  // ── 11. Deduction Register ────────────────────────────────────────────────
  "deduction-register": {
    label: "Deduction Register",
    sumCols: ["mobile_deduction", "short_collection", "asset_recovery", "leave_deduction", "others_deduction"],
    columns: [
      { key: "employee_code",    label: "Emp Code",        format: "text" },
      { key: "employee_name",    label: "Employee Name",   format: "text" },
      { key: "branch_name",      label: "Branch",          format: "text" },
      { key: "cost_center",      label: "Cost Centre",     format: "text" },
      { key: "salary_month",     label: "Salary Month",    format: "text" },
      { key: "mobile_deduction", label: "Mobile Ded",      format: "currency", align: "right" },
      { key: "short_collection", label: "Short Collection",format: "currency", align: "right" },
      { key: "asset_recovery",   label: "Asset Recovery",  format: "currency", align: "right" },
      { key: "insurance",        label: "Insurance",       format: "currency", align: "right" },
      { key: "leave_deduction",  label: "Leave Ded",       format: "currency", align: "right" },
      { key: "others_deduction", label: "Other Ded",       format: "currency", align: "right" },
      { key: "remarks",          label: "Remarks",         format: "text" },
    ],
    async query(f) {
      const [bw, bv] = branchWhere("branch_name", f.branch);
      const [ew, ev] = empWhere("employee_code", f.employee_code);
      // salary_month and run_month are varchar(YYYY-MM) — use direct equality
      const mw  = f.month ? "AND salary_month = ?" : "";
      const mv  = f.month ? [f.month] : [];
      const [ew2, ev2] = empWhere("e.employee_code", f.employee_code);
      const mw2 = f.month ? "AND ede.run_month = ?" : "";
      const mv2 = f.month ? [f.month] : [];
      const bw2 = f.branch ? "AND bm.branch_name = ?" : "";
      const bv2 = f.branch ? [f.branch] : [];
      return q(`
        SELECT employee_code, employee_name, branch_name, cost_center,
               salary_month, mobile_deduction, short_collection,
               asset_recovery, insurance, leave_deduction,
               others_deduction, remarks
        FROM upload_deduction_snapshot
        WHERE 1=1 ${bw} ${ew} ${mw}
        UNION ALL
        SELECT e.employee_code COLLATE utf8mb4_unicode_ci,
               e.full_name COLLATE utf8mb4_unicode_ci AS employee_name,
               bm.branch_name COLLATE utf8mb4_unicode_ci,
               cc.cost_centre_code COLLATE utf8mb4_unicode_ci AS cost_center,
               ede.run_month COLLATE utf8mb4_unicode_ci AS salary_month,
               0 AS mobile_deduction, 0 AS short_collection,
               0 AS asset_recovery, 0 AS insurance, 0 AS leave_deduction,
               SUM(ede.amount) AS others_deduction,
               GROUP_CONCAT(ede.deduction_type_code SEPARATOR ', ') COLLATE utf8mb4_unicode_ci AS remarks
        FROM employee_deduction_entries ede
        JOIN employees e ON e.id = ede.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
        WHERE 1=1 ${ew2} ${mw2} ${bw2}
        GROUP BY e.employee_code, e.full_name, bm.branch_name,
                 cc.cost_centre_code, ede.run_month
        ORDER BY branch_name, employee_code, salary_month
        LIMIT ${f._limit ?? 50000}
      `, [...bv, ...ev, ...mv, ...ev2, ...mv2, ...bv2]);
    },
  },

  // ── 12. Employee Transfer Register ────────────────────────────────────────
  "transfer-register": {
    label: "Transfer Register",
    columns: [
      { key: "employee_code",    label: "Emp Code",    format: "text" },
      { key: "from_branch",      label: "From Branch", format: "text" },
      { key: "to_branch",        label: "To Branch",   format: "text" },
      { key: "from_cost_center", label: "From CC",     format: "text" },
      { key: "to_cost_center",   label: "To CC",       format: "text" },
      { key: "move_month",       label: "Move Month",  format: "text" },
      { key: "reason",           label: "Reason",      format: "text" },
      { key: "move_date",        label: "Move Date",   format: "date" },
    ],
    async query(f) {
      const [ew, ev] = empWhere("employee_code", f.employee_code);
      const bCond = f.branch ? "AND (from_branch = ? OR to_branch = ?)" : "";
      const bv    = f.branch ? [f.branch, f.branch] : [];
      const [mw, mv] = monthWhere("move_month", f.month);
      return q(`
        SELECT employee_code, from_branch, to_branch,
               from_cost_center, to_cost_center,
               move_month, reason, move_date
        FROM employee_move_snapshot
        WHERE 1=1 ${ew} ${bCond} ${mw}
        ORDER BY move_month DESC, employee_code
        LIMIT 10000
      `, [...ev, ...bv, ...mv]);
    },
  },

  // ── 13. DOJ Change Register ───────────────────────────────────────────────
  "doj-change-register": {
    label: "DOJ Change Register",
    columns: [
      { key: "employee_code", label: "Emp Code",     format: "text" },
      { key: "employee_name", label: "Employee Name",format: "text" },
      { key: "branch_name",   label: "Branch",       format: "text" },
      { key: "old_doj",       label: "Old DOJ",      format: "date" },
      { key: "new_doj",       label: "New DOJ",      format: "date" },
      { key: "remarks",       label: "Remarks",      format: "text" },
      { key: "approve_status",label: "Status",       format: "status" },
      { key: "approve_date",  label: "Approved On",  format: "date" },
    ],
    async query(f) {
      const [bw, bv] = branchWhere("branch_name", f.branch);
      const [ew, ev] = empWhere("employee_code", f.employee_code);
      return q(`
        SELECT employee_code, employee_name, branch_name,
               old_doj, new_doj, remarks, approve_status, approve_date
        FROM change_doj_snapshot
        WHERE 1=1 ${bw} ${ew}
        ORDER BY branch_name, employee_code
        LIMIT 10000
      `, [...bv, ...ev]);
    },
  },

  // ── 14. Document Register ─────────────────────────────────────────────────
  "document-register": {
    label: "Document Register",
    columns: [
      { key: "offer_no",    label: "Offer No",  format: "text" },
      { key: "doc_type",    label: "Doc Type",  format: "text" },
      { key: "doc_name",    label: "Doc Name",  format: "text" },
      { key: "file_no",     label: "File No",   format: "text" },
      { key: "box_no",      label: "Box No",    format: "text" },
      { key: "doc_status",  label: "Status",    format: "status" },
      { key: "save_date",   label: "Saved On",  format: "date" },
    ],
    async query(f) {
      const oCond = f.employee_code ? "AND offer_no = ?" : "";
      const ov    = f.employee_code ? [f.employee_code] : [];
      const [dw, dv] = f.from_date ? dateRangeWhere("save_date", f.from_date, f.to_date)
        : monthWhere("save_date", f.month);
      return q(`
        SELECT offer_no, doc_type, doc_name, file_no,
               box_no, doc_status, save_date
        FROM doc_legacy_snapshot
        WHERE 1=1 ${oCond} ${dw}
        ORDER BY offer_no, doc_type
        LIMIT ${f._limit ?? 50000}
      `, [...ov, ...dv]);
    },
  },

  // ── 15. Legacy Employee Master ────────────────────────────────────────────
  "legacy-employee-master": {
    label: "Legacy Employee Master",
    columns: [
      { key: "employee_code",  label: "Emp Code",    format: "text" },
      { key: "employee_name",  label: "Name",        format: "text" },
      { key: "branch_name",    label: "Branch",      format: "text" },
      { key: "process",        label: "Process",     format: "text" },
      { key: "designation",    label: "Designation", format: "text" },
      { key: "doj",            label: "DOJ",         format: "date" },
      { key: "dol",            label: "DOL",         format: "date" },
      { key: "basic",          label: "Basic",       format: "currency", align: "right" },
      { key: "hra",            label: "HRA",         format: "currency", align: "right" },
      { key: "gross",          label: "Gross",       format: "currency", align: "right" },
      { key: "ctc_monthly",    label: "CTC/Month",   format: "currency", align: "right" },
      { key: "net_salary",     label: "Net In Hand", format: "currency", align: "right" },
      { key: "pf_eligible",    label: "PF Eligible", format: "text" },
      { key: "esic_eligible",  label: "ESI Eligible",format: "text" },
    ],
    async query(f) {
      const [bw, bv] = branchWhere("ls.branch_name", f.branch);
      const [ew, ev] = empWhere("ls.employee_code", f.employee_code);
      const [nw, nv] = nameWhere("ls.employee_name", f.employee_name);
      const pw  = f.process ? "AND ls.process = ?"     : "";
      const pv  = f.process ? [f.process]              : [];
      return q(`
        SELECT ls.employee_code, ls.employee_name, ls.branch_name,
               ls.process, ls.designation, ls.doj, ls.dol,
               ls.basic, ls.hra, ls.gross, ls.ctc_monthly, ls.net_salary,
               IF(ls.pf_eligible, 'YES', 'NO') AS pf_eligible,
               IF(ls.esic_eligible, 'YES', 'NO') AS esic_eligible
        FROM legacy_salary_snapshot ls
        WHERE 1=1 ${bw} ${ew} ${nw} ${pw}
        ORDER BY ls.branch_name, ls.employee_code
        LIMIT ${f._limit ?? 50000}
      `, [...bv, ...ev, ...nv, ...pv]);
    },
  },

  // ── 16. Salary History ────────────────────────────────────────────────────
  "salary-history": {
    label: "Salary History",
    columns: [
      { key: "employee_code",  label: "Emp Code",     format: "text" },
      { key: "employee_name",  label: "Name",         format: "text" },
      { key: "branch_name",    label: "Branch",       format: "text" },
      { key: "process_name",   label: "Process",      format: "text" },
      { key: "designation",    label: "Designation",  format: "text" },
      { key: "basic",          label: "Basic",        format: "currency", align: "right" },
      { key: "hra",            label: "HRA",          format: "currency", align: "right" },
      { key: "gross",          label: "Gross",        format: "currency", align: "right" },
      { key: "ctc_monthly",    label: "CTC/Month",    format: "currency", align: "right" },
      { key: "net_in_hand",    label: "Net In Hand",  format: "currency", align: "right" },
      { key: "effective_from", label: "Effective",    format: "date" },
    ],
    async query(f) {
      const [ew, ev] = empWhere("e.employee_code", f.employee_code);
      const [nw, nv] = nameWhere("e.full_name", f.employee_name);
      const [pw, pv] = processWhere("pm", f.process);
      const bCond = f.branch ? "AND esh.branch_name = ?" : "";
      const bv    = f.branch ? [f.branch] : [];
      return q(`
        SELECT e.employee_code, e.full_name AS employee_name,
               esh.branch_name, COALESCE(pm.process_name,'UNASSIGNED') AS process_name,
               esh.designation_name AS designation,
               esh.basic, esh.hra, esh.gross, esh.ctc AS ctc_monthly,
               esh.net_in_hand, esh.effective_from
        FROM employee_salary_history esh
        JOIN employees e ON e.id = esh.employee_id
        ${processJoin("pm", "e")}
        WHERE esh.source = 'data_migration' ${ew} ${nw} ${bCond} ${pw}
        ORDER BY e.employee_code, esh.effective_from DESC
        LIMIT ${f._limit ?? 50000}
      `, [...ev, ...nv, ...bv, ...pv]);
    },
  },

  // ── 17. Quality Attendance ────────────────────────────────────────────────
  "qual-attendance": {
    label: "Quality Attendance",
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text" },
      { key: "present",       label: "Present",  format: "number", align: "right" },
      { key: "wo",            label: "WO",       format: "number", align: "right" },
      { key: "holiday",       label: "Holiday",  format: "number", align: "right" },
      { key: "half_day",      label: "Half Day", format: "number", align: "right" },
      { key: "compoff",       label: "Compoff",  format: "number", align: "right" },
      { key: "el",            label: "EL",       format: "number", align: "right" },
      { key: "cl",            label: "CL",       format: "number", align: "right" },
      { key: "sl",            label: "SL",       format: "number", align: "right" },
      { key: "ot",            label: "OT",       format: "number", align: "right" },
      { key: "sal_month",     label: "Month",    format: "text" },
      { key: "sal_year",      label: "Year",     format: "text" },
    ],
    async query(f) {
      const [ew, ev] = empWhere("employee_code", f.employee_code);
      // sal_month stored as 3-letter name ('Jan','Feb',...,'Dec'), sal_year as string ('2026')
      const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      let mCond = ""; let mv: unknown[] = [];
      if (f.month) {
        const [yr, mo] = f.month.split('-');
        mCond = "AND sal_month = ? AND sal_year = ?";
        mv = [MONTH_NAMES[parseInt(mo, 10) - 1], yr];
      }
      return q(`
        SELECT employee_code, present, wo, holiday, half_day,
               compoff, el, cl, sl, ot, sal_month, sal_year
        FROM qual_attendance_snapshot
        WHERE 1=1 ${ew} ${mCond}
        ORDER BY sal_year DESC, sal_month DESC, employee_code
        LIMIT ${f._limit ?? 50000}
      `, [...ev, ...mv]);
    },
  },

  // ── 18. Quality Leave ─────────────────────────────────────────────────────
  "qual-leave": {
    label: "Quality Leave",
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text" },
      { key: "pl",            label: "PL",       format: "number", align: "right" },
      { key: "cl",            label: "CL",       format: "number", align: "right" },
      { key: "sl",            label: "SL",       format: "number", align: "right" },
      { key: "leave_status",  label: "Status",   format: "status" },
      { key: "leave_month",   label: "Month",    format: "text" },
      { key: "leave_year",    label: "Year",     format: "text" },
    ],
    async query(f) {
      const [ew, ev] = empWhere("employee_code", f.employee_code);
      // leave_month stored as 3-letter name ('Jan','Feb',...,'Dec'), leave_year as string
      const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      let mCond = ""; let mv: unknown[] = [];
      if (f.month) {
        const [yr, mo] = f.month.split('-');
        mCond = "AND leave_month = ? AND leave_year = ?";
        mv = [MONTH_NAMES[parseInt(mo, 10) - 1], yr];
      }
      return q(`
        SELECT employee_code, pl, cl, sl, leave_status, leave_month, leave_year
        FROM qual_leave_snapshot
        WHERE 1=1 ${ew} ${mCond}
        ORDER BY leave_year DESC, leave_month DESC, employee_code
        LIMIT ${f._limit ?? 50000}
      `, [...ev, ...mv]);
    },
  },

  // ── 19. Quality Salary ────────────────────────────────────────────────────
  "qual-salary": {
    label: "Quality Salary",
    sumCols: ["gross", "net_pay", "pf", "esi", "tds"],
    columns: [
      { key: "employee_code", label: "Emp Code",  format: "text" },
      { key: "qual_emp_code", label: "Qual Code", format: "text" },
      { key: "employee_name", label: "Name",      format: "text" },
      { key: "designation",   label: "Desg",      format: "text" },
      { key: "basic",         label: "Basic",     format: "currency", align: "right" },
      { key: "hra",           label: "HRA",       format: "currency", align: "right" },
      { key: "gross",         label: "Gross",     format: "currency", align: "right" },
      { key: "pf",            label: "PF",        format: "currency", align: "right" },
      { key: "tds",           label: "TDS",       format: "currency", align: "right" },
      { key: "esi",           label: "ESIC",      format: "currency", align: "right" },
      { key: "net_pay",       label: "Net Pay",   format: "currency", align: "right" },
      { key: "sal_month",     label: "Month",     format: "text" },
      { key: "sal_year",      label: "Year",      format: "text" },
    ],
    async query(f) {
      const [ew, ev] = empWhere("employee_code", f.employee_code);
      // sal_month stored as 3-letter name ('Jan','Feb',...,'Dec'), sal_year as string
      const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      let mCond = ""; let mv: unknown[] = [];
      if (f.month) {
        const [yr, mo] = f.month.split('-');
        mCond = "AND sal_month = ? AND sal_year = ?";
        mv = [MONTH_NAMES[parseInt(mo, 10) - 1], yr];
      }
      return q(`
        SELECT employee_code, qual_emp_code, employee_name, designation,
               basic, hra, gross, pf, tds, esi, net_pay,
               sal_month, sal_year
        FROM qual_salary_snapshot
        WHERE 1=1 ${ew} ${mCond}
        ORDER BY sal_year DESC, sal_month DESC, employee_code
        LIMIT ${f._limit ?? 50000}
      `, [...ev, ...mv]);
    },
  },

  // ── 20. Quality Incentive ─────────────────────────────────────────────────
  "qual-incentive": {
    label: "Quality Incentive",
    sumCols: ["amount"],
    columns: [
      { key: "employee_code", label: "Emp Code",  format: "text" },
      { key: "amount",        label: "Incentive", format: "currency", align: "right" },
      { key: "sal_month",     label: "Month",     format: "text" },
      { key: "sal_year",      label: "Year",      format: "text" },
      { key: "remarks",       label: "Remarks",   format: "text" },
    ],
    async query(f) {
      const [ew, ev] = empWhere("employee_code", f.employee_code);
      // sal_month stored as 3-letter name ('Jan','Feb',...,'Dec'), sal_year as string
      const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      let mCond = ""; let mv: unknown[] = [];
      if (f.month) {
        const [yr, mo] = f.month.split('-');
        mCond = "AND sal_month = ? AND sal_year = ?";
        mv = [MONTH_NAMES[parseInt(mo, 10) - 1], yr];
      }
      return q(`
        SELECT employee_code, amount, sal_month, sal_year, remarks
        FROM qual_incentive_snapshot
        WHERE 1=1 ${ew} ${mCond}
        ORDER BY sal_year DESC, sal_month DESC, employee_code
        LIMIT ${f._limit ?? 50000}
      `, [...ev, ...mv]);
    },
  },

  // "leave-balance" — uses leave_balance_ledger
  "leave-balance": {
    label: "Leave Balance",
    columns: [
      { key: "employee_code", label: "Emp Code",      format: "text" },
      { key: "employee_name", label: "Employee Name", format: "text" },
      { key: "branch_name",   label: "Branch",        format: "text" },
      { key: "leave_type",    label: "Leave Type",    format: "text" },
      { key: "balance_year",  label: "Year",          format: "text" },
      { key: "allocated",     label: "Allocated",     format: "number" },
      { key: "used",          label: "Used",          format: "number" },
      { key: "adjusted",      label: "Adjusted",      format: "number" },
    ],
    async query(f: LegacyFilter) {
      const [nw, nv] = nameWhere("e.full_name", f.employee_name);
      const [bw, bv] = branchWhere("bm.branch_name", f.branch);
      const [ew, ev] = empWhere("e.employee_code", f.employee_code);
      const pj = processJoin("pm", "e");
      const [pw, pv] = processWhere("pm", f.process);
      return q(`
        SELECT e.employee_code, e.full_name AS employee_name,
               bm.branch_name,
               ltm.leave_name AS leave_type,
               lbl.balance_year,
               lbl.allocated_days AS allocated,
               lbl.used_days AS used,
               lbl.adjusted_days AS adjusted
        FROM leave_balance_ledger lbl
        JOIN employees e ON e.id = lbl.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        LEFT JOIN leave_type_master ltm ON ltm.id = lbl.leave_type_id
        ${pj}
        WHERE e.active_status = 1 ${bw} ${ew} ${pw} ${nw}
        ORDER BY bm.branch_name, e.employee_code, ltm.leave_name
        LIMIT ${f._limit ?? 50000}
      `, [...bv, ...ev, ...pv, ...nv]);
    },
  },

  // "bank-account" — employee bank details with optional salary join
  "bank-account": {
    label: "Bank Account Register",
    columns: [
      { key: "employee_code",    label: "Emp Code",        format: "text" },
      { key: "employee_name",    label: "Employee Name",   format: "text" },
      { key: "branch_name",      label: "Branch",          format: "text" },
      { key: "bank_name",        label: "Bank Name",       format: "text" },
      { key: "account_number",   label: "Account Number",  format: "text" },
      { key: "ifsc_code",        label: "IFSC Code",       format: "text" },
      { key: "account_type",     label: "Account Type",    format: "text" },
      { key: "net_amount",       label: "Net Amount",      format: "currency", align: "right" },
      { key: "salary_month",     label: "Month",           format: "text" },
    ],
    async query(f: LegacyFilter) {
      const [nw, nv] = nameWhere("e.full_name", f.employee_name);
      const pj = processJoin("pm", "e");
      const [pw, pv] = processWhere("pm", f.process);
      const [bw, bv] = branchWhere("bm.branch_name", f.branch);
      if (f.month) {
        return q(`
          SELECT e.employee_code, e.full_name AS employee_name,
                 bm.branch_name,
                 e.bank_name, e.bank_account_number AS account_number, e.ifsc_code, e.account_type,
                 spl.net_salary AS net_amount, spr.run_month AS salary_month
          FROM salary_prep_line spl
          JOIN salary_prep_run spr ON spr.id = spl.run_id AND spr.run_month = ?
          JOIN employees e ON e.id = spl.employee_id
          LEFT JOIN branch_master bm ON bm.id = e.branch_id
          ${pj}
          WHERE 1=1 ${bw} ${pw} ${nw}
          ORDER BY bm.branch_name, e.employee_code
          LIMIT ${f._limit ?? 50000}
        `, [f.month, ...bv, ...pv, ...nv]);
      }
      return q(`
        SELECT e.employee_code, e.full_name AS employee_name,
               bm.branch_name,
               e.bank_name, e.bank_account_number AS account_number, e.ifsc_code, e.account_type,
               NULL AS net_amount, NULL AS salary_month
        FROM employees e
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        ${pj}
        WHERE e.active_status = 1 ${bw} ${pw} ${nw}
        ORDER BY bm.branch_name, e.employee_code
        LIMIT ${f._limit ?? 50000}
      `, [...bv, ...pv, ...nv]);
    },
  },

  // "nominee-details" stub
  "nominee-details": {
    label: "Nominee Details",
    columns: [
      { key: "employee_code",   label: "Emp Code",       format: "text" },
      { key: "employee_name",   label: "Employee Name",  format: "text" },
      { key: "nominee_name",    label: "Nominee Name",   format: "text" },
      { key: "relationship",    label: "Relationship",   format: "text" },
      { key: "dob",             label: "Date of Birth",  format: "date" },
      { key: "share_pct",       label: "Share %",        format: "number" },
    ],
    async query(f: LegacyFilter) {
      const [nw, nv] = nameWhere("e.full_name", f.employee_name);
      return q(`
        SELECT e.employee_code, e.full_name AS employee_name,
               en.nominee_name, en.relationship, en.date_of_birth AS dob, en.share_percentage AS share_pct
        FROM employee_nominee en
        JOIN employees e ON e.id = en.employee_id
        WHERE e.active_status = 1 ${nw}
        ORDER BY e.employee_code, en.nominee_name
        LIMIT ${f._limit ?? 50000}
      `, [...nv]);
    },
  },

  // "asset-details" — uses asset_assignment + asset_master
  "asset-details": {
    label: "Asset Details",
    columns: [
      { key: "employee_code",  label: "Emp Code",       format: "text" },
      { key: "employee_name",  label: "Employee Name",  format: "text" },
      { key: "asset_code",     label: "Asset Code",     format: "text" },
      { key: "asset_name",     label: "Asset Name",     format: "text" },
      { key: "asset_category", label: "Category",       format: "text" },
      { key: "issue_date",     label: "Issue Date",     format: "date" },
      { key: "return_date",    label: "Return Date",    format: "date" },
    ],
    async query(f: LegacyFilter) {
      const [nw, nv] = nameWhere("e.full_name", f.employee_name);
      const pj = processJoin("pm", "e");
      const [pw, pv] = processWhere("pm", f.process);
      return q(`
        SELECT e.employee_code, e.full_name AS employee_name,
               am.asset_code, am.asset_name, am.asset_category,
               aa.assigned_date AS issue_date, aa.returned_date AS return_date
        FROM asset_assignment aa
        JOIN employees e ON e.id = aa.employee_id
        JOIN asset_master am ON am.id = aa.asset_id
        ${pj}
        WHERE 1=1 ${pw} ${nw}
        ORDER BY e.employee_code, am.asset_name
        LIMIT ${f._limit ?? 50000}
      `, [...pv, ...nv]);
    },
  },

  // "resignation-tracker" — uses exit_request table
  "resignation-tracker": {
    label: "Resignation Tracker",
    columns: [
      { key: "employee_code",    label: "Emp Code",         format: "text" },
      { key: "employee_name",    label: "Employee Name",    format: "text" },
      { key: "branch_name",      label: "Branch",           format: "text" },
      { key: "exit_type",        label: "Exit Type",        format: "text" },
      { key: "reason",           label: "Reason",           format: "text" },
      { key: "lwd_proposed",     label: "LWD Proposed",     format: "date" },
      { key: "lwd_confirmed",    label: "LWD Confirmed",    format: "date" },
      { key: "status",           label: "Status",           format: "text" },
    ],
    async query(f: LegacyFilter) {
      const [nw, nv] = nameWhere("e.full_name", f.employee_name);
      const pj = processJoin("pm", "e");
      const [pw, pv] = processWhere("pm", f.process);
      return q(`
        SELECT e.employee_code, e.full_name AS employee_name,
               bm.branch_name,
               er.exit_type, er.exit_reason_category AS reason,
               er.last_working_day_proposed AS lwd_proposed,
               er.last_working_day_confirmed AS lwd_confirmed,
               er.status
        FROM exit_request er
        JOIN employees e ON e.id = er.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        ${pj}
        WHERE er.exit_sub_type = 'resignation' ${pw} ${nw}
        ORDER BY er.submitted_at DESC, e.employee_code
        LIMIT ${f._limit ?? 50000}
      `, [...pv, ...nv]);
    },
  },

  // "exit-checklist" — uses exit_clearance_task
  "exit-checklist": {
    label: "Exit Clearance Checklist",
    columns: [
      { key: "employee_code",  label: "Emp Code",       format: "text" },
      { key: "employee_name",  label: "Employee Name",  format: "text" },
      { key: "branch_name",    label: "Branch",         format: "text" },
      { key: "clearance_area", label: "Clearance Area", format: "text" },
      { key: "task_title",     label: "Task",           format: "text" },
      { key: "status",         label: "Status",         format: "text" },
    ],
    async query(f: LegacyFilter) {
      const [nw, nv] = nameWhere("e.full_name", f.employee_name);
      const pj = processJoin("pm", "e");
      const [pw, pv] = processWhere("pm", f.process);
      return q(`
        SELECT e.employee_code, e.full_name AS employee_name,
               bm.branch_name,
               ect.clearance_area, ect.task_title, ect.status
        FROM exit_clearance_task ect
        JOIN employees e ON e.id = ect.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        ${pj}
        WHERE 1=1 ${pw} ${nw}
        ORDER BY e.employee_code, ect.clearance_area, ect.task_title
        LIMIT ${f._limit ?? 50000}
      `, [...pv, ...nv]);
    },
  },

  // "pf-esic-register" stub — uses employee_statutory_details
  "pf-esic-register": {
    label: "PF/ESIC Register",
    columns: [
      { key: "employee_code", label: "Emp Code",      format: "text" },
      { key: "employee_name", label: "Employee Name", format: "text" },
      { key: "branch_name",   label: "Branch",        format: "text" },
      { key: "uan_number",    label: "UAN",           format: "text" },
      { key: "pf_number",     label: "PF Number",     format: "text" },
      { key: "esic_number",   label: "ESIC Number",   format: "text" },
      { key: "epf_wages",     label: "PF Wage",       format: "currency", align: "right" },
      { key: "esic_wages",    label: "ESIC Wages",    format: "currency", align: "right" },
      { key: "total_pf",      label: "Total PF",      format: "currency", align: "right" },
      { key: "total_esic",    label: "Total ESIC",    format: "currency", align: "right" },
      { key: "run_month",     label: "Month",         format: "text" },
    ],
    async query(f: LegacyFilter) {
      const mCond = f.month ? "AND spr.run_month = ?" : "";
      const mv    = f.month ? [f.month] : [];
      const [nw, nv] = nameWhere("e.full_name", f.employee_name);
      const pj = processJoin("pm", "e");
      const [pw, pv] = processWhere("pm", f.process);
      return q(`
        SELECT e.employee_code, e.full_name AS employee_name,
               bm.branch_name,
               COALESCE(eu.uan, e.uan_number) AS uan_number,
               e.epf_number AS pf_number,
               e.esic_number,
               spl.basic AS epf_wages, spl.gross_salary AS esic_wages,
               spl.pf_employee + spl.pf_employer AS total_pf,
               spl.esic_employee + spl.esic_employer AS total_esic,
               spr.run_month
        FROM salary_prep_line spl
        JOIN salary_prep_run spr ON spr.id = spl.run_id
        JOIN employees e ON e.id = spl.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        LEFT JOIN employee_uan eu ON eu.employee_id = e.id AND eu.is_active = 1
        ${pj}
        WHERE 1=1 ${mCond} ${pw} ${nw}
        ORDER BY bm.branch_name, e.employee_code
        LIMIT ${f._limit ?? 50000}
      `, [...mv, ...pv, ...nv]);
    },
  },
  // ── New Joiners ───────────────────────────────────────────────────────────
  "new-joiners": {
    label: "New Joiners",
    columns: [
      { key: "employee_code", label: "Emp Code",       format: "text" },
      { key: "employee_name", label: "Employee Name",  format: "text" },
      { key: "branch_name",   label: "Branch",         format: "text" },
      { key: "cost_centre",   label: "Cost Centre",    format: "text" },
      { key: "department",    label: "Department",     format: "text" },
      { key: "designation",   label: "Designation",    format: "text" },
      { key: "doj",           label: "DOJ",            format: "date" },
      { key: "source",        label: "Source",         format: "text" },
      { key: "sub_source",    label: "Sub Source",     format: "text" },
      { key: "mobile",        label: "Mobile No",      format: "text" },
      { key: "net_inhand",    label: "Net In Hand",    format: "currency", align: "right" },
      { key: "ctc_offered",   label: "Offered CTC",    format: "currency", align: "right" },
    ],
    async query(f: LegacyFilter) {
      const [bw, bv] = branchWhere("bm.branch_name", f.branch);
      const [dw, dv] = f.from_date ? dateRangeWhere("e.date_of_joining", f.from_date, f.to_date)
        : monthWhere("e.date_of_joining", f.month);
      return q(`
        SELECT e.employee_code, e.full_name AS employee_name,
               bm.branch_name, cc.cost_centre_code AS cost_centre,
               COALESCE(dpm.dept_name,'') AS department,
               dm.designation_name AS designation,
               e.date_of_joining AS doj,
               COALESCE(e.source,'') AS source, COALESCE(e.sub_source,'') AS sub_source,
               e.mobile, e.net_inhand, e.ctc AS ctc_offered
        FROM employees e
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
        LEFT JOIN designation_master dm ON dm.id = e.designation_id
        LEFT JOIN department_master dpm ON dpm.id = e.department_id
        WHERE 1=1 ${bw} ${dw}
        ORDER BY bm.branch_name, e.date_of_joining DESC
        LIMIT ${f._limit ?? 50000}
      `, [...bv, ...dv]);
    },
  },

  // ── Left Employees ────────────────────────────────────────────────────────
  "left-employees": {
    label: "Left Employees",
    columns: [
      { key: "employee_code", label: "Emp Code",      format: "text" },
      { key: "employee_name", label: "Employee Name", format: "text" },
      { key: "department",    label: "Department",    format: "text" },
      { key: "designation",   label: "Designation",   format: "text" },
      { key: "branch_name",   label: "Branch",        format: "text" },
      { key: "cost_centre",   label: "Cost Centre",   format: "text" },
      { key: "mobile",        label: "Mobile No",     format: "text" },
      { key: "doj",           label: "DOJ",           format: "date" },
      { key: "dol",           label: "Left Date",     format: "date" },
      { key: "left_remarks",  label: "Left Remarks",  format: "text" },
      { key: "source",        label: "Source",        format: "text" },
      { key: "sub_source",    label: "Sub Source",    format: "text" },
      { key: "net_inhand",    label: "Net In Hand",   format: "currency", align: "right" },
      { key: "ctc_offered",   label: "Offered CTC",   format: "currency", align: "right" },
    ],
    async query(f: LegacyFilter) {
      const [bw, bv] = branchWhere("bm.branch_name", f.branch);
      const [dw, dv] = f.from_date ? dateRangeWhere("e.date_of_leaving", f.from_date, f.to_date)
        : monthWhere("e.date_of_leaving", f.month);
      return q(`
        SELECT e.employee_code, e.full_name AS employee_name,
               COALESCE(dpm.dept_name,'') AS department,
               dm.designation_name AS designation,
               bm.branch_name, cc.cost_centre_code AS cost_centre,
               e.mobile, e.date_of_joining AS doj, e.date_of_leaving AS dol,
               COALESCE(er.exit_reason_category,'') AS left_remarks,
               COALESCE(e.source,'') AS source, COALESCE(e.sub_source,'') AS sub_source,
               e.net_inhand, e.ctc AS ctc_offered
        FROM employees e
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
        LEFT JOIN designation_master dm ON dm.id = e.designation_id
        LEFT JOIN department_master dpm ON dpm.id = e.department_id
        LEFT JOIN exit_request er ON er.employee_id = e.id
        WHERE (e.active_status = 0 OR e.date_of_leaving IS NOT NULL) ${bw} ${dw}
        ORDER BY bm.branch_name, e.date_of_leaving DESC
        LIMIT ${f._limit ?? 50000}
      `, [...bv, ...dv]);
    },
  },

  // ── Professional Tax Register ─────────────────────────────────────────────
  "professional-tax": {
    label: "Professional Tax Register",
    sumCols: ["pt_amount"],
    columns: [
      { key: "employee_code", label: "Emp Code",      format: "text" },
      { key: "employee_name", label: "Employee Name", format: "text" },
      { key: "branch_name",   label: "Branch",        format: "text" },
      { key: "process_name",  label: "Process",       format: "text" },
      { key: "run_month",     label: "Month",         format: "text" },
      { key: "pt_amount",     label: "PT Amount",     format: "currency", align: "right" },
      { key: "gross_salary",  label: "Gross Salary",  format: "currency", align: "right" },
      { key: "pt_state",      label: "PT State",      format: "text" },
    ],
    async query(f: LegacyFilter) {
      const [bw, bv] = branchWhere("bm.branch_name", f.branch);
      const mw  = f.month ? "AND spr.run_month = ?" : "";
      const mv  = f.month ? [f.month] : [];
      const [ew, ev] = empWhere("spl.employee_code", f.employee_code);
      const [pw, pv] = processWhere("pm", f.process);
      return q(`
        SELECT spl.employee_code, e.full_name AS employee_name,
               bm.branch_name, COALESCE(pm.process_name,'UNASSIGNED') AS process_name,
               spr.run_month,
               COALESCE(spl.professional_tax, MAX(CASE WHEN c.component_code='PT' THEN c.amount END), 0) AS pt_amount,
               spl.gross_salary,
               '' AS pt_state
        FROM salary_prep_line spl
        JOIN salary_prep_run spr ON spr.id = spl.run_id
        JOIN employees e ON e.id = spl.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        LEFT JOIN salary_prep_line_component c ON c.line_id = spl.id AND c.component_code = 'PT'
        ${processJoin("pm", "e")}
        WHERE 1=1 ${bw} ${mw} ${ew} ${pw}
        GROUP BY spl.id, spl.employee_code, e.full_name, bm.branch_name,
                 pm.process_name, spr.run_month, spl.professional_tax, spl.gross_salary
        HAVING pt_amount > 0
        ORDER BY bm.branch_name, spl.employee_code
        LIMIT ${f._limit ?? 50000}
      `, [...bv, ...mv, ...ev, ...pv]);
    },
  },

  // ── PF ECR Export ─────────────────────────────────────────────────────────
  "pf-ecr": {
    label: "PF ECR Export",
    sumCols: ["epf_employee", "eps_employer"],
    columns: [
      { key: "employee_code", label: "Emp Code",    format: "text" },
      { key: "uan",           label: "UAN",         format: "text" },
      { key: "member_name",   label: "Member Name", format: "text" },
      { key: "pf_wages",      label: "PF Wages",    format: "currency", align: "right" },
      { key: "epf_employee",  label: "EPF Employee",format: "currency", align: "right" },
      { key: "eps_employer",  label: "EPS Employer",format: "currency", align: "right" },
      { key: "run_month",     label: "Month",       format: "text" },
    ],
    async query(f: LegacyFilter) {
      const mw  = f.month ? "AND spr.run_month = ?" : "";
      const mv  = f.month ? [f.month] : [];
      const [bw, bv] = branchWhere("bm.branch_name", f.branch);
      return q(`
        SELECT spl.employee_code,
               COALESCE(e.uan_number, '') AS uan,
               e.full_name AS member_name,
               spl.basic AS pf_wages,
               spl.pf_employee AS epf_employee,
               spl.pf_employer AS eps_employer,
               spr.run_month
        FROM salary_prep_line spl
        JOIN salary_prep_run spr ON spr.id = spl.run_id
        JOIN employees e ON e.id = spl.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        WHERE spl.pf_employee > 0 ${bw} ${mw}
        ORDER BY bm.branch_name, spl.employee_code
        LIMIT ${f._limit ?? 50000}
      `, [...bv, ...mv]);
    },
  },

  // ── Payroll Cost Summary ──────────────────────────────────────────────────
  "payroll-cost-summary": {
    label: "Payroll Cost Summary",
    sumCols: ["employee_count","total_gross","total_pf_employer","total_esic_employer","total_ctc","total_net"],
    columns: [
      { key: "branch_name",        label: "Branch",         format: "text" },
      { key: "process_name",       label: "Process",        format: "text" },
      { key: "department_name",    label: "Department",     format: "text" },
      { key: "run_month",          label: "Month",          format: "text" },
      { key: "employee_count",     label: "Head Count",     format: "number", align: "right" },
      { key: "total_gross",        label: "Total Gross",    format: "currency", align: "right" },
      { key: "total_pf_employer",  label: "EPF Co",         format: "currency", align: "right" },
      { key: "total_esic_employer",label: "ESIC Co",        format: "currency", align: "right" },
      { key: "total_ctc",          label: "Total CTC",      format: "currency", align: "right" },
      { key: "total_net",          label: "Total Net",      format: "currency", align: "right" },
    ],
    async query(f: LegacyFilter) {
      const [bw, bv] = branchWhere("bm.branch_name", f.branch);
      const mw = f.month ? "AND spr.run_month = ?" : "";
      const mv = f.month ? [f.month] : [];
      const [pw, pv] = processWhere("pm", f.process);
      return q(`
        SELECT bm.branch_name, COALESCE(pm.process_name,'UNASSIGNED') AS process_name,
               COALESCE(dpm.dept_name,'') AS department_name,
               spr.run_month,
               COUNT(DISTINCT spl.employee_code) AS employee_count,
               ROUND(SUM(spl.gross_salary),2) AS total_gross,
               ROUND(SUM(spl.pf_employer),2) AS total_pf_employer,
               ROUND(SUM(spl.esic_employer),2) AS total_esic_employer,
               ROUND(SUM(spl.gross_salary + spl.pf_employer + spl.esic_employer
                         + COALESCE(admin.amt,0)),2) AS total_ctc,
               ROUND(SUM(spl.net_salary),2) AS total_net
        FROM salary_prep_line spl
        JOIN salary_prep_run spr ON spr.id = spl.run_id
        JOIN employees e ON e.id = spl.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        LEFT JOIN department_master dpm ON dpm.id = e.department_id
        LEFT JOIN process_master pm ON pm.id = e.process_id
        LEFT JOIN (
          SELECT line_id, SUM(amount) AS amt
          FROM salary_prep_line_component WHERE component_code='ADMIN_CHG'
          GROUP BY line_id
        ) admin ON admin.line_id = spl.id
        WHERE 1=1 ${bw} ${mw} ${pw}
        GROUP BY bm.branch_name, pm.process_name, dpm.dept_name, spr.run_month
        ORDER BY bm.branch_name, pm.process_name
        LIMIT 5000
      `, [...bv, ...mv, ...pv]);
    },
  },

  // ── Payroll Reconciliation ────────────────────────────────────────────────
  "payroll-reconciliation": {
    label: "Payroll Reconciliation",
    sumCols: ["employee_count","total_gross","total_deductions","total_net","total_pf_employee","total_esic_employee","total_tds","total_lwp_deduction"],
    columns: [
      { key: "branch_name",          label: "Branch",          format: "text" },
      { key: "process_name",         label: "Process",         format: "text" },
      { key: "run_month",            label: "Month",           format: "text" },
      { key: "employee_count",       label: "Head Count",      format: "number", align: "right" },
      { key: "total_gross",          label: "Total Gross",     format: "currency", align: "right" },
      { key: "total_deductions",     label: "Total Deductions",format: "currency", align: "right" },
      { key: "total_net",            label: "Total Net",       format: "currency", align: "right" },
      { key: "total_pf_employee",    label: "Total EPF",       format: "currency", align: "right" },
      { key: "total_esic_employee",  label: "Total ESIC",      format: "currency", align: "right" },
      { key: "total_tds",            label: "Total TDS",       format: "currency", align: "right" },
      { key: "total_lwp_deduction",  label: "Total LWP Ded",   format: "currency", align: "right" },
    ],
    async query(f: LegacyFilter) {
      const [bw, bv] = branchWhere("bm.branch_name", f.branch);
      const mw = f.month ? "AND spr.run_month = ?" : "";
      const mv = f.month ? [f.month] : [];
      const [pw, pv] = processWhere("pm", f.process);
      return q(`
        SELECT bm.branch_name, COALESCE(pm.process_name,'UNASSIGNED') AS process_name,
               spr.run_month,
               COUNT(DISTINCT spl.employee_code) AS employee_count,
               ROUND(SUM(spl.gross_salary),2) AS total_gross,
               ROUND(SUM(spl.total_deductions),2) AS total_deductions,
               ROUND(SUM(spl.net_salary),2) AS total_net,
               ROUND(SUM(spl.pf_employee),2) AS total_pf_employee,
               ROUND(SUM(spl.esic_employee),2) AS total_esic_employee,
               ROUND(SUM(COALESCE(spl.tds,0)),2) AS total_tds,
               ROUND(SUM(COALESCE(spl.lwp_deduction,0)),2) AS total_lwp_deduction
        FROM salary_prep_line spl
        JOIN salary_prep_run spr ON spr.id = spl.run_id
        JOIN employees e ON e.id = spl.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        LEFT JOIN process_master pm ON pm.id = e.process_id
        WHERE 1=1 ${bw} ${mw} ${pw}
        GROUP BY bm.branch_name, pm.process_name, spr.run_month
        ORDER BY bm.branch_name, spr.run_month
        LIMIT 5000
      `, [...bv, ...mv, ...pv]);
    },
  },

  // ── Payroll Variance ──────────────────────────────────────────────────────
  "payroll-variance": {
    label: "Payroll Variance Report",
    columns: [
      { key: "employee_code",   label: "Emp Code",       format: "text" },
      { key: "employee_name",   label: "Employee Name",  format: "text" },
      { key: "branch_name",     label: "Branch",         format: "text" },
      { key: "process_name",    label: "Process",        format: "text" },
      { key: "department_name", label: "Department",     format: "text" },
      { key: "run_month",       label: "Month",          format: "text" },
      { key: "current_gross",   label: "Current Gross",  format: "currency", align: "right" },
      { key: "previous_gross",  label: "Previous Gross", format: "currency", align: "right" },
      { key: "variance_gross",  label: "Variance Gross", format: "currency", align: "right" },
      { key: "current_net",     label: "Current Net",    format: "currency", align: "right" },
      { key: "previous_net",    label: "Previous Net",   format: "currency", align: "right" },
      { key: "variance_net",    label: "Variance Net",   format: "currency", align: "right" },
      { key: "variance_flag",   label: "Flag",           format: "status" },
    ],
    async query(f: LegacyFilter) {
      const month = f.month || new Date().toISOString().slice(0, 7);
      const [bw, bv] = branchWhere("bm.branch_name", f.branch);
      const [pw, pv] = processWhere("pm", f.process);
      return q(`
        SELECT cur.employee_code, e.full_name AS employee_name,
               bm.branch_name, COALESCE(pm.process_name,'UNASSIGNED') AS process_name,
               COALESCE(dpm.dept_name,'') AS department_name,
               ? AS run_month,
               COALESCE(cur.gross_salary,0) AS current_gross,
               COALESCE(prv.gross_salary,0) AS previous_gross,
               ROUND(COALESCE(cur.gross_salary,0) - COALESCE(prv.gross_salary,0), 2) AS variance_gross,
               COALESCE(cur.net_salary,0) AS current_net,
               COALESCE(prv.net_salary,0) AS previous_net,
               ROUND(COALESCE(cur.net_salary,0) - COALESCE(prv.net_salary,0), 2) AS variance_net,
               IF(ABS(COALESCE(cur.gross_salary,0) - COALESCE(prv.gross_salary,0)) > 0.01, 'VARIANCE', 'NORMAL') AS variance_flag
        FROM (
          SELECT spl.employee_id, spl.employee_code, spl.gross_salary, spl.net_salary
          FROM salary_prep_line spl JOIN salary_prep_run spr ON spr.id=spl.run_id WHERE spr.run_month=?
        ) cur
        LEFT JOIN (
          SELECT spl.employee_id, spl.gross_salary, spl.net_salary
          FROM salary_prep_line spl JOIN salary_prep_run spr ON spr.id=spl.run_id
          WHERE spr.run_month = DATE_FORMAT(DATE_SUB(CONCAT(?, '-01'), INTERVAL 1 MONTH),'%Y-%m')
        ) prv ON prv.employee_id = cur.employee_id
        JOIN employees e ON e.id = cur.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        LEFT JOIN department_master dpm ON dpm.id = e.department_id
        LEFT JOIN process_master pm ON pm.id = e.process_id
        WHERE 1=1 ${bw} ${pw}
        ORDER BY bm.branch_name, cur.employee_code
        LIMIT ${f._limit ?? 50000}
      `, [month, month, month, ...bv, ...pv]);
    },
  },

  // ── 35. Tally Invoice Data Report ─────────────────────────────────────────
  "tally-invoice": {
    label: "Tally Invoice Data",
    sumCols: ["total_amt", "tax_amt", "grand_total"],
    columns: [
      { key: "bill_no",           label: "Bill No",        format: "text" },
      { key: "payment_status",    label: "Pending",        format: "text" },
      { key: "cost_centre_code",  label: "Process Code",   format: "text" },
      { key: "bill_branch",       label: "Branch",         format: "text" },
      { key: "bill_client",       label: "Client",         format: "text" },
      { key: "finance_year",      label: "Financial Year", format: "text" },
      { key: "month_label",       label: "Month",          format: "text" },
      { key: "po_no",             label: "PO No",          format: "text" },
      { key: "grn",               label: "GRN No",         format: "text" },
      { key: "invoice_date",      label: "Invoice Date",   format: "text" },
      { key: "total_amt",         label: "Amount",         format: "currency", align: "right" },
      { key: "igst",              label: "IGST",           format: "currency", align: "right" },
      { key: "cgst",              label: "CGST",           format: "currency", align: "right" },
      { key: "sgst",              label: "SGST",           format: "currency", align: "right" },
      { key: "grand_total",       label: "G Total",        format: "currency", align: "right" },
      { key: "invoice_type",      label: "Type",           format: "text" },
      { key: "category",          label: "Category",       format: "text" },
    ],
    async query(f: LegacyFilter) {
      const bCond = f.branch ? "AND bill_branch = ?" : "";
      const bv    = f.branch ? [f.branch] : [];
      const mCond = f.month  ? "AND month_label LIKE ?" : "";
      const mv    = f.month  ? [`%${f.month.split('-')[1]}%`] : [];
      const fyCond = f.from_date ? "AND finance_year = ?" : "";
      const fyv    = f.from_date ? [f.from_date] : [];
      return q(`
        SELECT bill_no,
               IF(payment_status='paid','Paid','Pending') AS payment_status,
               cost_centre_code, bill_branch, bill_client,
               finance_year, month_label, po_no, grn,
               invoice_date,
               COALESCE(total_amt,0) AS total_amt,
               COALESCE(igst,0) AS igst,
               COALESCE(cgst,0) AS cgst,
               COALESCE(sgst,0) AS sgst,
               COALESCE(grand_total,0) AS grand_total,
               invoice_type, category
        FROM billing_invoice_snapshot
        WHERE 1=1 ${bCond} ${mCond} ${fyCond}
        ORDER BY finance_year DESC, month_label, bill_no
        LIMIT ${f._limit ?? 50000}
      `, [...bv, ...mv, ...fyv]);
    },
  },

  // ── 36. Bank Transfer File ────────────────────────────────────────────────
  "bank-transfer": {
    label: "Bank Transfer File",
    sumCols: ["net_salary"],
    columns: [
      { key: "employee_code",  label: "Emp Code",       format: "text" },
      { key: "employee_name",  label: "Employee Name",  format: "text" },
      { key: "branch_name",    label: "Branch",         format: "text" },
      { key: "bank_name",      label: "Bank Name",      format: "text" },
      { key: "account_number", label: "Account No",     format: "text" },
      { key: "ifsc_code",      label: "IFSC Code",      format: "text" },
      { key: "net_salary",     label: "Net Amount",     format: "currency", align: "right" },
      { key: "pay_mode",       label: "Pay Mode",       format: "text" },
      { key: "salary_month",   label: "Month",          format: "text" },
    ],
    async query(f: LegacyFilter) {
      const [bw, bv] = branchWhere("bm.branch_name", f.branch);
      const [ew, ev] = empWhere("e.employee_code", f.employee_code);
      const month = f.month || new Date().toISOString().slice(0, 7);
      return q(`
        SELECT e.employee_code, e.full_name AS employee_name,
               bm.branch_name,
               COALESCE(ebd.bank_name, e.bank_name) AS bank_name,
               COALESCE(ebd.account_number, e.bank_account_number) AS account_number,
               COALESCE(ebd.ifsc_code, e.ifsc_code) AS ifsc_code,
               spl.net_salary,
               COALESCE(ebd.account_type, e.account_type, 'NEFT') AS pay_mode,
               spr.run_month AS salary_month
        FROM salary_prep_line spl
        JOIN salary_prep_run spr ON spr.id = spl.run_id
        JOIN employees e ON e.id = spl.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        LEFT JOIN employee_bank_detail ebd ON ebd.employee_id = e.id AND ebd.is_primary = 1 AND ebd.active_status = 1
        WHERE spr.run_month = ? ${bw} ${ew}
          AND (ebd.account_number IS NOT NULL OR e.bank_account_number IS NOT NULL)
        ORDER BY bm.branch_name, e.employee_code
        LIMIT ${f._limit ?? 50000}
      `, [month, ...bv, ...ev]);
    },
  },

  // ── 37. TDS Summary Report ─────────────────────────────────────────────────
  "tds-summary": {
    label: "TDS Summary",
    sumCols: ["total_tds"],
    columns: [
      { key: "employee_code",  label: "Emp Code",      format: "text" },
      { key: "employee_name",  label: "Employee Name", format: "text" },
      { key: "branch_name",    label: "Branch",        format: "text" },
      { key: "tax_month",      label: "Tax Month",     format: "text" },
      { key: "total_tds",      label: "Income Tax",    format: "currency", align: "right" },
    ],
    async query(f: LegacyFilter) {
      const bCond = f.branch ? "AND branch_name = ?" : "";
      const bv    = f.branch ? [f.branch] : [];
      const [ew, ev] = empWhere("employee_code", f.employee_code);
      const mCond = f.month  ? "AND tax_month = ?" : "";
      const mv    = f.month  ? [f.month] : [];
      return q(`
        SELECT employee_code, employee_name, branch_name,
               tax_month, income_tax AS total_tds
        FROM incometax_legacy_snapshot
        WHERE 1=1 ${bCond} ${ew} ${mCond}
        ORDER BY branch_name, employee_code, tax_month DESC
        LIMIT ${f._limit ?? 50000}
      `, [...bv, ...ev, ...mv]);
    },
  },

  // ── 38. Gratuity Liability Report ─────────────────────────────────────────
  "gratuity-liability": {
    label: "Gratuity Liability",
    sumCols: ["gratuity_liability"],
    columns: [
      { key: "employee_code",      label: "Emp Code",       format: "text" },
      { key: "employee_name",      label: "Employee Name",  format: "text" },
      { key: "branch_name",        label: "Branch",         format: "text" },
      { key: "date_of_joining",    label: "DOJ",            format: "date" },
      { key: "years_of_service",   label: "Years",          format: "number", align: "right" },
      { key: "last_basic",         label: "Last Basic",     format: "currency", align: "right" },
      { key: "gratuity_liability", label: "Gratuity",       format: "currency", align: "right" },
      { key: "eligible",           label: "Eligible",       format: "text" },
    ],
    async query(f: LegacyFilter) {
      const [bw, bv] = branchWhere("bm.branch_name", f.branch);
      const [ew, ev] = empWhere("e.employee_code", f.employee_code);
      return q(`
        SELECT e.employee_code, e.full_name AS employee_name,
               bm.branch_name,
               e.date_of_joining,
               TIMESTAMPDIFF(YEAR, e.date_of_joining, CURDATE()) AS years_of_service,
               COALESCE(MAX(sca.basic), 0) AS last_basic,
               ROUND(
                 IF(TIMESTAMPDIFF(YEAR, e.date_of_joining, CURDATE()) >= 5,
                    COALESCE(MAX(sca.basic), 0) * 15 / 26 * TIMESTAMPDIFF(YEAR, e.date_of_joining, CURDATE()),
                    0), 2
               ) AS gratuity_liability,
               IF(TIMESTAMPDIFF(YEAR, e.date_of_joining, CURDATE()) >= 5, 'YES', 'NO') AS eligible
        FROM employees e
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        LEFT JOIN salary_component_assignments sca ON sca.employee_id = e.id
          AND sca.status = 'active'
        WHERE e.active_status = 1 ${bw} ${ew}
        GROUP BY e.id, e.employee_code, e.full_name, bm.branch_name, e.date_of_joining
        ORDER BY gratuity_liability DESC, bm.branch_name
        LIMIT ${f._limit ?? 50000}
      `, [...bv, ...ev]);
    },
  },

};

// "employee-master" is an alias for "legacy-employee-master"
(REPORTS as Record<string, unknown>)["employee-master"] = REPORTS["legacy-employee-master"];

// ── public API ─────────────────────────────────────────────────────────────────

export const legacyReportsService = {
  list(): { code: string; label: string }[] {
    return Object.entries(REPORTS).map(([code, def]) => ({ code, label: def.label }));
  },

  async run(
    code: string,
    filter: LegacyFilter,
    options?: { forExport?: boolean },
  ): Promise<LegacyReportResult> {
    const def = REPORTS[code];
    if (!def) throw new Error(`Unknown legacy report: ${code}`);
    const EXPORT_HARD_LIMIT = 200_000;
    const displayLimit = def.defaultDisplayLimit;
    const effectiveLimit = options?.forExport ? EXPORT_HARD_LIMIT : (displayLimit ?? 50_000);
    const enriched: LegacyFilter = { ...filter, _limit: effectiveLimit };
    const rows = (await def.query(enriched)) as Record<string, unknown>[];
    const summary = def.sumCols ? numSum(rows, def.sumCols) : undefined;
    // Truncated for display when capped by defaultDisplayLimit
    const truncatedDisplay = !options?.forExport && displayLimit != null && rows.length >= displayLimit;
    // Truncated for export when rows hit the hard cap
    const truncatedExport  = options?.forExport && rows.length >= EXPORT_HARD_LIMIT;
    return {
      columns: def.columns,
      rows,
      total: rows.length,
      summary,
      ...(truncatedDisplay ? { truncated: true, displayLimit } : {}),
      ...(truncatedExport  ? { truncated: true, displayLimit: EXPORT_HARD_LIMIT } : {}),
    };
  },

  toCsv(result: LegacyReportResult): string {
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const warning = result.truncated && result.displayLimit
      ? `"WARNING: Export capped at ${result.displayLimit.toLocaleString()} rows. Apply branch/date/employee filters and re-export to get the full dataset."\n`
      : "";
    const header = result.columns.map(c => esc(c.label)).join(",");
    const body   = result.rows.map(r =>
      result.columns.map(c => esc(r[c.key])).join(",")
    ).join("\n");
    return warning + header + "\n" + body;
  },
};
