# Salary Date Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the salary effective date pre-fill on the Payroll Head review page, add write-back with audit trail, and provide a governed revision flow for existing employees.

**Architecture:** Four independent tasks — DB migration, backend service changes (payroll-head-review module + new salary-revision module), and two frontend surfaces (review page fix, revision drawer + queue tab). Tasks 1–3 can be done before the frontend. Each task is independently testable and committable.

**Tech Stack:** Express + TypeScript (backend), React 18 + Tailwind + shadcn/ui (frontend), MySQL `mas_hrms`

## Global Constraints

- All SQL is additive (no DROP, no ALTER on existing columns)
- Migration file numbered `440_` (current last is `439_asset_movement_log.sql`)
- Backend: `requireAuth` + `requireRole` on every new route
- Roles: `REVIEWER_ROLES = ["payroll_head","admin","super_admin"]`, `FIXER_ROLES = ["payroll_hr","branch_head","hr","admin","super_admin"]`
- Frontend: `rounded-xl` inputs, `rounded-2xl` cards, Inter font, MAS PeopleOS frozen palette
- No `git add -A` — stage only files explicitly listed per task
- Run `npm run build` and `cd backend && npx tsc --noEmit` before every commit

---

## File Map

| File | Action |
|---|---|
| `backend/sql/440_salary_date_revision_requests.sql` | Create |
| `backend/src/modules/payroll-head-review/payroll-head-review.service.ts` | Modify — add `ats_payroll_hr_validation` query in `getEmployeeJourney`; add `updateSalaryStartDate()` |
| `backend/src/modules/payroll-head-review/payroll-head-review.routes.ts` | Modify — add `PATCH /:employeeId/salary-start-date` |
| `backend/src/modules/salary-revision/salary-revision.service.ts` | Create |
| `backend/src/modules/salary-revision/salary-revision.routes.ts` | Create |
| `backend/src/app.ts` | Modify — mount `/api/salary-revision` router |
| `src/pages/payroll/PayrollHeadSalaryReviewDetail.tsx` | Modify — fix effective date default + write-back on blur |
| `src/pages/payroll/PayrollHeadSalaryReviewQueue.tsx` | Modify — fix effective date default + add "Pending Revisions" tab |
| `src/pages/payroll/SalaryRevisionDrawer.tsx` | Create — request drawer for Payroll HR |
| `src/pages/NativeJoiningControlRoom.tsx` | Modify — add tooltip to `salary_start_date` field |

---

## Task 1: DB Migration

**Files:**
- Create: `backend/sql/440_salary_date_revision_requests.sql`

**Interfaces:**
- Produces: table `employee_salary_date_revision_requests` used by Task 3

- [ ] **Step 1: Create the migration file**

```sql
-- backend/sql/440_salary_date_revision_requests.sql
CREATE TABLE IF NOT EXISTS employee_salary_date_revision_requests (
  id                       INT AUTO_INCREMENT PRIMARY KEY,
  employee_id              VARCHAR(50) NOT NULL,
  current_effective_from   DATE NOT NULL,
  requested_effective_from DATE NOT NULL,
  reason                   TEXT NOT NULL,
  status                   ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  requested_by             INT NOT NULL,
  reviewed_by              INT NULL,
  reviewed_at              DATETIME NULL,
  review_remarks           TEXT NULL,
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_esdrr_employee (employee_id),
  INDEX idx_esdrr_status (status)
);
```

- [ ] **Step 2: Apply migration against local `mas_hrms`**

```bash
mysql -u root -p mas_hrms < backend/sql/440_salary_date_revision_requests.sql
```
Expected: no errors. Verify:
```bash
mysql -u root -p mas_hrms -e "DESCRIBE employee_salary_date_revision_requests;"
```

- [ ] **Step 3: Commit**

```bash
git add backend/sql/440_salary_date_revision_requests.sql
git commit -m "feat: add employee_salary_date_revision_requests migration"
```

---

## Task 2: Backend — payroll-head-review module

**Files:**
- Modify: `backend/src/modules/payroll-head-review/payroll-head-review.service.ts`
- Modify: `backend/src/modules/payroll-head-review/payroll-head-review.routes.ts`

