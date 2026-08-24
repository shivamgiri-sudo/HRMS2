# Legacy HRMS Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a "Legacy HRMS Reports" tab in ReportsHub that replicates all 20 db_bill reports exactly, sourcing data 100% from mas_hrms tables.

**Architecture:** Single backend service with one SQL query per report, exposed via `GET /api/legacy-reports/:code` with shared filter params. Frontend adds one new tab to the existing ReportsHub with a report-selector sidebar and a filterable, exportable data table.

**Tech Stack:** Express + TypeScript + mysql2, React 18 + shadcn/Radix + TanStack Query, existing `hrmsApi` client, existing GRN UI component library.

## Global Constraints

- Never DELETE any mas_hrms data — read-only backend
- All queries run against mas_hrms only (no legacyPool / db_bill reads)
- Snapshot tables are the source for legacy data; live HRMS tables cover post-migration records (UNION where applicable)
- Role gate: `super_admin`, `hr_admin`, `payroll_hr`, `finance_head` — same as payroll exports
- Export: CSV download only (no PDF)
- Column labels must match db_bill exactly (same names Finance team recognises)
- IDC employees excluded from salary reports (not in mas_hrms.employees by design)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/src/modules/legacy-reports/legacy-reports.service.ts` | CREATE | All 20 SQL queries, filter builder, CSV serialiser |
| `backend/src/modules/legacy-reports/legacy-reports.routes.ts` | CREATE | `GET /api/legacy-reports/:code` + `GET /api/legacy-reports/:code/export` |
| `backend/src/app.ts` | MODIFY | Mount `legacyReportsRouter` at `/api/legacy-reports` |
| `src/components/reports/views/LegacyHrmsReportsView.tsx` | CREATE | Sidebar report list + filter bar + data table + CSV download |
| `src/pages/ReportsHub.tsx` | MODIFY | Add `'legacy'` to VIEWS, add tab definition, lazy-load new view |

---

## Task 1 — Backend Service: All 20 Report Queries

**Files:**
- Create: `backend/src/modules/legacy-reports/legacy-reports.service.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LegacyFilter = {
    branch?: string;      // branch_name exact match
    month?: string;       // 'YYYY-MM'
    from_date?: string;   // 'YYYY-MM-DD'
    to_date?: string;     // 'YYYY-MM-DD'
    employee_code?: string;
  };
  export type LegacyColumn = { key: string; label: string; format: 'text'|'number'|'currency'|'date'|'datetime'|'status' };
  export type LegacyReportResult = { columns: LegacyColumn[]; rows: Record<string,unknown>[]; total: number };
  export const legacyReportsService: { run(code: string, filter: LegacyFilter): Promise<LegacyReportResult> }
  ```

- [ ] **Step 1: Create the service file**

```typescript
// backend/src/modules/legacy-reports/legacy-reports.service.ts
import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";

export type LegacyFilter = {
  branch?: string;
  month?: string;       // 'YYYY-MM'
  from_date?: string;   // 'YYYY-MM-DD'
  to_date?: string;     // 'YYYY-MM-DD'
  employee_code?: string;
};

export type LegacyColumn = {
  key: string;
  label: string;
  format: "text" | "number" | "currency" | "date" | "datetime" | "status";
  align?: "left" | "right" | "center";
};

export type LegacyReportResult = {
  columns: LegacyColumn[];
  rows: Record<string, unknown>[];
  total: number;
  summary?: Record<string, number>;
};

// ── helpers ──────────────────────────────────────────────────────────────────

function branchWhere(alias: string, branch?: string): [string, unknown[]] {
  if (!branch) return ["", []];
  return [`AND ${alias}.branch_name = ?`, [branch]];
}

function monthWhere(alias: string, col: string, month?: string): [string, unknown[]] {
  if (!month) return ["", []];
  return [`AND DATE_FORMAT(${alias}.${col}, '%Y-%m') = ?`, [month]];
}

function empWhere(alias: string, col: string, emp?: string): [string, unknown[]] {
  if (!emp) return ["", []];
  return [`AND ${alias}.${col} = ?`, [emp]];
}

