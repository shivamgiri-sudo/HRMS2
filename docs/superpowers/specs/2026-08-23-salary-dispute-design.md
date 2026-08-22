# Salary Dispute Module — Design Spec

**Date:** 2026-08-23  
**Status:** Approved  
**Project:** MAS PeopleOS / HRMS2

---

## Purpose

Allow employees to raise salary disputes when their payslip is incorrect. The dispute flows through a 4-stage approval chain (Reporting Manager → WFM + Payroll HR → Payroll Head). On final approval, the differential amount is automatically added as an ARREAR component in the next month's payroll run.

---

## Scope

Builds on the existing `attendance.dispute.routes.ts` pattern. New module: `salary-dispute`. Does not modify existing attendance dispute flow.

---

## Dispute Types

| Code | Label | Differential Calculation |
|---|---|---|
| `MISSING_OT` | Missing Overtime | Entered hours × (gross/working_days/8) × OT multiplier (1.5) |
| `INCORRECT_ATTENDANCE` | Wrong P/A/HD Status | (correct_weight − actual_weight) × (gross/working_days) per date |
| `REGULARIZATION_NOT_APPLIED` | Regularization Approved But Not in Payroll | 1 day × daily_rate per date (LWP reversed) |
| `LEAVE_NOT_ASSIGNED` | Leave Applied But Marked LWP | 1 day × daily_rate per date |
| `INCENTIVE_MISSING` | Incentive Not Credited | WFM enters exact amount |
| `WRONG_DEDUCTION` | Wrong Deduction Applied | WFM enters excess deduction amount |
| `WRONG_COMPONENT_AMOUNT` | Basic/HRA/Component Incorrect | Difference between correct and actual component value |
| `SHIFT_ALLOWANCE_MISSING` | Night/Special Shift Allowance Not Paid | Policy-defined allowance amount |
| `DOUBLE_DEDUCTION` | Same Deduction Taken Twice | Duplicate deduction amount (WFM enters) |
| `WRONG_LWP_COUNT` | Incorrect LWP Days | lwp_days_removed × daily_rate |
| `OTHER` | Other — specify | WFM manually enters amount with justification |

---

## Approval Flow

```
Employee raises dispute
  → status: pending_manager
  → Inbox: Reporting Manager notified

Stage 1 — Reporting Manager
  Approve → status: pending_wfm
    → Inbox: WFM + Payroll HR of employee's branch notified
  Reject  → status: rejected (terminal)

Stage 2 — WFM + Payroll HR (branch)
  Validate attendance/payroll data
  Enter corrective details + system auto-calculates differential
  Approve → status: pending_payroll_head
    → Inbox: Payroll Head notified with full case + differential
  Reject  → status: rejected (terminal)

Stage 3 — Payroll Head
  Reviews full case history, all remarks, differential amount
  Approve → status: approved
    → ARREAR component created in next month's salary_prep_line_component
    → Employee notified: dispute approved, arrear in [month]
  Reject  → status: rejected (terminal)
```

---

## Data Model

### Table: `salary_dispute`

| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | UUID |
| `employee_id` | CHAR(36) FK | → employees.id |
| `employee_code` | VARCHAR(50) | Denormalised for display |
| `run_month` | VARCHAR(7) | 'YYYY-MM' — month salary was wrong |
| `dispute_type` | ENUM | See dispute types above + 'OTHER' |
| `affected_dates` | JSON | Array of 'YYYY-MM-DD' strings |
| `description` | TEXT | Employee's explanation (min 20 chars) |
| `status` | ENUM | draft, pending_manager, pending_wfm, pending_payroll_head, approved, rejected, closed |
| `manager_id` | CHAR(36) | Reporting manager at time of raise |
| `manager_remarks` | TEXT | |
| `manager_reviewed_at` | DATETIME | |
| `manager_reviewed_by` | CHAR(36) | user_id |
| `wfm_corrective_json` | JSON | Corrective data entered by WFM (what was wrong, what is correct) |
| `differential_amount` | DECIMAL(10,2) | Auto-calculated or WFM-entered |
| `differential_basis` | TEXT | How differential was calculated |
| `wfm_remarks` | TEXT | |
| `wfm_reviewed_at` | DATETIME | |
| `wfm_reviewed_by` | CHAR(36) | user_id |
| `payroll_head_remarks` | TEXT | |
| `payroll_head_reviewed_at` | DATETIME | |
| `payroll_head_reviewed_by` | CHAR(36) | user_id |
| `arrear_run_month` | VARCHAR(7) | Month arrear was/will be paid |
| `arrear_line_id` | CHAR(36) | FK → salary_prep_line_component.id (nullable until paid) |
| `branch_id` | CHAR(36) | Employee's branch at time of raise |
| `process_id` | CHAR(36) | Employee's process at time of raise |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |

### Indexes
- `idx_employee` (employee_id)
- `idx_status` (status)
- `idx_run_month` (run_month)
- `idx_branch_status` (branch_id, status)

---

## Differential Calculation

Daily rate = `salary_prep_line.gross_salary / salary_prep_line.working_days` for the disputed `run_month`.

| Type | Formula |
|---|---|
| `WRONG_LWP_COUNT` | `days_removed × daily_rate` |
| `INCORRECT_ATTENDANCE` | `(correct_weight − actual_weight) × daily_rate` per affected date. Weights: present=1.0, half_day=0.5, absent=0.0 |
| `REGULARIZATION_NOT_APPLIED` | `1.0 × daily_rate` per affected date |
| `LEAVE_NOT_ASSIGNED` | `1.0 × daily_rate` per affected date |
| `MISSING_OT` | `claimed_ot_hours × (daily_rate / 8) × 1.5` |
| `SHIFT_ALLOWANCE_MISSING` | Looked up from `payroll_config_flags.shift_allowance_amount` |
| `INCENTIVE_MISSING`, `WRONG_DEDUCTION`, `DOUBLE_DEDUCTION`, `WRONG_COMPONENT_AMOUNT`, `OTHER` | WFM enters amount directly |

