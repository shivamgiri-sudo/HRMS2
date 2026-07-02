# Report Standardization & UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mandatory employee-context columns (employee_code, employee_name, employment_status, designation, department, branch, process, cost_centre) to all employee-touching reports, rewrite attendance-summary with UNION logic for active+ex-employees, and completely redesign the Reports Center UI to a premium no-sidebar layout.

**Architecture:** Backend changes are purely SELECT/JOIN additions — no schema migrations needed. The `EMP_CORE_COLS` and `EMP_CORE_JOINS` constants provide a DRY pattern for the 8 mandatory columns. Frontend is a full rewrite of `NativeReportsCenter.tsx` with category-grid + runner-panel layout, animated transitions, and API-driven filter dropdowns.

**Tech Stack:** Express/TypeScript (backend), React 18 + TypeScript + Tailwind + shadcn/Radix (frontend), MySQL queries, React Query for data fetching.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `backend/src/modules/reporting/reporting.service.ts` | All QUERIES record query builders — add `EMP_CORE_COLS`/`EMP_CORE_JOINS` constants, enrich each builder with missing mandatory columns |
| `backend/src/modules/reporting/report-suite.routes.ts` | Suite report cases — add mandatory columns inline, rewrite `attendance-summary` with UNION |
| `src/pages/NativeReportsCenter.tsx` | Full UI rewrite — premium no-sidebar category grid + runner panel |

---

### Task 1: Add EMP_CORE_COLS and EMP_CORE_JOINS constants to reporting.service.ts

**Files:**
- Modify: `backend/src/modules/reporting/reporting.service.ts:14-16` (insert constants before QUERIES record)

- [ ] **Step 1: Add the shared SQL constants**

Insert between line 14 (the `Builder` type) and line 16 (the `const QUERIES` declaration):

```typescript
// ── Shared mandatory columns for all employee-touching reports ────────────────
const EMP_CORE_COLS = `
  e.employee_code,
  CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
  e.employment_status,
  desig.designation_name,
  dept.dept_name AS department,
  b.branch_name,
  p.process_name,
  cc.cost_centre_name`;

const EMP_CORE_JOINS = `
  LEFT JOIN branch_master b ON b.id = e.branch_id
  LEFT JOIN process_master p ON p.id = e.process_id
  LEFT JOIN department_master dept ON dept.id = e.department_id
  LEFT JOIN designation_master desig ON desig.id = e.designation_id
  LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id`;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors (constants are unused at this point — TS won't warn about unused consts in non-strict mode)

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/reporting/reporting.service.ts
git commit -m "feat(reports): add EMP_CORE_COLS and EMP_CORE_JOINS shared SQL constants"
```

---

### Task 2: Enrich employee_dir query with missing columns

**Files:**
- Modify: `backend/src/modules/reporting/reporting.service.ts:92-109`

- [ ] **Step 1: Rewrite employee_dir to use EMP_CORE_COLS/EMP_CORE_JOINS**

Replace the existing `employee_dir` builder (lines 92–109) with:

```typescript
  employee_dir: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
                   e.email, e.date_of_joining,
                   COALESCE(e.call_centre_code, b.call_centre_code) AS cc_code
              FROM employees e
              ${EMP_CORE_JOINS}
             WHERE e.active_status = 1 AND ${sc.sql}
               ${f.branch ? 'AND e.branch_id = ?' : ''}
               ${f.status ? 'AND e.employment_status = ?' : ''}
             ORDER BY b.branch_name, e.last_name`,
      params: [...sc.params, ...(f.branch ? [f.branch] : []), ...(f.status ? [f.status] : [])],
    };
  },
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/reporting/reporting.service.ts
git commit -m "feat(reports): enrich employee_dir with EMP_CORE_COLS"
```

---

### Task 3: Enrich payroll query builders (6 builders)

**Files:**
- Modify: `backend/src/modules/reporting/reporting.service.ts:115-355`

- [ ] **Step 1: Rewrite payroll_register**

Replace lines 115–164 with:

```typescript
  payroll_register: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               spr.run_month,
               spl.working_days, spl.present_days, spl.leave_days, spl.lwp_days, spl.late_marks,
               spl.gross_salary, spl.basic, spl.hra, spl.special_allowance,
               spl.pf_employee, spl.pf_employer, spl.esic_employee, spl.esic_employer,
               spl.professional_tax, spl.tds_amount, spl.advance_recovery,
               spl.lwp_deduction, spl.total_deductions, spl.net_salary,
               spl.status AS line_status
             FROM salary_prep_line spl
             JOIN salary_prep_run spr ON spr.id = spl.run_id
             JOIN employees e ON e.id = spl.employee_id
             ${EMP_CORE_JOINS}
            WHERE LOWER(spr.status) IN ('approved','disbursed','finalized')
              AND ${sc.sql}
              ${f.month ? 'AND spr.run_month = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.process ? 'AND e.process_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
        ...(f.process ? [f.process] : []),
      ],
    };
  },
