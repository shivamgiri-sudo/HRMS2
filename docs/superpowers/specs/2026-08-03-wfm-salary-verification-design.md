# WFM Salary Verification View — Design Spec
**Date:** 2026-08-03  
**Author:** Architecture session  
**Status:** Approved for implementation

---

## Context

After WFM completes all payroll prep steps (attendance data ready, freeze requested, deductions uploaded, overtime entered), they need one more critical capability before they can confidently sign off their process: **verifying that every employee's calculated salary is correct**.

This means WFM needs to:
1. See a full tabular breakdown of all employees in their process — days, earnings, deductions, net pay — in one scrollable table
2. Click on any employee or any value to drill into the full salary detail
3. Flag discrepancies to the Payroll Head (e.g., incentive not applied, wrong deduction)
4. Track flag resolution before final sign-off
5. Export the entire register to Excel/CSV for offline validation

This becomes **Step 6** in the Process Readiness stepper (before the existing sign-off step).

---

## Scope

| Deliverable | File |
|---|---|
| New page: `/payroll/process-salary-verify` | `src/pages/payroll/ProcessSalaryVerify.tsx` (new) |
| Employee detail side sheet | `src/components/payroll/EmployeeSalaryDetailSheet.tsx` (new) |
| Flag discrepancy dialog | `src/components/payroll/SalaryFlagDialog.tsx` (new) |
| Step 6 widget in process stepper | `src/pages/payroll/ProcessPayrollReadiness.tsx` (update) |
| Payroll Head flag queue panel | `src/pages/payroll/ProcessPayrollReadiness.tsx` (update — add to HO view) |
| Nav entry | `src/components/layout/navConfig.tsx` (update) |
| DB migration | `backend/sql/1057_salary_verification_flag.sql` (new) |
| New API routes | `backend/src/modules/payroll/salary-verification.routes.ts` (new) |
| Mount routes | `backend/src/app.ts` (update) |

---

## Database

### New table: `salary_verification_flag`

```sql
CREATE TABLE IF NOT EXISTS salary_verification_flag (
  id              VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  run_id          VARCHAR(36)  NOT NULL,          -- salary_prep_run.id (NULL if pre-run)
  run_month       VARCHAR(7)   NOT NULL,           -- YYYY-MM
  employee_id     VARCHAR(36)  NOT NULL,
  employee_code   VARCHAR(50),
  process_id      VARCHAR(36),
  branch_id       VARCHAR(36),
  category        ENUM('attendance','incentive','deduction','net_pay','other') NOT NULL,
  description     TEXT         NOT NULL,
  expected_value  DECIMAL(12,2),
  raised_by       VARCHAR(36)  NOT NULL,           -- user_id
  raised_at       DATETIME     NOT NULL DEFAULT NOW(),
  status          ENUM('open','resolved','rejected','acknowledged') NOT NULL DEFAULT 'open',
  resolved_by     VARCHAR(36),
  resolved_at     DATETIME,
  resolution_note TEXT,
  PRIMARY KEY (id),
  INDEX idx_run_process (run_month, process_id, status),
  INDEX idx_employee (employee_id, run_month)
);
```

### New column on `payroll_branch_readiness`

```sql
ALTER TABLE payroll_branch_readiness
  ADD COLUMN salary_verification_done TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN salary_verification_at   DATETIME,
  ADD COLUMN salary_verification_by   VARCHAR(36);
```

### New table: `salary_employee_verification`

Tracks per-employee verified status (separate from flags — WFM can mark an employee verified even without flagging).

```sql
CREATE TABLE IF NOT EXISTS salary_employee_verification (
  id           VARCHAR(36) NOT NULL DEFAULT (UUID()),
  run_month    VARCHAR(7)  NOT NULL,
  run_id       VARCHAR(36),
  employee_id  VARCHAR(36) NOT NULL,
  process_id   VARCHAR(36),
  verified_by  VARCHAR(36) NOT NULL,
  verified_at  DATETIME    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_emp_month (employee_id, run_month, process_id)
);
```