**Interfaces:**
- Consumes: `ats_payroll_hr_validation.salary_start_date` (via `review.candidate_id`)
- Produces:
  - `getEmployeeJourney()` now returns `payroll_hr_validation: { salary_start_date: string | null } | null`
  - `updateSalaryStartDate(employeeId: string, newDate: string, actorUserId: number): Promise<void>`
  - `PATCH /api/payroll-head-review/:employeeId/salary-start-date` → `{ success: true, salary_start_date: string }`

- [ ] **Step 1: Add `ats_payroll_hr_validation` query to `getEmployeeJourney`**

In `payroll-head-review.service.ts`, find the `Promise.all` block in `getEmployeeJourney` (around line 142). Add a new parallel query as the last element:

```ts
// After the offeredSalaryRows query, add:
review.candidate_id ? db.execute<RowDataPacket[]>(
  `SELECT salary_start_date FROM ats_payroll_hr_validation
    WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1`,
  [review.candidate_id]
).then(([r]) => r as RowDataPacket[]).catch(() => []) : Promise.resolve([]),
```

Add `payrollHrValidationRows` to the destructured array:
```ts
const [
  employeeRows,
  bgv,
  bankReport,
  documents,
  kitRows,
  checklistRows,
  salaryAssignmentRows,
  componentRows,
  history,
  offeredSalaryRows,
  payrollHrValidationRows,   // ← new
] = await Promise.all([...]);
```

Add to the return object (after `offered_salary`):
```ts
payroll_hr_validation: payrollHrValidationRows[0]
  ? { salary_start_date: (payrollHrValidationRows[0].salary_start_date as string) || null }
  : null,
```

- [ ] **Step 2: Add `updateSalaryStartDate` function**

Add after the `getEmployeeJourney` function (around line 244):

```ts
export async function updateSalaryStartDate(
  employeeId: string,
  newDate: string,
  actorUserId: number
): Promise<{ salary_start_date: string }> {
  // Fetch candidate_id and date_of_joining via the review row
  const review = await getReviewRow(employeeId);
  if (!review) throw httpError("No payroll-head review record for this employee.", 404, "NOT_FOUND");

  if (!review.candidate_id) {
    throw httpError("No candidate linked to this employee — cannot update salary start date.", 400, "NO_CANDIDATE");
  }

  // Validate: new date must not be before date_of_joining
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT date_of_joining FROM employees WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  const doj = empRows[0]?.date_of_joining as string | null;
  if (doj && new Date(newDate) < new Date(doj)) {
    throw httpError("Salary start date cannot be before date of joining.", 400, "INVALID_DATE");
  }

  // Fetch old value for audit
  const [oldRows] = await db.execute<RowDataPacket[]>(
    `SELECT salary_start_date FROM ats_payroll_hr_validation WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1`,
    [review.candidate_id]
  );
  const oldDate = (oldRows[0]?.salary_start_date as string) || null;

  // Update
  await db.execute(
    `UPDATE ats_payroll_hr_validation SET salary_start_date = ? WHERE candidate_id = ?`,
    [newDate, review.candidate_id]
  );

  // Audit
  await writeHistory({
    employeeId,
    reviewId: review.id as string,
    action: "salary_start_date_updated",
    actorUserId,
    rejectionRemarks: JSON.stringify({ old_date: oldDate, new_date: newDate }),
  });

  return { salary_start_date: newDate };
}
```

- [ ] **Step 3: Add PATCH route**

In `payroll-head-review.routes.ts`, add before the closing `export`:

```ts
router.patch("/:employeeId/salary-start-date", requireAuth, requireWriteAccess, requireRole(...REVIEWER_ROLES), h(async (req, res) => {
  const { salary_start_date } = req.body as Record<string, unknown>;
  if (!salary_start_date || typeof salary_start_date !== "string") {
    return res.status(400).json({ success: false, message: "salary_start_date (YYYY-MM-DD) is required." });
  }
  const data = await svc.updateSalaryStartDate(req.params.employeeId, salary_start_date, req.authUser!.id);
  res.json({ success: true, data });
}));
```

- [ ] **Step 4: TypeScript check**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
```
Expected: 0 errors.

- [ ] **Step 5: Manual API test** (requires a running dev server and a valid JWT)

```bash
curl -s -X GET \
  -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/payroll-head-review/<employeeId> | jq '.data.payroll_hr_validation'