```

- [ ] **Step 2: Rewrite payroll_component_detail**

Replace lines 166–199 with:

```typescript
  payroll_component_detail: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               spr.run_month,
               splc.component_code, splc.component_name, splc.component_type,
               splc.amount, splc.taxable, splc.source
             FROM salary_prep_line_component splc
             JOIN salary_prep_run spr ON spr.id = splc.run_id
             JOIN employees e ON e.id = splc.employee_id
             ${EMP_CORE_JOINS}
            WHERE LOWER(spr.status) IN ('approved','disbursed','finalized')
              AND ${sc.sql}
              ${f.month ? 'AND spr.run_month = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.componentType ? 'AND splc.component_type = ?' : ''}
            ORDER BY b.branch_name, e.employee_code, splc.component_type, splc.component_code`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
        ...(f.componentType ? [f.componentType] : []),
      ],
    };
  },
```

- [ ] **Step 3: Rewrite payroll_statutory**

Replace lines 201–236 with:

```typescript
  payroll_statutory: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               spr.run_month,
               e.uan_number, e.esic_number, e.pan_number,
               spl.gross_salary AS gross_wages,
               spl.pf_employee, spl.pf_employer,
               (spl.pf_employee + spl.pf_employer) AS total_pf,
               spl.esic_employee, spl.esic_employer,
               (spl.esic_employee + spl.esic_employer) AS total_esic,
               spl.professional_tax AS pt, spl.tds_amount AS tds
             FROM salary_prep_line spl
             JOIN salary_prep_run spr ON spr.id = spl.run_id
             JOIN employees e ON e.id = spl.employee_id
             ${EMP_CORE_JOINS}
            WHERE LOWER(spr.status) IN ('approved','disbursed','finalized')
              AND ${sc.sql}
              ${f.month ? 'AND spr.run_month = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },
```

- [ ] **Step 4: Rewrite payroll_bank_statement**

Replace lines 238–270 with:

```typescript
  payroll_bank_statement: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               spr.run_month,
               e.bank_name, e.bank_branch, e.account_holder_name,
               e.bank_account_number, e.ifsc_code, e.account_type,
               spl.net_salary AS amount_to_credit,
               spl.status AS line_status, spr.disbursed_at
             FROM salary_prep_line spl
             JOIN salary_prep_run spr ON spr.id = spl.run_id
             JOIN employees e ON e.id = spl.employee_id
             ${EMP_CORE_JOINS}
            WHERE LOWER(spr.status) IN ('approved','disbursed','finalized')
              AND ${sc.sql}
              ${f.month ? 'AND spr.run_month = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },
```

- [ ] **Step 5: Rewrite payroll_full_final**

Replace lines 272–312 with:

```typescript
  payroll_full_final: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               e.date_of_joining, e.date_of_exit,
               er.resignation_date, er.last_working_day, er.exit_type,
               ffc.calculation_date, ffc.notice_period_days, ffc.notice_shortfall_days,
               ffc.notice_recovery, ffc.earned_leave_encashment, ffc.gratuity_amount,
               ffc.salary_hold, ffc.advances_recovery, ffc.net_payable,
               ffc.status AS ff_status
             FROM full_final_calculation ffc
             JOIN exit_request er ON er.id = ffc.exit_request_id
             JOIN employees e ON e.id = ffc.employee_id
             ${EMP_CORE_JOINS}
            WHERE ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.dateFrom ? 'AND ffc.calculation_date >= ?' : ''}
              ${f.dateTo ? 'AND ffc.calculation_date <= ?' : ''}
            ORDER BY ffc.calculation_date DESC`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
      ],
    };
  },
```

- [ ] **Step 6: Rewrite payroll_ytd**

Replace lines 314–352 with:

```typescript
  payroll_ytd: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               spr.financial_year,
               COUNT(spl.id) AS months_paid,
               SUM(spl.gross_salary) AS ytd_gross, SUM(spl.basic) AS ytd_basic,
               SUM(spl.hra) AS ytd_hra, SUM(spl.special_allowance) AS ytd_special_allowance,
               SUM(spl.pf_employee) AS ytd_pf_employee, SUM(spl.pf_employer) AS ytd_pf_employer,
               SUM(spl.esic_employee) AS ytd_esic_employee,
               SUM(spl.professional_tax) AS ytd_pt, SUM(spl.tds_amount) AS ytd_tds,
               SUM(spl.lwp_deduction) AS ytd_lwp_deduction, SUM(spl.net_salary) AS ytd_net
             FROM salary_prep_line spl
             JOIN salary_prep_run spr ON spr.id = spl.run_id
             JOIN employees e ON e.id = spl.employee_id
             ${EMP_CORE_JOINS}
            WHERE LOWER(spr.status) IN ('approved','disbursed','finalized')
              AND ${sc.sql}
              ${f.financialYear ? 'AND spr.financial_year = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            GROUP BY e.id, spr.financial_year
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(f.financialYear ? [f.financialYear] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/reporting/reporting.service.ts
git commit -m "feat(reports): enrich all 6 payroll query builders with EMP_CORE_COLS"
```

---

### Task 4: Enrich employee detail builders (emp_master through emp_documents)

**Files:**
- Modify: `backend/src/modules/reporting/reporting.service.ts:358-567`

- [ ] **Step 1: Rewrite emp_statutory to add missing columns**

Replace lines 448–476. The key additions are `dept`, `desig`, `p`, `cc` JOINs and their columns in SELECT:

```typescript
  emp_statutory: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               e.pan_number, e.pan_verified_on,
               e.aadhaar_last4, e.aadhaar_verified_on,
               e.uan_number, e.epf_number, e.esic_number,
               esi.pf_applicable, esi.esic_applicable, esi.pt_applicable, esi.tds_applicable
             FROM employees e
             ${EMP_CORE_JOINS}
             LEFT JOIN employee_statutory_info esi ON esi.employee_id = e.id
            WHERE e.active_status = 1
              AND ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [...sc.params, ...(f.branch ? [f.branch] : [])],
    };
  },
```

- [ ] **Step 2: Rewrite emp_bank_details**

```typescript
  emp_bank_details: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               e.account_holder_name, e.bank_name, e.bank_branch,
               e.bank_account_number, e.ifsc_code, e.account_type
             FROM employees e
             ${EMP_CORE_JOINS}
            WHERE e.active_status = 1
              AND ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [...sc.params, ...(f.branch ? [f.branch] : [])],
    };
  },
