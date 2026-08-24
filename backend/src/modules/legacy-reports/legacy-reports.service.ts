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
    sumCols: ["gross_salary", "net_salary", "pf_employee", "esic_employee", "pf_employer", "esic_employer", "tds"],
    columns: [
      { key: "employee_code", label: "Emp Code",      format: "text" },
      { key: "employee_name", label: "Employee Name", format: "text" },
      { key: "branch_name",   label: "Branch",        format: "text" },
      { key: "process_name",  label: "Process",       format: "text" },
      { key: "cost_centre",   label: "Cost Centre",   format: "text" },
      { key: "designation",   label: "Designation",   format: "text" },
      { key: "working_days",  label: "Working Days",  format: "number",   align: "right" },
      { key: "present_days",  label: "Earned Days",   format: "number",   align: "right" },
      { key: "basic",         label: "Basic",         format: "currency", align: "right" },
      { key: "hra",           label: "HRA",           format: "currency", align: "right" },
      { key: "conv",          label: "Conv",          format: "currency", align: "right" },
      { key: "special",       label: "Special Allow", format: "currency", align: "right" },
      { key: "other_allow",   label: "Other Allow",   format: "currency", align: "right" },
      { key: "medical",       label: "Medical",       format: "currency", align: "right" },
      { key: "bonus",         label: "Bonus",         format: "currency", align: "right" },
      { key: "lta",           label: "LTA",           format: "currency", align: "right" },
      { key: "incentive",     label: "Incentive",     format: "currency", align: "right" },
      { key: "extra_day_inc", label: "Extra Day Inc", format: "currency", align: "right" },
      { key: "arrear",        label: "Arrear",        format: "currency", align: "right" },
      { key: "gross_salary",  label: "Gross",         format: "currency", align: "right" },
      { key: "pf_employee",   label: "EPF",           format: "currency", align: "right" },
      { key: "esic_employee", label: "ESIC",          format: "currency", align: "right" },
      { key: "pt",            label: "Prof Tax",      format: "currency", align: "right" },
      { key: "tds",           label: "Income Tax",    format: "currency", align: "right" },
      { key: "lwp",           label: "Leave Ded",     format: "currency", align: "right" },
      { key: "loan_ded",      label: "Loan Ded",      format: "currency", align: "right" },
      { key: "advance",       label: "Adv Paid",      format: "currency", align: "right" },
      { key: "mobile_ded",    label: "Mobile Ded",    format: "currency", align: "right" },
      { key: "asset_rec",     label: "Asset Rec",     format: "currency", align: "right" },
      { key: "insurance",     label: "Insurance",     format: "currency", align: "right" },
      { key: "other_ded",     label: "Other Ded",     format: "currency", align: "right" },
      { key: "net_salary",    label: "Net Salary",    format: "currency", align: "right" },
      { key: "pf_employer",   label: "EPF Co",        format: "currency", align: "right" },
      { key: "esic_employer", label: "ESIC Co",       format: "currency", align: "right" },
      { key: "admin_charges", label: "Admin Chg",     format: "currency", align: "right" },
    ],
    async query(f) {
      const [bw, bv] = branchWhere("bm.branch_name", f.branch);
      const month = f.month || new Date().toISOString().slice(0, 7);
      // run_month is varchar(7) like '2026-07' — use direct equality, not DATE_FORMAT
      const mw = "AND spr.run_month = ?";
      const mv = [month];
      const [ew, ev] = empWhere("spl.employee_code", f.employee_code);
      const [nw, nv] = nameWhere("e.full_name", f.employee_name);
      const [pw, pv] = processWhere("pm", f.process);
      return q(`
        SELECT
          spl.employee_code,
          e.full_name                                                            AS employee_name,
          bm.branch_name,
          COALESCE(pm.process_name, 'UNASSIGNED')                               AS process_name,
          cc.cost_centre_code                                                    AS cost_centre,
          dm.designation_name                                                    AS designation,
          spl.working_days,
          spl.present_days,
          COALESCE(MAX(CASE WHEN c.component_code='BASIC'         THEN c.amount END),0) AS basic,
          COALESCE(MAX(CASE WHEN c.component_code='HRA'           THEN c.amount END),0) AS hra,
          COALESCE(MAX(CASE WHEN c.component_code='CONV'          THEN c.amount END),0) AS conv,
          COALESCE(MAX(CASE WHEN c.component_code='SPECIAL'       THEN c.amount END),0) AS special,
          COALESCE(MAX(CASE WHEN c.component_code='OA'            THEN c.amount END),0) AS other_allow,
          COALESCE(MAX(CASE WHEN c.component_code='MA'            THEN c.amount END),0) AS medical,
          COALESCE(MAX(CASE WHEN c.component_code='BONUS'         THEN c.amount END),0) AS bonus,
          COALESCE(MAX(CASE WHEN c.component_code='LTA'           THEN c.amount END),0) AS lta,
          COALESCE(MAX(CASE WHEN c.component_code='INCENTIVE'     THEN c.amount END),0) AS incentive,
          COALESCE(MAX(CASE WHEN c.component_code='EXTRA_DAY_INC' THEN c.amount END),0) AS extra_day_inc,
          COALESCE(MAX(CASE WHEN c.component_code='ARREAR'        THEN c.amount END),0) AS arrear,
          spl.gross_salary,
          spl.net_salary,
          COALESCE(MAX(CASE WHEN c.component_code='PF_EMP'        THEN c.amount END),0) AS pf_employee,
          COALESCE(MAX(CASE WHEN c.component_code='ESIC_EMP'      THEN c.amount END),0) AS esic_employee,
          COALESCE(MAX(CASE WHEN c.component_code='PT'            THEN c.amount END),0) AS pt,
          COALESCE(MAX(CASE WHEN c.component_code='TDS'           THEN c.amount END),0) AS tds,
          COALESCE(MAX(CASE WHEN c.component_code='LWP'           THEN c.amount END),0) AS lwp,
          COALESCE(MAX(CASE WHEN c.component_code='LOAN'          THEN c.amount END),0) AS loan_ded,
          COALESCE(MAX(CASE WHEN c.component_code='ADV'           THEN c.amount END),0) AS advance,
          COALESCE(MAX(CASE WHEN c.component_code='MOBILE_DED'    THEN c.amount END),0) AS mobile_ded,
          COALESCE(MAX(CASE WHEN c.component_code='ASSET_REC'     THEN c.amount END),0) AS asset_rec,
          COALESCE(MAX(CASE WHEN c.component_code='INS'           THEN c.amount END),0) AS insurance,
          COALESCE(MAX(CASE WHEN c.component_code='OTHER_DED'     THEN c.amount END),0) AS other_ded,
          COALESCE(MAX(CASE WHEN c.component_code='PF_EMP_CO'     THEN c.amount END),0) AS pf_employer,
          COALESCE(MAX(CASE WHEN c.component_code='ESIC_EMP_CO'   THEN c.amount END),0) AS esic_employer,
          COALESCE(MAX(CASE WHEN c.component_code='ADMIN_CHG'     THEN c.amount END),0) AS admin_charges
        FROM salary_prep_line spl
        JOIN salary_prep_run spr ON spr.id = spl.run_id
        JOIN employees e ON e.id = spl.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
        LEFT JOIN designation_master dm ON dm.id = e.designation_id
        LEFT JOIN salary_prep_line_component c ON c.line_id = spl.id
        ${processJoin("pm", "e")}
        WHERE 1=1 ${bw} ${mw} ${ew} ${nw} ${pw}
        GROUP BY spl.id, spl.employee_code, e.full_name, bm.branch_name,
                 pm.process_name, cc.cost_centre_code, dm.designation_name,
                 spl.working_days, spl.present_days, spl.gross_salary, spl.net_salary
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
               lr.leave_type_code AS leave_type,
               lr.status, lr.reason
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
               splc.amount AS tds_amount,
               'hrms' COLLATE utf8mb4_unicode_ci AS source
        FROM salary_prep_line_component splc
        JOIN salary_prep_line spl ON spl.id = splc.line_id
        JOIN salary_prep_run spr ON spr.id = spl.run_id
        JOIN employees e2 ON e2.id = spl.employee_id
        LEFT JOIN branch_master bm2 ON bm2.id = e2.branch_id
        WHERE splc.component_code = 'TDS' ${mCond2} ${bw2} ${ew2}
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
      { key: "pf_eligible",    label: "PF Eligible", format: "boolean" },
      { key: "esic_eligible",  label: "ESI Eligible",format: "boolean" },
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
               ls.pf_eligible, ls.esic_eligible
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
      const mCond = f.month
        ? "AND CONCAT(sal_year, '-', LPAD(sal_month, 2, '0')) = ?"
        : "";
      const mv = f.month ? [f.month] : [];
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
      const mCond = f.month
        ? "AND CONCAT(leave_year, '-', LPAD(leave_month, 2, '0')) = ?"
        : "";
      const mv = f.month ? [f.month] : [];
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
      const mCond = f.month
        ? "AND CONCAT(sal_year, '-', LPAD(sal_month, 2, '0')) = ?"
        : "";
      const mv = f.month ? [f.month] : [];
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
      const mCond = f.month
        ? "AND CONCAT(sal_year, '-', LPAD(sal_month, 2, '0')) = ?"
        : "";
      const mv = f.month ? [f.month] : [];
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
        WHERE e.active_status = 1 ${pw} ${nw}
        ORDER BY bm.branch_name, e.employee_code, ltm.leave_name
        LIMIT ${f._limit ?? 50000}
      `, [...pv, ...nv]);
    },
  },

  // "bank-account" stub — employee bank details
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
    ],
    async query(f: LegacyFilter) {
      const [nw, nv] = nameWhere("e.full_name", f.employee_name);
      const pj = processJoin("pm", "e");
      const [pw, pv] = processWhere("pm", f.process);
      return q(`
        SELECT e.employee_code, e.full_name AS employee_name,
               bm.branch_name,
               e.bank_name, e.bank_account_number AS account_number, e.ifsc_code, e.account_type
        FROM employees e
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        ${pj}
        WHERE e.active_status = 1 ${pw} ${nw}
        ORDER BY bm.branch_name, e.employee_code
        LIMIT ${f._limit ?? 50000}
      `, [...pv, ...nv]);
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
      { key: "epf_wages",     label: "EPF Wages",     format: "currency", align: "right" },
      { key: "esic_wages",    label: "ESIC Wages",    format: "currency", align: "right" },
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