```
Expected: `{ "salary_start_date": "YYYY-MM-DD" }` (or `null` if no ATS record).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/payroll-head-review/payroll-head-review.service.ts \
        backend/src/modules/payroll-head-review/payroll-head-review.routes.ts
git commit -m "feat: expose salary_start_date in journey API and add write-back PATCH route"
```

---

## Task 3: Backend — salary-revision module

**Files:**
- Create: `backend/src/modules/salary-revision/salary-revision.service.ts`
- Create: `backend/src/modules/salary-revision/salary-revision.routes.ts`
- Modify: `backend/src/app.ts` (add import + mount)

**Interfaces:**
- Consumes: `employee_salary_date_revision_requests` (Task 1), `employee_salary_assignment`, `employees`
- Produces:
  - `POST /api/salary-revision` → `{ success: true, id: number }`
  - `GET /api/salary-revision?status=pending&employee_id=` → `{ success: true, data: RevisionRequest[] }`
  - `POST /api/salary-revision/:id/review` → `{ success: true }`

- [ ] **Step 1: Create `salary-revision.service.ts`**

```ts
// backend/src/modules/salary-revision/salary-revision.service.ts
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

function httpError(msg: string, status: number, code: string) {
  const e = new Error(msg) as Error & { status: number; code: string };
  e.status = status; e.code = code; return e;
}

export interface CreateRevisionInput {
  employee_id: string;
  requested_effective_from: string; // YYYY-MM-DD
  reason: string;
  requested_by: number; // auth_user.id
}

export async function createRevisionRequest(input: CreateRevisionInput): Promise<{ id: number }> {
  if (!input.reason || input.reason.trim().length < 10) {
    throw httpError("Reason must be at least 10 characters.", 400, "REASON_TOO_SHORT");
  }

  // Check employee exists and get DOJ + current effective_from
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT date_of_joining FROM employees WHERE id = ? LIMIT 1`,
    [input.employee_id]
  );
  if (!empRows.length) throw httpError("Employee not found.", 404, "NOT_FOUND");
  const doj = empRows[0].date_of_joining as string;
  if (new Date(input.requested_effective_from) < new Date(doj)) {
    throw httpError("Requested date cannot be before date of joining.", 400, "INVALID_DATE");
  }

  // Get current active salary assignment
  const [assignRows] = await db.execute<RowDataPacket[]>(
    `SELECT effective_from FROM employee_salary_assignment WHERE employee_id = ? AND active_status = 1 ORDER BY effective_from DESC LIMIT 1`,
    [input.employee_id]
  );
  if (!assignRows.length) throw httpError("No active salary assignment found for this employee.", 404, "NO_ASSIGNMENT");
  const currentEffectiveFrom = assignRows[0].effective_from as string;

  // Block duplicate pending request
  const [dupeRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employee_salary_date_revision_requests WHERE employee_id = ? AND status = 'pending' LIMIT 1`,
    [input.employee_id]
  );
  if (dupeRows.length) throw httpError("A pending revision request already exists for this employee.", 409, "DUPLICATE_REQUEST");

  const [result] = await db.execute(
    `INSERT INTO employee_salary_date_revision_requests
       (employee_id, current_effective_from, requested_effective_from, reason, requested_by)
     VALUES (?, ?, ?, ?, ?)`,
    [input.employee_id, currentEffectiveFrom, input.requested_effective_from, input.reason.trim(), input.requested_by]
  ) as any;

  return { id: result.insertId as number };
}

export async function listRevisionRequests(filters: { status?: string; employee_id?: string }) {
  const status = filters.status || "pending";
  const conds = ["r.status = ?"];
  const params: unknown[] = [status];
  if (filters.employee_id) { conds.push("r.employee_id = ?"); params.push(filters.employee_id); }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT r.id, r.employee_id, r.current_effective_from, r.requested_effective_from,
            r.reason, r.status, r.review_remarks, r.created_at, r.reviewed_at,
            e.full_name, e.employee_code,
            b.branch_name,
            COALESCE(au.email, '') AS requested_by_email
       FROM employee_salary_date_revision_requests r
       JOIN employees e ON e.id = r.employee_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN auth_user au ON au.id = r.requested_by
      WHERE ${conds.join(" AND ")}
      ORDER BY r.created_at DESC`,
    params
  );
  return rows as RowDataPacket[];
}