```

- [ ] **Step 3: Rewrite emp_joining_exit**

```typescript
  emp_joining_exit: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const typeFilter =
      f.type === 'joiners' ? 'AND e.date_of_joining IS NOT NULL' :
      f.type === 'leavers' ? 'AND e.date_of_exit IS NOT NULL' : '';
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               e.date_of_joining, e.date_of_exit,
               e.employment_type, e.employee_category,
               COALESCE(e.call_centre_code, b.call_centre_code) AS cc_code
             FROM employees e
             ${EMP_CORE_JOINS}
            WHERE ${sc.sql} ${typeFilter}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.dateFrom ? 'AND COALESCE(e.date_of_exit, e.date_of_joining) >= ?' : ''}
              ${f.dateTo ? 'AND COALESCE(e.date_of_exit, e.date_of_joining) <= ?' : ''}
            ORDER BY b.branch_name, e.date_of_joining DESC`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
      ],
    };
  },
```

- [ ] **Step 4: Rewrite emp_documents**

```typescript
  emp_documents: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               ed.doc_type, ed.doc_category, ed.doc_name,
               ed.verified, ed.expiry_date,
               ed.created_at AS uploaded_at,
               ed.verification_date, ed.verification_remarks
             FROM employee_documents ed
             JOIN employees e ON e.id = ed.employee_id
             ${EMP_CORE_JOINS}
            WHERE e.active_status = 1
              AND ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.verified !== undefined && f.verified !== '' ? 'AND ed.verified = ?' : ''}
            ORDER BY b.branch_name, e.employee_code, ed.doc_category`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.verified !== undefined && f.verified !== '' ? [f.verified] : []),
      ],
    };
  },
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/reporting/reporting.service.ts
git commit -m "feat(reports): enrich emp_statutory, emp_bank_details, emp_joining_exit, emp_documents with EMP_CORE_COLS"
```

---

### Task 5: Enrich attendance & biometric builders (5 builders)

**Files:**
- Modify: `backend/src/modules/reporting/reporting.service.ts:573-747`

- [ ] **Step 1: Rewrite att_monthly**

The existing query already has `b`, `p`, `dept` JOINs. Add `desig` and `cc` JOINs, and add `EMP_CORE_COLS` to SELECT:

```typescript
  att_monthly: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               adr.record_date,
               adr.attendance_status, adr.clock_in_time, adr.clock_out_time,
               adr.raw_minutes, ROUND(adr.raw_minutes / 60, 2) AS hours_worked,
               adr.late_mark, adr.late_by_minutes, adr.lwp_value,
               adr.work_mode, adr.attendance_source
             FROM attendance_daily_record adr
             JOIN employees e ON e.id = adr.employee_id
             ${EMP_CORE_JOINS}
            WHERE ${sc.sql}
              ${f.month ? "AND DATE_FORMAT(adr.record_date,'%Y-%m') = ?" : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.process ? 'AND e.process_id = ?' : ''}
              ${f.dateFrom ? 'AND adr.record_date >= ?' : ''}
              ${f.dateTo ? 'AND adr.record_date <= ?' : ''}
            ORDER BY adr.record_date, b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
        ...(f.process ? [f.process] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
      ],
    };
  },
```

- [ ] **Step 2: Rewrite att_late_mark**

```typescript
  att_late_mark: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               DATE_FORMAT(adr.record_date,'%Y-%m') AS month,
               COUNT(*) AS total_late_marks,
               SUM(adr.late_by_minutes) AS total_late_minutes,
               ROUND(AVG(adr.late_by_minutes),1) AS avg_late_minutes
             FROM attendance_daily_record adr
             JOIN employees e ON e.id = adr.employee_id
             ${EMP_CORE_JOINS}
            WHERE adr.late_mark = 1
              AND ${sc.sql}
              ${f.month ? "AND DATE_FORMAT(adr.record_date,'%Y-%m') = ?" : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            GROUP BY DATE_FORMAT(adr.record_date,'%Y-%m'), e.id, e.employee_code, e.first_name, e.last_name, e.employment_status, desig.designation_name, dept.dept_name, b.branch_name, p.process_name, cc.cost_centre_name
            ORDER BY month, b.branch_name, total_late_marks DESC`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },
```

- [ ] **Step 3: Rewrite att_biometric**

```typescript
  att_biometric: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               was.session_date, e.biometric_code,
               was.branch_name AS punch_branch,
               was.login_time AS punch_in, was.logout_time AS punch_out,
               was.total_login_minutes, ROUND(was.total_login_minutes / 60, 2) AS login_hours,
               was.current_status, was.punch_source
             FROM wfm_attendance_session was
             JOIN employees e ON e.id = was.employee_id
             ${EMP_CORE_JOINS}
            WHERE ${sc.sql}
              ${f.month ? "AND DATE_FORMAT(was.session_date,'%Y-%m') = ?" : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.dateFrom ? 'AND was.session_date >= ?' : ''}
              ${f.dateTo ? 'AND was.session_date <= ?' : ''}
            ORDER BY was.session_date, b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
      ],
    };
  },
```

- [ ] **Step 4: Rewrite att_regularization**

```typescript
  att_regularization: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               ar.session_date, ar.reason, ar.status,
               ar.reviewed_at, ar.reviewer_note, ar.created_at AS applied_at
             FROM attendance_regularization ar
             JOIN employees e ON e.id = ar.employee_id
             ${EMP_CORE_JOINS}
            WHERE ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.status ? 'AND ar.status = ?' : ''}
              ${f.dateFrom ? 'AND ar.session_date >= ?' : ''}
              ${f.dateTo ? 'AND ar.session_date <= ?' : ''}
            ORDER BY ar.session_date DESC`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.status ? [f.status] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
      ],
    };
  },
```

- [ ] **Step 5: Rewrite att_reconciliation**

```typescript
  att_reconciliation: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               adr.record_date, adr.attendance_status, adr.attendance_source,
               adr.clock_in_time, adr.clock_out_time, adr.raw_minutes, adr.is_locked
             FROM attendance_daily_record adr
             JOIN employees e ON e.id = adr.employee_id
             ${EMP_CORE_JOINS}
            WHERE adr.attendance_status = 'unreconciled'
              AND ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.dateFrom ? 'AND adr.record_date >= ?' : ''}
              ${f.dateTo ? 'AND adr.record_date <= ?' : ''}
            ORDER BY adr.record_date DESC, b.branch_name`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
      ],
    };
  },
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/reporting/reporting.service.ts
git commit -m "feat(reports): enrich all 5 attendance/biometric builders with EMP_CORE_COLS"
```