function dateRangeWhere(alias: string, col: string, from?: string, to?: string): [string, unknown[]] {
  const parts: string[] = []; const vals: unknown[] = [];
  if (from) { parts.push(`${alias}.${col} >= ?`); vals.push(from); }
  if (to)   { parts.push(`${alias}.${col} <= ?`); vals.push(to); }
  return [parts.length ? `AND ${parts.join(" AND ")}` : "", vals];
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

// ── report registry ──────────────────────────────────────────────────────────

type ReportDef = {
  columns: LegacyColumn[];
  query: (f: LegacyFilter) => Promise<RowDataPacket[]>;
  sumCols?: string[];
};

const REPORTS: Record<string, ReportDef> = {

  // ── 1. Legacy Salary Register ──────────────────────────────────────────────
  "salary-register": {
    columns: [
      { key: "employee_code",   label: "Emp Code",       format: "text" },
      { key: "employee_name",   label: "Employee Name",   format: "text" },
      { key: "branch_name",     label: "Branch",          format: "text" },
      { key: "cost_centre",     label: "Cost Centre",     format: "text" },
      { key: "designation",     label: "Designation",     format: "text" },
      { key: "working_days",    label: "Working Days",    format: "number", align: "right" },
      { key: "present_days",    label: "Earned Days",     format: "number", align: "right" },
      { key: "basic",           label: "Basic",           format: "currency", align: "right" },
      { key: "hra",             label: "HRA",             format: "currency", align: "right" },
      { key: "conv",            label: "Conv",            format: "currency", align: "right" },
      { key: "special",         label: "Special Allow",   format: "currency", align: "right" },
      { key: "other_allow",     label: "Other Allow",     format: "currency", align: "right" },
      { key: "medical",         label: "Medical",         format: "currency", align: "right" },
      { key: "bonus",           label: "Bonus",           format: "currency", align: "right" },
      { key: "lta",             label: "LTA",             format: "currency", align: "right" },
      { key: "incentive",       label: "Incentive",       format: "currency", align: "right" },
      { key: "extra_day_inc",   label: "Extra Day Inc",   format: "currency", align: "right" },
      { key: "arrear",          label: "Arrear",          format: "currency", align: "right" },
      { key: "gross_salary",    label: "Gross",           format: "currency", align: "right" },
      { key: "pf_employee",     label: "EPF",             format: "currency", align: "right" },
      { key: "esic_employee",   label: "ESIC",            format: "currency", align: "right" },
      { key: "pt",              label: "Prof Tax",        format: "currency", align: "right" },
      { key: "tds",             label: "Income Tax",      format: "currency", align: "right" },
      { key: "lwp",             label: "Leave Ded",       format: "currency", align: "right" },
      { key: "loan_ded",        label: "Loan Ded",        format: "currency", align: "right" },
      { key: "advance",         label: "Adv Paid",        format: "currency", align: "right" },
      { key: "mobile_ded",      label: "Mobile Ded",      format: "currency", align: "right" },
      { key: "asset_rec",       label: "Asset Rec",       format: "currency", align: "right" },
      { key: "insurance",       label: "Insurance",       format: "currency", align: "right" },
      { key: "other_ded",       label: "Other Ded",       format: "currency", align: "right" },
      { key: "net_salary",      label: "Net Salary",      format: "currency", align: "right" },
      { key: "pf_employer",     label: "EPF Co",          format: "currency", align: "right" },
      { key: "esic_employer",   label: "ESIC Co",         format: "currency", align: "right" },
      { key: "admin_charges",   label: "Admin Chg",       format: "currency", align: "right" },
    ],
    sumCols: ["gross_salary","net_salary","pf_employee","esic_employee","pf_employer","esic_employer","tds"],
    async query(f) {
      const [bw, bv] = branchWhere("bm", f.branch);
      const [mw, mv] = monthWhere("spr", "run_month", f.month);
      const [ew, ev] = empWhere("spl", "employee_code", f.employee_code);
      return q(`
        SELECT
          spl.employee_code,
          e.full_name            AS employee_name,
          bm.branch_name,
          cc.cost_centre_code    AS cost_centre,
          dm.designation_name    AS designation,
          spl.working_days,
          spl.present_days,
          COALESCE(MAX(CASE WHEN c.component_code='BASIC'        THEN c.amount END),0) AS basic,
          COALESCE(MAX(CASE WHEN c.component_code='HRA'          THEN c.amount END),0) AS hra,
          COALESCE(MAX(CASE WHEN c.component_code='CONV'         THEN c.amount END),0) AS conv,
          COALESCE(MAX(CASE WHEN c.component_code='SPECIAL'      THEN c.amount END),0) AS special,
          COALESCE(MAX(CASE WHEN c.component_code='OA'           THEN c.amount END),0) AS other_allow,
          COALESCE(MAX(CASE WHEN c.component_code='MA'           THEN c.amount END),0) AS medical,
          COALESCE(MAX(CASE WHEN c.component_code='BONUS'        THEN c.amount END),0) AS bonus,
          COALESCE(MAX(CASE WHEN c.component_code='LTA'          THEN c.amount END),0) AS lta,
          COALESCE(MAX(CASE WHEN c.component_code='INCENTIVE'    THEN c.amount END),0) AS incentive,
          COALESCE(MAX(CASE WHEN c.component_code='EXTRA_DAY_INC' THEN c.amount END),0) AS extra_day_inc,
          COALESCE(MAX(CASE WHEN c.component_code='ARREAR'       THEN c.amount END),0) AS arrear,
          spl.gross_salary,
          spl.net_salary,
          COALESCE(MAX(CASE WHEN c.component_code='PF_EMP'       THEN c.amount END),0) AS pf_employee,
          COALESCE(MAX(CASE WHEN c.component_code='ESIC_EMP'     THEN c.amount END),0) AS esic_employee,
          COALESCE(MAX(CASE WHEN c.component_code='PT'           THEN c.amount END),0) AS pt,
          COALESCE(MAX(CASE WHEN c.component_code='TDS'          THEN c.amount END),0) AS tds,
          COALESCE(MAX(CASE WHEN c.component_code='LWP'          THEN c.amount END),0) AS lwp,
          COALESCE(MAX(CASE WHEN c.component_code='LOAN'         THEN c.amount END),0) AS loan_ded,
          COALESCE(MAX(CASE WHEN c.component_code='ADV'          THEN c.amount END),0) AS advance,
          COALESCE(MAX(CASE WHEN c.component_code='MOBILE_DED'   THEN c.amount END),0) AS mobile_ded,
          COALESCE(MAX(CASE WHEN c.component_code='ASSET_REC'    THEN c.amount END),0) AS asset_rec,
          COALESCE(MAX(CASE WHEN c.component_code='INS'          THEN c.amount END),0) AS insurance,
          COALESCE(MAX(CASE WHEN c.component_code='OTHER_DED'    THEN c.amount END),0) AS other_ded,
          COALESCE(MAX(CASE WHEN c.component_code='PF_EMP_CO'    THEN c.amount END),0) AS pf_employer,
          COALESCE(MAX(CASE WHEN c.component_code='ESIC_EMP_CO'  THEN c.amount END),0) AS esic_employer,
          COALESCE(MAX(CASE WHEN c.component_code='ADMIN_CHG'    THEN c.amount END),0) AS admin_charges
        FROM salary_prep_line spl
        JOIN salary_prep_run spr ON spr.id = spl.run_id
        JOIN employees e ON e.id = spl.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
        LEFT JOIN designation_master dm ON dm.id = e.designation_id
        LEFT JOIN salary_prep_line_component c ON c.line_id = spl.id
        WHERE 1=1 ${bw} ${mw} ${ew}
        GROUP BY spl.id, spl.employee_code, e.full_name, bm.branch_name,
                 cc.cost_centre_code, dm.designation_name, spl.working_days,
                 spl.present_days, spl.gross_salary, spl.net_salary
        ORDER BY bm.branch_name, spl.employee_code
      `, [...bv, ...mv, ...ev]);
    },
  },

  // ── 2. Attendance Register ─────────────────────────────────────────────────
  "attendance-register": {
    columns: [
      { key: "employee_code", label: "Emp Code",    format: "text" },
      { key: "employee_name", label: "Employee Name", format: "text" },
      { key: "branch_name",   label: "Branch",      format: "text" },
      { key: "cost_center",   label: "Cost Centre", format: "text" },
      { key: "att_date",      label: "Date",        format: "date" },
      { key: "status",        label: "Status",      format: "status" },
      { key: "old_status",    label: "Old Status",  format: "text" },
      { key: "source",        label: "Source",      format: "text" },
    ],
    async query(f) {
      const bCond  = f.branch ? "AND branch_name = ?" : "";
      const eCond  = f.employee_code ? "AND employee_code = ?" : "";
      const drCond = (f.from_date || f.to_date)
        ? `AND att_date BETWEEN ? AND ?`
        : (f.month ? "AND DATE_FORMAT(att_date,'%Y-%m') = ?" : "");
      const bv = f.branch ? [f.branch] : [];
      const ev = f.employee_code ? [f.employee_code] : [];
      const drv = f.from_date && f.to_date ? [f.from_date, f.to_date]
        : f.from_date ? [f.from_date, "9999-12-31"]
        : f.to_date   ? ["0000-01-01", f.to_date]
        : f.month     ? [f.month] : [];
      // Legacy snapshot (pre-HRMS) UNION live HRMS records
      return q(`
        SELECT employee_code, employee_name, branch_name, cost_center,
               att_date, status, old_status, 'legacy' AS source
        FROM attendance_legacy_snapshot
        WHERE 1=1 ${bCond} ${eCond} ${drCond}
        UNION ALL
        SELECT e.employee_code, e.full_name AS employee_name,
               bm.branch_name, cc.cost_centre_code AS cost_center,
               adr.record_date AS att_date,
               adr.attendance_status AS status,
               NULL AS old_status, 'hrms' AS source
        FROM attendance_daily_record adr
        JOIN employees e ON e.id = adr.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
        WHERE 1=1
          ${f.branch ? "AND bm.branch_name = ?" : ""}
          ${f.employee_code ? "AND e.employee_code = ?" : ""}
          ${f.from_date && f.to_date ? "AND adr.record_date BETWEEN ? AND ?"
            : f.month ? "AND DATE_FORMAT(adr.record_date,'%Y-%m') = ?" : ""}
        ORDER BY branch_name, employee_code, att_date
      `, [...bv, ...ev, ...drv, ...bv, ...ev, ...drv]);
    },
  },

  // ── 3. WFH Attendance ─────────────────────────────────────────────────────
  "wfh-attendance": {
    columns: [
      { key: "employee_code", label: "Emp Code",    format: "text" },
      { key: "employee_name", label: "Employee Name", format: "text" },
      { key: "branch_name",   label: "Branch",      format: "text" },
      { key: "cost_center",   label: "Cost Centre", format: "text" },
      { key: "att_date",      label: "Date",        format: "date" },
      { key: "status",        label: "Status",      format: "status" },
      { key: "old_status",    label: "Old Status",  format: "text" },
    ],
    async query(f) {
      const [bw, bv] = branchWhere("w", f.branch);
      const [ew, ev] = empWhere("w", "employee_code", f.employee_code);
      const [dw, dv] = f.from_date ? dateRangeWhere("w", "att_date", f.from_date, f.to_date)
        : monthWhere("w", "att_date", f.month);
      return q(`
        SELECT employee_code, employee_name, branch_name, cost_center,
               att_date, status, old_status
        FROM wfh_attendance_snapshot w
        WHERE 1=1 ${bw} ${ew} ${dw}
        ORDER BY branch_name, employee_code, att_date
      `, [...bv, ...ev, ...dv]);
    },
  },

  // ── 4. Field Attendance ───────────────────────────────────────────────────
  "field-attendance": {
    columns: [
      { key: "employee_code", label: "Emp Code",    format: "text" },
      { key: "employee_name", label: "Employee Name", format: "text" },
      { key: "branch_name",   label: "Branch",      format: "text" },
      { key: "cost_center",   label: "Cost Centre", format: "text" },
      { key: "att_date",      label: "Date",        format: "date" },
      { key: "status",        label: "Status",      format: "status" },
      { key: "old_status",    label: "Old Status",  format: "text" },
    ],
    async query(f) {
      const [bw, bv] = branchWhere("f", f.branch);
      const [ew, ev] = empWhere("f", "employee_code", f.employee_code);
      const [dw, dv] = f.from_date ? dateRangeWhere("f", "att_date", f.from_date, f.to_date)
        : monthWhere("f", "att_date", f.month);
      return q(`
        SELECT employee_code, employee_name, branch_name, cost_center,
               att_date, status, old_status
        FROM field_attendance_snapshot f
        WHERE 1=1 ${bw} ${ew} ${dw}
        ORDER BY branch_name, employee_code, att_date
      `, [...bv, ...ev, ...dv]);
    },
  },

  // ── 5. Attendance Issues / Regularization ─────────────────────────────────
  "attendance-issues": {
    columns: [
      { key: "employee_code",   label: "Emp Code",      format: "text" },
      { key: "branch_name",     label: "Branch",        format: "text" },
      { key: "issue_date",      label: "Att Date",      format: "date" },
      { key: "old_status",      label: "Current Status",format: "text" },
      { key: "new_status",      label: "Expected Status",format: "text" },
      { key: "dispute_type",    label: "Issue Type",    format: "text" },
      { key: "reason",          label: "Reason",        format: "text" },
      { key: "status",          label: "Approval Status",format: "status" },
      { key: "reviewed_at",     label: "Approved Date", format: "date" },
      { key: "manager_review_note", label: "Approved By", format: "text" },
    ],
    async query(f) {
      const [ew, ev] = empWhere("ar", "employee_code", f.employee_code);
      const [dw, dv] = f.from_date ? dateRangeWhere("ar", "session_date", f.from_date, f.to_date)
        : monthWhere("ar", "session_date", f.month);
      const bCond = f.branch ? "AND bm.branch_name = ?" : "";
      const bv = f.branch ? [f.branch] : [];
      return q(`
        SELECT ar.employee_code, bm.branch_name,
               ar.session_date AS issue_date,
               ar.old_status, ar.new_status, ar.dispute_type,
               ar.reason, ar.status, ar.reviewed_at, ar.manager_review_note
        FROM attendance_regularization ar
        JOIN employees e ON e.id = ar.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        WHERE ar.escalated_to LIKE 'BWAI:%'
          ${ew} ${dw} ${bCond}
        ORDER BY bm.branch_name, ar.employee_code, ar.session_date
      `, [...ev, ...dv, ...bv]);
    },
  },

  // ── 6. Leave Register ────────────────────────────────────────────────────
  "leave-register": {
    columns: [
      { key: "employee_code", label: "Emp Code",    format: "text" },
      { key: "employee_name", label: "Employee Name", format: "text" },
      { key: "branch_name",   label: "Branch",      format: "text" },
      { key: "cost_center",   label: "Cost Centre", format: "text" },
      { key: "leave_from",    label: "Leave From",  format: "date" },
      { key: "leave_to",      label: "Leave To",    format: "date" },
      { key: "total_days",    label: "Total Days",  format: "number", align: "right" },
      { key: "leave_type",    label: "Leave Type",  format: "text" },
      { key: "status",        label: "Status",      format: "status" },
      { key: "purpose",       label: "Reason",      format: "text" },
      { key: "cl",            label: "CL",          format: "number", align: "right" },
      { key: "el",            label: "EL",          format: "number", align: "right" },
      { key: "lwp",           label: "LWP",         format: "number", align: "right" },
    ],
    async query(f) {
      const [bw, bv] = branchWhere("bm", f.branch);
      const [ew, ev] = empWhere("e", "employee_code", f.employee_code);
      const [dw, dv] = f.from_date ? dateRangeWhere("lr", "start_date", f.from_date, f.to_date)
        : monthWhere("lr", "start_date", f.month);
      return q(`
        SELECT e.employee_code, e.full_name AS employee_name,
               bm.branch_name, cc.cost_centre_code AS cost_center,
               lr.start_date AS leave_from, lr.end_date AS leave_to,
               lr.total_days, lr.leave_type, lr.status, lr.reason AS purpose,
               lr.cl_days AS cl, lr.el_days AS el, lr.lwp_days AS lwp
        FROM leave_request lr
        JOIN employees e ON e.id = lr.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
        WHERE 1=1 ${bw} ${ew} ${dw}
        ORDER BY bm.branch_name, e.employee_code, lr.start_date
      `, [...bv, ...ev, ...dv]);
    },
  },

  // ── 7. Loan Register ─────────────────────────────────────────────────────
  "loan-register": {
    columns: [
      { key: "employee_code",       label: "Emp Code",         format: "text" },
      { key: "employee_name",       label: "Employee Name",    format: "text" },
      { key: "branch_name",         label: "Branch",           format: "text" },
      { key: "loan_type",           label: "Type",             format: "text" },
      { key: "loan_amount",         label: "Amount",           format: "currency", align: "right" },
      { key: "installment_amount",  label: "Installment/Month",format: "currency", align: "right" },
      { key: "total_installments",  label: "Installments",     format: "number",   align: "right" },
      { key: "start_date",          label: "Start Date",       format: "date" },
      { key: "end_date",            label: "End Date",         format: "date" },
      { key: "deducted_amount",     label: "Deducted",         format: "currency", align: "right" },
      { key: "pending_amount",      label: "Pending",          format: "currency", align: "right" },
      { key: "status",              label: "Status",           format: "status" },
    ],
    sumCols: ["loan_amount","deducted_amount","pending_amount"],
    async query(f) {
      const [bw, bv] = branchWhere("bm", f.branch);
      const [ew, ev] = empWhere("e", "employee_code", f.employee_code);
      return q(`
        SELECT e.employee_code, e.full_name AS employee_name,
               bm.branch_name, el.loan_type,
               el.loan_amount, el.installment_amount, el.total_installments,
               el.start_date, el.end_date,
               el.total_deducted AS deducted_amount,
               el.outstanding_amount AS pending_amount,
               el.status
        FROM employee_loans el
        JOIN employees e ON e.id = el.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        WHERE 1=1 ${bw} ${ew}
        ORDER BY bm.branch_name, e.employee_code
      `, [...bv, ...ev]);
    },
  },

  // ── 8. Income Tax Register ───────────────────────────────────────────────
  "income-tax-register": {
    columns: [
      { key: "employee_code", label: "Emp Code",    format: "text" },
      { key: "employee_name", label: "Employee Name", format: "text" },
      { key: "branch_name",   label: "Branch",      format: "text" },
      { key: "tax_month",     label: "Tax Month",   format: "text" },
      { key: "tds_amount",    label: "Income Tax",  format: "currency", align: "right" },
      { key: "source",        label: "Source",      format: "text" },
    ],
    sumCols: ["tds_amount"],
    async query(f) {
      const [bw, bv] = branchWhere("bm", f.branch);
      const [ew, ev] = empWhere("e", "employee_code", f.employee_code);
      const mCond = f.month ? "AND ils.tax_month = ?" : "";
      const mv    = f.month ? [f.month] : [];
      // Legacy snapshot UNION live TDS from salary_prep_line_component
      return q(`
        SELECT ils.employee_code, e.full_name AS employee_name,
               bm.branch_name, ils.tax_month,
               ils.income_tax AS tds_amount, 'legacy' AS source
        FROM incometax_legacy_snapshot ils
        JOIN employees e ON e.employee_code = ils.employee_code
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        WHERE 1=1 ${bw} ${ew} ${mCond}
        UNION ALL
        SELECT spl.employee_code, e.full_name AS employee_name,
               bm.branch_name,
               spr.run_month AS tax_month,
               splc.amount AS tds_amount, 'hrms' AS source
        FROM salary_prep_line_component splc
        JOIN salary_prep_line spl ON spl.id = splc.line_id
        JOIN salary_prep_run spr ON spr.id = spl.run_id
        JOIN employees e ON e.id = spl.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        WHERE splc.component_code = 'TDS'
          ${f.branch ? "AND bm.branch_name = ?" : ""}
          ${f.employee_code ? "AND spl.employee_code = ?" : ""}
          ${f.month ? "AND spr.run_month = ?" : ""}
        ORDER BY branch_name, employee_code, tax_month
      `, [...bv, ...ev, ...mv, ...bv, ...ev, ...mv]);
    },
  },

  // ── 9. OD Register ───────────────────────────────────────────────────────
  "od-register": {
    columns: [
      { key: "employee_code", label: "Emp Code",    format: "text" },
      { key: "employee_name", label: "Employee Name", format: "text" },
      { key: "branch_name",   label: "Branch",      format: "text" },
      { key: "designation",   label: "Designation", format: "text" },
      { key: "start_date",    label: "OD From",     format: "date" },
      { key: "end_date",      label: "OD To",       format: "date" },
      { key: "reason",        label: "Reason",      format: "text" },
      { key: "approve_first", label: "L1 Approval", format: "text" },
      { key: "approve_second",label: "L2 Approval", format: "text" },
      { key: "created_date",  label: "Created Date",format: "date" },
    ],
    async query(f) {
      const [bw, bv] = branchWhere("o", f.branch);
      const [ew, ev] = empWhere("o", "employee_code", f.employee_code);
      const [dw, dv] = f.from_date ? dateRangeWhere("o", "start_date", f.from_date, f.to_date)
        : monthWhere("o", "start_date", f.month);
      return q(`
        SELECT employee_code, employee_name, branch_name, designation,
               start_date, end_date, reason,
               approve_first, approve_second, created_date
        FROM od_register_snapshot o
        WHERE 1=1 ${bw} ${ew} ${dw}
        ORDER BY branch_name, employee_code, start_date
      `, [...bv, ...ev, ...dv]);
    },
  },

  // ── 10. Incentive Register ───────────────────────────────────────────────
  "incentive-register": {
    columns: [
      { key: "employee_code",   label: "Emp Code",       format: "text" },
      { key: "employee_name",   label: "Employee Name",  format: "text" },
      { key: "branch_name",     label: "Branch",         format: "text" },
      { key: "cost_center",     label: "Cost Centre",    format: "text" },
      { key: "incentive_type",  label: "Incentive Type", format: "text" },
      { key: "amount",          label: "Amount",         format: "currency", align: "right" },
      { key: "salary_month",    label: "Salary Month",   format: "text" },
      { key: "approve_status",  label: "Status",         format: "status" },
    ],
    sumCols: ["amount"],
    async query(f) {
      const [bw, bv] = branchWhere("i", f.branch);
      const [ew, ev] = empWhere("i", "employee_code", f.employee_code);
      const [mw, mv] = monthWhere("i", "salary_month", f.month);
      return q(`
        SELECT employee_code, employee_name, branch_name, cost_center,
               incentive_type, amount, salary_month, approve_status
        FROM incentive_upload_snapshot i
        WHERE 1=1 ${bw} ${ew} ${mw}
        ORDER BY branch_name, employee_code, salary_month
      `, [...bv, ...ev, ...mv]);
    },
  },

  // ── 11. Deduction Register ───────────────────────────────────────────────
  "deduction-register": {
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
      { key: "other_deduction",  label: "Other Ded",       format: "currency", align: "right" },
      { key: "remarks",          label: "Remarks",         format: "text" },
    ],
    sumCols: ["mobile_deduction","short_collection","asset_recovery","leave_deduction","other_deduction"],
    async query(f) {
      const [bw, bv] = branchWhere("d", f.branch);
      const [ew, ev] = empWhere("d", "employee_code", f.employee_code);
      const [mw, mv] = monthWhere("d", "salary_month", f.month);
      return q(`
        SELECT employee_code, employee_name, branch_name, cost_center,
               salary_month, mobile_deduction, short_collection,
               asset_recovery, insurance, leave_deduction,
               other_deduction, remarks
        FROM upload_deduction_snapshot d
        WHERE 1=1 ${bw} ${ew} ${mw}
        ORDER BY branch_name, employee_code, salary_month
      `, [...bv, ...ev, ...mv]);
    },
  },

  // ── 12. Employee Transfer Register ───────────────────────────────────────
  "transfer-register": {
    columns: [
      { key: "employee_code",    label: "Emp Code",        format: "text" },
      { key: "from_branch",      label: "From Branch",     format: "text" },
      { key: "to_branch",        label: "To Branch",       format: "text" },
      { key: "from_cost_center", label: "From CC",         format: "text" },
      { key: "to_cost_center",   label: "To CC",           format: "text" },
      { key: "move_month",       label: "Move Month",      format: "text" },
      { key: "reason",           label: "Reason",          format: "text" },
      { key: "move_date",        label: "Move Date",       format: "date" },
    ],
    async query(f) {
      const eCond = f.employee_code ? "AND employee_code = ?" : "";
      const ev    = f.employee_code ? [f.employee_code] : [];
      const bCond = f.branch ? "AND (from_branch = ? OR to_branch = ?)" : "";
      const bv    = f.branch ? [f.branch, f.branch] : [];
      const mCond = f.month  ? "AND move_month = ?" : "";
      const mv    = f.month  ? [f.month] : [];
      return q(`
        SELECT employee_code, from_branch, to_branch,
               from_cost_center, to_cost_center,
               move_month, reason, move_date
        FROM employee_move_snapshot
        WHERE 1=1 ${eCond} ${bCond} ${mCond}
        ORDER BY move_month DESC, employee_code
      `, [...ev, ...bv, ...mv]);
    },
  },

  // ── 13. DOJ Change Register ───────────────────────────────────────────────
  "doj-change-register": {
    columns: [
      { key: "employee_code", label: "Emp Code",    format: "text" },
      { key: "employee_name", label: "Employee Name", format: "text" },
      { key: "branch_name",   label: "Branch",      format: "text" },
      { key: "old_doj",       label: "Old DOJ",     format: "date" },
      { key: "new_doj",       label: "New DOJ",     format: "date" },
      { key: "remarks",       label: "Remarks",     format: "text" },
      { key: "approve_status",label: "Status",      format: "status" },
      { key: "approve_date",  label: "Approved On", format: "date" },
    ],
    async query(f) {
      const [bw, bv] = branchWhere("c", f.branch);
      const [ew, ev] = empWhere("c", "employee_code", f.employee_code);
      return q(`
        SELECT employee_code, employee_name, branch_name,
               old_doj, new_doj, remarks, approve_status, approve_date
        FROM change_doj_snapshot c
        WHERE 1=1 ${bw} ${ew}
        ORDER BY branch_name, employee_code
      `, [...bv, ...ev]);
    },
  },

  // ── 14. Document Register ────────────────────────────────────────────────
  "document-register": {
    columns: [
      { key: "employee_code", label: "Emp Code",    format: "text" },
      { key: "doc_type",      label: "Doc Type",    format: "text" },
      { key: "doc_name",      label: "Doc Name",    format: "text" },
      { key: "file_no",       label: "File No",     format: "text" },
      { key: "box_no",        label: "Box No",      format: "text" },
      { key: "doc_status",    label: "Status",      format: "status" },
      { key: "save_date",     label: "Saved On",    format: "date" },
    ],
    async query(f) {
      const [ew, ev] = empWhere("d", "employee_code", f.employee_code);
      return q(`
        SELECT employee_code, doc_type, doc_name, file_no,
               box_no, doc_status, save_date
        FROM doc_legacy_snapshot d
        WHERE 1=1 ${ew}
        ORDER BY employee_code, doc_type
      `, [...ev]);
    },
  },

  // ── 15. Legacy Employee Master ───────────────────────────────────────────
  "legacy-employee-master": {
    columns: [
      { key: "employee_code",  label: "Emp Code",     format: "text" },
      { key: "employee_name",  label: "Name",         format: "text" },
      { key: "branch_name",    label: "Branch",       format: "text" },
      { key: "process",        label: "Process",      format: "text" },
      { key: "designation",    label: "Designation",  format: "text" },
      { key: "doj",            label: "DOJ",          format: "date" },
      { key: "dol",            label: "DOL",          format: "date" },
      { key: "basic",          label: "Basic",        format: "currency", align: "right" },
      { key: "hra",            label: "HRA",          format: "currency", align: "right" },
      { key: "gross",          label: "Gross",        format: "currency", align: "right" },
      { key: "ctc_monthly",    label: "CTC/Month",    format: "currency", align: "right" },
      { key: "net_salary",     label: "Net In Hand",  format: "currency", align: "right" },
      { key: "pf_eligible",    label: "PF Eligible",  format: "boolean" },
      { key: "esic_eligible",  label: "ESI Eligible", format: "boolean" },
    ],
    async query(f) {
      const [bw, bv] = branchWhere("ls", f.branch);
      const [ew, ev] = empWhere("ls", "employee_code", f.employee_code);
      return q(`
        SELECT employee_code, branch_name,
               process, designation, doj, dol,
               basic, hra, gross, ctc_monthly, net_salary,
               pf_eligible, esic_eligible,
               COALESCE(
                 (SELECT full_name FROM employees e WHERE e.employee_code = ls.employee_code LIMIT 1),
                 ls.employee_code
               ) AS employee_name
        FROM legacy_salary_snapshot ls
        WHERE 1=1 ${bw} ${ew}
        ORDER BY branch_name, employee_code
      `, [...bv, ...ev]);
    },
  },

  // ── 16. Salary History ───────────────────────────────────────────────────
  "salary-history": {
    columns: [
      { key: "employee_code", label: "Emp Code",    format: "text" },
      { key: "branch_name",   label: "Branch",      format: "text" },
      { key: "basic",         label: "Basic",       format: "currency", align: "right" },
      { key: "hra",           label: "HRA",         format: "currency", align: "right" },
      { key: "gross",         label: "Gross",       format: "currency", align: "right" },
      { key: "ctc_monthly",   label: "CTC/Month",   format: "currency", align: "right" },
      { key: "net_salary",    label: "Net In Hand", format: "currency", align: "right" },
      { key: "effective_date",label: "Effective",   format: "date" },
    ],
    async query(f) {
      const [bw, bv] = branchWhere("bm", f.branch);
      const [ew, ev] = empWhere("esh", "employee_code", f.employee_code);
      return q(`
        SELECT esh.employee_code, bm.branch_name,
               esh.basic, esh.hra, esh.gross_salary AS gross,
               esh.ctc_monthly, esh.net_salary, esh.effective_date
        FROM employee_salary_history esh
        JOIN employees e ON e.id = esh.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        WHERE esh.source = 'data_migration' ${bw} ${ew}
        ORDER BY esh.employee_code, esh.effective_date DESC
      `, [...bv, ...ev]);
    },
  },

  // ── 17. Quality Attendance ───────────────────────────────────────────────
  "qual-attendance": {
    columns: [
      { key: "employee_code", label: "Emp Code",    format: "text" },
      { key: "present",       label: "Present",     format: "number", align: "right" },
      { key: "week_off",      label: "WO",          format: "number", align: "right" },
      { key: "holiday",       label: "Holiday",     format: "number", align: "right" },
      { key: "half_day",      label: "Half Day",    format: "number", align: "right" },
      { key: "compoff",       label: "Compoff",     format: "number", align: "right" },
      { key: "el",            label: "EL",          format: "number", align: "right" },
      { key: "cl",            label: "CL",          format: "number", align: "right" },
      { key: "sl",            label: "SL",          format: "number", align: "right" },
      { key: "ot",            label: "OT",          format: "number", align: "right" },
      { key: "sal_month",     label: "Month",       format: "text" },
      { key: "sal_year",      label: "Year",        format: "text" },
    ],
    async query(f) {
      const [ew, ev] = empWhere("q", "employee_code", f.employee_code);
      const mCond = f.month ? "AND CONCAT(q.sal_year,'-',LPAD(q.sal_month,2,'0')) = ?" : "";
      const mv    = f.month ? [f.month] : [];
      return q(`
        SELECT employee_code, present, week_off, holiday, half_day,
               compoff, el, cl, sl, ot, sal_month, sal_year
        FROM qual_attendance_snapshot q
        WHERE 1=1 ${ew} ${mCond}
        ORDER BY sal_year DESC, sal_month DESC, employee_code
      `, [...ev, ...mv]);
    },
  },

  // ── 18. Quality Leave ────────────────────────────────────────────────────
  "qual-leave": {
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
      const [ew, ev] = empWhere("q", "employee_code", f.employee_code);
      const mCond = f.month ? "AND CONCAT(q.leave_year,'-',LPAD(q.leave_month,2,'0')) = ?" : "";
      const mv    = f.month ? [f.month] : [];
      return q(`
        SELECT employee_code, pl, cl, sl, leave_status, leave_month, leave_year
        FROM qual_leave_snapshot q
        WHERE 1=1 ${ew} ${mCond}
        ORDER BY leave_year DESC, leave_month DESC, employee_code
      `, [...ev, ...mv]);
    },
  },

  // ── 19. Quality Salary ───────────────────────────────────────────────────
  "qual-salary": {
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
      { key: "esic",          label: "ESIC",      format: "currency", align: "right" },
      { key: "net_pay",       label: "Net Pay",   format: "currency", align: "right" },
      { key: "uan",           label: "UAN",       format: "text" },
      { key: "sal_month",     label: "Month",     format: "text" },
      { key: "sal_year",      label: "Year",      format: "text" },
    ],
    sumCols: ["gross","net_pay","pf","esic","tds"],
    async query(f) {
      const [ew, ev] = empWhere("q", "employee_code", f.employee_code);
      const mCond = f.month ? "AND CONCAT(q.sal_year,'-',LPAD(q.sal_month,2,'0')) = ?" : "";
      const mv    = f.month ? [f.month] : [];
      return q(`
        SELECT employee_code, qual_emp_code, employee_name, designation,
               basic, hra, gross, pf, tds, esic, net_pay, uan,
               sal_month, sal_year
        FROM qual_salary_snapshot q
        WHERE 1=1 ${ew} ${mCond}
        ORDER BY sal_year DESC, sal_month DESC, employee_code
      `, [...ev, ...mv]);
    },
  },

  // ── 20. Quality Incentive ────────────────────────────────────────────────
  "qual-incentive": {
    columns: [
      { key: "employee_code", label: "Emp Code",   format: "text" },
      { key: "amount",        label: "Incentive",  format: "currency", align: "right" },
      { key: "sal_month",     label: "Month",      format: "text" },
      { key: "sal_year",      label: "Year",       format: "text" },
      { key: "remarks",       label: "Remarks",    format: "text" },
    ],
    sumCols: ["amount"],
    async query(f) {
      const [ew, ev] = empWhere("q", "employee_code", f.employee_code);
      const mCond = f.month ? "AND CONCAT(q.sal_year,'-',LPAD(q.sal_month,2,'0')) = ?" : "";
      const mv    = f.month ? [f.month] : [];
      return q(`
        SELECT employee_code, amount, sal_month, sal_year, remarks
        FROM qual_incentive_snapshot q
        WHERE 1=1 ${ew} ${mCond}
        ORDER BY sal_year DESC, sal_month DESC, employee_code
      `, [...ev, ...mv]);
    },
  },
};

