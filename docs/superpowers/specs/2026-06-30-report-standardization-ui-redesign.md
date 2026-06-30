# Report Standardization & UI Redesign
**Date:** 2026-06-30  
**Status:** Approved for implementation

---

## 1. Problem Statement

All HRMS reports are missing mandatory contextual columns (cost centre, branch, process, department) and employee-identity columns (employee code, name, designation, employment status). The attendance-summary query excludes ex-employees who worked mid-month. The Reports Center UI lacks visual appeal and has a sidebar layout the team wants replaced.

---

## 2. Scope

### 2.1 Backend — Mandatory Column Standardization

**Rule:** Every report that touches the `employees` table MUST include these columns in its SELECT (in this order at the top of the result):

| Column | SQL expression | Applies to |
|--------|---------------|------------|
| `employee_code` | `e.employee_code` | All employee reports |
| `employee_name` | `CONCAT(e.first_name,' ',COALESCE(e.last_name,''))` | All employee reports |
| `employment_status` | `e.employment_status` | All employee reports |
| `designation_name` | `desig.designation_name` | All employee reports |
| `department` | `dept.dept_name` | All reports |
| `branch_name` | `b.branch_name` | All reports |
| `process_name` | `p.process_name` | All reports |
| `cost_centre_name` | `cc.cost_centre_name` | All reports |

**Shared SQL helpers** (added near top of `reporting.service.ts`):

```typescript
const EMP_CORE_COLS = `
  e.employee_code,
  CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
  e.employment_status,
  desig.designation_name,
  dept.dept_name         AS department,
  b.branch_name,
  p.process_name,
  cc.cost_centre_name`;

const EMP_CORE_JOINS = `
  LEFT JOIN branch_master      b     ON b.id     = e.branch_id
  LEFT JOIN process_master     p     ON p.id     = e.process_id
  LEFT JOIN department_master  dept  ON dept.id  = e.department_id
  LEFT JOIN designation_master desig ON desig.id = e.designation_id
  LEFT JOIN cost_centre_master cc    ON cc.id    = e.cost_centre_id`;
```

Every query builder in `reporting.service.ts` uses these constants. Report-suite cases in `report-suite.routes.ts` get the same treatment inline.

**Exception:** `branch_master`, `process_master`, `role_access_map`, `cc_headcount` are aggregate/master-data reports with no per-employee row — they keep their existing columns and only add `branch_name` / `process_name` / `cost_centre_name` where applicable.

**Affected query builders in `reporting.service.ts`** (all 28):
`branch_master`, `user_master`, `process_master`, `role_access_map` (no emp), `cc_headcount`, `employee_dir`, `payroll_register`, `payroll_component_detail`, `payroll_statutory`, `payroll_bank_statement`, `payroll_full_final`, `payroll_ytd`, `emp_master`, `emp_statutory`, `emp_bank_details`, `emp_joining_exit`, `emp_documents`, `att_monthly`, `att_late_mark`, `att_biometric`, `att_regularization`, `att_reconciliation`, `apr_daily`, `apr_monthly`, `apr_campaign`, `leave_balance`, `leave_transactions`, `leave_lwp`, `kpi_scores`, `kpi_summary`, `attrition_monthly`, `emp_lifecycle`, `pf_challan`, `esic_challan`, `emp_emergency_contact`, `emp_nominee`, `emp_probation`, `emp_job_history`, `emp_salary_history`.

**Affected cases in `report-suite.routes.ts`**:
`employee-master`, `headcount`, `employee-movement`, `exit-movement-report`, `manager-mapping`, `attendance-daily`, `attendance-summary`, `biometric-reconciliation`, `leave-balance`, `leave-utilization`, `payroll-register`, `payroll-variance`, `payslip-status`, `ytd-salary-summary`, `lwp-deduction-register`, `salary-advance-register`, `statutory-missing`, `bank-missing`, `pf-ecr-export`.

### 2.2 Attendance-Summary Special Logic

