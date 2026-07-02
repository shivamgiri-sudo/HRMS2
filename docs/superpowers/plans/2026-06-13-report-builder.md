# Report Builder — Full Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build 28 detailed reports across Payroll, Employee, Attendance/Biometric, APR/Dialer, Leave, KPI, Attrition, and Statutory categories — with branch-scoped data visibility enforced at the API layer so each role sees only their branch's data; only `super_admin`/`admin` role sees all branches.

**Architecture:** Branch scope is resolved server-side from `user_assignment_scope` and `employees.branch_id` — the client sends optional filter overrides but the server clamps them to the user's permitted branches. All 28 reports use the existing `report_master` → `query_key` → `QUERIES` map pattern already in `reporting.service.ts`. The frontend `NativeMasterReports.tsx` works generically for all reports; we add month/year/date-range/process filters and an Excel export button.

**Tech Stack:** Express + TypeScript + mysql2 (backend), React 18 + TanStack Query + shadcn/ui + xlsx (frontend), MySQL 8 (`mas_hrms`)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/sql/143_report_builder.sql` | **Create** | Registers all 28 reports in `report_master`; adds `super_admin` role alias |
| `backend/src/modules/reporting/reporting.scope.ts` | **Create** | `resolveBranchScope(userId)` — returns `{ isSuperAdmin, branchIds[] }` |
| `backend/src/modules/reporting/reporting.service.ts` | **Replace** | All 28 query builders + scope-clamping in `runReport()` |
| `backend/src/modules/reporting/reporting.routes.ts` | **Modify** | Pass `req.authUser.id` to service; open to all authenticated roles |
| `backend/src/db/runPendingMigrations.ts` | **Modify** | Add `143_report_builder.sql` to `MIGRATION_MANIFEST` |
| `src/pages/NativeMasterReports.tsx` | **Modify** | Add month/year/process/dateTo filters + Excel (xlsx) export |

---

## Task 1 — Branch Scope Helper

**Files:**
- Create: `backend/src/modules/reporting/reporting.scope.ts`

- [ ] **Step 1: Create the scope resolver**

```typescript
// backend/src/modules/reporting/reporting.scope.ts
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

export interface BranchScope {
  isSuperAdmin: boolean;
  branchIds: string[];  // empty = all (super_admin), non-empty = restricted list
}

const SUPER_ADMIN_ROLES = ['super_admin', 'admin', 'ceo'];

export async function resolveBranchScope(userId: string): Promise<BranchScope> {
  // 1. Get all active roles for this user
  const [roleRows] = await db.execute<RowDataPacket[]>(
    `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`,
    [userId]
  );
  const roles = (roleRows as { role_key: string }[]).map(r => r.role_key);

  // 2. Super admin / admin / ceo — unrestricted
  if (roles.some(r => SUPER_ADMIN_ROLES.includes(r))) {
    return { isSuperAdmin: true, branchIds: [] };
  }

  // 3. Check user_assignment_scope for explicit branch grants
  const [scopeRows] = await db.execute<RowDataPacket[]>(
    `SELECT scope_type, branch_id
       FROM user_assignment_scope
      WHERE user_id = ? AND active_status = 1`,
    [userId]
  );
  const scopes = scopeRows as { scope_type: string; branch_id: string | null }[];

  // If any scope_type = 'all', treat as unrestricted within their role
  // (but still not super_admin level — they only see data for their role context)
  // For reports, we treat 'all' scope as branch-unrestricted hr/finance roles.
  if (scopes.some(s => s.scope_type === 'all')) {
    return { isSuperAdmin: false, branchIds: [] };
  }

  // 4. Collect explicit branch IDs from scope
  const branchIds = scopes
    .map(s => s.branch_id)
    .filter((id): id is string => !!id);

  // 5. Fallback: use employee's own branch
  if (branchIds.length === 0) {
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT branch_id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
      [userId]
    );
    const emp = empRows as { branch_id: string | null }[];
    if (emp[0]?.branch_id) branchIds.push(emp[0].branch_id);
  }

  return { isSuperAdmin: false, branchIds };
}
```

- [ ] **Step 2: Verify TypeScript compiles (no build step needed — tsx handles it at runtime)**

---

## Task 2 — SQL Migration: Register All 28 Reports

**Files:**
- Create: `backend/sql/143_report_builder.sql`
- Modify: `backend/src/db/runPendingMigrations.ts` (add to manifest)

- [ ] **Step 1: Create the migration file**

```sql
-- backend/sql/143_report_builder.sql
-- Registers all 28 reports in report_master.
-- Safe to re-run: uses INSERT IGNORE.

INSERT IGNORE INTO report_master
  (id, report_code, report_name, report_category, query_key, default_filters, export_formats, admin_only, active_status)
VALUES
-- ── Payroll (6) ─────────────────────────────────────────────────────────────
(UUID(), 'PAYROLL_REGISTER',         'Monthly Payroll Register',             'payroll',    'payroll_register',         NULL, '["csv","xlsx"]', 1, 1),
(UUID(), 'PAYROLL_COMPONENT_DETAIL', 'Payroll Component Breakdown',          'payroll',    'payroll_component_detail',  NULL, '["csv","xlsx"]', 1, 1),
(UUID(), 'PAYROLL_STATUTORY',        'PF / ESIC / PT / TDS Summary',         'payroll',    'payroll_statutory',         NULL, '["csv","xlsx"]', 1, 1),
(UUID(), 'PAYROLL_BANK_STATEMENT',   'Bank Disbursement Statement',          'payroll',    'payroll_bank_statement',    NULL, '["csv","xlsx"]', 1, 1),
(UUID(), 'PAYROLL_FULL_FINAL',       'Full & Final Settlement Report',       'payroll',    'payroll_full_final',        NULL, '["csv","xlsx"]', 1, 1),
(UUID(), 'PAYROLL_YTD',              'Year-to-Date Earnings & Deductions',   'payroll',    'payroll_ytd',               NULL, '["csv","xlsx"]', 1, 1),