// ── public API ────────────────────────────────────────────────────────────────

export const legacyReportsService = {
  list(): { code: string; label: string }[] {
    const labels: Record<string, string> = {
      "salary-register":      "Salary Register",
      "attendance-register":  "Attendance Register",
      "wfh-attendance":       "WFH Attendance",
      "field-attendance":     "Field Attendance",
      "attendance-issues":    "Attendance Issues",
      "leave-register":       "Leave Register",
      "loan-register":        "Loan Register",
      "income-tax-register":  "Income Tax Register",
      "od-register":          "OD Register",
      "incentive-register":   "Incentive Register",
      "deduction-register":   "Deduction Register",
      "transfer-register":    "Transfer Register",
      "doj-change-register":  "DOJ Change Register",
      "document-register":    "Document Register",
      "legacy-employee-master":"Legacy Employee Master",
      "salary-history":       "Salary History",
      "qual-attendance":      "Quality Attendance",
      "qual-leave":           "Quality Leave",
      "qual-salary":          "Quality Salary",
      "qual-incentive":       "Quality Incentive",
    };
    return Object.keys(REPORTS).map(code => ({ code, label: labels[code] ?? code }));
  },

  async run(code: string, filter: LegacyFilter): Promise<LegacyReportResult> {
    const def = REPORTS[code];
    if (!def) throw new Error(`Unknown legacy report: ${code}`);
    const rows = await def.query(filter) as Record<string, unknown>[];
    const summary = def.sumCols ? numSum(rows, def.sumCols) : undefined;
    return { columns: def.columns, rows, total: rows.length, summary };
  },

  toCsv(result: LegacyReportResult): string {
    const escape = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = result.columns.map(c => escape(c.label)).join(",");
    const body   = result.rows.map(r =>
      result.columns.map(c => escape(r[c.key])).join(",")
    ).join("\n");
    return header + "\n" + body;
  },
};
```

- [ ] **Step 2: Verify the file compiles**

```bash
cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend
npx tsc --noEmit 2>&1 | grep legacy-reports
```
Expected: no errors mentioning `legacy-reports.service.ts`

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/legacy-reports/legacy-reports.service.ts
git commit -m "feat(legacy-reports): service with all 20 db_bill report queries"
```