---

## Backend API

**Mount point:** `/api/payroll/salary-verification`

**File:** `backend/src/modules/payroll/salary-verification.routes.ts`

### Endpoints

#### `GET /employees`
Query: `?month=YYYY-MM&processId=&branchId=&runId=&status=all|verified|flagged|pending&search=`

Returns array of employee salary rows — one per employee. If a `salary_prep_run` exists for the month, reads from `salary_prep_line` + `salary_prep_line_component`. If no run, calls `computeRunningSalary` per employee (estimate mode).

Response shape per employee:
```json
{
  "employee_id": "...",
  "employee_code": "MAS58621",
  "full_name": "RINKY SHARMA",
  "designation_name": "Agent",
  "working_days": 26,
  "present_days": 22,
  "leave_days": 2,
  "lwp_days": 2,
  "late_marks": 3,
  "ot_hours": 18.5,
  "gross_salary": 30600,
  "incentive_total": 5200,
  "total_deductions": 8704,
  "net_salary": 21896,
  "is_estimate": false,
  "verification_status": "flagged",
  "flag_count": 1,
  "flag_category": "incentive"
}
```

Roles: `wfm`, `process_manager`, `branch_head`, `payroll_head`, `super_admin`, `payroll`

#### `GET /employee/:employeeId`
Query: `?month=&runId=`

Returns full salary detail: attendance breakdown + all earnings (from `salary_prep_line_component`) + all deductions (PF, ESIC, PT, TDS, LWP, loan EMI, custom deductions) + net pay + any open flags.

Response:
```json
{
  "employee": { "id": "...", "code": "...", "name": "...", "designation": "..." },
  "attendance": {
    "working_days": 26, "present_days": 22, "leave_days": 2,
    "lwp_days": 2, "late_marks": 3, "ot_hours": 18.5,
    "final_payable_days": 22, "paid_working_days": 24
  },
  "earnings": [
    { "code": "BASIC", "name": "Basic", "amount": 12000, "type": "earning" },
    { "code": "HRA", "name": "HRA", "amount": 4800, "type": "earning" },
    { "code": "SPECIAL", "name": "Special Allowance", "amount": 6200, "type": "earning" },
    { "code": "CONV", "name": "Conveyance", "amount": 1600, "type": "earning" },
    { "code": "INCENTIVE", "name": "Incentive", "amount": 5200, "source": "incentive_upload", "type": "earning" },
    { "code": "HWR", "name": "Holiday Work Extra", "amount": 800, "type": "earning" }
  ],
  "gross_salary": 30600,
  "deductions": [
    { "code": "LWP", "name": "LWP Deduction (2 days)", "amount": 2354 },
    { "code": "PF_EMP", "name": "PF (Employee 12%)", "amount": 1440 },
    { "code": "ESIC", "name": "ESIC (0.75%)", "amount": 230 },
    { "code": "PT", "name": "Professional Tax", "amount": 200 },
    { "code": "TDS", "name": "TDS", "amount": 980 },
    { "code": "LOAN", "name": "Loan EMI", "amount": 3000 },
    { "code": "CANTEEN", "name": "Custom Deduction (Canteen)", "amount": 500 }
  ],
  "total_deductions": 8704,
  "net_salary": 21896,
  "is_estimate": false,
  "flags": [{ "id": "...", "category": "incentive", "description": "...", "status": "open" }],
  "verification_status": "flagged"
}
```

#### `POST /flags`
Body: `{ runMonth, runId?, employeeId, processId, branchId, category, description, expectedValue? }`

Creates a flag + Work Inbox item for Payroll Head.
Roles: `wfm`, `process_manager`, `branch_head`

#### `PATCH /flags/:flagId`
Body: `{ status: 'resolved'|'rejected'|'acknowledged', resolutionNote }`
Roles: `payroll_head`, `super_admin`, `payroll`