---

### Task 6: Enrich APR builders (already have dept/desig — just add cc)

**Files:**
- Modify: `backend/src/modules/reporting/reporting.service.ts:753-873`

The APR builders already have `dm` (department_master) and `dg` (designation_master) JOINs. They need `cc` (cost_centre_master) added plus `cc.cost_centre_name` in SELECT.

- [ ] **Step 1: Add cost_centre JOIN and column to apr_daily**

In `apr_daily` (around line 783), add after the `designation_master dg` JOIN line:
```sql
LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
```

And add `cc.cost_centre_name,` after `dg.designation_name,` in the SELECT.

- [ ] **Step 2: Add cost_centre JOIN and column to apr_monthly**

Same pattern — add the JOIN and column.

- [ ] **Step 3: Add cost_centre JOIN and column to apr_campaign**

Same pattern.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/reporting/reporting.service.ts
git commit -m "feat(reports): add cost_centre_name to all 3 APR builders"
```

---

### Task 7: Enrich leave builders (3 builders)

**Files:**
- Modify: `backend/src/modules/reporting/reporting.service.ts:879-977`

- [ ] **Step 1: Rewrite leave_balance**

```typescript
  leave_balance: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const year = parseInt(f.year || String(new Date().getFullYear()));
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               ltm.leave_code, ltm.leave_name, ltm.paid_leave,
               lbl.balance_year AS year,
               lbl.allocated_days, lbl.used_days, lbl.adjusted_days,
               (lbl.allocated_days - lbl.used_days + lbl.adjusted_days) AS closing_balance
             FROM leave_balance_ledger lbl
             JOIN employees e ON e.id = lbl.employee_id
             JOIN leave_type_master ltm ON ltm.id = lbl.leave_type_id
             ${EMP_CORE_JOINS}
            WHERE lbl.balance_year = ?
              AND e.active_status = 1
              AND ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code, ltm.leave_code`,
      params: [year, ...sc.params, ...(f.branch ? [f.branch] : [])],
    };
  },
```

- [ ] **Step 2: Rewrite leave_transactions**

```typescript
  leave_transactions: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               lr.applied_at, ltm.leave_code, ltm.leave_name,
               lr.from_date, lr.to_date, lr.total_days,
               lr.status, lr.reason, lr.approved_at, lr.approved_by, lr.rejection_reason
             FROM leave_request lr
             JOIN employees e ON e.id = lr.employee_id
             JOIN leave_type_master ltm ON ltm.id = lr.leave_type_id
             ${EMP_CORE_JOINS}
            WHERE ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.status ? 'AND lr.status = ?' : ''}
              ${f.dateFrom ? 'AND lr.from_date >= ?' : ''}
              ${f.dateTo ? 'AND lr.to_date <= ?' : ''}
            ORDER BY lr.applied_at DESC`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.status ? [f.status] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
      ],
    };
  },