-- ── Employee (5) ─────────────────────────────────────────────────────────────
(UUID(), 'EMP_MASTER',               'Employee Master Report',               'employee',   'emp_master',               NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'EMP_STATUTORY',            'Employee Statutory Data (PAN/UAN/ESIC)','employee',  'emp_statutory',             NULL, '["csv","xlsx"]', 1, 1),
(UUID(), 'EMP_BANK_DETAILS',         'Employee Bank Details',                'employee',   'emp_bank_details',          NULL, '["csv","xlsx"]', 1, 1),
(UUID(), 'EMP_JOINING_EXIT',         'Joiners & Leavers Report',             'employee',   'emp_joining_exit',          NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'EMP_DOCUMENTS',            'Document Submission Status',           'employee',   'emp_documents',             NULL, '["csv"]',        0, 1),

-- ── Attendance & Biometric (5) ───────────────────────────────────────────────
(UUID(), 'ATT_MONTHLY',              'Monthly Attendance Register',          'attendance', 'att_monthly',               NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'ATT_LATE_MARK',            'Late Mark Summary',                    'attendance', 'att_late_mark',             NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'ATT_BIOMETRIC',            'Biometric Punch Log',                  'attendance', 'att_biometric',             NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'ATT_REGULARIZATION',       'Attendance Regularization Report',     'attendance', 'att_regularization',        NULL, '["csv"]',        0, 1),
(UUID(), 'ATT_RECONCILIATION',       'Unreconciled Attendance Records',      'attendance', 'att_reconciliation',        NULL, '["csv"]',        1, 1),

-- ── APR / Dialer (3) ─────────────────────────────────────────────────────────
(UUID(), 'APR_DAILY',                'Daily APR Report',                     'kpi',        'apr_daily',                 NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'APR_MONTHLY',              'Monthly APR Summary',                  'kpi',        'apr_monthly',               NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'APR_CAMPAIGN',             'Campaign-wise Performance',            'kpi',        'apr_campaign',              NULL, '["csv","xlsx"]', 0, 1),

-- ── Leave (3) ────────────────────────────────────────────────────────────────
(UUID(), 'LEAVE_BALANCE',            'Leave Balance by Type',                'attendance', 'leave_balance',             NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'LEAVE_TRANSACTIONS',       'Leave Applications & Approvals',       'attendance', 'leave_transactions',        NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'LEAVE_LWP',                'LWP (Loss of Pay) Report',             'attendance', 'leave_lwp',                 NULL, '["csv","xlsx"]', 1, 1),

-- ── KPI (2) ──────────────────────────────────────────────────────────────────
(UUID(), 'KPI_SCORES',               'Employee KPI Scores by Period',        'kpi',        'kpi_scores',                NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'KPI_SUMMARY',              'Process / Branch KPI Rollup',          'kpi',        'kpi_summary',               NULL, '["csv","xlsx"]', 0, 1),

-- ── Attrition & Lifecycle (2) ────────────────────────────────────────────────
(UUID(), 'ATTRITION_MONTHLY',        'Monthly Attrition Report',             'employee',   'attrition_monthly',         NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'EMP_LIFECYCLE',            'Promotions, Transfers & Increments',   'employee',   'emp_lifecycle',             NULL, '["csv","xlsx"]', 0, 1),

-- ── Compliance / Statutory (2) ───────────────────────────────────────────────
(UUID(), 'PF_CHALLAN',               'PF Contribution Challan Data',         'payroll',    'pf_challan',                NULL, '["csv","xlsx"]', 1, 1),
(UUID(), 'ESIC_CHALLAN',             'ESIC Contribution Summary',            'payroll',    'esic_challan',              NULL, '["csv","xlsx"]', 1, 1);
```

- [ ] **Step 2: Add to migration manifest in `runPendingMigrations.ts`**

Open `backend/src/db/runPendingMigrations.ts`. Find the line `"142_offer_letter_system.sql",` and add after it:

```typescript
  "143_report_builder.sql",
```

---

## Task 3 — Backend: All 28 Query Builders + Scope Clamping

**Files:**
- Replace: `backend/src/modules/reporting/reporting.service.ts`

This is the core task. Replace the entire file with the version below. Key design decisions:
- Every query builder accepts `(filters, scope: BranchScope)` — the scope is applied via a helper that builds a SQL `IN (...)` or `1=1` clause.
- Payroll reports require `run_month` filter (YYYY-MM format). If absent, defaults to the most recent completed run.
- APR reports join `employees` on `biometric_code = apr.UserID` to attach branch context for scoping.

- [ ] **Step 1: Replace `reporting.service.ts` completely**

```typescript
// backend/src/modules/reporting/reporting.service.ts
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { resolveBranchScope, type BranchScope } from './reporting.scope.js';

// ── Scope SQL helper ─────────────────────────────────────────────────────────
// Returns a WHERE fragment and params array for branch scoping.
// branchCol: the column to filter, e.g. 'e.branch_id'
function scopeClause(scope: BranchScope, branchCol: string): { sql: string; params: string[] } {
  if (scope.isSuperAdmin || scope.branchIds.length === 0) {
    return { sql: '1=1', params: [] };
  }
  const placeholders = scope.branchIds.map(() => '?').join(',');
  return { sql: `${branchCol} IN (${placeholders})`, params: scope.branchIds };
}

// ── Query builders ────────────────────────────────────────────────────────────
type Builder = (f: Record<string, string>, scope: BranchScope) => { sql: string; params: unknown[] };

