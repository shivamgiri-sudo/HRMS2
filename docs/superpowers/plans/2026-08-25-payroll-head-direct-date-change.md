# Payroll Head Direct Salary Date Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the Payroll Head to directly update an existing employee's salary assignment effective date from the review page, with a confirmation dialog, bypassing the Payroll HR revision request flow.

**Architecture:** Two tasks — backend adds a new `PATCH /:employeeId/assignment-effective-date` endpoint that updates `employee_salary_assignment.effective_from` (distinct from the existing `salary-start-date` endpoint which targets `ats_payroll_hr_validation`); frontend makes the blur handler context-aware: no active assignment → existing ATS path, active assignment exists → confirmation dialog → new endpoint.

**Tech Stack:** Express + TypeScript (backend), React 18 + Tailwind + shadcn/ui (frontend), MySQL `mas_hrms`

## Global Constraints

- `REVIEWER_ROLES = ["payroll_head","admin","super_admin"]` — only these roles reach this endpoint
- `requireAuth + requireWriteAccess + requireRole` on every mutating route
- All salary assignment mutations wrapped in a transaction
- `effective_to` must be stamped on the deactivated row: `DATE_SUB(new_date, INTERVAL 1 DAY)`
- Audit entry written to `employee_payroll_head_review_history` on every change
- Date format validated: `/^\d{4}-\d{2}-\d{2}$/` + `Date.parse`
- New date must not be before employee's `date_of_joining`
- No `git add -A` — stage only listed files per task
- `npm run build` and `cd backend && npx tsc --noEmit` must pass (0 errors) before every commit

---

## File Map

| File | Action |
|---|---|
| `backend/src/modules/payroll-head-review/payroll-head-review.service.ts` | Add `updateAssignmentEffectiveDate()` |
| `backend/src/modules/payroll-head-review/payroll-head-review.routes.ts` | Add `PATCH /:employeeId/assignment-effective-date` |
| `src/pages/payroll/PayrollHeadSalaryReviewDetail.tsx` | Context-aware blur + confirmation dialog |
| `src/pages/payroll/PayrollHeadSalaryReviewQueue.tsx` | Same context-aware blur in Queue sub-components |

---

## Task 1: Backend — `updateAssignmentEffectiveDate` + route

**Files:**
- Modify: `backend/src/modules/payroll-head-review/payroll-head-review.service.ts`
- Modify: `backend/src/modules/payroll-head-review/payroll-head-review.routes.ts`

**Interfaces:**
- Produces:
  - `updateAssignmentEffectiveDate(employeeId: string, newDate: string, actorUserId: string, reason: string): Promise<{ effective_from: string }>`
  - `PATCH /api/payroll-head-review/:employeeId/assignment-effective-date` body: `{ effective_date: string, reason: string }` → `{ success: true, data: { effective_from: string } }`

- [ ] **Step 1: Add `updateAssignmentEffectiveDate` to `payroll-head-review.service.ts`**

Add this function after `updateSalaryStartDate` (around line 373). Note: `db`, `httpError`, `writeHistory`, `getReviewRow`, `RowDataPacket` are all already in scope in this file.