```

- [ ] **Step 3: Rewrite leave_lwp**

```typescript
  leave_lwp: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               DATE_FORMAT(adr.record_date,'%Y-%m') AS month,
               SUM(adr.lwp_value) AS total_lwp_days, COUNT(*) AS lwp_records
             FROM attendance_daily_record adr
             JOIN employees e ON e.id = adr.employee_id
             ${EMP_CORE_JOINS}
            WHERE adr.lwp_value > 0
              AND ${sc.sql}
              ${f.month ? "AND DATE_FORMAT(adr.record_date,'%Y-%m') = ?" : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            GROUP BY DATE_FORMAT(adr.record_date,'%Y-%m'), e.id, e.employee_code, e.first_name, e.last_name, e.employment_status, desig.designation_name, dept.dept_name, b.branch_name, p.process_name, cc.cost_centre_name
            ORDER BY month, b.branch_name, total_lwp_days DESC`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/reporting/reporting.service.ts
git commit -m "feat(reports): enrich all 3 leave builders with EMP_CORE_COLS"
```

---

### Task 8: Enrich KPI, attrition, lifecycle builders

**Files:**
- Modify: `backend/src/modules/reporting/reporting.service.ts:983-1107`

- [ ] **Step 1: Rewrite kpi_scores**

```typescript
  kpi_scores: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               ks.period, kmm.metric_code, kmm.metric_name, kmm.metric_unit,
               ks.actual_value, ks.source
             FROM kpi_score ks
             JOIN kpi_metric_master kmm ON kmm.id = ks.metric_id
             JOIN employees e ON e.id = ks.employee_id
             ${EMP_CORE_JOINS}
            WHERE ${sc.sql}
              ${f.period ? 'AND ks.period = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY ks.period, b.branch_name, e.employee_code, kmm.metric_code`,
      params: [
        ...sc.params,
        ...(f.period ? [f.period] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },
```

- [ ] **Step 2: Rewrite kpi_summary**

```typescript
  kpi_summary: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               kss.period_id, kss.role_code,
               kss.final_score, kss.rating,
               kss.rank_in_team, kss.rank_in_process, kss.rank_in_branch, kss.status
             FROM kpi_score_summary kss
             JOIN employees e ON e.id = kss.employee_id
             ${EMP_CORE_JOINS}
            WHERE ${sc.sql}
              ${f.period ? 'AND kss.period_id = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, kss.rank_in_branch`,
      params: [
        ...sc.params,
        ...(f.period ? [f.period] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },
```

- [ ] **Step 3: Rewrite emp_lifecycle**

```typescript
  emp_lifecycle: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               ele.effective_date, ele.event_type,
               ele.old_value_json, ele.new_value_json,
               ele.remarks, ele.created_at
             FROM employee_lifecycle_event ele
             JOIN employees e ON e.id = ele.employee_id
             ${EMP_CORE_JOINS}
            WHERE ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.eventType ? 'AND ele.event_type = ?' : ''}
              ${f.dateFrom ? 'AND ele.effective_date >= ?' : ''}
              ${f.dateTo ? 'AND ele.effective_date <= ?' : ''}
            ORDER BY ele.effective_date DESC`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.eventType ? [f.eventType] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
      ],
    };
  },
```

Note: `attrition_monthly` is an aggregate report (GROUP BY branch/process/exit_type with COUNT), not per-employee. It already has `branch_name` and `process_name`. Skip EMP_CORE_COLS for it.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/reporting/reporting.service.ts
git commit -m "feat(reports): enrich kpi_scores, kpi_summary, emp_lifecycle with EMP_CORE_COLS"
```

---

### Task 9: Enrich compliance builders (pf_challan, esic_challan)

**Files:**
- Modify: `backend/src/modules/reporting/reporting.service.ts:1113-1175`

- [ ] **Step 1: Rewrite pf_challan**

```typescript
  pf_challan: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               spr.run_month, e.uan_number, e.epf_number,
               spl.gross_salary AS pf_wages, spl.basic AS pf_basic,
               spl.pf_employee AS employee_pf, spl.pf_employer AS employer_pf,
               (spl.pf_employee + spl.pf_employer) AS total_pf_contribution
             FROM salary_prep_line spl
             JOIN salary_prep_run spr ON spr.id = spl.run_id
             JOIN employees e ON e.id = spl.employee_id
             ${EMP_CORE_JOINS}
            WHERE LOWER(spr.status) IN ('approved','disbursed','finalized')
              AND spl.pf_employee > 0
              AND ${sc.sql}
              ${f.month ? 'AND spr.run_month = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },
```

- [ ] **Step 2: Rewrite esic_challan**

```typescript
  esic_challan: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               spr.run_month, e.esic_number,
               spl.gross_salary AS esic_wages,
               spl.esic_employee AS employee_esic, spl.esic_employer AS employer_esic,
               (spl.esic_employee + spl.esic_employer) AS total_esic_contribution
             FROM salary_prep_line spl
             JOIN salary_prep_run spr ON spr.id = spl.run_id
             JOIN employees e ON e.id = spl.employee_id
             ${EMP_CORE_JOINS}
            WHERE LOWER(spr.status) IN ('approved','disbursed','finalized')
              AND spl.esic_employee > 0
              AND ${sc.sql}
              ${f.month ? 'AND spr.run_month = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/reporting/reporting.service.ts
git commit -m "feat(reports): enrich pf_challan, esic_challan with EMP_CORE_COLS"
```

---

### Task 10: Enrich remaining employee detail builders (5 builders)

**Files:**
- Modify: `backend/src/modules/reporting/reporting.service.ts:1181-1355`

- [ ] **Step 1: Rewrite emp_emergency_contact**

```typescript
  emp_emergency_contact: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               ec.contact_seq, ec.is_primary,
               ec.name AS contact_name, ec.relationship,
               ec.mobile AS contact_mobile, ec.address AS contact_address
             FROM employee_emergency_contact ec
             JOIN employees e ON e.id = ec.employee_id
             ${EMP_CORE_JOINS}
            WHERE e.active_status = 1
              AND ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.status ? 'AND e.employment_status = ?' : ''}
            ORDER BY e.employee_code, ec.is_primary DESC, ec.contact_seq`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.status ? [f.status] : []),
      ],
    };
  },
```

- [ ] **Step 2: Rewrite emp_nominee**

```typescript
  emp_nominee: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               n.nominee_name, n.relationship,
               n.date_of_birth AS nominee_dob, n.nominee_for,
               n.share_percentage, n.is_minor,
               n.guardian_name, n.guardian_relation,
               n.mobile AS nominee_mobile, n.address AS nominee_address
             FROM employee_nominee n
             JOIN employees e ON e.id = n.employee_id
             ${EMP_CORE_JOINS}
            WHERE e.active_status = 1
              AND ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY e.employee_code, n.nominee_for`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },
```

- [ ] **Step 3: Rewrite emp_probation**

```typescript
  emp_probation: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               e.date_of_joining,
               ep.probation_start_date, ep.probation_end_date,
               ep.actual_end_date, ep.extended_end_date,
               ep.status AS probation_status, ep.extension_reason,
               ep.confirmation_remarks,
               CONCAT(conf.first_name,' ',COALESCE(conf.last_name,'')) AS confirmed_by
             FROM employee_probation ep
             JOIN employees e ON e.id = ep.employee_id
             ${EMP_CORE_JOINS}
             LEFT JOIN employees conf ON conf.id = ep.confirmed_by
            WHERE ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.status ? 'AND ep.status = ?' : ''}
            ORDER BY ep.probation_end_date, b.branch_name`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.status ? [f.status] : []),
      ],
    };
  },
```

- [ ] **Step 4: Rewrite emp_job_history**

```typescript
  emp_job_history: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               jh.effective_date, jh.change_type,
               fd.designation_name AS from_designation, td.designation_name AS to_designation,
               fdept.dept_name AS from_department, tdept.dept_name AS to_department,
               fb.branch_name AS from_branch, tb.branch_name AS to_branch,
               fp.process_name AS from_process, tp.process_name AS to_process,
               jh.from_ctc_annual, jh.to_ctc_annual, jh.reason
             FROM employee_job_history jh
             JOIN employees e ON e.id = jh.employee_id
             ${EMP_CORE_JOINS}
             LEFT JOIN designation_master fd ON fd.id = jh.from_designation_id
             LEFT JOIN designation_master td ON td.id = jh.to_designation_id
             LEFT JOIN department_master fdept ON fdept.id = jh.from_department_id
             LEFT JOIN department_master tdept ON tdept.id = jh.to_department_id
             LEFT JOIN branch_master fb ON fb.id = jh.from_branch_id
             LEFT JOIN branch_master tb ON tb.id = jh.to_branch_id
             LEFT JOIN process_master fp ON fp.id = jh.from_process_id
             LEFT JOIN process_master tp ON tp.id = jh.to_process_id
            WHERE ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.dateFrom ? 'AND jh.effective_date >= ?' : ''}
              ${f.dateTo ? 'AND jh.effective_date <= ?' : ''}
              ${f.changeType ? 'AND jh.change_type = ?' : ''}
            ORDER BY e.employee_code, jh.effective_date`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
        ...(f.changeType ? [f.changeType] : []),
      ],
    };
  },