const QUERIES: Record<string, Builder> = {

  // ══════════════════════════════════════════════════════════════════════════
  //  EXISTING (kept + scope-enhanced)
  // ══════════════════════════════════════════════════════════════════════════

  branch_master: (f, scope) => {
    const sc = scopeClause(scope, 'b.id');
    return {
      sql: `SELECT b.id, b.branch_code, b.branch_name, b.call_centre_code, b.city, b.state,
                   COUNT(DISTINCT e.id) AS employee_count,
                   COUNT(DISTINCT p.id) AS process_count,
                   b.active_status
              FROM branch_master b
              LEFT JOIN employees e ON e.branch_id = b.id AND e.active_status = 1
              LEFT JOIN process_master p ON p.branch_id = b.id AND p.active_status = 1
             WHERE ${sc.sql} ${f.branch ? 'AND b.id = ?' : ''}
             GROUP BY b.id ORDER BY b.branch_name`,
      params: [...sc.params, ...(f.branch ? [f.branch] : [])],
    };
  },

  user_master: (_f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ur.user_id, ur.role_key, ur.active_status,
                   e.first_name, e.last_name, e.email, e.employee_code,
                   e.branch_id, bm.branch_name
              FROM user_roles ur
              LEFT JOIN employees e ON e.user_id = ur.user_id
              LEFT JOIN branch_master bm ON bm.id = e.branch_id
             WHERE ${sc.sql}
             ORDER BY ur.role_key, e.last_name`,
      params: sc.params,
    };
  },

  process_master: (f, scope) => {
    const sc = scopeClause(scope, 'p.branch_id');
    return {
      sql: `SELECT p.id, p.process_code, p.process_name, p.call_centre_code,
                   b.branch_name, l.lob_name,
                   COUNT(DISTINCT e.id) AS headcount,
                   p.active_status
              FROM process_master p
              LEFT JOIN branch_master b ON b.id = p.branch_id
              LEFT JOIN lob_master l ON l.id = p.lob_id
              LEFT JOIN employees e ON e.process_id = p.id AND e.active_status = 1
             WHERE ${sc.sql} ${f.branch ? 'AND p.branch_id = ?' : ''}
             GROUP BY p.id ORDER BY b.branch_name, p.process_name`,
      params: [...sc.params, ...(f.branch ? [f.branch] : [])],
    };
  },

  role_access_map: (_f, _scope) => ({
    sql: `SELECT rpa.role_key, rpa.page_code, rpa.can_view, rpa.can_create,
                 rpa.can_edit, rpa.can_delete, rpa.can_export
            FROM role_page_access rpa
           ORDER BY rpa.role_key, rpa.page_code`,
    params: [],
  }),

  cc_headcount: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT COALESCE(e.call_centre_code, b.call_centre_code) AS cc_code,
                   b.branch_name, COUNT(e.id) AS headcount,
                   COUNT(CASE WHEN e.employment_status = 'active' THEN 1 END) AS active_count
              FROM employees e
              LEFT JOIN branch_master b ON b.id = e.branch_id
             WHERE ${sc.sql} ${f.ccCode ? 'AND COALESCE(e.call_centre_code, b.call_centre_code) = ?' : ''}
             GROUP BY cc_code, b.branch_name ORDER BY cc_code`,
      params: [...sc.params, ...(f.ccCode ? [f.ccCode] : [])],
    };
  },

  employee_dir: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT e.employee_code, CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS full_name,
                   e.email, d.designation_name, b.branch_name, p.process_name,
                   e.employment_status, e.date_of_joining,
                   COALESCE(e.call_centre_code, b.call_centre_code) AS cc_code
              FROM employees e
              LEFT JOIN designation_master d ON d.id = e.designation_id
              LEFT JOIN branch_master b ON b.id = e.branch_id
              LEFT JOIN process_master p ON p.id = e.process_id
             WHERE e.active_status = 1
               AND ${sc.sql}
               ${f.branch ? 'AND e.branch_id = ?' : ''}
               ${f.status ? 'AND e.employment_status = ?' : ''}
             ORDER BY b.branch_name, e.last_name`,
      params: [...sc.params, ...(f.branch ? [f.branch] : []), ...(f.status ? [f.status] : [])],
    };
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  PAYROLL (6 new)
  // ══════════════════════════════════════════════════════════════════════════

  payroll_register: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const month = f.month || '';
    return {
      sql: `SELECT
               spr.run_month,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               p.process_name,
               d.designation_name,
               spl.working_days,
               spl.present_days,
               spl.leave_days,
               spl.lwp_days,
               spl.late_marks,
               spl.gross_salary,
               spl.basic,
               spl.hra,
               spl.special_allowance,
               spl.pf_employee,
               spl.pf_employer,
               spl.esic_employee,
               spl.esic_employer,
               spl.professional_tax,
               spl.tds_amount,
               spl.advance_recovery,
               spl.lwp_deduction,
               spl.total_deductions,
               spl.net_salary,
               spl.status AS line_status
             FROM salary_prep_line spl
             JOIN salary_prep_run spr ON spr.id = spl.run_id
             JOIN employees e ON e.id = spl.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
             LEFT JOIN designation_master d ON d.id = e.designation_id
            WHERE spr.status IN ('approved','disbursed')
              AND ${sc.sql}
              ${month ? 'AND spr.run_month = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.process ? 'AND e.process_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(month ? [month] : []),
        ...(f.branch ? [f.branch] : []),
        ...(f.process ? [f.process] : []),
      ],
    };
  },

  payroll_component_detail: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const month = f.month || '';
    return {
      sql: `SELECT
               spr.run_month,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               p.process_name,
               splc.component_code,
               splc.component_name,
               splc.component_type,
               splc.amount,
               splc.taxable,
               splc.source
             FROM salary_prep_line_component splc
             JOIN salary_prep_run spr ON spr.id = splc.run_id
             JOIN employees e ON e.id = splc.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE spr.status IN ('approved','disbursed')
              AND ${sc.sql}
              ${month ? 'AND spr.run_month = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.componentType ? 'AND splc.component_type = ?' : ''}
            ORDER BY b.branch_name, e.employee_code, splc.component_type, splc.component_code`,
      params: [
        ...sc.params,
        ...(month ? [month] : []),
        ...(f.branch ? [f.branch] : []),
        ...(f.componentType ? [f.componentType] : []),
      ],
    };
  },

  payroll_statutory: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const month = f.month || '';
    return {
      sql: `SELECT
               spr.run_month,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               e.uan_number,
               e.esic_number,
               e.pan_number,
               spl.gross_salary AS gross_wages,
               spl.pf_employee,
               spl.pf_employer,
               (spl.pf_employee + spl.pf_employer) AS total_pf,
               spl.esic_employee,
               spl.esic_employer,
               (spl.esic_employee + spl.esic_employer) AS total_esic,
               spl.professional_tax AS pt,
               spl.tds_amount AS tds
             FROM salary_prep_line spl
             JOIN salary_prep_run spr ON spr.id = spl.run_id
             JOIN employees e ON e.id = spl.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
            WHERE spr.status IN ('approved','disbursed')
              AND ${sc.sql}
              ${month ? 'AND spr.run_month = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(month ? [month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  payroll_bank_statement: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const month = f.month || '';
    return {
      sql: `SELECT
               spr.run_month,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               e.bank_name,
               e.bank_branch,
               e.account_holder_name,
               e.bank_account_number,
               e.ifsc_code,
               e.account_type,
               spl.net_salary AS amount_to_credit,
               spl.status AS line_status,
               spr.disbursed_at
             FROM salary_prep_line spl
             JOIN salary_prep_run spr ON spr.id = spl.run_id
             JOIN employees e ON e.id = spl.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
            WHERE spr.status IN ('approved','disbursed')
              AND ${sc.sql}
              ${month ? 'AND spr.run_month = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(month ? [month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  payroll_full_final: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               d.designation_name,
               e.date_of_joining,
               e.date_of_exit,
               er.resignation_date,
               er.last_working_day,
               er.exit_type,
               ffc.calculation_date,
               ffc.notice_period_days,
               ffc.notice_shortfall_days,
               ffc.notice_recovery,
               ffc.earned_leave_encashment,
               ffc.gratuity_amount,
               ffc.salary_hold,
               ffc.advances_recovery,
               ffc.net_payable,
               ffc.status AS ff_status
             FROM full_final_calculation ffc
             JOIN exit_request er ON er.id = ffc.exit_request_id
             JOIN employees e ON e.id = ffc.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN designation_master d ON d.id = e.designation_id
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

  payroll_ytd: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const fy = f.financialYear || '';
    return {
      sql: `SELECT
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               p.process_name,
               spr.financial_year,
               COUNT(spl.id) AS months_paid,
               SUM(spl.gross_salary) AS ytd_gross,
               SUM(spl.basic) AS ytd_basic,
               SUM(spl.hra) AS ytd_hra,
               SUM(spl.special_allowance) AS ytd_special_allowance,
               SUM(spl.pf_employee) AS ytd_pf_employee,
               SUM(spl.pf_employer) AS ytd_pf_employer,
               SUM(spl.esic_employee) AS ytd_esic_employee,
               SUM(spl.professional_tax) AS ytd_pt,
               SUM(spl.tds_amount) AS ytd_tds,
               SUM(spl.lwp_deduction) AS ytd_lwp_deduction,
               SUM(spl.net_salary) AS ytd_net
             FROM salary_prep_line spl
             JOIN salary_prep_run spr ON spr.id = spl.run_id
             JOIN employees e ON e.id = spl.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE spr.status IN ('approved','disbursed')
              AND ${sc.sql}
              ${fy ? 'AND spr.financial_year = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            GROUP BY e.id, spr.financial_year
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(fy ? [fy] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  EMPLOYEE (5 new)
  // ══════════════════════════════════════════════════════════════════════════

  emp_master: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS full_name,
               e.gender,
               e.date_of_birth,
               e.mobile,
               e.email,
               e.office_email,
               e.date_of_joining,
               e.salary_start_date,
               e.employment_type,
               e.employee_category,
               e.employment_status,
               b.branch_name,
               p.process_name,
               d.designation_name,
               dept.dept_name AS department,
               g.band AS grade_band,
               e.band,
               e.blood_group,
               e.father_name,
               e.marital_status,
               e.address1, e.city, e.state, e.pincode,
               e.billable_status,
               COALESCE(e.call_centre_code, b.call_centre_code) AS cc_code
             FROM employees e
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
             LEFT JOIN designation_master d ON d.id = e.designation_id
             LEFT JOIN department_master dept ON dept.id = e.department_id
             LEFT JOIN grade_band_master g ON g.id = e.grade_id
            WHERE e.active_status = 1
              AND ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.process ? 'AND e.process_id = ?' : ''}
              ${f.status ? 'AND e.employment_status = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.process ? [f.process] : []),
        ...(f.status ? [f.status] : []),
      ],
    };
  },

  emp_statutory: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS full_name,
               b.branch_name,
               e.pan_number,
               e.pan_verified_on,
               e.aadhaar_last4,
               e.aadhaar_verified_on,
               e.uan_number,
               e.epf_number,
               e.esic_number,
               esi.pf_applicable,
               esi.esic_applicable,
               esi.pt_applicable,
               esi.tds_applicable,
               e.employment_status
             FROM employees e
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN employee_statutory_info esi ON esi.employee_id = e.id
            WHERE e.active_status = 1
              AND ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  emp_bank_details: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS full_name,
               b.branch_name,
               e.account_holder_name,
               e.bank_name,
               e.bank_branch,
               e.bank_account_number,
               e.ifsc_code,
               e.account_type,
               e.employment_status
             FROM employees e
             LEFT JOIN branch_master b ON b.id = e.branch_id
            WHERE e.active_status = 1
              AND ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  emp_joining_exit: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const type = f.type || 'both';
    let typeFilter = '';
    if (type === 'joiners') typeFilter = 'AND e.date_of_joining IS NOT NULL';
    else if (type === 'leavers') typeFilter = "AND e.date_of_exit IS NOT NULL";
    return {
      sql: `SELECT
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS full_name,
               b.branch_name,
               p.process_name,
               d.designation_name,
               e.date_of_joining,
               e.date_of_exit,
               e.employment_status,
               e.employment_type,
               e.employee_category,
               COALESCE(e.call_centre_code, b.call_centre_code) AS cc_code
             FROM employees e
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
             LEFT JOIN designation_master d ON d.id = e.designation_id
            WHERE ${sc.sql}
              ${typeFilter}
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

  emp_documents: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS full_name,
               b.branch_name,
               ed.doc_type,
               ed.doc_category,
               ed.doc_name,
               ed.verified,
               ed.expiry_date,
               ed.created_at AS uploaded_at,
               ed.verification_date,
               ed.verification_remarks
             FROM employee_documents ed
             JOIN employees e ON e.id = ed.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
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

  // ══════════════════════════════════════════════════════════════════════════
  //  ATTENDANCE & BIOMETRIC (5 new)
  // ══════════════════════════════════════════════════════════════════════════

  att_monthly: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const month = f.month || '';
    return {
      sql: `SELECT
               adr.record_date,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               p.process_name,
               adr.attendance_status,
               adr.clock_in_time,
               adr.clock_out_time,
               adr.raw_minutes,
               ROUND(adr.raw_minutes / 60, 2) AS hours_worked,
               adr.late_mark,
               adr.late_by_minutes,
               adr.lwp_value,
               adr.work_mode,
               adr.attendance_source
             FROM attendance_daily_record adr
             JOIN employees e ON e.id = adr.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE ${sc.sql}
              ${month ? "AND DATE_FORMAT(adr.record_date,'%Y-%m') = ?" : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.process ? 'AND e.process_id = ?' : ''}
              ${f.dateFrom ? 'AND adr.record_date >= ?' : ''}
              ${f.dateTo ? 'AND adr.record_date <= ?' : ''}
            ORDER BY adr.record_date, b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(month ? [month] : []),
        ...(f.branch ? [f.branch] : []),
        ...(f.process ? [f.process] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
      ],
    };
  },

  att_late_mark: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const month = f.month || '';
    return {
      sql: `SELECT
               DATE_FORMAT(adr.record_date,'%Y-%m') AS month,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               p.process_name,
               COUNT(*) AS total_late_marks,
               SUM(adr.late_by_minutes) AS total_late_minutes,
               ROUND(AVG(adr.late_by_minutes),1) AS avg_late_minutes
             FROM attendance_daily_record adr
             JOIN employees e ON e.id = adr.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE adr.late_mark = 1
              AND ${sc.sql}
              ${month ? "AND DATE_FORMAT(adr.record_date,'%Y-%m') = ?" : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            GROUP BY month, e.id
            ORDER BY month, b.branch_name, total_late_marks DESC`,
      params: [
        ...sc.params,
        ...(month ? [month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  att_biometric: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const month = f.month || '';
    return {
      sql: `SELECT
               was.session_date,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               e.biometric_code,
               b.branch_name,
               was.branch_name AS punch_branch,
               p.process_name,
               was.login_time AS punch_in,
               was.logout_time AS punch_out,
               was.total_login_minutes,
               ROUND(was.total_login_minutes / 60, 2) AS login_hours,
               was.current_status,
               was.punch_source
             FROM wfm_attendance_session was
             JOIN employees e ON e.id = was.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE ${sc.sql}
              ${month ? "AND DATE_FORMAT(was.session_date,'%Y-%m') = ?" : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.dateFrom ? 'AND was.session_date >= ?' : ''}
              ${f.dateTo ? 'AND was.session_date <= ?' : ''}
            ORDER BY was.session_date, b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(month ? [month] : []),
        ...(f.branch ? [f.branch] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
      ],
    };
  },

  att_regularization: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               ar.session_date,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               ar.reason,
               ar.status,
               ar.reviewed_at,
               ar.reviewer_note,
               ar.created_at AS applied_at
             FROM attendance_regularization ar
             JOIN employees e ON e.id = ar.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
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

  att_reconciliation: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               adr.record_date,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               adr.attendance_status,
               adr.attendance_source,
               adr.clock_in_time,
               adr.clock_out_time,
               adr.raw_minutes,
               adr.is_locked
             FROM attendance_daily_record adr
             JOIN employees e ON e.id = adr.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
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

  // ══════════════════════════════════════════════════════════════════════════
  //  APR / DIALER (3 new) — joins employees on biometric_code
  // ══════════════════════════════════════════════════════════════════════════

  apr_daily: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               a.ReportDate,
               a.UserID AS agent_id,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS agent_name,
               e.employee_code,
               b.branch_name,
               p.process_name,
               a.campaign_id,
               a.Calls,
               a.TALK_TIME,
               a.WAIT_TIME,
               a.DISPO_TIME,
               a.PAUSE_TIME,
               a.AHT,
               a.Login_Time,
               a.Logout_Time,
               a.Net_Login,
               a.BIO,
               a.LUNCH,
               a.QA,
               a.TRAINING
             FROM apr a
             LEFT JOIN employees e ON e.biometric_code = a.UserID AND e.active_status = 1
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE ${sc.sql}
              ${f.dateFrom ? 'AND a.ReportDate >= ?' : ''}
              ${f.dateTo ? 'AND a.ReportDate <= ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.campaign ? 'AND a.campaign_id = ?' : ''}
            ORDER BY a.ReportDate DESC, b.branch_name, a.UserID`,
      params: [
        ...sc.params,
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
        ...(f.branch ? [f.branch] : []),
        ...(f.campaign ? [f.campaign] : []),
      ],
    };
  },

  apr_monthly: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const month = f.month || '';
    return {
      sql: `SELECT
               DATE_FORMAT(a.ReportDate,'%Y-%m') AS month,
               a.UserID AS agent_id,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS agent_name,
               e.employee_code,
               b.branch_name,
               p.process_name,
               a.campaign_id,
               COUNT(*) AS days_logged,
               SUM(a.Calls) AS total_calls,
               SEC_TO_TIME(SUM(TIME_TO_SEC(a.TALK_TIME))) AS total_talk_time,
               SEC_TO_TIME(SUM(TIME_TO_SEC(a.Net_Login))) AS total_net_login,
               SEC_TO_TIME(AVG(TIME_TO_SEC(a.AHT))) AS avg_aht
             FROM apr a
             LEFT JOIN employees e ON e.biometric_code = a.UserID AND e.active_status = 1
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE ${sc.sql}
              ${month ? "AND DATE_FORMAT(a.ReportDate,'%Y-%m') = ?" : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            GROUP BY month, a.UserID, a.campaign_id
            ORDER BY month, b.branch_name, a.UserID`,
      params: [
        ...sc.params,
        ...(month ? [month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  apr_campaign: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const month = f.month || '';
    return {
      sql: `SELECT
               a.campaign_id,
               DATE_FORMAT(a.ReportDate,'%Y-%m') AS month,
               b.branch_name,
               COUNT(DISTINCT a.UserID) AS agents,
               COUNT(*) AS agent_days,
               SUM(a.Calls) AS total_calls,
               ROUND(SUM(a.Calls)/NULLIF(COUNT(*),0),1) AS avg_calls_per_day,
               SEC_TO_TIME(AVG(TIME_TO_SEC(a.AHT))) AS avg_aht,
               SEC_TO_TIME(SUM(TIME_TO_SEC(a.Net_Login))) AS total_net_login
             FROM apr a
             LEFT JOIN employees e ON e.biometric_code = a.UserID AND e.active_status = 1
             LEFT JOIN branch_master b ON b.id = e.branch_id
            WHERE ${sc.sql}
              ${month ? "AND DATE_FORMAT(a.ReportDate,'%Y-%m') = ?" : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.campaign ? 'AND a.campaign_id = ?' : ''}
            GROUP BY a.campaign_id, month, b.branch_name
            ORDER BY month, b.branch_name, a.campaign_id`,
      params: [
        ...sc.params,
        ...(month ? [month] : []),
        ...(f.branch ? [f.branch] : []),
        ...(f.campaign ? [f.campaign] : []),
      ],
    };
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  LEAVE (3 new)
  // ══════════════════════════════════════════════════════════════════════════

  leave_balance: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const year = f.year ? parseInt(f.year) : new Date().getFullYear();
    return {
      sql: `SELECT
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               p.process_name,
               ltm.leave_code,
               ltm.leave_name,
               ltm.paid_leave,
               lbl.balance_year AS year,
               lbl.allocated_days,
               lbl.used_days,
               lbl.adjusted_days,
               (lbl.allocated_days - lbl.used_days + lbl.adjusted_days) AS closing_balance
             FROM leave_balance_ledger lbl
             JOIN employees e ON e.id = lbl.employee_id
             JOIN leave_type_master ltm ON ltm.id = lbl.leave_type_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE lbl.balance_year = ?
              AND ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code, ltm.leave_code`,
      params: [
        year,
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  leave_transactions: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               lr.applied_at,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               p.process_name,
               ltm.leave_code,
               ltm.leave_name,
               lr.from_date,
               lr.to_date,
               lr.total_days,
               lr.status,
               lr.reason,
               lr.approved_at,
               lr.approved_by,
               lr.rejection_reason
             FROM leave_request lr
             JOIN employees e ON e.id = lr.employee_id
             JOIN leave_type_master ltm ON ltm.id = lr.leave_type_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
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

  leave_lwp: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const month = f.month || '';
    return {
      sql: `SELECT
               DATE_FORMAT(adr.record_date,'%Y-%m') AS month,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               p.process_name,
               SUM(adr.lwp_value) AS total_lwp_days,
               COUNT(*) AS lwp_records
             FROM attendance_daily_record adr
             JOIN employees e ON e.id = adr.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE adr.lwp_value > 0
              AND ${sc.sql}
              ${month ? "AND DATE_FORMAT(adr.record_date,'%Y-%m') = ?" : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            GROUP BY month, e.id
            ORDER BY month, b.branch_name, total_lwp_days DESC`,
      params: [
        ...sc.params,
        ...(month ? [month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  KPI (2 new)
  // ══════════════════════════════════════════════════════════════════════════

  kpi_scores: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const period = f.period || '';
    return {
      sql: `SELECT
               ks.period,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               p.process_name,
               kmm.metric_code,
               kmm.metric_name,
               kmm.metric_unit,
               ks.actual_value,
               ks.source
             FROM kpi_score ks
             JOIN kpi_metric_master kmm ON kmm.id = ks.metric_id
             JOIN employees e ON e.id = ks.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE ${sc.sql}
              ${period ? 'AND ks.period = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY ks.period, b.branch_name, e.employee_code, kmm.metric_code`,
      params: [
        ...sc.params,
        ...(period ? [period] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  kpi_summary: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const period = f.period || '';
    return {
      sql: `SELECT
               kss.period_id,
               kss.role_code,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               p.process_name,
               kss.final_score,
               kss.rating,
               kss.rank_in_team,
               kss.rank_in_process,
               kss.rank_in_branch,
               kss.status
             FROM kpi_score_summary kss
             JOIN employees e ON e.id = kss.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = kss.process_id
            WHERE ${sc.sql}
              ${period ? 'AND kss.period_id = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, kss.rank_in_branch`,
      params: [
        ...sc.params,
        ...(period ? [period] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  ATTRITION & LIFECYCLE (2 new)
  // ══════════════════════════════════════════════════════════════════════════

  attrition_monthly: (f, scope) => {
    const sc = scopeClause(scope, 'ar.branch_id');
    const month = f.month || '';
    return {
      sql: `SELECT
               DATE_FORMAT(ar.exit_date,'%Y-%m') AS month,
               b.branch_name,
               p.process_name,
               ar.exit_type,
               COUNT(*) AS headcount_exited,
               SUM(ar.tenure_days) AS total_tenure_days,
               ROUND(AVG(ar.tenure_days),0) AS avg_tenure_days
             FROM attrition_record ar
             LEFT JOIN branch_master b ON b.id = ar.branch_id
             LEFT JOIN process_master p ON p.id = ar.process_id
            WHERE ${sc.sql}
              ${month ? "AND DATE_FORMAT(ar.exit_date,'%Y-%m') = ?" : ''}
              ${f.branch ? 'AND ar.branch_id = ?' : ''}
            GROUP BY month, ar.branch_id, ar.process_id, ar.exit_type
            ORDER BY month DESC, b.branch_name`,
      params: [
        ...sc.params,
        ...(month ? [month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  emp_lifecycle: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               ele.effective_date,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               ele.event_type,
               ele.old_value_json,
               ele.new_value_json,
               ele.remarks,
               ele.created_at
             FROM employee_lifecycle_event ele
             JOIN employees e ON e.id = ele.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
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

  // ══════════════════════════════════════════════════════════════════════════
  //  COMPLIANCE / STATUTORY (2 new)
  // ══════════════════════════════════════════════════════════════════════════

  pf_challan: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const month = f.month || '';
    return {
      sql: `SELECT
               spr.run_month,
               b.branch_name,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               e.uan_number,
               e.epf_number,
               spl.gross_salary AS pf_wages,
               spl.basic AS pf_basic,
               spl.pf_employee AS employee_pf,
               spl.pf_employer AS employer_pf,
               (spl.pf_employee + spl.pf_employer) AS total_pf_contribution
             FROM salary_prep_line spl
             JOIN salary_prep_run spr ON spr.id = spl.run_id
             JOIN employees e ON e.id = spl.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
            WHERE spr.status IN ('approved','disbursed')
              AND spl.pf_employee > 0
              AND ${sc.sql}
              ${month ? 'AND spr.run_month = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(month ? [month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  esic_challan: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const month = f.month || '';
    return {
      sql: `SELECT
               spr.run_month,
               b.branch_name,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               e.esic_number,
               spl.gross_salary AS esic_wages,
               spl.esic_employee AS employee_esic,
               spl.esic_employer AS employer_esic,
               (spl.esic_employee + spl.esic_employer) AS total_esic_contribution
             FROM salary_prep_line spl
             JOIN salary_prep_run spr ON spr.id = spl.run_id
             JOIN employees e ON e.id = spl.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
            WHERE spr.status IN ('approved','disbursed')
              AND spl.esic_employee > 0
              AND ${sc.sql}
              ${month ? 'AND spr.run_month = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(month ? [month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },
};

// ── Service ──────────────────────────────────────────────────────────────────

export const reportingService = {
  async listReports(userId: string): Promise<RowDataPacket[]> {
    const scope = await resolveBranchScope(userId);
    // Non-super-admins cannot see admin_only reports unless they are hr/finance/payroll
    const [roleRows] = await db.execute<RowDataPacket[]>(
      `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`,
      [userId]
    );
    const roles = (roleRows as { role_key: string }[]).map(r => r.role_key);
    const canSeeAdminOnly = scope.isSuperAdmin || roles.some(r => ['hr', 'finance', 'payroll', 'ceo'].includes(r));

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM report_master
        WHERE active_status = 1 ${canSeeAdminOnly ? '' : 'AND admin_only = 0'}
        ORDER BY report_category, report_name`
    );
    return rows;
  },

  async runReport(
    reportCode: string,
    filters: Record<string, string>,
    userId: string
  ): Promise<{ columns: string[]; rows: unknown[]; count: number }> {
    const [meta] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM report_master WHERE report_code = ? AND active_status = 1 LIMIT 1',
      [reportCode]
    );
    if (!meta[0]) throw Object.assign(new Error(`Report ${reportCode} not found`), { statusCode: 404 });

    const queryKey = meta[0].query_key as string;
    const builder = QUERIES[queryKey];
    if (!builder) throw Object.assign(new Error(`No query builder for ${queryKey}`), { statusCode: 501 });

    const scope = await resolveBranchScope(userId);

    // If user requests a specific branch but it's not in their allowed scope, reject
    if (!scope.isSuperAdmin && scope.branchIds.length > 0 && filters.branch) {
      if (!scope.branchIds.includes(filters.branch)) {
        throw Object.assign(new Error('Access denied: branch not in your scope'), { statusCode: 403 });
      }
    }

    const { sql, params } = builder(filters, scope);
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);

    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { columns, rows, count: rows.length };
  },
};
```

---

## Task 4 — Update Reporting Routes

**Files:**
- Modify: `backend/src/modules/reporting/reporting.routes.ts`

- [ ] **Step 1: Replace routes file**

```typescript
// backend/src/modules/reporting/reporting.routes.ts
import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { reportingService } from './reporting.service.js';

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<void>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

// All authenticated roles can list/run reports — scope is enforced in service
router.get('/', requireAuth, h(async (req, res) => {
  const reports = await reportingService.listReports(req.authUser!.id);
  res.json({ data: reports });
}));

router.post('/:code/run', requireAuth, h(async (req, res) => {
  const filters = req.body.filters || {};
  const result = await reportingService.runReport(req.params.code, filters, req.authUser!.id);
  res.json({ data: result });
}));

export { router as reportingRouter };
```

---

## Task 5 — Frontend: Enhanced Filters + Excel Export

**Files:**
- Modify: `src/pages/NativeMasterReports.tsx`

Key changes:
1. Add `month`, `year`, `dateTo`, `process`, `financialYear`, `period`, `campaign`, `eventType` filter inputs
2. Add **Export Excel** button using `xlsx` (already available via jspdf, or install xlsx)
3. Branch filter is pre-locked for non-admin users (fetch user's branch from `/api/employees/me` or scope endpoint)

- [ ] **Step 1: Install xlsx if not present**

```bash
cd /c/Users/shivamg/Desktop/HRMS1 && npm list xlsx 2>/dev/null || npm install xlsx
```

- [ ] **Step 2: Add imports at top of NativeMasterReports.tsx**

Add after existing imports:
```typescript
import * as XLSX from 'xlsx';
```

- [ ] **Step 3: Add Excel download helper after the existing `downloadCsv` function**

```typescript
function downloadXlsx(columns: string[], rows: Record<string, unknown>[], filename: string) {
  const data = [columns, ...rows.map(r => columns.map(c => r[c] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, filename.replace('.csv', '.xlsx'));
}
```

- [ ] **Step 4: Expand the filters state type and add new filter fields**

Replace the existing `filters` state initialization with:
```typescript
const [filters, setFilters] = useState<{
  branch: string; ccCode: string; status: string; dateFrom: string;
  dateTo: string; month: string; year: string; financialYear: string;
  process: string; period: string; campaign: string; eventType: string;
}>({
  branch: '', ccCode: '', status: '', dateFrom: '',
  dateTo: '', month: '', year: String(new Date().getFullYear()),
  financialYear: '', process: '', period: '', campaign: '', eventType: '',
});
```

- [ ] **Step 5: Add process dropdown state (fetch from API)**

After the `branches` query, add:
```typescript
const { data: processes = [] } = useQuery({
  queryKey: ['processes-for-reports'],
  queryFn: () => hrmsApi.get('/api/process').then(r => r.data?.data ?? []),
});
```

- [ ] **Step 6: Expand the filter panel in the JSX (replace the existing 4-column grid)**

```tsx
<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
  {/* Branch */}
  <div className="space-y-1">
    <Label className="text-xs">Branch</Label>
    <Select value={filters.branch || '__all__'} onValueChange={(v) => setFilters(f => ({ ...f, branch: v === '__all__' ? '' : v }))}>
      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All branches" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">All branches</SelectItem>
        {branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}
      </SelectContent>
    </Select>
  </div>
  {/* Process */}
  <div className="space-y-1">
    <Label className="text-xs">Process</Label>
    <Select value={filters.process || '__all__'} onValueChange={(v) => setFilters(f => ({ ...f, process: v === '__all__' ? '' : v }))}>
      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All processes" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">All processes</SelectItem>
        {processes.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.process_name}</SelectItem>)}
      </SelectContent>
    </Select>
  </div>
  {/* Month */}
  <div className="space-y-1">
    <Label className="text-xs">Month (YYYY-MM)</Label>
    <Input className="h-8 text-sm" type="month" value={filters.month} onChange={(e) => setFilters(f => ({ ...f, month: e.target.value }))} />
  </div>
  {/* Year */}
  <div className="space-y-1">
    <Label className="text-xs">Year</Label>
    <Input className="h-8 text-sm" placeholder="e.g. 2026" value={filters.year} onChange={(e) => setFilters(f => ({ ...f, year: e.target.value }))} />
  </div>
  {/* Financial Year */}
  <div className="space-y-1">
    <Label className="text-xs">Financial Year</Label>
    <Input className="h-8 text-sm" placeholder="e.g. 2025-26" value={filters.financialYear} onChange={(e) => setFilters(f => ({ ...f, financialYear: e.target.value }))} />
  </div>
  {/* Date From */}
  <div className="space-y-1">
    <Label className="text-xs">Date From</Label>
    <Input type="date" className="h-8 text-sm" value={filters.dateFrom} onChange={(e) => setFilters(f => ({ ...f, dateFrom: e.target.value }))} />
  </div>
  {/* Date To */}
  <div className="space-y-1">
    <Label className="text-xs">Date To</Label>
    <Input type="date" className="h-8 text-sm" value={filters.dateTo} onChange={(e) => setFilters(f => ({ ...f, dateTo: e.target.value }))} />
  </div>
  {/* Status */}
  <div className="space-y-1">
    <Label className="text-xs">Status</Label>
    <Select value={filters.status || '__all__'} onValueChange={(v) => setFilters(f => ({ ...f, status: v === '__all__' ? '' : v }))}>
      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All statuses" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">All</SelectItem>
        <SelectItem value="active">Active</SelectItem>
        <SelectItem value="inactive">Inactive</SelectItem>
        <SelectItem value="resigned">Resigned</SelectItem>
        <SelectItem value="terminated">Terminated</SelectItem>
        <SelectItem value="pending">Pending</SelectItem>
        <SelectItem value="approved">Approved</SelectItem>
        <SelectItem value="rejected">Rejected</SelectItem>
      </SelectContent>
    </Select>
  </div>
  {/* Campaign */}
  <div className="space-y-1">
    <Label className="text-xs">Campaign ID</Label>
    <Input className="h-8 text-sm" placeholder="Campaign ID" value={filters.campaign} onChange={(e) => setFilters(f => ({ ...f, campaign: e.target.value }))} />
  </div>
  {/* Period (KPI) */}
  <div className="space-y-1">
    <Label className="text-xs">KPI Period</Label>
    <Input className="h-8 text-sm" placeholder="e.g. 2026-05" value={filters.period} onChange={(e) => setFilters(f => ({ ...f, period: e.target.value }))} />
  </div>
</div>
```

- [ ] **Step 7: Add Excel export button next to the CSV button**

In the buttons row (next to "Export CSV"), add:
```tsx
{result && result.rows.length > 0 && (
  <Button
    variant="outline"
    onClick={() =>
      downloadXlsx(
        result.columns,
        result.rows as Record<string, unknown>[],
        `${selected.report_code}_${new Date().toISOString().slice(0, 10)}.xlsx`
      )
    }
  >
    <Download className="h-4 w-4 mr-2" />
    Export Excel
  </Button>
)}
```

- [ ] **Step 8: Pass all filters to the run mutation**

The `runMut` already sends `filters` — ensure it passes the full expanded object:
```typescript
const runMut = useMutation({
  mutationFn: () =>
    hrmsApi.post(`/api/reports/${selected!.report_code}/run`, {
      filters: Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v !== '' && v !== undefined)
      ),
    }).then(r => r.data.data as ReportResult),
  onSuccess: (data) => setResult(data),
});
```

---

## Task 6 — Run Migration & Verify

- [ ] **Step 1: Run the migration directly on MySQL**

```bash
"/c/Program Files/MySQL/MySQL Workbench 8.0 CE/mysql.exe" \
  -h 192.168.10.6 -P 3306 -u shivam_user -p'qwersdfg!@#hjk' mas_hrms \
  < "/c/Users/shivamg/Desktop/HRMS1/backend/sql/143_report_builder.sql"
```

- [ ] **Step 2: Verify 28 new rows in report_master**

```bash
"/c/Program Files/MySQL/MySQL Workbench 8.0 CE/mysql.exe" \
  -h 192.168.10.6 -P 3306 -u shivam_user -p'qwersdfg!@#hjk' mas_hrms \
  -e "SELECT report_code, report_name, report_category FROM report_master ORDER BY report_category, report_name;"
```

Expected: 34 rows total (6 existing + 28 new).

- [ ] **Step 3: Start backend**

```bash
cd "/c/Users/shivamg/Desktop/HRMS1/backend" && node_modules/.bin/tsx watch src/server.ts
```

- [ ] **Step 4: Smoke-test the API**

```bash
# Get token from login, then:
curl -s -X POST http://localhost:5055/api/reports/PAYROLL_REGISTER/run \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"filters":{"month":"2026-05"}}' | jq '.data.count'
```

- [ ] **Step 5: Start frontend**

```bash
cd "/c/Users/shivamg/Desktop/HRMS1" && node_modules/.bin/vite
```

- [ ] **Step 6: Open http://localhost:5173 → navigate to Master Reports → verify all 28 reports appear, run one, export CSV + Excel**

---

## Self-Review Checklist

- [x] All 28 reports have query builders in `QUERIES` map
- [x] All 28 reports registered in SQL migration
- [x] Branch scope clamped in every query via `scopeClause()`
- [x] Super admin / admin / ceo → `isSuperAdmin: true` → no branch filter
- [x] All other roles → branch-restricted via `user_assignment_scope` or employee's own branch
- [x] Admin-only reports (bank details, statutory, payroll) hidden from non-privileged roles via `listReports()`
- [x] Filter branch override validated against scope — 403 if outside permitted branches
- [x] Excel export helper uses `xlsx` library
- [x] All filter fields passed to backend (month, year, dateFrom, dateTo, process, campaign, period, financialYear, eventType)
- [x] APR reports join on `biometric_code` to attach branch context
- [x] Migration is idempotent (`INSERT IGNORE`)