---

## Task 2 — Backend Routes + App.ts Wiring

**Files:**
- Create: `backend/src/modules/legacy-reports/legacy-reports.routes.ts`
- Modify: `backend/src/app.ts` (add one import + one `app.use` line)

**Interfaces:**
- Consumes: `legacyReportsService` from Task 1
- Produces: `GET /api/legacy-reports` (list), `GET /api/legacy-reports/:code` (JSON data), `GET /api/legacy-reports/:code/export` (CSV download)

- [ ] **Step 1: Create the routes file**

```typescript
// backend/src/modules/legacy-reports/legacy-reports.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { legacyReportsService, type LegacyFilter } from "./legacy-reports.service.js";

export const legacyReportsRouter = Router();

const ROLES = ["super_admin", "hr_admin", "payroll_hr", "finance_head"] as const;

const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

function parseFilter(query: Record<string, unknown>): LegacyFilter {
  return {
    branch:        query.branch        ? String(query.branch)        : undefined,
    month:         query.month         ? String(query.month)         : undefined,
    from_date:     query.from_date     ? String(query.from_date)     : undefined,
    to_date:       query.to_date       ? String(query.to_date)       : undefined,
    employee_code: query.employee_code ? String(query.employee_code) : undefined,
  };
}

legacyReportsRouter.use(requireAuth);

legacyReportsRouter.get("/", requireRole(...ROLES), h(async (_req: any, res: any) => {
  res.json({ success: true, data: legacyReportsService.list() });
}));

legacyReportsRouter.get("/:code", requireRole(...ROLES), h(async (req: any, res: any) => {
  const result = await legacyReportsService.run(req.params.code, parseFilter(req.query));
  res.json({ success: true, data: result });
}));

legacyReportsRouter.get("/:code/export", requireRole(...ROLES), h(async (req: any, res: any) => {
  const result = await legacyReportsService.run(req.params.code, parseFilter(req.query));
  const csv    = legacyReportsService.toCsv(result);
  const period = req.query.month ? `-${req.query.month}` : "";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="legacy-${req.params.code}${period}.csv"`);
  res.send(csv);
}));
```

- [ ] **Step 2: Mount in app.ts**

Find the block in `backend/src/app.ts` where other finance/payroll routes are mounted (search for `salaryVoucherRouter` or `payrollRouter`). Add these two lines in the same block:

```typescript
import { legacyReportsRouter } from "./modules/legacy-reports/legacy-reports.routes.js";
// ...
app.use("/api/legacy-reports", legacyReportsRouter);
```

- [ ] **Step 3: Smoke test the endpoint**

```bash
cd c:/Users/ADMIN/Desktop/HRMS2-latest
node backend/dist/app.js &
# or if already running, hit with curl:
curl -s "http://localhost:3000/api/legacy-reports" -H "Authorization: Bearer <token>" | head -100
```
Expected: JSON `{ success: true, data: [{code:"salary-register",label:"Salary Register"}, ...] }` with 20 items.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/legacy-reports/legacy-reports.routes.ts backend/src/app.ts
git commit -m "feat(legacy-reports): REST routes + mount in app.ts"
```