```

- [ ] **Step 5: Rewrite emp_salary_history**

```typescript
  emp_salary_history: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ${EMP_CORE_COLS},
               sa.effective_from, sa.effective_to, sa.ctc_annual,
               ss.structure_name, ss.structure_code,
               sa.active_status AS is_current
             FROM employee_salary_assignment sa
             JOIN employees e ON e.id = sa.employee_id
             ${EMP_CORE_JOINS}
             LEFT JOIN salary_structure_master ss ON ss.id = sa.structure_id
            WHERE ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.dateFrom ? 'AND sa.effective_from >= ?' : ''}
              ${f.dateTo ? 'AND sa.effective_from <= ?' : ''}
            ORDER BY e.employee_code, sa.effective_from DESC`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
      ],
    };
  },
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/reporting/reporting.service.ts
git commit -m "feat(reports): enrich emp_emergency_contact, emp_nominee, emp_probation, emp_job_history, emp_salary_history with EMP_CORE_COLS"
```

---

### Task 11: Add EMP_CORE_COLS to report-suite.routes.ts cases + rewrite attendance-summary with UNION

**Files:**
- Modify: `backend/src/modules/reporting/report-suite.routes.ts`

- [ ] **Step 1: Add EMP_CORE_COLS and EMP_CORE_JOINS constants at the top of the file**

After line 8 (`export const reportSuiteRouter = Router();`), add:

```typescript
const EMP_CORE_COLS = `e.employee_code, CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name, e.employment_status, desig.designation_name, dept.dept_name AS department, b.branch_name, p.process_name, cc.cost_centre_name`;

const EMP_CORE_JOINS = `LEFT JOIN branch_master b ON b.id = e.branch_id LEFT JOIN process_master p ON p.id = e.process_id LEFT JOIN department_master dept ON dept.id = e.department_id LEFT JOIN designation_master desig ON desig.id = e.designation_id LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id`;
```

- [ ] **Step 2: Rewrite employee-master case**

Replace lines 70–84 with:

```typescript
    case "employee-master":
      addEmployeeFilters(req.query, clauses, params);
      sql = `SELECT ${EMP_CORE_COLS},
                    e.official_email, e.mobile, e.date_of_joining, e.date_of_exit,
                    COALESCE(NULLIF(m.full_name,''), CONCAT(m.first_name,' ',COALESCE(m.last_name,''))) AS reporting_manager
               FROM employees e
               ${EMP_CORE_JOINS}
               LEFT JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY e.employee_code`;
      break;
```

- [ ] **Step 3: Rewrite headcount case**

Replace lines 85–96 with:

```typescript
    case "headcount":
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1", "LOWER(COALESCE(e.employment_status,'active')) = 'active'");
      sql = `SELECT b.branch_name, dept.dept_name AS department, p.process_name, cc.cost_centre_name, COUNT(*) AS active_headcount
               FROM employees e
               ${EMP_CORE_JOINS}
              WHERE ${clauses.join(" AND ")}
              GROUP BY b.branch_name, dept.dept_name, p.process_name, cc.cost_centre_name
              ORDER BY b.branch_name, dept.dept_name, p.process_name`;
      break;
```

- [ ] **Step 4: Rewrite employee-movement case**

Replace lines 97–115 with:

```typescript
    case "employee-movement": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("(e.date_of_joining BETWEEN ? AND ? OR COALESCE(e.date_of_exit,e.date_of_leaving,e.resignation_date) BETWEEN ? AND ?)");
      params.push(from, to, from, to);
      sql = `SELECT ${EMP_CORE_COLS},
                    e.date_of_joining, COALESCE(e.date_of_exit,e.date_of_leaving,e.resignation_date) AS exit_date,
                    CASE WHEN e.date_of_joining BETWEEN ? AND ? THEN 'joining' ELSE 'exit' END AS movement_type
               FROM employees e
               ${EMP_CORE_JOINS}
              WHERE ${clauses.join(" AND ")}
              ORDER BY COALESCE(e.date_of_joining,e.date_of_exit,e.date_of_leaving,e.resignation_date) DESC`;
      params.push(from, to);
      break;
    }
```

- [ ] **Step 5: Rewrite exit-movement-report case**

```typescript
    case "exit-movement-report": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to   = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("COALESCE(e.date_of_exit,e.date_of_leaving,e.resignation_date) BETWEEN ? AND ?");
      params.push(from, to);
      if (req.query.exitType) { clauses.push("e.exit_type = ?"); params.push(String(req.query.exitType)); }
      sql = `SELECT ${EMP_CORE_COLS},
                    e.date_of_joining,
                    COALESCE(e.date_of_exit,e.date_of_leaving,e.resignation_date) AS exit_date,
                    DATEDIFF(COALESCE(e.date_of_exit,e.date_of_leaving,e.resignation_date), e.date_of_joining) AS tenure_days,
                    e.exit_type, e.exit_sub_type, e.exit_reason_category
               FROM employees e
               ${EMP_CORE_JOINS}
              WHERE ${clauses.join(" AND ")}
              ORDER BY COALESCE(e.date_of_exit,e.date_of_leaving,e.resignation_date) DESC`;
      break;
    }
```

