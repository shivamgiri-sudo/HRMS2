# PeopleOS Payroll Module — Feature Gap Analysis

**Date:** 2026-07-13  
**Status:** Active reference  
**Rule:** Every feature below MUST be implemented within an existing page (add tab/card/section). Do NOT create new pages.

---

## Completed (This Session)

| # | Feature | Status | Where Built |
|---|---------|--------|-------------|
| C1 | All filters working (branch, dept, process, status) | Done | `/payroll` page — both Current and History tabs |
| C2 | Employee name/code search with server-side filtering | Done | `/payroll` page — search input wired to API `search` param |
| C3 | Dependent/cascading filters (branch → process reset) | Done | `/payroll` page — filter state resets on parent change |
| C4 | Salary trend per employee (chart + table) | Done | Payslip dialog + Analytics tab "Employee Salary Lens" |
| C5 | Branch/Process displayed in table and exports | Done | PayrollTable, CSV, PDF exports |
| C6 | Overtime process-level configuration | Done | `/payroll/overtime` page — OT Config panel + backend enforcement |
| C7 | Overtime route access fix (payroll_head, payroll) | Done | App.tsx ProtectedRoute roles expanded |
| C8 | Overtime rounding & minimum-hour config | Done | `/payroll/overtime` config panel — Min Hours + Rounding columns, backend enforcement in updateOvertime |

---

## Priority Gaps Remaining

### P1 — Salary Advance Request UI (Employee Self-Service)

**Current state:** Backend `POST /api/payroll/advances` exists. No employee-facing request form.  
**Target page:** `NativePayrollHOQueues` — add a 7th tab "Advance Requests" showing pending/approved/rejected advances. Employees see their own; HR/Finance see queue with approve/reject.  
**Roles:** Employee (request), HR/Finance/Payroll (approve/reject)  
**Priority:** High — frequently needed in BPO

### P2 — Employee CTC Self-View

**Current state:** Employee can see payslips but not their current CTC structure breakdown.  
**Target page:** `/payroll/payslips` (NativePayslipCenter) — add a "My CTC" card/section showing assigned salary structure components, basic + allowances + employer costs.  
**Roles:** Employee (own data only)  
**Priority:** Medium

### P3 — Finance Approval Surface (Disbursement Authorization)

**Current state:** Run transitions from `approved → locked → disbursed` but no dedicated finance sign-off UI.  
**Target page:** `/payroll` page — add a "Finance Queue" tab visible to `finance` role showing runs pending disbursement authorization.  
**Roles:** Finance  
**Priority:** High — required before payroll goes live

### P4 — Run Lifecycle Board (Visual Status)

**Current state:** Run status is shown as text badge. No visual pipeline/workflow view.  
**Target page:** `/payroll` Analytics tab — add a "Run Pipeline" card showing lifecycle stages (draft → calculating → reviewed → approved → locked → disbursed) with the current run highlighted.  
**Roles:** Payroll, Payroll Head, Super Admin  
**Priority:** Medium

### P5 — Increment Status Visibility

**Current state:** `NativeSalaryIncrement` page exists with full increment workflow. Employees cannot see their increment history or pending status.  
**Target page:** Employee profile or `/payroll/payslips` — add "Increment History" section showing past effective-date increments and any pending approval.  
**Roles:** Employee (own data), HR/Payroll (all)  
**Priority:** Low

### P6 — Payroll Reconciliation Summary

**Current state:** No month-over-month comparison of total payroll cost by branch/process.  
**Target page:** `/payroll` Analytics tab — add a "Reconciliation" card showing MoM total gross/net/deductions delta by branch, flagging anomalies (>10% swing).  
**Roles:** Payroll Head, Finance, Super Admin  
**Priority:** Medium

---

## Overtime Configuration Details (Implemented)

### Architecture

- **Config store:** `payroll_config_flags` table (existing) with process_id scope
- **Config keys:** `overtime_allowed`, `overtime_rate_multiplier`, `overtime_monthly_cap_hours`
- **Default:** Overtime disabled globally. Must be explicitly enabled per process.

### Backend Enforcement

1. `updateOvertime` service (payroll.service.ts) now checks:
   - Resolves employee's `process_id` from `salary_prep_line → employees`
   - Queries `payroll_config_flags` for that process's `overtime_allowed`
   - Rejects with 403 if not `'true'`
   - Enforces monthly cap hours if configured (400 error if exceeded)
   - Falls back to global default for employees without a process

2. API endpoints added (payroll-more.routes.ts):
   - `GET /api/payroll/overtime/config/processes` — lists all processes with OT status
   - `PATCH /api/payroll/overtime/config/process/:processId` — toggle/update OT settings

### Frontend

- OT Config panel added to existing `/payroll/overtime` page (collapsible)
- Shows process list with Switch toggle, rate multiplier input, cap hours input
- Real-time toggle with optimistic invalidation

---

## Design Rule

> "Why create a new page when we already have one for the same purpose?"

All payroll features MUST be housed within existing pages:

| Need | Existing Page | How to Add |
|------|--------------|------------|
| Advance requests | NativePayrollHOQueues | New tab |
| CTC self-view | NativePayslipCenter | New card |
| Finance approval | /payroll (Payroll.tsx) | New tab |
| Run pipeline | /payroll Analytics | New card |
| Increment history | NativePayslipCenter or employee profile | New section |
| Reconciliation | /payroll Analytics | New card |
| OT configuration | PayrollOvertimeManagement | Collapsible panel (done) |

Never create a standalone page for something that logically belongs as a view/tab within an existing surface.