export async function reviewRevisionRequest(
  id: number,
  action: "approve" | "reject",
  reviewedBy: number,
  remarks?: string
): Promise<void> {
  if (action === "reject" && (!remarks || remarks.trim().length === 0)) {
    throw httpError("Remarks are required when rejecting.", 400, "REMARKS_REQUIRED");
  }

  const [reqRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM employee_salary_date_revision_requests WHERE id = ? LIMIT 1`,
    [id]
  );
  const req = reqRows[0];
  if (!req) throw httpError("Revision request not found.", 404, "NOT_FOUND");
  if (req.status !== "pending") throw httpError("Request is no longer pending.", 409, "NOT_PENDING");

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    if (action === "approve") {
      // Deactivate current assignment
      await connection.execute(
        `UPDATE employee_salary_assignment SET active_status = 0 WHERE employee_id = ? AND active_status = 1`,
        [req.employee_id]
      );

      // Get the last active assignment's structure to copy it with new effective_from
      const [assignRows] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM employee_salary_assignment WHERE employee_id = ? ORDER BY effective_from DESC LIMIT 1`,
        [req.employee_id]
      );
      if (!assignRows.length) {
        await connection.rollback();
        throw httpError("No salary assignment found to revise.", 404, "NO_ASSIGNMENT");
      }
      const old = assignRows[0];

      // Insert new assignment with revised date
      await connection.execute(
        `INSERT INTO employee_salary_assignment
           (employee_id, structure_id, basic_salary, gross_salary, ctc_annual, effective_from, active_status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          req.employee_id,
          old.structure_id,
          old.basic_salary,
          old.gross_salary,
          old.ctc_annual,
          req.requested_effective_from,
          reviewedBy,
        ]
      );

      // Audit entry (reuse employee_payroll_head_review_history if review row exists, else skip gracefully)
      await connection.execute(
        `INSERT INTO employee_payroll_head_review_history
           (id, employee_id, review_id, action, actor_user_id, rejection_remarks, notified_employee)
         SELECT UUID(), ?, r.review_id, 'salary_date_revision_approved',
                ?, ?, 0
           FROM employee_payroll_head_review r WHERE r.employee_id = ? LIMIT 1`,
        [
          req.employee_id,
          reviewedBy,
          JSON.stringify({ old_date: req.current_effective_from, new_date: req.requested_effective_from, request_id: id }),
          req.employee_id,
        ]
      ).catch(() => {}); // non-fatal if no review row
    } else {
      // Audit rejection
      await connection.execute(
        `INSERT INTO employee_payroll_head_review_history
           (id, employee_id, review_id, action, actor_user_id, rejection_remarks, notified_employee)
         SELECT UUID(), ?, r.review_id, 'salary_date_revision_rejected',
                ?, ?, 0
           FROM employee_payroll_head_review r WHERE r.employee_id = ? LIMIT 1`,
        [
          req.employee_id,
          reviewedBy,
          JSON.stringify({ requested_date: req.requested_effective_from, remarks }),
          req.employee_id,
        ]
      ).catch(() => {});
    }

    // Update request status
    await connection.execute(
      `UPDATE employee_salary_date_revision_requests
          SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_remarks = ?
        WHERE id = ?`,
      [action === "approve" ? "approved" : "rejected", reviewedBy, remarks ?? null, id]
    );

    await connection.commit();
  } catch (e) {
    await connection.rollback();
    throw e;
  } finally {
    connection.release();
  }
}
```

- [ ] **Step 2: Create `salary-revision.routes.ts`**

```ts
// backend/src/modules/salary-revision/salary-revision.routes.ts
import { Router, type NextFunction, type Response } from "express";
import { requireAuth, requireWriteAccess, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./salary-revision.service.js";

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

const REVIEWER_ROLES = ["payroll_head", "admin", "super_admin"] as const;
const FIXER_ROLES    = ["payroll_hr", "branch_head", "hr", "admin", "super_admin"] as const;

router.post("/", requireAuth, requireWriteAccess, requireRole(...FIXER_ROLES), h(async (req, res) => {
  const { employee_id, requested_effective_from, reason } = req.body as Record<string, unknown>;
  if (!employee_id || !requested_effective_from || !reason) {
    return res.status(400).json({ success: false, message: "employee_id, requested_effective_from, and reason are required." });
  }
  const data = await svc.createRevisionRequest({
    employee_id: String(employee_id),
    requested_effective_from: String(requested_effective_from),
    reason: String(reason),
    requested_by: req.authUser!.id,
  });
  res.json({ success: true, data });
}));

router.get("/", requireAuth, requireRole(...REVIEWER_ROLES), h(async (req, res) => {
  const data = await svc.listRevisionRequests({
    status: typeof req.query.status === "string" ? req.query.status : undefined,
    employee_id: typeof req.query.employee_id === "string" ? req.query.employee_id : undefined,
  });
  res.json({ success: true, data });
}));

router.post("/:id/review", requireAuth, requireWriteAccess, requireRole(...REVIEWER_ROLES), h(async (req, res) => {
  const { action, remarks } = req.body as Record<string, unknown>;
  if (action !== "approve" && action !== "reject") {
    return res.status(400).json({ success: false, message: "action must be 'approve' or 'reject'." });
  }
  await svc.reviewRevisionRequest(
    Number(req.params.id),
    action as "approve" | "reject",
    req.authUser!.id,
    typeof remarks === "string" ? remarks : undefined
  );
  res.json({ success: true });
}));

export const salaryRevisionRouter = router;
```

- [ ] **Step 3: Mount router in `app.ts`**

Find the import block near the `payrollHeadReviewRouter` import (around line 225 in `app.ts`) and add:

```ts
import { salaryRevisionRouter } from "./modules/salary-revision/salary-revision.routes.js";
```

Find the mount near line 673 and add after it:

```ts
app.use("/api/salary-revision", salaryRevisionRouter);
```

- [ ] **Step 4: TypeScript check**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
```
Expected: 0 errors.

- [ ] **Step 5: Smoke-test the endpoints** (requires running server + valid JWT with FIXER_ROLES)

```bash
# Create revision request
curl -s -X POST http://localhost:3000/api/salary-revision \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"employee_id":"<id>","requested_effective_from":"2026-09-01","reason":"Correction due to payroll policy change"}' | jq .
# Expected: { "success": true, "data": { "id": <number> } }

# List pending
curl -s "http://localhost:3000/api/salary-revision?status=pending" \
  -H "Authorization: Bearer <reviewer-token>" | jq '.data | length'
# Expected: >= 1
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/salary-revision/salary-revision.service.ts \
        backend/src/modules/salary-revision/salary-revision.routes.ts \
        backend/src/app.ts
git commit -m "feat: add salary-revision module with create/list/review endpoints"
```

---

## Task 4: Frontend — Review page effective date fix + write-back

**Files:**
- Modify: `src/pages/payroll/PayrollHeadSalaryReviewDetail.tsx`
- Modify: `src/pages/payroll/PayrollHeadSalaryReviewQueue.tsx`

**Interfaces:**
- Consumes: `journey.payroll_hr_validation.salary_start_date` (from Task 2)
- Consumes: `PATCH /api/payroll-head-review/:employeeId/salary-start-date` (from Task 2)

- [ ] **Step 1: Fix effective date `useEffect` in `PayrollHeadSalaryReviewDetail.tsx`**

Find lines 160–164 (the `useEffect` that initialises `effectiveDate`) and replace:

```ts
// OLD:
useEffect(() => {
  if (!journey?.employee?.date_of_joining || effectiveDate) return;
  const d = new Date(journey.employee.date_of_joining);
  if (!isNaN(d.getTime())) setEffectiveDate(d.toISOString().slice(0, 10));
}, [journey]);

// NEW:
const [loadedSalaryStartDate, setLoadedSalaryStartDate] = useState<string>('');

useEffect(() => {
  if (effectiveDate) return;
  const preferred = journey?.payroll_hr_validation?.salary_start_date
                 ?? journey?.employee?.date_of_joining;
  if (!preferred) return;
  const d = new Date(preferred);
  if (!isNaN(d.getTime())) {
    const iso = d.toISOString().slice(0, 10);
    setEffectiveDate(iso);
    setLoadedSalaryStartDate(journey?.payroll_hr_validation?.salary_start_date
      ? iso : '');
  }
}, [journey]);
```

- [ ] **Step 2: Add write-back on blur + hint text**

Find the `<Input type="date"` element bound to `effectiveDate` in `PayrollHeadSalaryReviewDetail.tsx`. Replace or wrap it:

```tsx
{/* find the existing date Input and replace with this: */}
<div className="flex flex-col gap-1">
  <Input
    type="date"
    value={effectiveDate}
    onChange={(e) => setEffectiveDate(e.target.value)}
    onBlur={async (e) => {
      const newDate = e.target.value;
      if (!newDate || newDate === loadedSalaryStartDate) return;
      try {
        await hrmsApi.patch(`/api/payroll-head-review/${employeeId}/salary-start-date`, {
          salary_start_date: newDate,
        });
        setLoadedSalaryStartDate(newDate);
        setNotice('Salary start date updated.');
        setTimeout(() => setNotice(null), 3000);
      } catch {
        setError('Failed to update salary start date.');
      }
    }}
    className="w-[160px] rounded-xl"
  />
  {journey?.payroll_hr_validation?.salary_start_date && (
    <p className="text-xs text-slate-400">
      Payroll HR set:{' '}
      {new Date(journey.payroll_hr_validation.salary_start_date)
        .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
    </p>
  )}
</div>
```

- [ ] **Step 3: Apply identical changes to `PayrollHeadSalaryReviewQueue.tsx`**

Same two changes (fix `useEffect` + add write-back onBlur + hint text) in `PayrollHeadSalaryReviewQueue.tsx`. The state variable and handler follow the same pattern — add `loadedSalaryStartDate` state and update both the `useEffect` and the date `Input`.

- [ ] **Step 4: Frontend build check**

```bash
npm run build 2>&1 | tail -10
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/payroll/PayrollHeadSalaryReviewDetail.tsx \
        src/pages/payroll/PayrollHeadSalaryReviewQueue.tsx
git commit -m "fix: pre-fill effective date from salary_start_date and write back on change"
```

---

## Task 5: Frontend — NativeJoiningControlRoom tooltip

**Files:**
- Modify: `src/pages/NativeJoiningControlRoom.tsx` (line ~500)

**Interfaces:**
- No API changes. Pure UI hint.

- [ ] **Step 1: Add tooltip to the `salary_start_date` field**

Find line ~500 where `salary_start_date` is rendered:
```tsx
<TextInput form={dateForm} setForm={setDateForm} name="salary_start_date" type="date" />
```

Wrap it with a label + tooltip:
```tsx
<div className="flex flex-col gap-1">
  <Label htmlFor="salary_start_date" className="text-xs font-medium text-slate-600">
    Salary Start Date
  </Label>
  <TextInput
    form={dateForm}
    setForm={setDateForm}
    name="salary_start_date"
    type="date"
  />
  <p className="text-[11px] text-slate-400">
    Date salary generation begins. Defaults to joining date if left blank.
  </p>
</div>
```

Note: `Label` is already imported in this file (check imports; if missing, add `import { Label } from "@/components/ui/label"`).

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | tail -5
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/NativeJoiningControlRoom.tsx
git commit -m "ux: add tooltip to salary_start_date field in JCR"
```

---

## Task 6: Frontend — SalaryRevisionDrawer + Pending Revisions tab

**Files:**
- Create: `src/pages/payroll/SalaryRevisionDrawer.tsx`
- Modify: `src/pages/payroll/PayrollHeadSalaryReviewQueue.tsx`

**Interfaces:**
- Consumes: `POST /api/salary-revision` (Task 3)
- Consumes: `GET /api/salary-revision?status=pending` (Task 3)
- Consumes: `POST /api/salary-revision/:id/review` (Task 3)
- Props for `SalaryRevisionDrawer`: `{ open: boolean; onClose: () => void; employeeId: string; employeeName: string; currentEffectiveFrom: string; dateOfJoining: string; onSuccess: () => void }`

- [ ] **Step 1: Create `SalaryRevisionDrawer.tsx`**

```tsx
// src/pages/payroll/SalaryRevisionDrawer.tsx
import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { hrmsApi } from '@/lib/hrmsApi';
import { useToast } from '@/hooks/use-toast';
import { CalendarDays } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  employeeId: string;
  employeeName: string;
  currentEffectiveFrom: string;
  dateOfJoining: string;
  onSuccess: () => void;
}

export function SalaryRevisionDrawer({
  open, onClose, employeeId, employeeName, currentEffectiveFrom, dateOfJoining, onSuccess,
}: Props) {
  const { toast } = useToast();
  const [newDate, setNewDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fmtDate = (d: string) =>
    d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const handleSubmit = async () => {
    setError(null);
    if (!newDate) { setError('New effective date is required.'); return; }
    if (reason.trim().length < 10) { setError('Reason must be at least 10 characters.'); return; }
    setBusy(true);
    try {
      await hrmsApi.post('/api/salary-revision', {
        employee_id: employeeId,
        requested_effective_from: newDate,
        reason: reason.trim(),
      });
      toast({ title: 'Revision request submitted', description: 'Awaiting Payroll Head review.' });
      setNewDate(''); setReason('');
      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to submit request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="max-w-lg w-full flex flex-col p-0 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-5">
          <SheetHeader>
            <SheetTitle className="text-white text-base font-semibold">Request Salary Date Revision</SheetTitle>
          </SheetHeader>
          <p className="text-blue-100 text-sm mt-1">{employeeName}</p>
          <div className="mt-2 inline-flex items-center gap-1.5 bg-white/20 rounded-lg px-3 py-1 text-sm">
            <CalendarDays className="h-3.5 w-3.5" />
            Current effective: {fmtDate(currentEffectiveFrom)}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              New Effective Date <span className="text-red-500">*</span>
            </Label>
            <Input
              type="date"
              value={newDate}
              min={dateOfJoining}
              onChange={(e) => setNewDate(e.target.value)}
              className="rounded-xl"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Reason <span className="text-red-500">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why the date needs to change (min 10 characters)"
              rows={4}
              className="rounded-xl resize-none"
            />
            <p className="text-[11px] text-slate-400">{reason.trim().length}/10 minimum</p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t p-4 flex gap-3">
          <Button variant="outline" onClick={onClose} disabled={busy} className="flex-1 rounded-xl">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={busy} className="flex-1 bg-blue-600 hover:bg-blue-700 rounded-xl">
            {busy ? 'Submitting…' : 'Submit Request'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Add "Pending Revisions" tab to `PayrollHeadSalaryReviewQueue.tsx`**

Find the `Tabs` component near the top of the queue page. The file already imports `Tabs`, `TabsList`, `TabsTrigger`. Add:

**A. Add import at the top of the file:**
```ts
import { TabsContent } from '@/components/ui/tabs';
import { ArrowRight, CheckCircle2 as CheckIcon, XCircle as RejectIcon } from 'lucide-react';
```
(Check existing imports — only add what is missing.)

**B. Add a `RevisionRequest` interface after the existing `QueueRow` interface:**
```ts
interface RevisionRequest {
  id: number;
  employee_id: string;
  full_name: string;
  employee_code: string;
  branch_name: string | null;
  current_effective_from: string;
  requested_effective_from: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}
```

**C. Add state for revisions near the existing state declarations:**
```ts
const [revisions, setRevisions]         = useState<RevisionRequest[]>([]);
const [rejectingId, setRejectingId]     = useState<number | null>(null);
const [rejectRemarks, setRejectRemarks] = useState('');
const [revBusy, setRevBusy]             = useState(false);
const [pendingCount, setPendingCount]   = useState(0);
```

**D. Add a `loadRevisions` function near the existing `load` function:**
```ts
const loadRevisions = useCallback(async () => {
  try {
    const r = await hrmsApi.get<{ success: boolean; data: RevisionRequest[] }>(
      '/api/salary-revision?status=pending'
    );
    const data = (r as any)?.data ?? [];
    setRevisions(data);
    setPendingCount(data.length);
  } catch { /* non-fatal */ }
}, []);

useEffect(() => { void loadRevisions(); }, [loadRevisions]);
```

**E. Add `reviewRevision` handler:**
```ts
const reviewRevision = async (id: number, action: 'approve' | 'reject', remarks?: string) => {
  setRevBusy(true);
  try {
    await hrmsApi.post(`/api/salary-revision/${id}/review`, { action, remarks });
    setRejectingId(null); setRejectRemarks('');
    void loadRevisions();
  } catch (e: any) {
    setError(e?.message ?? 'Action failed.');
  } finally { setRevBusy(false); }
};
```

**F. Add the tab trigger to the existing `TabsList`** (find the `<TabsList>` and add):
```tsx
<TabsTrigger value="revisions" className="relative">
  Pending Revisions
  {pendingCount > 0 && (
    <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold">
      {pendingCount}
    </span>
  )}
</TabsTrigger>
```

**G. Add the `TabsContent` for revisions** (add before the closing `</Tabs>` tag):
```tsx
<TabsContent value="revisions">
  <div className="space-y-3 mt-3">
    {revisions.length === 0 && (
      <p className="text-sm text-slate-500 text-center py-8">No pending revision requests.</p>
    )}
    {revisions.map((r) => (
      <div key={r.id} className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-slate-800 text-sm">{r.full_name}</p>
            <p className="text-xs text-slate-500">{r.employee_code} · {r.branch_name ?? '—'}</p>
          </div>
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700 shrink-0">
            <span className="text-slate-500">{new Date(r.current_effective_from).toLocaleDateString('en-IN')}</span>
            <ArrowRight className="h-3.5 w-3.5 text-blue-500" />
            <span className="text-blue-700 font-semibold">{new Date(r.requested_effective_from).toLocaleDateString('en-IN')}</span>
          </div>
        </div>
        <p className="text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2 line-clamp-3">{r.reason}</p>

        {rejectingId === r.id ? (
          <div className="space-y-2">
            <Textarea
              value={rejectRemarks}
              onChange={(e) => setRejectRemarks(e.target.value)}
              placeholder="Rejection reason (required)"
              rows={2}
              className="rounded-xl resize-none text-sm"
            />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setRejectingId(null); setRejectRemarks(''); }} className="rounded-xl flex-1">
                Cancel
              </Button>
              <Button size="sm" disabled={revBusy || !rejectRemarks.trim()} onClick={() => reviewRevision(r.id, 'reject', rejectRemarks)}
                className="rounded-xl flex-1 bg-red-600 hover:bg-red-700 text-white">
                Confirm Reject
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" disabled={revBusy} onClick={() => reviewRevision(r.id, 'approve')}
              className="rounded-xl flex-1 bg-blue-600 hover:bg-blue-700 text-white">
              Approve
            </Button>
            <Button size="sm" variant="outline" disabled={revBusy} onClick={() => setRejectingId(r.id)}
              className="rounded-xl flex-1 border-red-200 text-red-600 hover:bg-red-50">
              Reject
            </Button>
          </div>
        )}
      </div>
    ))}
  </div>
</TabsContent>
```

- [ ] **Step 3: Frontend build check**

```bash
npm run build 2>&1 | tail -10
```
Expected: 0 errors.

- [ ] **Step 4: Backend TypeScript check**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -10
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/payroll/SalaryRevisionDrawer.tsx \
        src/pages/payroll/PayrollHeadSalaryReviewQueue.tsx
git commit -m "feat: add salary date revision drawer and pending revisions tab"
```

---

## Self-Review Checklist

- [x] **Spec coverage:**
  - Fix (pre-fill from `salary_start_date`) → Task 2 + Task 4 ✓
  - Write-back (Payroll Head change → `ats_payroll_hr_validation` + audit) → Task 2 + Task 4 ✓
  - ATS inline edit (Payroll HR edits date pre-approval) → Task 5 (tooltip; no new endpoint needed) ✓
  - Salary Date Revision flow (request → approve/reject) → Task 1 + Task 3 + Task 6 ✓
  - Audit trail for all date changes → Task 2 (`writeHistory`) + Task 3 (`employee_payroll_head_review_history` insert) ✓
  - Validation rules (date before DOJ, reason min 10, no duplicate pending) → Task 3 service ✓
  - "Pending Revisions" tab with badge count → Task 6 ✓
  - GlassCard + blue gradient design → Task 6 ✓

- [x] **No placeholders:** All steps contain actual code, exact file paths, and exact commands.

- [x] **Type consistency:**
  - `payroll_hr_validation.salary_start_date` used in Task 2 return, Task 4 consumption ✓
  - `RevisionRequest.id` is `number` in Task 6 interface; `reviewRevision(id: number, ...)` in Task 6 handler ✓
  - `salary-revision` service exports match route imports ✓
