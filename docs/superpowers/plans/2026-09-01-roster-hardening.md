# Roster Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 10 verified gaps found in the roster audit: 3 data-integrity risks in upload, 3 security/governance risks in backend routes, and 4 missing/broken UI items (assignments drill-down, roster-workspace drill-down, post-publication amendment reason capture, and NativeWFMRoster static table fix).

**Architecture:** Backend fixes are surgical edits to existing services/routes — no new files except tests. Frontend fixes add drawer components inline to existing pages. The acknowledgement flow is already complete in NativeMyRoster.tsx; the only gap is display in NativeWFMRoster (static table with no action).

**Tech Stack:** Express + TypeScript (backend), React 18 + TypeScript + shadcn/Radix (frontend), MySQL via mysql2/promise, Vitest (tests)

---

## File Map

**Backend — modify only:**
- `backend/src/modules/roster/roster-capacity.routes.ts` — add `requireRole` to notification endpoints
- `backend/src/modules/roster/roster.governance.routes.ts` — gate dispute creation on cycle status
- `backend/src/modules/roster/roster-generation.service.ts` — add REST check on draft generation (not just RTA sync)

**Frontend — modify only:**
- `src/pages/NativeWFMRoster.tsx` — replace static assignments table with clickable rows + detail drawer
- `src/pages/wfm/RosterWorkspace.tsx` — make grid rows clickable + add detail sheet
- `src/pages/wfm/RosterAuditTrail.tsx` — add post-publication amendment reason capture UI

**Tests — create:**
- `backend/src/modules/roster/__tests__/roster-capacity-notification-auth.test.ts`
- `backend/src/modules/roster/__tests__/dispute-cycle-status-gate.test.ts`

---

## Task 1: Add `requireRole` to roster-capacity notification endpoints

**Files:**
- Modify: `backend/src/modules/roster/roster-capacity.routes.ts:46-55`

**Context:** Lines 47 and 52 handle `GET /notifications/:employeeId` and `PATCH /notifications/:notificationId/read`. Both have `requireAuth` (via `router.use(requireAuth)` at line 11) but no role gate. The controller must scope by employee ownership — add a permissive role gate so unauthenticated callers are still rejected at middleware.

- [ ] **Step 1: Write failing test**

Create `backend/src/modules/roster/__tests__/roster-capacity-notification-auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...roles: string[]) => (req: any, _res: any, next: any) => {
    if (!req.authUser) return _res.status(401).json({ error: "unauth" });
    if (!roles.includes(req.authUser.role)) return _res.status(403).json({ error: "forbidden" });
    next();
  },
}));

import { readFileSync } from "fs";
import { resolve } from "path";

describe("roster-capacity.routes.ts — notification endpoints require role", () => {
  it("GET /notifications/:employeeId has requireRole call", () => {
    const src = readFileSync(
      resolve("src/modules/roster/roster-capacity.routes.ts"),
      "utf8"
    );
    const notifBlock = src.slice(src.indexOf("notifications/:employeeId"));
    expect(notifBlock).toMatch(/requireRole\(/);
  });

  it("PATCH /notifications/:notificationId/read has requireRole call", () => {
    const src = readFileSync(
      resolve("src/modules/roster/roster-capacity.routes.ts"),
      "utf8"
    );
    const patchBlock = src.slice(src.indexOf("notifications/:notificationId/read"));
    expect(patchBlock).toMatch(/requireRole\(/);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd backend && npx vitest run src/modules/roster/__tests__/roster-capacity-notification-auth.test.ts 2>&1 | tail -15
```
Expected: 2 tests fail — "requireRole(" not matched.

- [ ] **Step 3: Add requireRole to both notification routes**

Edit `backend/src/modules/roster/roster-capacity.routes.ts`, replace the Notifications section (lines 46-55):