- [ ] **Step 6: Rewrite manager-mapping case**

```typescript
    case "manager-mapping":
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("e.active_status = 1");
      sql = `SELECT ${EMP_CORE_COLS},
                    e.reporting_manager_id, e.manager_id,
                    COALESCE(NULLIF(m.full_name,''), CONCAT(m.first_name,' ',COALESCE(m.last_name,''))) AS manager_name,
                    CASE WHEN e.reporting_manager_id IS NULL AND e.manager_id IS NULL THEN 'MISSING_MANAGER'
                         WHEN e.reporting_manager_id IS NOT NULL AND e.manager_id IS NOT NULL AND e.reporting_manager_id <> e.manager_id THEN 'MANAGER_FIELD_MISMATCH'
                         ELSE 'OK' END AS mapping_status
               FROM employees e
               ${EMP_CORE_JOINS}
               LEFT JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
              WHERE ${clauses.join(" AND ")}
              ORDER BY mapping_status DESC, employee_name`;
      break;
```

- [ ] **Step 7: Rewrite attendance-daily case**

```typescript
    case "attendance-daily": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      const attDailyScope = await resolveBranchScope(String(req.authUser.id));
      if (!attDailyScope.isSuperAdmin && attDailyScope.branchIds.length > 0) {
        clauses.push(`e.branch_id IN (${attDailyScope.branchIds.map(() => '?').join(',')})`);
        params.push(...attDailyScope.branchIds);
      }
      addEmployeeFilters(req.query, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT ${EMP_CORE_COLS},
                    adr.record_date, adr.attendance_source, adr.attendance_status,
                    adr.raw_minutes, adr.dialler_minutes, adr.biometric_minutes,
                    adr.lwp_value, adr.late_mark, adr.late_by_minutes, adr.is_locked
               FROM attendance_daily_record adr JOIN employees e ON e.id = adr.employee_id
               ${EMP_CORE_JOINS}
              WHERE ${clauses.join(" AND ")}
              ORDER BY adr.record_date DESC, employee_name`;
      break;
    }
```

- [ ] **Step 8: Rewrite attendance-summary with UNION logic**

Replace the entire `case "attendance-summary"` block with:

```typescript
    case "attendance-summary": {
      const month = monthParam(req.query.month);
      const attSummaryScope = await resolveBranchScope(String(req.authUser.id));
      const scopeClauses: string[] = [];
      const scopeParams: unknown[] = [];
      if (!attSummaryScope.isSuperAdmin && attSummaryScope.branchIds.length > 0) {
        scopeClauses.push(`e.branch_id IN (${attSummaryScope.branchIds.map(() => '?').join(',')})`);
        scopeParams.push(...attSummaryScope.branchIds);
      }
      const filterClauses: string[] = [];
      const filterParams: unknown[] = [];
      addEmployeeFilters(req.query, filterClauses, filterParams);

      const whereActive = [...scopeClauses, ...filterClauses, 'e.active_status = 1'].filter(Boolean).join(' AND ') || '1=1';
      const whereInactive = [...scopeClauses, ...filterClauses, 'e.active_status = 0'].filter(Boolean).join(' AND ') || '1=1';

      sql = `(SELECT ${EMP_CORE_COLS},
                     COALESCE(SUM(adr.attendance_status='present'),0) AS present_days,
                     COALESCE(SUM(adr.attendance_status='half_day'),0) AS half_days,
                     COALESCE(SUM(adr.attendance_status='absent'),0) AS absent_days,
                     COALESCE(SUM(adr.attendance_status='leave_approved'),0) AS leave_days,
                     COALESCE(SUM(adr.lwp_value),0) AS lwp_days,
                     COALESCE(SUM(adr.late_mark=1),0) AS late_days,
                     ROUND(COALESCE(SUM(COALESCE(adr.raw_minutes,adr.biometric_minutes,adr.dialler_minutes,0)),0)/60,2) AS total_hours
                FROM employees e
                ${EMP_CORE_JOINS}
                LEFT JOIN attendance_daily_record adr ON adr.employee_id = e.id AND DATE_FORMAT(adr.record_date,'%Y-%m') = ?
               WHERE ${whereActive}
               GROUP BY e.id, e.employee_code, e.first_name, e.last_name, e.employment_status, desig.designation_name, dept.dept_name, b.branch_name, p.process_name, cc.cost_centre_name)
             UNION ALL
             (SELECT ${EMP_CORE_COLS},
                     SUM(adr.attendance_status='present') AS present_days,
                     SUM(adr.attendance_status='half_day') AS half_days,
                     SUM(adr.attendance_status='absent') AS absent_days,
                     SUM(adr.attendance_status='leave_approved') AS leave_days,
                     SUM(adr.lwp_value) AS lwp_days,
                     SUM(adr.late_mark=1) AS late_days,
                     ROUND(SUM(COALESCE(adr.raw_minutes,adr.biometric_minutes,adr.dialler_minutes,0))/60,2) AS total_hours
                FROM attendance_daily_record adr
                JOIN employees e ON e.id = adr.employee_id
                ${EMP_CORE_JOINS}
               WHERE DATE_FORMAT(adr.record_date,'%Y-%m') = ? AND ${whereInactive}
               GROUP BY e.id, e.employee_code, e.first_name, e.last_name, e.employment_status, desig.designation_name, dept.dept_name, b.branch_name, p.process_name, cc.cost_centre_name
               HAVING SUM(adr.attendance_status IN ('present','half_day')) > 0)
             ORDER BY branch_name, employee_name`;
      params.push(...scopeParams, ...filterParams, month, month, ...scopeParams, ...filterParams);
      break;
    }