#### `POST /verify-employee`
Body: `{ runMonth, runId?, employeeId, processId }`
Inserts row into `salary_employee_verification`.
Roles: `wfm`, `process_manager`, `branch_head`

#### `POST /verify-bulk`
Body: `{ runMonth, runId?, processId, branchId }` — verifies all non-flagged employees for the process.
Roles: `wfm`, `process_manager`, `branch_head`

#### `GET /summary`
Query: `?month=&processId=&runId=`
Returns: `{ total, verified, flagged, open_flags, pending, salary_verification_done }`

#### `GET /export`
Query: `?month=&processId=&branchId=&runId=&format=xlsx|csv`
Returns: Excel (xlsx) or CSV file. See export spec below.
Roles: `wfm`, `process_manager`, `branch_head`, `payroll_head`, `super_admin`

#### `GET /open-flags`
Query: `?month=&branchId=&processId=`
Returns all open/unresolved flags for Payroll Head's queue.
Roles: `payroll_head`, `super_admin`, `payroll`

---

## Frontend — Page: `ProcessSalaryVerify.tsx`

### Page header

```
┌──────────────────────────────────────────────────────────────────┐
│  💰  Process Salary Register         NOIDA-2 / Onfido            │
│      August 2026  ·  173 employees  ·  Gross ₹30,07,551          │
│                                                                    │
│  [Month ▾]  [Branch ▾]  [Process ▾]              [Export ▾]      │
│                                                                    │
│  ● All (173)   ○ Pending (3)   ○ Flagged (3)   ○ Verified (167)  │
│  [🔍 Search by name or code...]                                   │
└──────────────────────────────────────────────────────────────────┘
```

- **Summary bar** shows total employees, total gross, total net, flag count
- **Tabs**: All / Pending review / Flagged / Verified
- If no payroll run yet: amber banner "Showing salary estimates — payroll has not been run yet"
- If run exists: shows run date + status

### Main table

Full-width, `overflow-x-auto`, compact rows (h-10 per row). Every column value is **clickable** — clicking any cell on a row opens the Employee Salary Detail Sheet for that employee.

**Columns:**

| # | Column | Source | Width |
|---|--------|--------|-------|
| 1 | ☐ | checkbox | 40px |
| 2 | Employee | name + code | 180px |
| 3 | Designation | | 120px |
| 4 | Working Days | `working_days` | 80px |
| 5 | Present | `present_days` · green pill | 70px |
| 6 | Leave | `leave_days` · blue pill | 60px |
| 7 | LWP | `lwp_days` · red pill if > 0 | 60px |
| 8 | Late | `late_marks` · amber if > 0 | 60px |
| 9 | OT Hrs | `ot_hours` | 70px |
| 10 | Gross ₹ | `gross_salary` | 100px |
| 11 | Incentive ₹ | sum of incentive components | 100px |
| 12 | Deductions ₹ | `total_deductions` | 110px |
| 13 | Net Pay ₹ | `net_salary` · **bold** | 110px |
| 14 | Status | ✓ / 🚩 / ⏳ badge | 90px |
| 15 | Actions | [Flag] [Verify] or icon | 80px |

**Row colors:**
- Flagged: `bg-red-50/40`
- Verified: `bg-emerald-50/30`
- Pending: default white

**Bulk actions bar** (shown when rows selected):
```
[N selected]  [Mark All Verified]  [Export Selected]
```

**Column header tooltips** explain each field (e.g., LWP = Loss of Pay days).

**Pagination:** 50 rows per page with prev/next + page indicator. Total count shown.

**Sort:** Click any numeric column header to sort ascending/descending.

---

## Frontend — Employee Salary Detail Sheet

**Component:** `src/components/payroll/EmployeeSalaryDetailSheet.tsx`

Side sheet, 560px wide. Opens when any row or cell is clicked in the main table.

### Sheet layout