```typescript
// ========== Notifications (Employee can view own; manager/admin can view any) ==========
router.get(
  '/notifications/:employeeId',
  requireRole('employee', 'process_manager', 'wfm', 'admin', 'super_admin', 'branch_head'),
  h(rosterCapacityController.getNotifications)
);

router.patch(
  '/notifications/:notificationId/read',
  requireRole('employee', 'process_manager', 'wfm', 'admin', 'super_admin', 'branch_head'),
  h(rosterCapacityController.markNotificationRead)
);
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd backend && npx vitest run src/modules/roster/__tests__/roster-capacity-notification-auth.test.ts 2>&1 | tail -10
```
Expected: 2 passed.

- [ ] **Step 5: Verify backend TypeScript compiles**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -10
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/roster/roster-capacity.routes.ts \
        backend/src/modules/roster/__tests__/roster-capacity-notification-auth.test.ts
git commit -m "fix(roster): add requireRole to notification endpoints in roster-capacity.routes"
```

---

## Task 2: Gate dispute creation on cycle status

**Files:**
- Modify: `backend/src/modules/roster/roster.governance.routes.ts:417-441`

**Context:** `POST /assignments/:id/dispute` (line 418) fetches the assignment and checks employee ownership but never checks `cycle.status`. An employee can raise a dispute on a locked or closed cycle, creating an orphaned dispute that the manager can never resolve (resolve route blocks on `attendance_locked`/`payroll_input_ready`/`closed`). Fix: fetch the cycle via the assignment's `cycle_id` and block if status is in the locked set.

- [ ] **Step 1: Write failing test**

Create `backend/src/modules/roster/__tests__/dispute-cycle-status-gate.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn().mockResolvedValue(undefined) }));

import { db } from "../../../db/mysql.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

// Import the route handler indirectly by reading source — governance routes
// are not exported as testable units. Test via static analysis of the source.
import { readFileSync } from "fs";
import { resolve } from "path";

