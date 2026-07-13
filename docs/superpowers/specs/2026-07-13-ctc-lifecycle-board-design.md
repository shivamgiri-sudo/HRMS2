# Employee CTC Self-View + Run Lifecycle Board Design

> **Goal:** Provide employee transparency into salary structure and give payroll team operational visibility into run pipeline status.

> **Architecture:** CTC view as self-contained card in `/payroll/payslips` (NativePayslipCenter). Lifecycle Board as new card in `/payroll` dashboard analytics area. Both read-only, no writes.

> **Tech Stack:** React 18 + TypeScript, shadcn/Radix UI. Backend: read-only queries from `salary_structure` or `salary_package` tables.

---

## Feature 1: Employee CTC Self-View

### Current State
- Employees can view payslips but cannot see their assigned salary structure breakdown
- `salary_package` or `salary_structure` table exists with basic/HRA/allowances per employee
- No dedicated frontend card

### What Changes

#### New Card in `/payroll/payslips` ("My Salary Structure")
- **Visibility:** All employees (self-service read-only)
- **Location:** Added to `NativePayslipCenter.tsx` dashboard — appears alongside "My Payslips" or in a tabbed interface
- **Content:**
  - Heading: "My Salary Structure"
  - Subtext: "Annual CTC breakdown (effective as of [effective_date])"
  - Table (2 columns: Component, Amount & %):
    - **Earnings Section:**
      - Basic Salary: ₹X (40% of CTC, for example)
      - HRA: ₹Y (20%)
      - Conveyance Allowance: ₹Z (5%)
      - Medical Allowance: ₹A (2%)
      - Personal Allowance: ₹B (3%)
      - Special Allowance: ₹C (10%)
      - **Subtotal: ₹Total Earnings**
    - **Employer Contribution Section:**
      - PF Employer: ₹D (12%)
      - ESI Employer: ₹E (3.25%)
      - Gratuity Reserve: ₹F (1.67%)
      - **Subtotal: ₹Total Employer**
    - **Total Annual CTC: ₹(Earnings + Employer)**
  - Monthly equivalent: ₹(CTC / 12) at bottom
  - Effective date: "Effective from [date]" footer
  - If no structure assigned: "No salary structure assigned. Contact HR."

#### Data Source
- Query employee's current `salary_structure` or `salary_package` record (whichever is source of truth)
- Fallback to `employees.basic_pct`, `employees.hra_pct` if no dedicated structure table
- Filter by `effective_from <= TODAY AND (effective_to IS NULL OR effective_to >= TODAY)` to get active structure

### APIs Used (Existing or New)
- **Option A (if service exists):** `GET /api/payroll/salary-structure/:employeeId` — returns active structure
- **Option B (if new):** Fetch from `/api/payroll/payslip/my` endpoint and extract structure data
- **Option C (simplest):** Query `employees` table directly — basic_pct, hra_pct, etc. already stored

### Files to Modify
| File | Change |
|------|--------|
| `src/pages/NativePayslipCenter.tsx` | Add "My Salary Structure" card/section; fetch employee's active salary structure on mount |

### Security & Validation
- Employee can only see own structure (server-side check: `getEmployeeForUser(userId)` filters to own record)
- Read-only view — no edit capability in this phase
- If employee has no salary structure, show helpful message instead of error

### Testing
- Employee navigates to `/payroll/payslips` and sees "My Salary Structure" card
- Structure displays all components with percentages calculated correctly
- Monthly CTC = Annual CTC / 12 (rounded to 2 decimals)
- Non-employee roles see same view with their own structure (if applicable)
- If no structure: error message displayed gracefully

### Success Criteria
- Card renders without errors
- All salary components visible and percentages sum to ~100%
- Monthly equivalent calculated correctly
- Employee cannot see other employees' structures

---

## Feature 2: Run Lifecycle Board

### Current State
- Run status displayed as text badge in main payroll page
- No visual representation of pipeline stages or where each run is in the workflow
- Difficult for payroll team to understand stage distribution at a glance

### What Changes

