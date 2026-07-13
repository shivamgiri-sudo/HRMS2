# Salary Advance Request + Finance Approval Surface Design

> **Goal:** Enable employee self-service advance requests and provide Finance team with a dedicated approval surface before payroll runs move to `disbursed` status.

> **Architecture:** Advance Request tab integrated into `NativePayrollHOQueues` (existing HR queues page). Finance Approval tab added to main `/payroll` dashboard. Both use existing backend APIs; Finance sign-off endpoint is new.

> **Tech Stack:** React 18 + TypeScript, shadcn/Radix UI, TanStack Query v5 for caching. Backend: Express, MySQL `salary_advance_log` table, new `POST /api/payroll/runs/:id/finance-approve` endpoint.

---

## Feature 1: Salary Advance Request UI

### Current State
- Backend API exists: `POST /api/payroll/advances` (create), `GET /api/payroll/advances` (list)
- `salary_advance_log` table: `id, employee_id, amount, recovery_months, recovered_amount, status, created_at, approved_by, approved_at, paid_out_at`
- No frontend form or approval queue

### What Changes

#### Employee Self-Service View (in `NativePayrollHOQueues` new tab "Advance Requests")
- **Request Button** → Modal dialog:
  - Amount input (validation: positive, ≤ 3 months of basic salary as safety limit)
  - Purpose dropdown (Personal, Medical, Emergency, Educational, Other)
  - Recovery Months selector (1–12 months, default 3)
  - Submit button
  - On success: toast, dialog closes, request appears in table with status `pending`
- **My Requests Table:**
  - Columns: Requested Date, Amount, Purpose, Recovery Months, Status (pending/approved/rejected/recovered), Actions (View Details)
  - Status badge color: `pending` = yellow, `approved` = blue, `rejected` = red, `recovered` = green
  - Filter by status dropdown

#### HR/Finance Approval Queue (same tab, role-gated)
- **Roles:** `payroll_head`, `finance`, `admin`
- **Requests Table:**
  - Columns: Employee Code, Name, Requested Date, Amount, Purpose, Recovery Months, Status, Remaining Balance (if approved), Actions
  - Each row has **Approve** (green) and **Reject** (red) buttons
  - **Approve button** → modal:
    - Confirmation message (employee name, amount, recovery months)
    - Optional remarks field
    - Submit button calls `PATCH /api/payroll/advances/:id/approve`
    - On success: row status updates to `approved`, buttons disable, toast shown
  - **Reject button** → confirmation dialog:
    - Reason field (required)
    - Calls `PATCH /api/payroll/advances/:id/reject`
    - Row updates to `rejected`
  - **Batch approve/reject** (nice-to-have): checkbox select multiple + bulk action buttons

### APIs Used (Existing)
- `GET /api/payroll/advances` — list all (with optional filters: `employee_id`, `status`)
- `POST /api/payroll/advances` — create request (body: `amount`, `purpose`, `recovery_months`)
- `PATCH /api/payroll/advances/:id/approve` — approve (body: `remarks` optional)
- `PATCH /api/payroll/advances/:id/reject` — reject (body: `reason` required)

### Files to Modify
| File | Change |
|------|--------|
| `src/pages/NativePayrollHOQueues.tsx` | Add "Advance Requests" tab with employee form + HR/Finance approval queue |

### Security & Validation
- Employee form restricted to `employee` role via `requireRole` middleware
- Approval queue restricted to `payroll_head`, `finance`, `admin`
- Server-side validation: amount > 0, recovery_months ∈ [1,12], employee ownership verified on read
- Audit log: every approval/rejection logged via `logSensitiveAction`

### Testing
- Employee can request advance; request appears in own queue with `pending` status
- HR can approve; status updates to `approved`, row disables
- HR can reject with reason; status updates to `rejected`
- Non-HR cannot access approval queue (403 enforced)
- Cross-employee request rejected (server-side check)

---

## Feature 2: Finance Approval Surface

### Current State
- Disbursal data stored in `salary_run_disbursal` (cheque_no, payment_mode, payment_date, bank_ref)
- Run status: `draft` → `calculating` → `reviewed` → `approved` → `locked` → `disbursed`
- No dedicated finance sign-off UI; runs transition directly from `locked` to `disbursed`

### What Changes