```
┌─ RINKY SHARMA  MAS58621 ──────────────────────────────────────┐
│  NOIDA / Onfido  ·  Agent  ·  August 2026          [× Close]  │
│                                                                 │
│  ┌─ ATTENDANCE ──────────────────────────────────────────────┐ │
│  │  Working  Present  Leave   LWP    Late   OT Hrs           │ │
│  │    26       22      2       2      3      18.5            │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ EARNINGS ────────────────────────────────────────────────┐ │
│  │  Basic                                        ₹12,000    │ │
│  │  HRA                                           ₹4,800    │ │
│  │  Special Allowance                             ₹6,200    │ │
│  │  Conveyance                                    ₹1,600    │ │
│  │  Incentive        [uploaded: ₹5,200]  ← source badge     │ │
│  │  Holiday Work Extra                              ₹800    │ │
│  │  ─────────────────────────────────────────────────────   │ │
│  │  GROSS                                        ₹30,600    │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ DEDUCTIONS ──────────────────────────────────────────────┐ │
│  │  LWP Deduction (2 days)                       -₹2,354    │ │
│  │  PF — Employee (12%)                          -₹1,440    │ │
│  │  ESIC (0.75%)                                   -₹230    │ │
│  │  Professional Tax                               -₹200    │ │
│  │  TDS                                            -₹980    │ │
│  │  Loan EMI                                     -₹3,000    │ │
│  │  Custom: Canteen                                -₹500    │ │
│  │  ─────────────────────────────────────────────────────   │ │
│  │  TOTAL DEDUCTIONS                              -₹8,704   │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ NET PAY ─────────────────────────────────────────────────┐ │
│  │  ₹21,896                          ✓ Estimate / Final      │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ OPEN FLAGS ──────────────────────────────────────────────┐ │
│  │  🚩 Incentive missing — uploaded ₹5,200, showing ₹0      │ │
│  │     Raised by Suresh Kumar · 1 Aug 10:22   [Open]         │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  [🚩 Flag a Discrepancy]          [✓ Mark this Employee OK]   │
└───────────────────────────────────────────────────────────────┘
```

**Source badges** on earning components:
- `salary_structure` → grey "Structure"
- `incentive_upload` → blue "Uploaded"
- `custom_input` → amber "Manual"
- `holiday_work` → green "Holiday OT"

**Flag Discrepancy Dialog** (inline inside sheet):
- Category dropdown: Attendance error / Incentive missing or wrong / Deduction wrong / Net pay incorrect / Other
- Description textarea (required)
- Expected value field (optional, numeric)
- [Submit Flag] → creates `salary_verification_flag` + Work Inbox item to Payroll Head

**Mark OK:** Sets `salary_employee_verification` row, status → ✓ Verified.

---

## Frontend — Export

**Button in page header:** `[Export ▾]` dropdown:
- Download Excel (.xlsx)
- Download CSV

**Excel format:**
- Sheet 1 "Register": full table — all 13 data columns + Status + Flag notes
- Sheet 2 "Summary": process totals — total gross, total net, headcount by status
- Sheet 3 "Flags": all open flags with employee, category, description, expected value

**CSV format:** flat — same as Sheet 1.

**Filename:** `salary-register-{PROCESS_NAME}-{MONTH}.xlsx`

**Library:** `xlsx` (already installed as a dependency).

---

## Frontend — Step 6 in Process Stepper

In `ProcessDetailDrawer` inside `ProcessPayrollReadiness.tsx`, add Step 6 between "Overtime Entered" (Step 4) and "Sign-Off" (Step 5, renumbered to Step 7).

```
Step 6 — Verify Employee Salaries
─────────────────────────────────
"Review each employee's salary breakdown in your process.
Flag any discrepancies to the Payroll Head before final
sign-off. All open flags must be resolved."

[Progress bar: 168/173 verified · 3 flagged · 2 pending]
[Flags: 3 open  •  0 resolved  •  0 rejected]

[Open Salary Register →]        ← links to /payroll/process-salary-verify?processId=...

Completion condition:
  ✓ All employees verified OR flagged
  ✓ No flags with status 'open' (all must be resolved/rejected/acknowledged)
```