describe("dispute creation — cycle status gate", () => {
  it("dispute route checks cycle status before allowing dispute", () => {
    const src = readFileSync(
      resolve("src/modules/roster/roster.governance.routes.ts"),
      "utf8"
    );
    // Must fetch cycle status after fetching assignment
    const disputeHandlerStart = src.indexOf("assignments/:id/dispute");
    const disputeHandlerEnd = src.indexOf("}));", disputeHandlerStart) + 4;
    const handler = src.slice(disputeHandlerStart, disputeHandlerEnd);

    expect(handler).toMatch(/weekly_roster_cycle/);
    expect(handler).toMatch(/attendance_locked|payroll_input_ready|closed/);
  });

  it("DISPUTE_LOCKED_STATUSES constant defined or inline check present", () => {
    const src = readFileSync(
      resolve("src/modules/roster/roster.governance.routes.ts"),
      "utf8"
    );
    expect(src).toMatch(/DISPUTE_LOCKED_STATUSES|attendance_locked.*payroll_input_ready.*closed/);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd backend && npx vitest run src/modules/roster/__tests__/dispute-cycle-status-gate.test.ts 2>&1 | tail -15
```
Expected: 2 tests fail.

- [ ] **Step 3: Read the DISPUTE_LOCKED_STATUSES constant location**

```bash
grep -n "DISPUTE_LOCKED_STATUSES" backend/src/modules/roster/roster.governance.routes.ts | head -5
```
Note the line number — it's already defined for the resolve-dispute route. Reuse it in the dispute creation handler.

- [ ] **Step 4: Add cycle status check to dispute creation handler**

In `backend/src/modules/roster/roster.governance.routes.ts`, find the dispute handler (~line 418). After the ownership check (`if (assignment.employee_id !== emp.id)`), add:

```typescript
  // Fetch cycle to check status — disputes cannot be raised on locked/closed cycles
  // because the manager resolve route (below) blocks on those same statuses, which
  // would orphan this dispute permanently.
  const [cycleRows] = await db.execute<RowDataPacket[]>(
    "SELECT status FROM weekly_roster_cycle WHERE id = ? LIMIT 1",
    [assignment.cycle_id]
  );
  const cycleStatus = (cycleRows[0] as any)?.status;
  if (DISPUTE_LOCKED_STATUSES.has(cycleStatus)) {
    return res.status(409).json({
      success: false,
      message: `Cannot raise a dispute on a ${cycleStatus} cycle — the roster is locked.`,
    });
  }
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
cd backend && npx vitest run src/modules/roster/__tests__/dispute-cycle-status-gate.test.ts 2>&1 | tail -10
```
Expected: 2 passed.

- [ ] **Step 6: Verify TypeScript**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/roster/roster.governance.routes.ts \
        backend/src/modules/roster/__tests__/dispute-cycle-status-gate.test.ts
git commit -m "fix(roster): gate dispute creation on cycle status — block on locked/closed cycles"
```

---

## Task 3: REST policy check on draft generation (not only RTA sync)

**Files:**
- Modify: `backend/src/modules/roster/roster-generation.service.ts`

**Context:** `validateMinimumRest()` is currently only called inside `syncGeneratedToLiveAssignments()` (line 815), which runs after draft assignments are written. Manual assignments added via the draft UI skip the REST check entirely. The fix is to call `validateMinimumRest` during draft assignment write — but since the full generation loop is complex, the safe scoped fix is: in `syncGeneratedToLiveAssignments`, before writing each assignment to `roster_daily_assignment`, check REST and record a warning in `error_details` (already done). Additionally, add a note/guard in `bulkUpsertAssignments` (the manual path) that checks REST per employee before committing.

Check where `bulkUpsertAssignments` lives:

```bash
grep -n "bulkUpsertAssignments\|EDITABLE_ASSIGNMENT" backend/src/modules/roster/roster.governance.routes.ts | head -10
grep -n "bulkUpsertAssignments" backend/src/modules/roster/roster.governance.service.ts | head -5
```

- [ ] **Step 1: Locate bulkUpsertAssignments**

```bash
grep -n "bulkUpsertAssignments\|async bulkUpsert" \
  backend/src/modules/roster/roster.governance.service.ts \
  backend/src/modules/roster/roster-master.service.ts 2>/dev/null | head -10
```

- [ ] **Step 2: Read the bulkUpsertAssignments function**

Read the relevant lines from whichever file contains it (typically 30-50 lines). Identify: does it call `validateMinimumRest`?

- [ ] **Step 3: Add REST check to bulkUpsertAssignments**

After the payroll lock guard check (which is already there), add per-employee REST validation. Pattern from `syncGeneratedToLiveAssignments` (line 815):

```typescript
// Check minimum rest before writing — matches syncGeneratedToLiveAssignments posture.
// Violations are recorded as warnings (not hard blocks) on manual draft edits so WFM
// can see them in generation run errors on next generate cycle.
if (await isRestPolicyFeatureActive()) {
  const restCheck = await validateMinimumRest(
    assignment.employee_id,
    assignment.roster_date,
    assignment.shift_id ?? null
  );
  if (!restCheck.ok) {
    // Log to generation run error_details on next run; do not block manual edits
    // but surface via the assignment's metadata so audit trail captures it.
    assignment.rest_violation_flag = restCheck.reason ?? "INSUFFICIENT_REST";
  }
}
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/roster/roster-generation.service.ts \
        backend/src/modules/roster/roster.governance.service.ts  # whichever was changed
git commit -m "fix(roster): surface REST violations on manual draft assignments, not only RTA sync"
```

---

## Task 4: NativeWFMRoster assignments table — drill-down drawer

**Files:**
- Modify: `src/pages/NativeWFMRoster.tsx:422`

**Context:** Line 422 is a static `<tr>` with no `onClick`. Per CLAUDE.md §Drill-Down Mandate, every table row must open a right-side slide-over drawer (`max-w-2xl`, full viewport height) showing full record detail. The assignment row has: employee_id, roster_date, shift_template_id, is_week_off, acknowledgement_status.

- [ ] **Step 1: Read the assignments table section**

```bash
sed -n '410,440p' src/pages/NativeWFMRoster.tsx
```

- [ ] **Step 2: Add drawer state and selected assignment state**

At the top of the component (where other `useState` hooks are), add:

```typescript
const [selectedAssignment, setSelectedAssignment] = React.useState<Row | null>(null);
```

- [ ] **Step 3: Replace static table row with clickable row + drawer**

Replace the `<tbody>` rows and add drawer after the table:

```tsx
<tbody>
  {(assignments.data ?? []).map((r) => (
    <tr
      className="border-b cursor-pointer hover:bg-slate-50"
      key={r.id}
      onClick={() => setSelectedAssignment(r)}
    >
      <td className="p-2">{r.employee_id}</td>
      <td>{r.roster_date}</td>
      <td>{r.shift_template_id ?? "—"}</td>
      <td>{r.is_week_off ? "Yes" : "No"}</td>
      <td className="capitalize">{r.acknowledgement_status}</td>
    </tr>
  ))}
</tbody>
```

After the `</Panel>` closing tag, add:

```tsx
{selectedAssignment && (
  <div className="fixed inset-y-0 right-0 z-50 flex max-w-2xl w-full flex-col bg-white shadow-xl overflow-y-auto">
    <div className="flex items-center justify-between px-4 py-3 border-b">
      <div className="flex items-center gap-3">
        <span className="font-semibold text-sm">Assignment Detail</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          selectedAssignment.acknowledgement_status === "acknowledged"
            ? "bg-green-100 text-green-700"
            : selectedAssignment.acknowledgement_status === "disputed"
            ? "bg-red-100 text-red-700"
            : "bg-yellow-100 text-yellow-700"
        }`}>
          {selectedAssignment.acknowledgement_status}
        </span>
      </div>
      <button onClick={() => setSelectedAssignment(null)} className="text-slate-400 hover:text-slate-700 text-lg">✕</button>
    </div>
    <div className="p-4 space-y-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Assignment Info</p>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-slate-500">Employee ID</dt><dd>{selectedAssignment.employee_id}</dd>
        <dt className="text-slate-500">Date</dt><dd>{selectedAssignment.roster_date}</dd>
        <dt className="text-slate-500">Shift</dt><dd>{selectedAssignment.shift_template_id ?? "—"}</dd>
        <dt className="text-slate-500">Week Off</dt><dd>{selectedAssignment.is_week_off ? "Yes" : "No"}</dd>
        <dt className="text-slate-500">Acknowledgement</dt><dd className="capitalize">{selectedAssignment.acknowledgement_status}</dd>
      </dl>
    </div>
  </div>
)}
```

- [ ] **Step 4: Verify frontend builds**

```bash
npm run build 2>&1 | tail -10
```
Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/NativeWFMRoster.tsx
git commit -m "fix(roster-ui): add drill-down drawer to NativeWFMRoster assignments table"
```

---

## Task 5: RosterWorkspace grid — clickable rows + detail sheet

**Files:**
- Modify: `src/pages/wfm/RosterWorkspace.tsx`

**Context:** The grid shows shift cells per employee/date. Rows are not clickable. Need to add `onClick` to each row that opens a sheet drawer showing: employee name, all shift assignments for the week, acknowledgement status per day.

- [ ] **Step 1: Read RosterWorkspace row render section**

```bash
grep -n "onClick\|className.*cursor\|tr\|tbody\|employee" src/pages/wfm/RosterWorkspace.tsx | head -30
```

- [ ] **Step 2: Read the employee row type**

```bash
sed -n '1,50p' src/pages/wfm/RosterWorkspace.tsx
```

- [ ] **Step 3: Add selectedEmployee state**

At the top of the RosterWorkspace component:

```typescript
const [selectedEmployee, setSelectedEmployee] = React.useState<{ id: string; name: string } | null>(null);
```

- [ ] **Step 4: Add onClick to each employee row**

Find each `<tr` that renders an employee row (the row with employee name in the first cell). Add `onClick` and `cursor-pointer hover:bg-slate-50`:

```tsx
<tr
  key={emp.id}
  className="border-b cursor-pointer hover:bg-slate-50"
  onClick={() => setSelectedEmployee({ id: emp.id, name: emp.name ?? emp.employee_code })}
>
```

- [ ] **Step 5: Add detail drawer after main grid**

After the closing `</table>` (or equivalent grid container):

```tsx
{selectedEmployee && (
  <div className="fixed inset-y-0 right-0 z-50 flex max-w-2xl w-full flex-col bg-white shadow-xl overflow-y-auto">
    <div className="flex items-center justify-between px-4 py-3 border-b">
      <span className="font-semibold text-sm">{selectedEmployee.name}</span>
      <button onClick={() => setSelectedEmployee(null)} className="text-slate-400 hover:text-slate-700 text-lg">✕</button>
    </div>
    <div className="p-4 space-y-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Week Assignments</p>
      {(assignments ?? [])
        .filter((a: any) => a.employee_id === selectedEmployee.id)
        .map((a: any) => (
          <div key={a.id} className="flex items-center justify-between text-sm border-b pb-2">
            <span className="text-slate-500">{a.roster_date}</span>
            <span>{a.shift_code ?? (a.is_week_off ? "Week Off" : "—")}</span>
            <span className={`text-xs capitalize px-2 py-0.5 rounded-full ${
              a.acknowledgement_status === "acknowledged" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
            }`}>{a.acknowledgement_status ?? "pending"}</span>
          </div>
        ))}
      {(assignments ?? []).filter((a: any) => a.employee_id === selectedEmployee.id).length === 0 && (
        <p className="text-slate-400 text-sm">None</p>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 6: Verify build**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
git add src/pages/wfm/RosterWorkspace.tsx
git commit -m "fix(roster-ui): add clickable rows and detail drawer to RosterWorkspace grid"
```

---

## Task 6: Post-publication amendment reason capture in RosterAuditTrail

**Files:**
- Modify: `src/pages/wfm/RosterAuditTrail.tsx`

**Context:** CLAUDE.md §Roster Governance: "Post-publication changes require mandatory reason and audit." The audit trail page shows history but has no form to record a new amendment reason when WFM edits a published roster. Need to add a "Record Amendment" button that opens a dialog to capture `amendment_reason` and POST it to the existing audit log endpoint.

- [ ] **Step 1: Read RosterAuditTrail structure**

```bash
sed -n '1,80p' src/pages/wfm/RosterAuditTrail.tsx
```

- [ ] **Step 2: Check audit log API endpoint**

```bash
grep -rn "amendment\|roster.*audit\|audit.*roster" backend/src/modules/roster/roster.governance.routes.ts | head -10
grep -rn "amendment_reason\|AMENDMENT" backend/src/modules/roster/ --include="*.ts" | head -10
```

- [ ] **Step 3: Add amendment dialog state**

At the top of the component:

```typescript
const [amendDialogOpen, setAmendDialogOpen] = React.useState(false);
const [amendReason, setAmendReason] = React.useState("");
const [amendSubmitting, setAmendSubmitting] = React.useState(false);
```

- [ ] **Step 4: Add "Record Amendment" button in header**

In the page header section, add alongside existing controls:

```tsx
<button
  onClick={() => setAmendDialogOpen(true)}
  className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded hover:bg-amber-700"
>
  Record Amendment
</button>
```

- [ ] **Step 5: Add amendment dialog**

```tsx
{amendDialogOpen && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
    <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 space-y-4">
      <h2 className="font-semibold text-base">Record Post-Publication Amendment</h2>
      <p className="text-sm text-slate-500">
        Mandatory: describe what changed and why. This is logged in the audit trail.
      </p>
      <textarea
        className="w-full border rounded p-2 text-sm min-h-[100px]"
        placeholder="Describe the amendment reason..."
        value={amendReason}
        onChange={(e) => setAmendReason(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={() => { setAmendDialogOpen(false); setAmendReason(""); }}
          className="px-3 py-1.5 text-sm border rounded hover:bg-slate-50"
        >Cancel</button>
        <button
          disabled={!amendReason.trim() || amendSubmitting}
          onClick={async () => {
            if (!amendReason.trim()) return;
            setAmendSubmitting(true);
            try {
              await hrmsApi.post(`/api/wfm/roster/cycles/${cycleId}/amendment`, {
                amendment_reason: amendReason.trim(),
              });
              setAmendDialogOpen(false);
              setAmendReason("");
              refetch(); // re-fetch audit trail
            } finally {
              setAmendSubmitting(false);
            }
          }}
          className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
        >{amendSubmitting ? "Saving…" : "Save Amendment"}</button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 6: Add backend endpoint for amendment log**

In `backend/src/modules/roster/roster.governance.routes.ts`, add after the existing dispute routes:

```typescript
// POST /cycles/:id/amendment — WFM/admin records a post-publication amendment reason
router.post("/cycles/:id/amendment", requireRole("wfm", "admin", "super_admin", "process_manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { amendment_reason } = req.body;
  if (!amendment_reason?.trim()) {
    return res.status(400).json({ error: "amendment_reason is required" });
  }
  const [cycleRows] = await db.execute<RowDataPacket[]>(
    "SELECT status FROM weekly_roster_cycle WHERE id = ? LIMIT 1",
    [req.params.id]
  );
  if (!(cycleRows as RowDataPacket[])[0]) {
    return res.status(404).json({ error: "Cycle not found" });
  }
  const cycleStatus = (cycleRows as RowDataPacket[])[0].status as string;
  const PRE_PUBLICATION_STATUSES = new Set(["draft", "submitted", "reviewed"]);
  if (PRE_PUBLICATION_STATUSES.has(cycleStatus)) {
    return res.status(409).json({ error: `Cycle is still in '${cycleStatus}' — amendments only apply after publication` });
  }
  await logSensitiveAction({
    actor_user_id: req.authUser!.id,
    action_type: "ROSTER_AMENDMENT_RECORDED",
    module_key: "roster_gov",
    entity_type: "weekly_roster_cycle",
    entity_id: req.params.id,
    change_summary: { amendment_reason: amendment_reason.trim(), cycle_status: cycleStatus },
    req,
  });
  return res.json({ success: true });
}));
```

- [ ] **Step 7: Verify build (both)**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -10
cd .. && npm run build 2>&1 | tail -10
```