#### New Tab in `/payroll` Dashboard ("Finance Queue")
- **Visibility:** `finance` role only (gated via `requireRole`)
- **Content:**
  - Subtitle: "Runs ready for disbursement authorization"
  - Table showing all runs in `locked` status:
    - Columns: Run Month, Total Employees, Total Gross (₹), Payment Methods (NEFT/Cheque/Other counts), Last Updated, Actions
    - Run month formatted as `Jul 2026`
    - Payment methods as badge row: `NEFT: 45 | Cheque: 12 | IMPS: 3 | Cash: 2`
  - If no runs in `locked` status: "No runs pending finance approval"
  - **Action Column:** "Review & Approve" button (blue) + "View Details" link

#### Approval Workflow
- **Review & Approve button** → modal:
  - Run summary: month, total employees, total gross, net, total deductions
  - Disbursal summary (read-only table): first 5 rows of employees with payment mode + bank ref, "Show all" link
  - Confirmation checkbox: "I have verified all disbursement details"
  - Approve button (enabled only when checkbox checked)
  - Cancel button
- **On Approve:**
  - Calls `POST /api/payroll/runs/:id/finance-approve` (new endpoint)
  - Backend verifies run is in `locked` status; if not, returns 400
  - Backend updates `salary_prep_run.status = 'disbursed'` + `finance_approved_by = user_id`, `finance_approved_at = NOW()`
  - Frontend: toast "Run approved and marked for disbursement", modal closes, row removed from table
  - Query invalidated; table refreshes

#### Quick-View Summary (optional card above table)
- Shows aggregate stats: `Runs pending: X | Total employees: Y | Total amount: ₹Z`

### APIs Used
- `GET /api/payroll/runs?status=locked` — fetch runs in locked status
- `POST /api/payroll/runs/:id/finance-approve` — (new) approve run for disbursement
- `GET /api/payroll/runs/:id/disbursal` — fetch disbursal details for a run

### New Backend Endpoint
```typescript
// POST /api/payroll/runs/:id/finance-approve
// Roles: finance, admin
// Body: {} (empty, or optional remarks field for audit)
// Response: { success: true, run_id, status: "disbursed" }
// Error: 400 if run not in "locked" status; 403 if unauthorized
```

### Files to Modify/Create
| File | Change |
|------|--------|
| `src/pages/Payroll.tsx` | Add "Finance Queue" tab in dashboard (or as new card in existing Analytics section) |
| `backend/src/modules/payroll/payroll.routes.ts` | Add `POST /api/payroll/runs/:id/finance-approve` endpoint |

### Security & Validation
- Endpoint restricted to `finance`, `admin` roles via `requireRole`
- Run status checked before update (only `locked` runs can be approved)
- Audit logged: `logSensitiveAction({ action_type: 'FINANCE_APPROVAL', entity_type: 'salary_prep_run', entity_id: runId, ... })`
- No cross-tenant data leakage (assume single tenant; multi-tenant scope would filter by org_id)

### Testing
- Finance user sees all runs in `locked` status
- Non-finance cannot see Finance Queue tab (403)
- Approve button disabled until confirmation checkbox checked
- On approve: status updates to `disbursed`, row vanishes from table, toast shows
- Approving already-disbursed run returns 400 with clear message
- Audit log entry created with user_id and timestamp

---

## Database Impact
- No schema changes (tables already exist)
- New audit log rows on every advance approval/rejection and run finance approval

## API Impact
- `POST /api/payroll/runs/:id/finance-approve` (new endpoint)
- All existing advance request endpoints already live

## Frontend Impact
- One new tab in `NativePayrollHOQueues`: "Advance Requests"
- One new tab or card in `/payroll` dashboard: "Finance Queue"

## Roles Impacted
- **Employee:** Can request advances (new self-service)
- **Payroll Head / HR / Finance / Admin:** Can approve/reject advances
- **Finance:** Can approve runs for disbursement (new gated access)

## Success Criteria
1. Employee creates advance request; appears in own queue with `pending` badge
2. HR approves; status updates to `approved`, next payroll run deducts monthly installment
3. Advance fully recovered; status flips to `recovered` (backend auto-closes, see Disbursal PR)
4. Finance sees only `locked` runs in Finance Queue tab
5. Finance approves run; status updates to `disbursed`, audit logged
6. Build passes; no TypeScript errors; all role gates enforced