If `salary_prep_line` for `run_month` does not exist (employee not in that run), differential must be manually entered by WFM.

---

## API Routes

All under `/api/salary-disputes`

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/` | employee | Raise new dispute |
| GET | `/my` | employee | My disputes list |
| GET | `/:id` | scoped | Dispute detail |
| POST | `/:id/manager-review` | reporting_manager | Stage 1 approve/reject |
| POST | `/:id/wfm-review` | wfm, payroll_hr | Stage 2: enter corrective data + approve/reject |
| POST | `/:id/payroll-head-review` | payroll_head | Stage 3 approve/reject |
| GET | `/branch/:branchId` | wfm, payroll_hr, payroll_head | Branch dispute queue |
| GET | `/queue/manager` | manager | Manager's pending queue |
| GET | `/queue/payroll-head` | payroll_head | Payroll head queue |

---

## Arrear Application

On Payroll Head approval:
1. Find or wait for next `salary_prep_run` for employee's branch
2. Insert `salary_prep_line_component` row: `component_code='ARREAR'`, `amount=differential_amount`, `notes='Dispute #<id> approved'`
3. Update `salary_prep_line.gross_salary += differential_amount`, `net_salary += differential_amount`
4. Set `salary_dispute.arrear_run_month` and `arrear_line_id`
5. Send inbox notification to employee: "Your salary dispute for [month] has been approved. ₹[amount] will be paid in [next_month] payroll."

If next month's run doesn't exist yet, set `arrear_run_month` and apply when run is created.

---

## Work Inbox Notifications

| Event | Recipient | Type |
|---|---|---|
| Dispute raised | Reporting Manager | `SALARY_DISPUTE_MANAGER_PENDING` |
| Manager approved | WFM + Payroll HR (branch) | `SALARY_DISPUTE_WFM_PENDING` |
| WFM approved | Payroll Head | `SALARY_DISPUTE_PAYHEAD_PENDING` |
| Approved (any stage rejection) | Employee | `SALARY_DISPUTE_RESOLVED` |
| Arrear applied | Employee | `SALARY_DISPUTE_ARREAR_APPLIED` |

---

## UI Pages

### 1. Raise Dispute (Employee)
- **Location:** My Profile → Salary → Raise Dispute button on payslip
- **Header:** `bg-gradient-to-r from-red-600 to-rose-600` — Financial dispute = red
- **Step 1:** Select month (only past finalized months shown)
- **Step 2:** Select dispute type — card grid, each type with icon + short description
- **Step 3:** Select affected dates (multi-date picker from that month's calendar, color-coded P/A/HD)
- **Step 4:** Describe the issue (textarea, 20+ chars required)
- Submits → success toast → redirects to My Disputes

### 2. My Disputes (Employee)
- **Location:** My Profile → Salary → Disputes tab
- List of disputes with status badges (pending/approved/rejected)
- Click any → Detail view with 4-stage timeline (#120 Approval Workflow pattern)
- Timeline nodes: Submitted → Manager Review → WFM Review → Payroll Head
- Each completed node shows: reviewer name, date, remarks
- Approved disputes show: differential amount + arrear payment month

### 3. Manager Queue (Reporting Manager)
- Surfaces via Work Inbox (`SALARY_DISPUTE_MANAGER_PENDING`)
- Card shows: employee name/code, dispute type, affected month, dates, description
- Action: Approve (with remarks) / Reject (with mandatory reason)
- Mandatory remarks: min 10 chars

### 4. WFM + Payroll HR Review
- Surfaces via Work Inbox (`SALARY_DISPUTE_WFM_PENDING`)
- Shows: full dispute + manager remarks + employee's attendance data for affected dates (live from ADR)
- **Corrective Data Entry:** Shows actual vs what employee claims per date
- Auto-calculates differential when corrective data entered
- WFM can override differential if auto-calc isn't applicable
- Action: Approve (with remarks + confirmed differential) / Reject

### 5. Payroll Head Final Review
- Surfaces via Work Inbox (`SALARY_DISPUTE_PAYHEAD_PENDING`) + Payroll module dispute queue
- Full case file: employee, type, dates, all stage remarks, differential, corrective data
- Shows estimated arrear run month
- Action: Approve / Reject

---

## Design Consistency

- **Status colors:** pending_manager/pending_wfm/pending_payroll_head = amber, approved = green, rejected = red
- **Dispute type icons:** Use Lucide icons (Clock for OT, Calendar for attendance, CreditCard for deductions, etc.)
- **Differential display:** Always show as `+₹X,XXX.XX` in green
- **Stage timeline:** Pattern #120, nodes left-to-right on desktop, top-to-bottom on mobile

---

## Constraints

- Employee can raise max 1 open dispute per employee per run_month per dispute_type
- Dispute can only be raised for months where `salary_prep_run.status IN ('finalized','approved','draft')`
- Cannot raise dispute for a month where arrear has already been applied for the same type
- WFM cannot approve without entering differential_amount > 0 (except for `OTHER` with justification)
- Payroll Head approval is final — no further edits

---

## Out of Scope

- Salary rerun / recalculation for disputed month (too complex, handled by arrear model)
- Bulk dispute raises
- Dispute appeal after Payroll Head rejection