When Step 6 is complete (all employees accounted for, no open flags):
- Shows green "Salary Register Verified" with timestamp
- Step 7 (Sign-Off) unlocks

---

## Frontend — Payroll Head Flag Queue (in HOGroupedView)

In `HOGroupedView` inside `ProcessPayrollReadiness.tsx`, add a new **"Salary Flags"** tab alongside the existing branch accordion view.

```
┌─ Salary Flags (3 open) ─────────────────────────────────┐
│  NOIDA-2 / Onfido · RINKY SHARMA (MAS58621)              │
│  Category: Incentive missing                             │
│  "Incentive uploaded ₹5,200 but showing ₹0"             │
│  Expected: ₹5,200   Raised by: Suresh K · 1 Aug 10:22   │
│  [Recalculate]  [Acknowledge — No Change]  [Reject]      │
├──────────────────────────────────────────────────────────┤
│  NOIDA / Vodafone · DEEPAK BARUAH (MAS62619)             │
│  Category: Attendance error                              │
│  "3 days shown LWP — all 3 were regularised on 29 Jul"   │
│  [Recalculate]  [Acknowledge — No Change]  [Reject]      │
└──────────────────────────────────────────────────────────┘
```

**[Recalculate]** → calls `POST /api/payroll/runs/:runId/recalculate-drift` for that employee, then closes the flag as `resolved`.

**[Acknowledge — No Change]** → sets flag status to `acknowledged` with a note, does not recalculate. WFM sees "Acknowledged — no change made."

**[Reject]** → sets status to `rejected` with a note. WFM sees "Flag rejected."

---

## Navigation

Add to `navConfig.tsx` under the Payroll group:

```ts
{ 
  label: "Salary Register", 
  href: "/payroll/process-salary-verify", 
  icon: ic(Table2), 
  roles: ["wfm","process_manager","branch_head","payroll_head","super_admin","payroll"],
  description: "Verify employee salary breakdowns before payroll sign-off"
}
```

---

## Role Access Matrix

| Action | WFM | Process Manager | Branch Head | Payroll Head | Super Admin |
|--------|-----|-----------------|-------------|--------------|-------------|
| View salary register | ✓ own process | ✓ own process | ✓ own branch | ✓ all | ✓ all |
| View employee detail | ✓ | ✓ | ✓ | ✓ | ✓ |
| Flag discrepancy | ✓ | ✓ | ✓ | ✗ | ✓ |
| Mark employee verified | ✓ | ✓ | ✓ | ✗ | ✓ |
| Resolve / reject flag | ✗ | ✗ | ✗ | ✓ | ✓ |
| Recalculate (after flag) | ✗ | ✗ | ✗ | ✓ | ✓ |
| Export register | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## Pre-run vs. Post-run behaviour

| State | Data source | Flag allowed | Export |
|-------|-------------|--------------|--------|
| No payroll run for month | `computeRunningSalary` per employee (estimate) | No (estimates only) | Yes (marked "Estimate") |
| Run exists (draft/processing) | `salary_prep_line` | Yes | Yes |
| Run locked/disbursed | `salary_prep_line` | No (read-only) | Yes |

---

## Verification

1. WFM opens `/payroll/process-salary-verify` — sees all 173 employees with salary columns
2. Clicks any row → Employee Salary Detail Sheet opens with full breakdown
3. Clicks "Flag a Discrepancy" → form appears, submits → Work Inbox item created for Payroll Head
4. Bulk "Mark All Unflagged Verified" → all non-flagged rows go green
5. Step 6 in Process Stepper shows progress: 170 verified, 3 flagged
6. Payroll Head opens flag queue → sees all open flags → clicks Recalculate or Acknowledge
7. After all flags resolved → Step 6 complete → Step 7 (Sign-Off) unlocks
8. Export → downloads Excel with 3 sheets
9. TypeScript: `npx tsc --noEmit` passes; `npm run build` succeeds
10. No existing payroll data or calculation logic is modified — all new read-only + flag layer