#### New Card in `/payroll` Dashboard Analytics ("Run Pipeline")
- **Visibility:** `payroll`, `payroll_head`, `admin` roles (gated via `requireRole`)
- **Location:** Added to `/payroll` dashboard — either as new card in Analytics section or adjacent to Finance Queue
- **Layout:** Horizontal flow diagram showing 7 stages
  - Visual pipeline: `draft` → `calculating` → `reviewed` → `approved` → `locked` → `finance-approved` → `disbursed`
  - Each stage as a box with:
    - Stage name (lowercase, bold)
    - Count badge (e.g., "3 runs")
    - Color: gray (no runs) | blue (current) | green (completed/passed through)
  - Connecting arrows between stages
  - Example: `draft [0] → calculating [0] → reviewed [1] → approved [1] → locked [3] → finance-approved [0] → disbursed [5]`

#### Data Source
- Query `salary_prep_run` table: group by status, count
- Aggregate: `SELECT status, COUNT(*) as count FROM salary_prep_run GROUP BY status`
- Filter by current fiscal year or last 12 months (parameterized, default to current year)

#### Interactive Elements (Optional Enhancements)
- Click on a stage box → show list of runs in that status (modal or side panel)
- Run list shows: Run Month, Employee Count, Total Gross
- Hovering over a stage shows tooltip: "3 runs locked, pending review"

#### Summary Card Above Pipeline
- Quick stats: "Active Runs: X | In Progress: Y | Completed This Month: Z"

### APIs Used
- `GET /api/payroll/runs?status=draft` (repeat for each status) OR
- New endpoint: `GET /api/payroll/runs/pipeline-summary` → returns `{ draft: 0, calculating: 2, reviewed: 1, ... }`

### Files to Modify/Create
| File | Change |
|------|--------|
| `src/pages/Payroll.tsx` | Add "Run Pipeline" card in Analytics area or new dedicated section |
| `backend/src/modules/payroll/payroll.routes.ts` (optional) | Add `GET /api/payroll/runs/pipeline-summary` endpoint if aggregation needed |

### Backend Implementation (Optional New Endpoint)
```typescript
// GET /api/payroll/runs/pipeline-summary
// Roles: payroll, payroll_head, admin
// Query params: ?year=2026 (optional, defaults to current year)
// Response:
// {
//   draft: 0,
//   calculating: 2,
//   reviewed: 1,
//   approved: 3,
//   locked: 2,
//   finance_approved: 0,
//   disbursed: 5
// }
```

### Security & Validation
- Endpoint restricted to `payroll`, `payroll_head`, `admin` via `requireRole`
- No sensitive data exposed (only counts and status)
- If multi-tenant: filter by `org_id`

### Testing
- Payroll user sees Run Pipeline card with correct counts
- Non-payroll user cannot access (403)
- Counts refresh when new run created / status updated
- Pipeline stages in correct order
- Clicking a stage shows runs in that status (if interactive feature added)

### Success Criteria
1. Pipeline visually displays all 7 stages horizontally
2. Each stage shows count of runs in that status
3. Colors reflect stage completion (gray → blue → green progression)
4. Counts update in real-time when runs transition
5. Role-gating enforced (payroll_head, admin only)
6. Build passes; no TypeScript errors

---

## Database Impact
- No schema changes (all tables exist)
- Read-only queries only

## API Impact
- `GET /api/payroll/runs/pipeline-summary` (new, optional; can use existing `GET /api/payroll/runs?status=X` instead)

## Frontend Impact
- One new card in `NativePayslipCenter`: "My Salary Structure"
- One new card in `/payroll` dashboard: "Run Pipeline"

## Roles Impacted
- **Employee:** Can view own CTC structure (new transparency)
- **Payroll / Payroll Head / Admin:** Can see Run Pipeline overview (new operational view)

## Success Criteria
1. Employee CTC card displays all salary components with correct calculations
2. Run Pipeline shows correct counts per stage
3. Both features read-only, no write capability
4. All role gates enforced
5. Build passes; tests pass
