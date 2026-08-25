# Salary Date Sync — Design Spec
**Date:** 2026-08-25  
**Status:** Approved  
**Approach:** C — Hybrid (ATS-path direct edit + lightweight revision approval for live employees)

---

## Problem

When Payroll HR creates an offer for a candidate and sets a `salary_start_date`, that date is stored in `ats_payroll_hr_validation`. The Payroll Head review page (`/payroll/salary-review/:id`) never queries that table, so the Effective Date field falls back to the employee's `date_of_joining` — causing the wrong date to be pre-filled and potentially assigned.

Additionally, there is no process for Payroll HR to correct the salary date after the fact, nor a governed way to revise the effective date for employees who are already onboarded and salary-assigned.

---

## Scope

Three independent but related sub-features:

1. **Fix:** Pre-fill Effective Date from `salary_start_date` instead of DOJ
2. **Write-back:** Payroll Head date change → updates `ats_payroll_hr_validation.salary_start_date` + audit entry
3. **ATS inline edit:** Payroll HR can update `salary_start_date` for a candidate still in ATS flow
4. **Salary Date Revision:** Lightweight request/approval flow for existing employees

---

## Data Layer

### No schema changes needed for items 1–3
`ats_payroll_hr_validation.salary_start_date` already exists. Only query and write paths change.

### New table for item 4

```sql
CREATE TABLE employee_salary_date_revision_requests (
  id                       INT AUTO_INCREMENT PRIMARY KEY,
  employee_id              VARCHAR(50) NOT NULL,
  current_effective_from   DATE NOT NULL,
  requested_effective_from DATE NOT NULL,
  reason                   TEXT NOT NULL,
  status                   ENUM('pending','approved','rejected') DEFAULT 'pending',
  requested_by             INT NOT NULL,        -- auth_user.id of Payroll HR
  reviewed_by              INT NULL,            -- auth_user.id of Payroll Head
  reviewed_at              DATETIME NULL,
  review_remarks           TEXT NULL,
  created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_employee (employee_id),
  INDEX idx_status (status)
);
```

### Audit entries
All date changes write to `employee_payroll_head_review_history` with:
- `action`: `'salary_start_date_updated'` or `'salary_date_revision_approved'`
- `remarks`: JSON string `{ old_date, new_date, changed_by_role }`
- `created_by`: acting user id
- `employee_id`

---

## Backend API

### Module: `payroll-head-review`

#### 1. `getEmployeeJourney` — add `ats_payroll_hr_validation` query
- File: `backend/src/modules/payroll-head-review/payroll-head-review.service.ts`
- Add a parallel query alongside the existing `offeredSalaryRows` query:
  ```sql
  SELECT salary_start_date FROM ats_payroll_hr_validation
  WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1
  ```
- Return as `payroll_hr_validation: { salary_start_date }` in the journey response.

#### 2. `PATCH /:employeeId/salary-start-date` — new route
- Roles: `REVIEWER_ROLES` (payroll_head, admin, super_admin)
- Body: `{ salary_start_date: string (YYYY-MM-DD) }`
- Validates: date is not before employee's `date_of_joining`
- Writes: updates `ats_payroll_hr_validation.salary_start_date` for the candidate_id linked to this employee
- Audit: inserts row into `employee_payroll_head_review_history`
- Response: `{ success: true, salary_start_date }`

### Module: `salary-revision` (new, 2 files)

#### 3. `POST /api/salary-revision`
- Roles: `FIXER_ROLES` (payroll_hr, branch_head, hr, admin, super_admin)
- Body: `{ employee_id, requested_effective_from, reason }`
- Validates:
  - `requested_effective_from` cannot be before employee's `date_of_joining`
  - `reason` min 10 characters
  - No existing `pending` request for the same employee
- Inserts into `employee_salary_date_revision_requests`
- Response: `{ success: true, id }`

#### 4. `GET /api/salary-revision`
- Roles: `REVIEWER_ROLES`
- Query params: `status` (default: `pending`), `employee_id` (optional)
- Returns list of revision requests with employee name, branch, current effective date, requested date, reason, requested_by name

#### 5. `POST /api/salary-revision/:id/review`
- Roles: `REVIEWER_ROLES`
- Body: `{ action: 'approve' | 'reject', remarks?: string }`
- On `approve`:
  - Marks old `employee_salary_assignment` row `active_status = 0`
  - Inserts new `employee_salary_assignment` row with `effective_from = requested_effective_from`
  - Updates request `status = 'approved'`, sets `reviewed_by`, `reviewed_at`
  - Writes audit entry to `employee_payroll_head_review_history`
- On `reject`:
  - `remarks` is required
  - Updates request `status = 'rejected'`, stores `review_remarks`
  - Writes audit entry
- Response: `{ success: true }`

### ATS Payroll HR — no new endpoint
The existing `validateAndAssignSalary` service already upserts `salary_start_date`. The frontend just needs the field rendered as always-editable (not disabled) while candidate is in an editable ATS status.

---

## Frontend / UI

### Surface 1 — Payroll Head Review Page
**File:** `src/pages/payroll/PayrollHeadSalaryReviewDetail.tsx`  
**File:** `src/pages/payroll/PayrollHeadSalaryReviewQueue.tsx`