```

- [ ] **Step 9: Add EMP_CORE_COLS/JOINS to remaining cases**

For each of `biometric-reconciliation`, `leave-balance`, `leave-utilization`, `payroll-register`, `payroll-variance`, `payslip-status`, `statutory-missing`, `bank-missing`, `ytd-salary-summary`, `lwp-deduction-register`, `salary-advance-register`, `pf-ecr-export`:

Add `${EMP_CORE_JOINS}` after the employees table reference, and prepend `${EMP_CORE_COLS},` to the SELECT list. Remove any now-redundant individual JOINs (e.g. standalone `LEFT JOIN branch_master b ON b.id = e.branch_id`).

For cases that already have `b`/`p`/`dept` JOINs inline, replace them with the shared `${EMP_CORE_JOINS}` to avoid duplicate aliases.

- [ ] **Step 10: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add backend/src/modules/reporting/report-suite.routes.ts
git commit -m "feat(reports): add EMP_CORE_COLS to all suite cases; rewrite attendance-summary with UNION for active+ex-employees"
```

---

### Task 12: Full rewrite of NativeReportsCenter.tsx (premium UI)

**Files:**
- Modify: `src/pages/NativeReportsCenter.tsx` (complete rewrite)

This is a large single-file rewrite. The component structure within the file:

1. `HeroBar` — sticky top bar with gradient, animated count-up stats, search, recent chips
2. `CategoryCard` — single gradient card with icon, name, count, hover lift
3. `ReportList` — inline accordion under expanded category
4. `RunnerPanel` — filter row + results table
5. `FilterRow` — all filter comboboxes
6. `ResultsTable` — sticky header, alternating rows, sparklines, export

- [ ] **Step 1: Write the full NativeReportsCenter.tsx**

Full rewrite — too large to inline here. Key architectural decisions:

- All internal components are defined in the same file (no extraction)
- State: `selectedCategory`, `selectedReport`, `filterValues`, `results`, `isRunning`, `favourites`, `recentReports`
- Data fetching for dropdowns: uses `useReportMasters()` hook (already exists at `src/hooks/useReportMasters.ts`)
- Report execution: `POST /api/reports/run` or `GET /api/report-suite/:code?...params`
- Category grid: 14 categories derived from `CATALOG` array, each with unique gradient
- Animations: CSS keyframes for slide-up, staggered fade-in, count-up via `useEffect` + `requestAnimationFrame`
- Export: CSV via `Blob` download, XLSX via dynamic import of `xlsx` package
- Mobile: filters collapse behind toggle with active-count badge
- Filter row: `<select>` or shadcn `<Combobox>` for branch/process/dept/cc (populated from `useReportMasters`)

Implementation pattern for the count-up animation:
```typescript
function useCountUp(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let start = 0;
    const step = (timestamp: number) => {
      if (!start) start = timestamp;
      const progress = Math.min((timestamp - start) / duration, 1);
      setValue(Math.floor(progress * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);
  return value;
}
```

Category gradients:
```typescript
const CATEGORY_GRADIENTS: Record<string, string> = {
  "HR & Workforce": "from-blue-500 to-indigo-600",
  "Attendance": "from-violet-500 to-purple-600",
  "Leave": "from-emerald-500 to-teal-600",
  "Payroll": "from-amber-500 to-orange-600",
  "Compliance & Statutory": "from-red-500 to-rose-600",
  "Exit & Attrition": "from-slate-500 to-gray-600",
  "KPI & Performance": "from-cyan-500 to-sky-600",
  "Assets": "from-lime-500 to-green-600",
  "Documents": "from-fuchsia-500 to-pink-600",
  "Integration": "from-indigo-500 to-blue-600",
  "WFM & Roster": "from-teal-500 to-cyan-600",
  "Quality": "from-yellow-500 to-amber-600",
  "Operations": "from-orange-500 to-red-600",
  "Client Portal": "from-sky-500 to-indigo-600",
};
```

- [ ] **Step 2: Verify frontend TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Start dev server and verify UI renders**

Run: `npm run dev`
Navigate to the Reports Center page. Verify:
- No sidebar
- Category gradient grid renders (4-col on desktop)
- Clicking a category expands report list inline
- Selecting a report shows runner panel with filter dropdowns populated
- Running a report shows results table
- Mobile responsive

- [ ] **Step 4: Commit**

```bash
git add src/pages/NativeReportsCenter.tsx
git commit -m "feat(reports): premium no-sidebar Reports Center UI with category grid, runner panel, animations"
```

---

### Task 13: Final integration verification

- [ ] **Step 1: Run backend TypeScript check**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS — no type errors

- [ ] **Step 2: Run frontend TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Manual test — run attendance-summary report**

Start backend, run attendance-summary for a month where a resigned employee worked. Verify:
- Active employees appear (even if 0 attendance records)
- Ex-employees who worked appear with `employment_status = 'resigned'`
- All 8 mandatory columns present (employee_code, employee_name, employment_status, designation_name, department, branch_name, process_name, cost_centre_name)

- [ ] **Step 4: Manual test — run payroll_register via QUERIES endpoint**

Verify all 8 mandatory columns present in output.

- [ ] **Step 5: Manual test — run any APR report**

Verify only Operations Executives appear (dept + designation filter working) AND cost_centre_name column present.

- [ ] **Step 6: Commit final state**

```bash
git add -A
git commit -m "chore(reports): final verification pass — all reports standardized, attendance-summary UNION working, premium UI live"
```

---

## Summary of Changes

| File | Lines Changed (approx.) | What Changed |
|------|------------------------|--------------|
| `backend/src/modules/reporting/reporting.service.ts` | ~600 | Added `EMP_CORE_COLS`/`EMP_CORE_JOINS` constants; rewrote 30+ query builders to use them |
| `backend/src/modules/reporting/report-suite.routes.ts` | ~200 | Added same constants; enriched all suite cases; rewrote `attendance-summary` with UNION |
| `src/pages/NativeReportsCenter.tsx` | ~1200 (full rewrite) | Premium no-sidebar UI with category grid, runner panel, animations, sparklines, export |

**No SQL migrations. No new backend routes. No new frontend routes. No schema changes.**