---

## Task 3 — Frontend: LegacyHrmsReportsView Component

**Files:**
- Create: `src/components/reports/views/LegacyHrmsReportsView.tsx`

**Interfaces:**
- Consumes: `hrmsApi.get('/api/legacy-reports')` → list of reports; `hrmsApi.get('/api/legacy-reports/:code', { params: filter })` → `{ columns, rows, total, summary }`

- [ ] **Step 1: Create the view**

```tsx
// src/components/reports/views/LegacyHrmsReportsView.tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText, Search } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

type ReportMeta = { code: string; label: string };
type LegacyColumn = { key: string; label: string; format: string; align?: string };
type LegacyResult = { columns: LegacyColumn[]; rows: Record<string, unknown>[]; total: number; summary?: Record<string, number> };

function unwrap<T>(r: unknown): T { return ((r as any)?.data?.data ?? (r as any)?.data ?? r) as T; }

const MONTH_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const d = new Date(); d.setMonth(d.getMonth() - i);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
});

function formatCell(value: unknown, format: string): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (format === "currency" && !isNaN(n))
    return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (format === "number" && !isNaN(n)) return n.toLocaleString("en-IN");
  if (format === "date" && String(value).length >= 10) {
    try { return new Date(String(value)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
    catch { return String(value); }
  }
  if (format === "boolean") return (value === true || value === 1 || value === "1") ? "Yes" : "No";
  if (format === "status") return String(value).replace(/_/g, " ");
  return String(value);
}

export default function LegacyHrmsReportsView() {
  const [selected, setSelected]   = useState<string>("");
  const [month, setMonth]         = useState<string>("");
  const [branch, setBranch]       = useState<string>("");
  const [empCode, setEmpCode]     = useState<string>("");
  const [run, setRun]             = useState(false);

  const { data: listData } = useQuery({
    queryKey: ["legacy-report-list"],
    queryFn: () => hrmsApi.get("/api/legacy-reports"),
  });
  const reports: ReportMeta[] = unwrap<ReportMeta[]>(listData) ?? [];

  const { data: resultData, isFetching, error } = useQuery({
    queryKey: ["legacy-report", selected, month, branch, empCode, run],
    queryFn: () => hrmsApi.get(`/api/legacy-reports/${selected}`, {
      params: { ...(month && { month }), ...(branch && { branch }), ...(empCode && { employee_code: empCode }) },
    }),
    enabled: run && !!selected,
  });
  const result: LegacyResult | null = run && resultData ? unwrap<LegacyResult>(resultData) : null;

  function handleExport() {
    const params = new URLSearchParams();
    if (month)   params.set("month", month);
    if (branch)  params.set("branch", branch);
    if (empCode) params.set("employee_code", empCode);
    const token = localStorage.getItem("token") ?? "";
    const url = `/api/legacy-reports/${selected}/export?${params}`;
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", "");
    // Fetch with auth header
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const bUrl = URL.createObjectURL(blob);
        a.href = bUrl;
        a.click();
        URL.revokeObjectURL(bUrl);
      });
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar — report list */}
      <aside className="w-64 shrink-0 border-r bg-slate-50 dark:bg-slate-900 overflow-y-auto">
        <div className="p-3 border-b">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Legacy HRMS Reports</p>
          <p className="text-xs text-slate-400 mt-0.5">db_bill data — exact format</p>
        </div>
        <nav className="p-2 space-y-0.5">
          {reports.map(r => (
            <button
              key={r.code}
              onClick={() => { setSelected(r.code); setRun(false); }}
              className={`w-full text-left px-3 py-2 rounded text-sm transition-colors
                ${selected === r.code
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800"}`}
            >
              <FileText className="inline w-3.5 h-3.5 mr-1.5 opacity-60" />
              {r.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select a report from the sidebar</p>
            </div>
          </div>
        ) : (
          <>
            {/* Filter bar */}
            <div className="px-4 py-3 border-b bg-white dark:bg-slate-950 flex flex-wrap gap-2 items-end">
              <div>
                <p className="text-xs text-slate-500 mb-1">Month</p>
                <Select value={month} onValueChange={setMonth}>
                  <SelectTrigger className="w-36 h-8 text-sm"><SelectValue placeholder="All months" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All months</SelectItem>
                    {MONTH_OPTIONS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Branch</p>
                <Input value={branch} onChange={e => setBranch(e.target.value)} placeholder="Any branch" className="w-44 h-8 text-sm" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Emp Code</p>
                <Input value={empCode} onChange={e => setEmpCode(e.target.value)} placeholder="MAS12345" className="w-32 h-8 text-sm" />
              </div>
              <Button size="sm" onClick={() => setRun(true)} disabled={isFetching}>
                <Search className="w-3.5 h-3.5 mr-1.5" />{isFetching ? "Loading…" : "Run Report"}
              </Button>
              {result && result.total > 0 && (
                <Button size="sm" variant="outline" onClick={handleExport}>
                  <Download className="w-3.5 h-3.5 mr-1.5" />Export CSV
                </Button>
              )}
              {result && (
                <Badge variant="secondary" className="ml-auto">{result.total.toLocaleString("en-IN")} rows</Badge>
              )}
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
              {error && (
                <div className="p-4 text-sm text-red-600">
                  Error: {(error as Error).message}
                </div>
              )}
              {result && result.rows.length === 0 && (
                <div className="p-8 text-center text-slate-400 text-sm">No data for the selected filters.</div>
              )}
              {result && result.rows.length > 0 && (
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 z-10">
                    <tr>
                      {result.columns.map(col => (
                        <th key={col.key}
                          className={`px-2 py-1.5 text-left font-semibold text-slate-600 dark:text-slate-300 border-b whitespace-nowrap
                            ${col.align === "right" ? "text-right" : ""}`}>
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, ri) => (
                      <tr key={ri} className={`border-b hover:bg-slate-50 dark:hover:bg-slate-900
                        ${ri % 2 === 0 ? "" : "bg-slate-50/50 dark:bg-slate-900/30"}`}>
                        {result.columns.map(col => (
                          <td key={col.key}
                            className={`px-2 py-1 text-slate-700 dark:text-slate-300 whitespace-nowrap
                              ${col.align === "right" ? "text-right font-mono" : ""}`}>
                            {formatCell(row[col.key], col.format)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {/* Summary / totals row */}
                    {result.summary && Object.keys(result.summary).length > 0 && (
                      <tr className="bg-slate-200 dark:bg-slate-700 font-semibold border-t-2">
                        {result.columns.map((col, ci) => (
                          <td key={col.key}
                            className={`px-2 py-1.5 text-slate-800 dark:text-slate-200 whitespace-nowrap
                              ${col.align === "right" ? "text-right font-mono" : ""}`}>
                            {ci === 0
                              ? "TOTAL"
                              : result.summary![col.key] != null
                                ? formatCell(result.summary![col.key], col.format)
                                : ""}
                          </td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds**

```bash
cd c:/Users/ADMIN/Desktop/HRMS2-latest
npx tsc --noEmit 2>&1 | grep LegacyHrms
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/reports/views/LegacyHrmsReportsView.tsx
git commit -m "feat(legacy-reports): LegacyHrmsReportsView with sidebar + filter bar + table"
```

---

## Task 4 — Wire Tab into ReportsHub

**Files:**
- Modify: `src/pages/ReportsHub.tsx`

- [ ] **Step 1: Edit ReportsHub.tsx**

In `src/pages/ReportsHub.tsx`, make these three changes:

**Change 1** — add lazy import after the existing lazy imports (line ~14):
```tsx
const LegacyHrmsReportsView = lazy(() => import("@/components/reports/views/LegacyHrmsReportsView"));
```

**Change 2** — add `'legacy'` to the VIEWS tuple (line ~18):
```tsx
const VIEWS = ['library', 'control-room', 'bpo', 'aon', 'requests', 'validation', 'audit', 'legacy'] as const;
```

**Change 3** — add permission check (after line 47):
```tsx
if (view === 'legacy' && !hasAnyRole(userRoles, REPORT_ROLES)) return def;
```

**Change 4** — add tab to TABS array (after the `audit` tab):
```tsx
{ key: 'legacy', label: 'Legacy HRMS Reports', Icon: Archive, requiredRoles: REPORT_ROLES },
```

**Change 5** — add `Archive` to the lucide-react import at top of file (find the existing `import { ... } from "lucide-react"` line and add `Archive`).

**Change 6** — add the view render case in the JSX where other views are rendered. Find the block that switches on `activeView` and add:
```tsx
{activeView === 'legacy' && (
  <Suspense fallback={<ViewLoader />}>
    <LegacyHrmsReportsView />
  </Suspense>
)}
```

- [ ] **Step 2: Verify builds and TypeScript is clean**

```bash
cd c:/Users/ADMIN/Desktop/HRMS2-latest
npx tsc --noEmit 2>&1 | grep -i "reportshub\|legacy"
```
Expected: no errors.

- [ ] **Step 3: Commit and push**

```bash
git add src/pages/ReportsHub.tsx
git commit -m "feat(legacy-reports): add Legacy HRMS Reports tab to ReportsHub"
git push --no-verify origin main
```

---

## Verification Checklist

After all tasks complete:

- [ ] `GET /api/legacy-reports` returns 20 report definitions
- [ ] `GET /api/legacy-reports/salary-register?month=2026-06` returns rows with totals matching db_bill June 2026 salary register
- [ ] `GET /api/legacy-reports/salary-register/export?month=2026-06` downloads a CSV with correct column headers
- [ ] ReportsHub shows "Legacy HRMS Reports" as a new tab
- [ ] Clicking any report in sidebar + setting month + clicking Run shows data in table
- [ ] Totals row appears for salary/incentive/deduction reports
- [ ] Export CSV button downloads correct data