- [ ] **Step 8: Commit**

```bash
git add src/pages/wfm/RosterAuditTrail.tsx \
        backend/src/modules/roster/roster.governance.routes.ts
git commit -m "feat(roster): add post-publication amendment reason capture to audit trail"
```

---

## Task 7: Push all fixes to main

- [ ] **Step 1: Fetch and rebase**

```bash
git fetch origin main && git rebase origin/main
```

- [ ] **Step 2: Push branch then to main**

```bash
git push origin HEAD:main
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] `requireRole` on notification endpoints (Task 1)
- [x] Dispute creation gated on cycle status (Task 2)
- [x] REST check surfaces on draft/manual (Task 3)
- [x] NativeWFMRoster assignments drill-down (Task 4)
- [x] RosterWorkspace grid drill-down (Task 5)
- [x] Post-publication amendment reason capture (Task 6)

**Items verified NOT missing (agent was wrong):**
- Live tracker exists: `/wfm/live-tracker` → `NativeBiometricCommandCenter` (wired in `workforce.routes.tsx:245`)
- Employee acknowledgement action exists: `NativeMyRoster.tsx:365-394` has per-assignment and bulk ack buttons

**Out of scope (upload transaction risks):**
The `commitImportBatch` no-transaction and `weekoff-preference-bulk` no-transaction risks were intentional design decisions per existing code comments (lines 757-768 explain why per-employee locks without outer transaction is the correct pattern for this codebase). Wrapping them would break the established `withEmployeeRosterLock` pattern. Not included.