**Requirement:** Show (a) all currently active employees for the month regardless of whether they have any attendance record, and (b) any ex-employee (active_status=0 or employment_status not 'active') who has at least one `present` or `half_day` record in the month.

**SQL pattern (attendance-summary case in report-suite.routes.ts):**

```sql
-- Part 1: Active employees — always shown (LEFT JOIN so 0-attendance rows appear as nulls/zeros)
SELECT {EMP_CORE_COLS},
       COALESCE(SUM(adr.attendance_status='present'),0)       AS present_days,
       COALESCE(SUM(adr.attendance_status='half_day'),0)      AS half_days,
       COALESCE(SUM(adr.attendance_status='absent'),0)        AS absent_days,
       COALESCE(SUM(adr.attendance_status='leave_approved'),0) AS leave_days,
       COALESCE(SUM(adr.lwp_value),0)                         AS lwp_days,
       COALESCE(SUM(adr.late_mark=1),0)                       AS late_days,
       ROUND(COALESCE(SUM(COALESCE(adr.raw_minutes,adr.biometric_minutes,adr.dialler_minutes,0)),0)/60,2) AS total_hours
FROM employees e
{EMP_CORE_JOINS}
LEFT JOIN attendance_daily_record adr
  ON adr.employee_id = e.id AND DATE_FORMAT(adr.record_date,'%Y-%m') = ?
WHERE e.active_status = 1
  AND [branch_scope_clause]
  AND [optional employee filters]
GROUP BY e.id, ...

UNION ALL

-- Part 2: Ex-employees who actually worked this month
SELECT {EMP_CORE_COLS},
       SUM(adr.attendance_status='present')       AS present_days,
       ...same aggregates...
FROM attendance_daily_record adr
JOIN employees e ON e.id = adr.employee_id
{EMP_CORE_JOINS}
WHERE e.active_status = 0
  AND DATE_FORMAT(adr.record_date,'%Y-%m') = ?
  AND [branch_scope_clause]
GROUP BY e.id, ...
HAVING SUM(adr.attendance_status IN ('present','half_day')) > 0

ORDER BY branch_name, employee_name
```

The UNION eliminates the need for two queries. Branch scope applies to both halves. The `employment_status` column (e.g. `active`, `resigned`, `terminated`) lets HR see why someone is inactive.

---

## 3. UI Redesign — NativeReportsCenter

### 3.1 Layout (no sidebar)

```
┌─────────────────────────────────────────────────────────────────┐
│  HERO BAR (gradient, sticky)                                    │
│  [🔍 Search]  [Recent chips]  [Favourites ★ N]  [N reports]    │
└─────────────────────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────────────────┐
│  CATEGORY GRID  (4-col → 2-col → 1-col responsive)            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│  │ HR & WF  │ │Attendance│ │  Leave   │ │ Payroll  │         │
│  │  👥 12   │ │  📅 18   │ │  🌿 9   │ │  💳 22  │         │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘         │
│  ↕ Clicking a category card expands an inline accordion below  │
└───────────────────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────────────────┐
│  EXPANDED CATEGORY (inline, animated slide-down)              │
│  Subcategory chips → Report list as horizontal pill buttons   │
└───────────────────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────────────────┐
│  REPORT RUNNER PANEL (slide-up animation)                     │
│  [Report name badge] [Category tag] [★ Fav] [Last run: 2m ago]│
│  ─────────────────────────────────────────────────────────── │
│  FILTER ROW: Branch ▾  Process ▾  Dept ▾  CC ▾  Month  [Run] │
│  ─────────────────────────────────────────────────────────── │
│  RESULTS TABLE (sticky header, alternating rows, sort icons)  │
│  [N rows chip]  [N columns chip]  [CSV ↓]  [XLSX ↓]          │
└───────────────────────────────────────────────────────────────┘
```

### 3.2 Visual Language