```ts
export async function updateAssignmentEffectiveDate(
  employeeId: string,
  newDate: string,
  actorUserId: string,
  reason: string
): Promise<{ effective_from: string }> {
  if (!reason || reason.trim().length < 5) {
    throw httpError("Reason is required (min 5 characters).", 400, "REASON_REQUIRED");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || isNaN(Date.parse(newDate))) {
    throw httpError("effective_date must be a valid YYYY-MM-DD date.", 400, "INVALID_DATE");
  }

  const review = await getReviewRow(employeeId);
  if (!review) throw httpError("No payroll-head review record for this employee.", 404, "NOT_FOUND");

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT date_of_joining FROM employees WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  const doj = empRows[0]?.date_of_joining as string | null;
  if (doj && new Date(newDate) < new Date(doj)) {
    throw httpError("Effective date cannot be before date of joining.", 400, "INVALID_DATE");
  }

  const [assignRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, effective_from FROM employee_salary_assignment
      WHERE employee_id = ? AND active_status = 1
      ORDER BY effective_from DESC LIMIT 1`,
    [employeeId]
  );
  if (!assignRows.length) {
    throw httpError("No active salary assignment found. Use the ATS salary-start-date path instead.", 404, "NO_ASSIGNMENT");
  }
  const oldDate = assignRows[0].effective_from as string;
  const assignmentId = assignRows[0].id as string;

  if (oldDate === newDate) {
    return { effective_from: newDate };
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Stamp effective_to on the current assignment
    await connection.execute(
      `UPDATE employee_salary_assignment
          SET active_status = 0,
              effective_to = DATE_SUB(?, INTERVAL 1 DAY)
        WHERE id = ?`,
      [newDate, assignmentId]
    );

    // Copy current assignment with the new effective_from
    const [copyRows] = await connection.execute<RowDataPacket[]>(
      `SELECT * FROM employee_salary_assignment WHERE id = ? LIMIT 1`,
      [assignmentId]
    );
    const old = copyRows[0];

    await connection.execute(
      `INSERT INTO employee_salary_assignment
         (employee_id, structure_id, ctc_annual, effective_from, active_status, assigned_by)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [employeeId, old.structure_id, old.ctc_annual, newDate, actorUserId]
    );

    // Audit
    await connection.execute(
      `INSERT INTO employee_payroll_head_review_history
         (id, employee_id, review_id, action, actor_user_id, rejection_remarks, notified_employee)
       VALUES (UUID(), ?, ?, 'assignment_effective_date_updated', ?, ?, 0)`,
      [
        employeeId,
        review.id as string,
        actorUserId,
        JSON.stringify({ old_date: oldDate, new_date: newDate, reason: reason.trim() }),
      ]
    );

    await connection.commit();
  } catch (e) {
    await connection.rollback();
    throw e;
  } finally {
    connection.release();
  }

  return { effective_from: newDate };
}
```

- [ ] **Step 2: Add route to `payroll-head-review.routes.ts`**

Add before the closing `export const payrollHeadReviewRouter = router;`:

```ts
router.patch("/:employeeId/assignment-effective-date", requireAuth, requireWriteAccess, requireRole(...REVIEWER_ROLES), h(async (req, res) => {
  const { effective_date, reason } = req.body as Record<string, unknown>;
  if (!effective_date || !reason) {
    return res.status(400).json({ success: false, message: "effective_date and reason are required." });
  }
  const data = await svc.updateAssignmentEffectiveDate(
    req.params.employeeId,
    String(effective_date),
    String(req.authUser!.id),
    String(reason)
  );
  res.json({ success: true, data });
}));
```

- [ ] **Step 3: TypeScript check**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -10
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/payroll-head-review/payroll-head-review.service.ts \
        backend/src/modules/payroll-head-review/payroll-head-review.routes.ts
git commit -m "feat: add direct assignment effective-date update for Payroll Head"
```

---

## Task 2: Frontend — Context-aware blur + confirmation dialog

**Files:**
- Modify: `src/pages/payroll/PayrollHeadSalaryReviewDetail.tsx`
- Modify: `src/pages/payroll/PayrollHeadSalaryReviewQueue.tsx`

**Interfaces:**
- Consumes: `journey.salary_assignment` (already in journey response — `{ effective_from: string } | null`)
- Consumes: `PATCH /api/payroll-head-review/:employeeId/assignment-effective-date` (Task 1)
- Consumes: `PATCH /api/payroll-head-review/:employeeId/salary-start-date` (existing)

- [ ] **Step 1: Add confirmation dialog state to `PayrollHeadSalaryReviewDetail.tsx`**

Read the file first. Find the existing `useState` declarations (around line 155). Add:

```ts
const [confirmDateDialog, setConfirmDateDialog] = useState<{
  newDate: string;
  oldDate: string;
} | null>(null);
const [confirmDateReason, setConfirmDateReason] = useState('');
const [confirmDateBusy, setConfirmDateBusy] = useState(false);
```

- [ ] **Step 2: Replace the `onBlur` handler in `PayrollHeadSalaryReviewDetail.tsx`**

Find the current `onBlur` on the date `<Input>` (around line 544). The current handler always calls `salary-start-date`. Replace with a context-aware handler:

```tsx
onBlur={async (e) => {
  const newDate = e.target.value;
  if (!newDate || newDate === loadedSalaryStartDate) return;

  const hasLiveAssignment = !!journey?.salary_assignment?.effective_from;

  if (hasLiveAssignment) {
    // Show confirmation dialog — do not call API yet
    setConfirmDateDialog({
      newDate,
      oldDate: journey.salary_assignment.effective_from,
    });
    setConfirmDateReason('');
  } else {
    // ATS new-joiner path — update ats_payroll_hr_validation
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
  }
}}
```

- [ ] **Step 3: Add the confirmation dialog JSX to `PayrollHeadSalaryReviewDetail.tsx`**

Find where other `<Dialog>` components are rendered (e.g. the rejectOpen dialog, around line 700+). Add this dialog nearby:

```tsx
<Dialog open={!!confirmDateDialog} onOpenChange={(v) => { if (!v) { setConfirmDateDialog(null); setConfirmDateReason(''); } }}>
  <DialogContent className="max-w-md rounded-2xl">
    <DialogHeader>
      <DialogTitle className="text-base font-semibold">Update Salary Effective Date</DialogTitle>
    </DialogHeader>
    <div className="space-y-4 py-2">
      <p className="text-sm text-slate-600">
        This will update the live salary assignment for this employee.
      </p>
      <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 text-sm font-medium">
        <span className="text-slate-500">{confirmDateDialog?.oldDate
          ? new Date(confirmDateDialog.oldDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
          : '—'}</span>
        <span className="text-blue-500">→</span>
        <span className="text-blue-700 font-semibold">{confirmDateDialog?.newDate
          ? new Date(confirmDateDialog.newDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
          : '—'}</span>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Reason <span className="text-red-500">*</span>
        </Label>
        <Textarea
          value={confirmDateReason}
          onChange={(e) => setConfirmDateReason(e.target.value)}
          placeholder="Why is this date being changed? (min 5 characters)"
          rows={3}
          className="rounded-xl resize-none text-sm"
        />
      </div>
    </div>
    <DialogFooter className="gap-2">
      <Button variant="outline" className="rounded-xl" onClick={() => { setConfirmDateDialog(null); setConfirmDateReason(''); }}>
        Cancel
      </Button>
      <Button
        disabled={confirmDateBusy || confirmDateReason.trim().length < 5}
        className="rounded-xl bg-blue-600 hover:bg-blue-700"
        onClick={async () => {
          if (!confirmDateDialog) return;
          setConfirmDateBusy(true);
          try {
            await hrmsApi.patch(`/api/payroll-head-review/${employeeId}/assignment-effective-date`, {
              effective_date: confirmDateDialog.newDate,
              reason: confirmDateReason.trim(),
            });
            setLoadedSalaryStartDate(confirmDateDialog.newDate);
            setConfirmDateDialog(null);
            setConfirmDateReason('');
            setNotice('Salary effective date updated.');
            setTimeout(() => setNotice(null), 3000);
            await load();
          } catch (e: any) {
            setError(e?.message ?? 'Failed to update effective date.');
          } finally {
            setConfirmDateBusy(false);
          }
        }}
      >
        {confirmDateBusy ? 'Updating…' : 'Confirm Update'}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

Check existing imports — `Label`, `Textarea`, `DialogFooter` may need to be added if not already imported. Check `PayrollHeadSalaryReviewDetail.tsx` imports at the top.

- [ ] **Step 4: Apply the same changes to `PayrollHeadSalaryReviewQueue.tsx`**

The Queue file has the same date input inside sub-components (`OfferedSalarySection`, `FinalSalarySection`, `SectionPopup`, `ReviewDrawer`). The `onEffectiveDateBlur` prop currently calls the `salary-start-date` endpoint directly.

For each of `SectionPopup` and `ReviewDrawer`:
- Add the same three state variables (`confirmDateDialog`, `confirmDateReason`, `confirmDateBusy`)
- Replace `handleEffectiveDateBlur` with the context-aware version (check `journey?.salary_assignment?.effective_from` in scope)
- Add the same `<Dialog>` JSX for the confirmation modal

The confirmation dialog needs `employeeId` — confirm it is available in both `SectionPopup` and `ReviewDrawer` scope (it should be, since they already call `hrmsApi.patch` with `employeeId`).

- [ ] **Step 5: Build check**

```bash
npm run build 2>&1 | tail -10
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/payroll/PayrollHeadSalaryReviewDetail.tsx \
        src/pages/payroll/PayrollHeadSalaryReviewQueue.tsx
git commit -m "feat: context-aware effective date blur with confirmation for live assignments"
```

---

## Self-Review

- [x] **Spec coverage:**
  - No active assignment → existing ATS path unchanged ✓ (Task 2 Step 2, `hasLiveAssignment` false branch)
  - Active assignment → confirmation dialog → `PATCH assignment-effective-date` ✓ (Task 2 Steps 2–3)
  - Backend: deactivates old assignment, stamps `effective_to`, inserts new assignment, audit ✓ (Task 1 Step 1)
  - Reason required (min 5 chars) enforced at backend + frontend ✓
  - Date format + DOJ validation ✓
  - REVIEWER_ROLES auth guard ✓
  - Both Detail and Queue pages updated ✓

- [x] **No placeholders:** All steps have complete code.

- [x] **Type consistency:**
  - `confirmDateDialog: { newDate: string; oldDate: string } | null` — used consistently in state, dialog JSX, and onClick handler ✓
  - `updateAssignmentEffectiveDate` produces `{ effective_from: string }` — route returns `{ success: true, data: { effective_from: string } }` ✓