- Change the `useEffect` that initialises `effectiveDate` to prefer `journey?.payroll_hr_validation?.salary_start_date` over `date_of_joining`:
  ```ts
  useEffect(() => {
    if (effectiveDate) return;
    const preferred = journey?.payroll_hr_validation?.salary_start_date
                   ?? journey?.employee?.date_of_joining;
    if (!preferred) return;
    const d = new Date(preferred);
    if (!isNaN(d.getTime())) setEffectiveDate(d.toISOString().slice(0, 10));
  }, [journey]);
  ```
- On date field `onBlur`: fire `PATCH /:employeeId/salary-start-date` if date changed from original loaded value
- Show inline hint below date field: `"Payroll HR set: DD/MM/YYYY"` in `text-xs text-slate-400` when `payroll_hr_validation.salary_start_date` exists
- Show brief success notice `"Salary start date updated"` (green, auto-dismiss 3s) on successful write-back

**Design tokens:** Uses existing `Input` component + `rounded-xl`. Notice uses `text-emerald-600 text-xs`.

---

### Surface 2 — Payroll HR Validation Screen
**File:** `src/pages/NativePayrollHRValidation.tsx`

- Ensure `salary_start_date` input is rendered as editable (not disabled) whenever the candidate status allows editing
- Add `title` / tooltip: `"Date salary generation begins. Defaults to joining date if left blank."`
- No new API needed — saving the form already calls `validateAndAssignSalary` which upserts the value

---

### Surface 3 — Salary Date Revision

#### Request drawer (Payroll HR)
- Trigger: "Request Date Revision" button on employee profile or salary assignment section
- Component: right-side slide-over drawer, `max-w-lg`, full viewport height, scrollable
- Header: `bg-gradient-to-r from-blue-600 to-indigo-600 text-white`
  - Title: "Request Salary Date Revision"
  - Sub: employee name + current effective date badge
- Fields:
  - `New Effective Date` — date picker, required, min = employee DOJ
  - `Reason` — textarea, required, min 10 chars, placeholder: "Explain why the date needs to change"
- Submit: `POST /api/salary-revision`
- On success: drawer closes, toast: "Revision request submitted. Awaiting Payroll Head review."

#### Pending Revisions tab (Payroll Head)
- Location: added as a new tab `"Pending Revisions"` inside the existing Salary Review queue page (`/payroll/salary-review`)
- Tab shows badge count of `pending` requests
- Each card shows:
  - Employee name + branch (left)
  - Current date `→` Requested date (arrow, right)
  - Reason (collapsible if long)
  - `Approve` (blue) + `Reject` (red outline) buttons
- Reject opens an inline remarks input (required) before confirming
- Design: GlassCard (`rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm`)
- Gradient header for the tab content area: `bg-gradient-to-r from-blue-600 to-indigo-600`

---

## Validation Rules

| Rule | Where enforced |
|---|---|
| `salary_start_date` cannot be before `date_of_joining` | Backend (both PATCH and revision POST) |
| Reason min 10 characters | Backend + frontend |
| No duplicate pending request for same employee | Backend (POST /api/salary-revision) |
| Revision approval requires active salary assignment to exist | Backend |
| Rejection requires remarks | Backend + frontend |

---

## Audit Trail

Every date change produces an `employee_payroll_head_review_history` row:

| Event | action value | remarks |
|---|---|---|
| Payroll Head changes date on review page | `salary_start_date_updated` | `{ old_date, new_date }` |
| Revision request approved | `salary_date_revision_approved` | `{ old_date, new_date, request_id }` |
| Revision request rejected | `salary_date_revision_rejected` | `{ requested_date, remarks }` |

---

## Files Affected

| File | Change type |
|---|---|
| `backend/src/modules/payroll-head-review/payroll-head-review.service.ts` | Add `ats_payroll_hr_validation` query; add `updateSalaryStartDate()` function |
| `backend/src/modules/payroll-head-review/payroll-head-review.routes.ts` | Add `PATCH /:employeeId/salary-start-date` route |
| `backend/src/modules/salary-revision/salary-revision.service.ts` | New file |
| `backend/src/modules/salary-revision/salary-revision.routes.ts` | New file |
| `backend/src/index.ts` | Mount `/api/salary-revision` router |
| `backend/sql/` | New migration file for `employee_salary_date_revision_requests` |
| `src/pages/payroll/PayrollHeadSalaryReviewDetail.tsx` | Fix effective date default + write-back on blur |
| `src/pages/payroll/PayrollHeadSalaryReviewQueue.tsx` | Fix effective date default + write-back on blur |
| `src/pages/NativePayrollHRValidation.tsx` | Ensure `salary_start_date` field is editable |
| `src/pages/payroll/SalaryRevisionDrawer.tsx` | New component |
| `src/pages/payroll/SalaryReviewQueue.tsx` or equivalent queue page | Add "Pending Revisions" tab |

---

## Out of Scope

- Payroll recalculation on revision approval (handled by existing payroll run, not this feature)
- Notification emails/SMS on revision approval/rejection (can be added later via existing notification hooks)
- Bulk revision requests