- **Cards:** `rounded-2xl`, `backdrop-blur-sm`, `bg-white/80`, `border border-white/60`, `shadow-lg hover:shadow-xl`, `transition-all duration-300`
- **Category gradient:** Each category has a unique gradient pair (e.g. HR = `from-blue-500 to-indigo-600`, Attendance = `from-violet-500 to-purple-600`, Payroll = `from-amber-500 to-orange-600`). Gradient used for icon bg + card top accent strip.
- **Hero bar:** `bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900` with a subtle dot-grid SVG background pattern
- **Animations:**
  - Category card hover: `hover:-translate-y-1 hover:shadow-xl` (CSS transition)
  - Category expand: `animate-accordion-down` (shadcn accordion primitive)
  - Report runner panel: `animate-slide-up` (custom keyframe: `translateY(40px)→0, opacity 0→1, 300ms ease-out`)
  - Run button: spinner + text morph `Run → Running… → ✓ Done`
  - Result rows: staggered fade-in (CSS `animation-delay: calc(var(--row-index) * 15ms)`)
  - Stats in hero: animated count-up on mount (vanilla JS requestAnimationFrame, no library)
- **Result table header:** per-column mini-sparkline for numeric columns (tiny SVG path from first 10 row values)
- **Typography:** `font-inter` (already loaded), hero title `text-4xl font-black tracking-tight`

### 3.3 Filter Row

All standard filter inputs rendered as shadcn `<Combobox>` (searchable) where options come from API. Layout:

```
[Branch ▾] [Process ▾] [Department ▾] [Cost Centre ▾] [Month] [Date From] [Date To] [Status ▾]  [Run ▶]
```

On mobile (< 768px): filters collapse behind a "Filters (N active) ▾" toggle button. Active filter count badge shown on the toggle.

### 3.4 Component Structure

**New file:** `src/pages/NativeReportsCenter.tsx` (full rewrite)

Internal sub-components (same file, not extracted to avoid over-engineering):
- `HeroBar` — sticky top bar with search, stats, recent chips
- `CategoryCard` — single gradient card with expand/collapse state
- `ReportList` — inline accordion content: subcategory chips + report pill buttons
- `RunnerPanel` — filter row + results table
- `FilterRow` — all filter inputs
- `ResultsTable` — sticky-header table with sparklines + export buttons

`src/hooks/useReportMasters.ts` — already exists, already fetches branches/departments/processes/cost-centres. No changes needed to this hook.

---

## 4. Files Modified

| File | Change |
|------|--------|
| `backend/src/modules/reporting/reporting.service.ts` | Add `EMP_CORE_COLS` + `EMP_CORE_JOINS` constants; rewrite all 38 query builders to use them |
| `backend/src/modules/reporting/report-suite.routes.ts` | Add `EMP_CORE_COLS`/`EMP_CORE_JOINS` inline to all suite cases; rewrite `attendance-summary` with UNION logic |
| `src/pages/NativeReportsCenter.tsx` | Full premium UI rewrite — no sidebar, category grid, slide-up runner |
| `src/hooks/useReportMasters.ts` | No changes needed |

No SQL migrations. No new backend routes. No new frontend routes.

---

## 5. Verification

1. Run `att_monthly` report — confirm `employee_code`, `employee_name`, `employment_status`, `designation_name`, `department`, `branch_name`, `process_name`, `cost_centre_name` all present in output.
2. Run `attendance-summary` for a month where an employee resigned mid-month — confirm they appear with `employment_status = 'resigned'` and correct partial day counts.
3. Run `attendance-summary` for an active employee who had zero attendance records — confirm they appear with 0s, not missing.
4. Run `payroll_register` — confirm all 8 mandatory columns present.
5. Open NativeReportsCenter — confirm no sidebar, category grid renders with gradients, click a category to expand, select a report, run it, confirm filter dropdowns are all populated (no "type ID" text boxes for branch/process/dept/cc).
6. On mobile viewport — confirm filters collapse behind toggle, table scrolls horizontally.
7. TypeScript `tsc --noEmit` passes on both frontend and backend.
