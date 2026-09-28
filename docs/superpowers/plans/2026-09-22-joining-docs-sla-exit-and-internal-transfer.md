# Joining Docs SLA/Exit Fixes + Internal Transfer Voucher — Implementation Plan

> Executed inline in this session (not subagent-dispatched — financial ledger and exit-workflow
> integrity make this a single-owner change; see docs/superpowers/specs/2026-09-22-joining-docs-sla-exit-and-internal-transfer-design.md).

**Goal:** Ship the 3 approved features: employee-ID-creation SLA visibility on the Joining
Documents Tracker + Appointment Letter Queue, a "Mark Left / Dropped" action that routes through
Exit Management, fixed exclusion filters on both pages, and an internal fund-transfer voucher type.

**Architecture:** Part A is read-path + one new Exit sub-type, no schema change. Part B adds one
column + one ENUM value to `payment_voucher` and seeds one `payable_account_master` row.

## Global Constraints
- No existing exit sub-type, voucher source type, or filter behavior for existing callers changes.
- Every migration is additive and idempotent (guarded `ALTER`/`INSERT`), per CLAUDE.md.
- `npm run build` (frontend) and `cd backend && npx tsc --noEmit` must both be clean before this is "done".
- No production DB writes/migrations without explicit user approval — verify against a local sandbox.

---

## Task 1 — Exit Management: `did_not_join` sub-type

**Files:**
- Modify: `backend/src/modules/exit/exitEmploymentStatus.ts`
- Modify: `backend/src/modules/exit/exit.validation.ts`
- Test: `backend/src/modules/exit/__tests__/exit-did-not-join.test.ts` (new)

**Interfaces:**
- Produces: `TERMINAL_EXIT_STATUSES` gains `"not_joined"`; `employmentStatusForExit(exitType, "did_not_join")` returns `"not_joined"`; `createExitRequestSchema` accepts `exitSubType: "did_not_join"`.

- [ ] **Step 1: Write failing test**
```ts
// backend/src/modules/exit/__tests__/exit-did-not-join.test.ts
import { describe, it, expect } from "vitest";
import { employmentStatusForExit, TERMINAL_EXIT_STATUSES, NON_REACTIVATABLE_STATUSES } from "../exitEmploymentStatus.js";
import { createExitRequestSchema } from "../exit.validation.js";

describe("did_not_join exit sub-type", () => {
  it("maps to the not_joined terminal employment status", () => {
    expect(employmentStatusForExit("involuntary", "did_not_join")).toBe("not_joined");
  });

  it("is included in the terminal/non-reactivatable guard lists", () => {
    expect(TERMINAL_EXIT_STATUSES).toContain("not_joined");
    expect(NON_REACTIVATABLE_STATUSES).toContain("not_joined");
  });

  it("createExitRequestSchema accepts did_not_join and does not require abscondingSince", () => {
    const parsed = createExitRequestSchema.parse({
      employeeId: "11111111-1111-1111-1111-111111111111",
      exitDate: "2026-09-22",
      exitType: "involuntary",
      exitSubType: "did_not_join",
    });
    expect(parsed.exitSubType).toBe("did_not_join");
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**
Run: `cd backend && npx vitest run src/modules/exit/__tests__/exit-did-not-join.test.ts`
Expected: FAIL — `"not_joined"` not in `TERMINAL_EXIT_STATUSES`, and `zod` rejects `"did_not_join"`.

- [ ] **Step 3: Implement — `exitEmploymentStatus.ts`**

In `backend/src/modules/exit/exitEmploymentStatus.ts`, change:
```ts
export const TERMINAL_EXIT_STATUSES = ["inactive", "terminated", "absconded"] as const;
```
to:
```ts
export const TERMINAL_EXIT_STATUSES = ["inactive", "terminated", "absconded", "not_joined"] as const;
```
and in `employmentStatusForExit`, add the new sub-type check before the existing `sub === "termination"` line:
```ts
  if (sub === "absconding" || sub === "abandonment") return "absconded";
  if (sub === "did_not_join") return "not_joined";
  if (sub === "termination") return "terminated";
```
Update the function's doc comment to add: `'did_not_join' maps to 'not_joined' — an employee ID
was created but the person never actually started; distinct from absconding (left after joining)
so exit/attrition reporting can tell the two apart.`

- [ ] **Step 4: Implement — `exit.validation.ts`**

In `backend/src/modules/exit/exit.validation.ts`, change:
```ts
  exitSubType: z
    .enum(["resignation", "retirement", "mutual_separation", "termination", "absconding", "contract_end", "abandonment"])
    .optional()
    .default("resignation"),
```
to:
```ts
  exitSubType: z
    .enum(["resignation", "retirement", "mutual_separation", "termination", "absconding", "contract_end", "abandonment", "did_not_join"])
    .optional()
    .default("resignation"),
```
Leave every `.refine(...)` below untouched — `did_not_join` is not in the
`["absconding", "abandonment"]` list, so `abscondingSince` stays optional for it, as intended.

- [ ] **Step 5: Run test, confirm it passes**
Run: `cd backend && npx vitest run src/modules/exit/__tests__/exit-did-not-join.test.ts`
Expected: PASS (3/3)

- [ ] **Step 6: Commit**
```bash
git add backend/src/modules/exit/exitEmploymentStatus.ts backend/src/modules/exit/exit.validation.ts backend/src/modules/exit/__tests__/exit-did-not-join.test.ts
git commit -m "feat(exit): add did_not_join sub-type for employees who never joined"
```

---

## Task 2 — Joining Documents Tracker: canonical exclusion filter + SLA field

**Files:**
- Modify: `backend/src/modules/ats/ats.joiningDocumentsTracker.service.ts`
- Test: `backend/src/modules/ats/__tests__/ats.joiningDocumentsTracker.service.test.ts` (new — the
  existing route test mocks the service, so the WHERE-clause/SQL-shape logic needs its own test)

**Interfaces:**
- Consumes: `NON_REACTIVATABLE_STATUSES` from `../exit/exitEmploymentStatus.js`.
- Produces: `TrackerRow` gains `days_since_id_created: number`, `id_creation_sla_breached: boolean`;
  `TrackerSummary` gains `id_creation_overdue_count: number`; `TrackerQueryParams` gains
  `id_creation_sla_only?: boolean`.

- [ ] **Step 1: Write failing test**
```ts
// backend/src/modules/ats/__tests__/ats.joiningDocumentsTracker.service.test.ts
import { describe, it, expect, vi } from "vitest";
import { NON_REACTIVATABLE_STATUSES } from "../../exit/exitEmploymentStatus.js";

const executeMock = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...args: unknown[]) => executeMock(...args) } }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  buildScopeWhereClause: vi.fn().mockResolvedValue({ sql: "1=1", params: [] }),
}));

describe("getJoiningDocumentsTracker WHERE clause", () => {
  it("excludes every NON_REACTIVATABLE_STATUSES value, not just resigned/terminated", async () => {
    executeMock.mockResolvedValueOnce([[{ total: 0 }]]); // count query
    executeMock.mockResolvedValueOnce([[]]); // rows query
    const { getJoiningDocumentsTracker } = await import("../ats.joiningDocumentsTracker.service.js");
    await getJoiningDocumentsTracker("actor-1", { page: 1, limit: 50 });

    const [sql] = executeMock.mock.calls[0];
    for (const status of NON_REACTIVATABLE_STATUSES) {
      expect(sql).toContain(status);
    }
    expect(sql).not.toContain("NOT IN ('resigned', 'terminated')");
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**
Run: `cd backend && npx vitest run src/modules/ats/__tests__/ats.joiningDocumentsTracker.service.test.ts`
Expected: FAIL — current SQL only names `resigned`/`terminated`.

- [ ] **Step 3: Implement — replace the exclusion clause**

In `backend/src/modules/ats/ats.joiningDocumentsTracker.service.ts`, add the import near the top:
```ts
import { NON_REACTIVATABLE_STATUSES, nonReactivatableSqlList } from '../exit/exitEmploymentStatus.js';
```
Replace (around line 450):
```ts
    `(e.employment_status IS NULL OR e.employment_status NOT IN ('resigned', 'terminated'))`,
```
with:
```ts
    `(e.employment_status IS NULL OR e.employment_status NOT IN (${nonReactivatableSqlList()}))`,
```
This is a compile-time-literal `IN (...)` fragment (same pattern `nonReactivatableSqlList()` is
already written for), so it needs no bound parameter.

- [ ] **Step 4: Run test, confirm it passes**
Run: `cd backend && npx vitest run src/modules/ats/__tests__/ats.joiningDocumentsTracker.service.test.ts`
Expected: PASS

- [ ] **Step 5: Add the SLA field — write a second failing test in the same file**
```ts
describe("id_creation_sla_breached", () => {
  it("is true once created_at is more than 3 days old, and summed into id_creation_overdue_count", async () => {
    executeMock.mockResolvedValueOnce([[{ total: 1 }]]);
    executeMock.mockResolvedValueOnce([[{
      employee_id: "e1", employee_code: "MAS1", full_name: "A B",
      branch_name: null, process_name: null, date_of_joining: "2026-09-01",
      onboarding_submitted_at: null, salary_assigned_at: null,
      joining_document_completion_pct: 0, total_documents: 0, verified_count: 0,
      needs_correction_count: 0, overdue_count: 0, esign_completed_count: null,
      esign_pending_count: null, updated_at: "2026-09-01",
      days_since_id_created: 5,
    }]]);
    const { getJoiningDocumentsTracker } = await import("../ats.joiningDocumentsTracker.service.js");
    const result = await getJoiningDocumentsTracker("actor-1", { page: 1, limit: 50 });
    expect(result.rows[0].id_creation_sla_breached).toBe(true);
    expect(result.summary.id_creation_overdue_count).toBe(1);
  });
});
```

- [ ] **Step 6: Run it, confirm it fails**
Run: `cd backend && npx vitest run src/modules/ats/__tests__/ats.joiningDocumentsTracker.service.test.ts`
Expected: FAIL — `days_since_id_created` not selected, `id_creation_sla_breached`/`id_creation_overdue_count` undefined.

- [ ] **Step 7: Implement — add the column to the row SELECT and the summary aggregate**

Find the main row `SELECT` (the one aliasing `e.employee_code, e.full_name...` around line 584) and
add, alongside the other `e.` columns:
```sql
  DATEDIFF(CURDATE(), e.created_at) AS days_since_id_created,
```
Find the summary aggregate query (the one producing `overdue_count`) and add a sibling aggregate:
```sql
  SUM(CASE WHEN DATEDIFF(CURDATE(), e.created_at) > 3 THEN 1 ELSE 0 END) AS id_creation_overdue_count,
```
In the row-mapping code (where `overdue_count: row.overdue_count` etc. are assigned, near line 669),
add:
```ts
    days_since_id_created: Number(row.days_since_id_created ?? 0),
    id_creation_sla_breached: Number(row.days_since_id_created ?? 0) > 3,
```
In the summary object assembly, add:
```ts
    id_creation_overdue_count: Number(summaryRow.id_creation_overdue_count ?? 0),
```
Add the matching fields to the `TrackerRow`/`TrackerSummary` TypeScript types at the top of the file.

- [ ] **Step 8: Run test, confirm it passes**
Run: `cd backend && npx vitest run src/modules/ats/__tests__/ats.joiningDocumentsTracker.service.test.ts`
Expected: PASS (2/2)

- [ ] **Step 9: `id_creation_sla_only` filter param**

In `TrackerQueryParams`, add `id_creation_sla_only?: boolean`. In `ats.joiningDocumentsTracker.routes.ts`,
add `id_creation_sla_only: req.query.id_creation_sla_only === 'true'` to the `filters` object built in
the `GET /` handler. In the service, when `filters.id_creation_sla_only` is true, add to `havingClause`
(alongside the existing `overdue_count > 0` HAVING branch) — build it as
`HAVING days_since_id_created > 3` when only this filter is set, or combine with `AND` when both
`overdue_only` and `id_creation_sla_only` are set, matching the existing `havingClause` string-building
style in the file.

- [ ] **Step 10: Commit**
```bash
git add backend/src/modules/ats/ats.joiningDocumentsTracker.service.ts backend/src/modules/ats/ats.joiningDocumentsTracker.routes.ts backend/src/modules/ats/__tests__/ats.joiningDocumentsTracker.service.test.ts
git commit -m "feat(ats): fix stale exit-status filter, add employee-ID SLA field to joining tracker"
```

---

## Task 3 — Appointment Letter Queue: employment_status exclusion + SLA field

**Files:**
- Modify: `backend/src/modules/letters/appointmentLetterEligibility.service.ts`
- Test: `backend/src/modules/letters/__tests__/appointmentLetterEligibility.service.test.ts` (new)

**Interfaces:**
- Consumes: `NON_REACTIVATABLE_STATUSES`/`nonReactivatableSqlList` from `../exit/exitEmploymentStatus.js`.
- Produces: `EligibilityResult` gains `daysSinceIdCreated: number`, `idCreationSlaBreached: boolean`.
  `listAppointmentLetterQueue()`'s population query excludes terminal `employment_status` values.

- [ ] **Step 1: Write failing test**
```ts
// backend/src/modules/letters/__tests__/appointmentLetterEligibility.service.test.ts
import { describe, it, expect, vi } from "vitest";
import { NON_REACTIVATABLE_STATUSES } from "../../exit/exitEmploymentStatus.js";

const executeMock = vi.fn().mockResolvedValue([[]]);
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...args: unknown[]) => executeMock(...args) } }));

describe("listAppointmentLetterQueue population filter", () => {
  it("excludes every terminal employment_status, not just active_status", async () => {
    const { listAppointmentLetterQueue } = await import("../appointmentLetterEligibility.service.js");
    await listAppointmentLetterQueue(200, {});
    const [sql] = executeMock.mock.calls[0];
    expect(sql).toContain("e.active_status = 1");
    for (const status of NON_REACTIVATABLE_STATUSES) {
      expect(sql).toContain(status);
    }
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**
Run: `cd backend && npx vitest run src/modules/letters/__tests__/appointmentLetterEligibility.service.test.ts`
Expected: FAIL — today's `conds` array has no `employment_status` entry at all.

- [ ] **Step 3: Implement**

In `appointmentLetterEligibility.service.ts`, add the import:
```ts
import { NON_REACTIVATABLE_STATUSES, nonReactivatableSqlList } from "../exit/exitEmploymentStatus.js";
```
(unused-var lint note: only `nonReactivatableSqlList` is used in the SQL string; import both since the
test above imports `NON_REACTIVATABLE_STATUSES` from the shared module directly, not re-exported here.)

In `listAppointmentLetterQueue()`, change:
```ts
  const conds: string[] = [
    "e.active_status = 1",
    "e.legacy_emp_id IS NULL",
```
to:
```ts
  const conds: string[] = [
    "e.active_status = 1",
    `(e.employment_status IS NULL OR e.employment_status NOT IN (${nonReactivatableSqlList()}))`,
    "e.legacy_emp_id IS NULL",
```

- [ ] **Step 4: Run test, confirm it passes**
Run: `cd backend && npx vitest run src/modules/letters/__tests__/appointmentLetterEligibility.service.test.ts`
Expected: PASS

- [ ] **Step 5: SLA field — extend `evaluateAppointmentLetterEligibility`**

Add `e.created_at` to the employee `SELECT` at the top of `evaluateAppointmentLetterEligibility`
(the query selecting `e.id, e.employee_code, e.branch_id, e.date_of_joining, ...`). In the final
`return { ... }` block, add:
```ts
    daysSinceIdCreated: emp.created_at
      ? Math.floor((Date.now() - new Date(emp.created_at).getTime()) / 86_400_000)
      : 0,
    idCreationSlaBreached: emp.created_at
      ? Math.floor((Date.now() - new Date(emp.created_at).getTime()) / 86_400_000) > 3
      : false,
```
Add both fields to the `EligibilityResult` type. Also add them to the early-return branch for
`!emp` (`employeeId, employeeCode: null, ...`) as `daysSinceIdCreated: 0, idCreationSlaBreached: false`
so every return path satisfies the type.

- [ ] **Step 6: Commit**
```bash
git add backend/src/modules/letters/appointmentLetterEligibility.service.ts backend/src/modules/letters/__tests__/appointmentLetterEligibility.service.test.ts
git commit -m "feat(letters): fix appointment letter queue to exclude exited employees, add SLA field"
```

---

## Task 4 — Frontend: SLA badges + filters on both pages

**Files:**
- Modify: `src/pages/JoiningDocumentsTrackerPage.tsx`
- Modify: `src/pages/NativeAppointmentLetterQueue.tsx`

No backend contract changes here beyond Tasks 2–3 (already shipped). Manual verification only —
these are presentational; existing contract tests (`page-catalog-route-drift.contract.test.ts`) are
unaffected since no route changes.

- [ ] **Step 1 — `JoiningDocumentsTrackerPage.tsx`: types**

In the `EmployeeRow` interface, add:
```ts
  days_since_id_created: number;
  id_creation_sla_breached: boolean;
```
In `TrackerSummary`, add:
```ts
  id_creation_overdue_count: number;
```
In the `summary` default object (the `?? { ... }` fallback), add `id_creation_overdue_count: 0,`.

- [ ] **Step 2 — sixth summary tile**

After the existing "Overdue" `<HrmsBentoTile>` (the one using `AlertTriangle`/`summary.overdue_count`),
add:
```tsx
          <HrmsBentoTile
            icon={<Clock className="h-5 w-5" />}
            title="ID SLA Breached"
            value={summary.id_creation_overdue_count}
            className="bg-red-50 text-red-700"
          />
```
Change the tiles grid from `lg:grid-cols-5` to `lg:grid-cols-6` (one line above the tiles, the
comment there already explains the 5-tile partition — extend it to note the 6th is cross-cutting
like Overdue).

- [ ] **Step 3 — filter checkbox and query param**

Add state: `const [idSlaOnly, setIdSlaOnly] = useState(false);` next to `overdueOnly`. Add it to the
query key and to `params.set('id_creation_sla_only', 'true')` inside `queryFn`, mirroring the
existing `overdueOnly`/`overdue_only` block exactly. Add a matching `<Checkbox>` + `<Label>` right
after the existing "Overdue only" one:
```tsx
              <div className="flex items-center gap-2">
                <Checkbox
                  id="id-sla"
                  checked={idSlaOnly}
                  onCheckedChange={checked => { setIdSlaOnly(!!checked); setPage(1); }}
                />
                <Label htmlFor="id-sla" className="cursor-pointer text-sm font-medium">
                  ID SLA breached only
                </Label>
              </div>
```

- [ ] **Step 4 — per-row badge**

In the row `<td>` that renders the existing `overdue_count` badge, add a second badge right after it
(inside the same `<td>` or a new one — add a new `<th>`/`<td>` pair "ID SLA" after the "Overdue" one
to keep the two independent signals visually separate):
```tsx
                        <td className="px-4 py-3">
                          {row.id_creation_sla_breached ? (
                            <Badge variant="outline" className="bg-red-100 text-red-800 border-red-300">
                              {row.days_since_id_created}d
                            </Badge>
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                        </td>
```
Add the matching `<th className="px-4 py-3">ID SLA</th>` to the header row.

- [ ] **Step 5 — Mark Left / Dropped dialog**

Add state:
```tsx
  const [markLeftRow, setMarkLeftRow] = useState<EmployeeRow | null>(null);
  const [markLeftReason, setMarkLeftReason] = useState("");
```
Add the mutation next to the other bulk mutations:
```tsx
  const markLeftMutation = useMutation({
    mutationFn: (vars: { employeeId: string; reason: string }) =>
      hrmsApi.post("/api/exit/", {
        employeeId: vars.employeeId,
        exitType: "involuntary",
        exitSubType: "did_not_join",
        exitDate: new Date().toISOString().slice(0, 10),
        reason: vars.reason || "Employee ID created but candidate never joined",
        noticePeriodDays: 0,
      }),
    onSuccess: () => {
      toast({ title: "Marked left/dropped", description: "An exit request has been raised — this employee will drop off once it's processed through Exit Management." });
      queryClient.invalidateQueries({ queryKey: ["joining-documents-tracker"] });
      setMarkLeftRow(null);
      setMarkLeftReason("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
```
Add a `DropdownMenuItem` in the per-row Actions menu, after "Resend Payroll HR Notification":
```tsx
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={e => { e.stopPropagation(); setMarkLeftRow(row); }}
                                className="text-rose-600"
                              >
                                <AlertTriangle className="h-3.5 w-3.5 mr-2" />
                                Mark Left / Dropped
                              </DropdownMenuItem>
```
Add the confirm dialog near the other `<Dialog>` blocks in this file:
```tsx
      <Dialog open={!!markLeftRow} onOpenChange={open => !open && setMarkLeftRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {markLeftRow?.full_name} as Left / Dropped</DialogTitle>
            <DialogDescription>
              This raises an exit request through Exit Management. The employee stays visible here
              until that request is processed and closed — this does not remove them immediately.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason (optional)"
            value={markLeftReason}
            onChange={e => setMarkLeftReason(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkLeftRow(null)}>Cancel</Button>
            <Button
              className="bg-rose-600 hover:bg-rose-700"
              disabled={markLeftMutation.isPending}
              onClick={() => markLeftRow && markLeftMutation.mutate({ employeeId: markLeftRow.employee_id, reason: markLeftReason })}
            >
              Raise Exit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 6 — `NativeAppointmentLetterQueue.tsx`: same three additions**

Add to the `QueueRow` type: `daysSinceIdCreated: number; idCreationSlaBreached: boolean;` (camelCase —
this endpoint's payload is already camelCase, unlike the Tracker's snake_case).

On both the eligible-tab card (after the `employeeCode` line) and the blocked-tab card, add:
```tsx
                        {row.idCreationSlaBreached && (
                          <span className="mt-1 inline-block rounded-md bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 border border-red-300">
                            ID SLA breached ({row.daysSinceIdCreated}d)
                          </span>
                        )}
```
Sort the blocked list breached-first before rendering: replace `queue.blocked.map((row) => (` with
`[...queue.blocked].sort((a, b) => Number(b.idCreationSlaBreached) - Number(a.idCreationSlaBreached)).map((row) => (`.

Add the same "Mark Left / Dropped" button + dialog pattern as Step 5 above (same mutation body,
same confirm copy), placed next to the existing "Preview & Issue" button on the eligible card and
as a standalone button on each blocked card. Reuse one dialog + one `markLeftRow`/`markLeftReason`
state pair for the whole page, same as the Tracker page. On success, invalidate
`["appointment-letter-queue"]` (check the actual query key used by this page's `useQuery` near line
116 and match it exactly).

- [ ] **Step 7 — manual verification**
Run: `npm run build` (must be zero TypeScript errors)
Start dev server, open `/joining-documents-tracker` and the Appointment Letter Queue page, confirm:
the new tile/column/checkbox render, an employee with `created_at` > 3 days old shows the badge, and
"Mark Left / Dropped" opens the dialog and (against a running backend) posts successfully.

- [ ] **Step 8: Commit**
```bash
git add src/pages/JoiningDocumentsTrackerPage.tsx src/pages/NativeAppointmentLetterQueue.tsx
git commit -m "feat(ui): SLA badges and Mark Left/Dropped action on joining docs + appointment letter pages"
```

---

## Task 5 — Migration: internal transfer voucher schema

**Files:**
- Create: `backend/sql/1836_payment_voucher_internal_transfer.sql`

- [ ] **Step 1: Write the migration**
```sql
-- 1836_payment_voucher_internal_transfer.sql
--
-- A fourth voucher purpose: moving money between two of the company's OWN bank accounts
-- (company_bank_account rows), as opposed to paying an external vendor/imprest/statutory head.
-- destination_bank_account_id is the new column release() needs to know which account receives
-- the funds; payable_account_id stays NOT NULL and is satisfied by the seeded
-- "Inter-Account Transfer" row below, used as the counterpart on both ledger legs — no schema
-- change to that column, same pattern release() already uses for "TDS Payable" by name lookup.

SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    COLUMN_TYPE NOT LIKE '%''internal_transfer''%',
    'ALTER TABLE payment_voucher MODIFY COLUMN source_type ENUM(''vendor_grn'',''imprest_allocation'',''sales_receipt'',''general'',''vendor_advance'',''vendor_advance_application'',''internal_transfer'') NOT NULL',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'source_type'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'destination_bank_account_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE payment_voucher ADD COLUMN destination_bank_account_id CHAR(36) NULL COMMENT ''FK company_bank_account. Set only when source_type=internal_transfer — the account receiving the funds.'' AFTER bank_account_id, ADD INDEX idx_pv_destination_bank_account (destination_bank_account_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT IGNORE INTO payable_account_master (id, account_name, account_type, tally_ledger_name, active_status)
VALUES (UUID(), 'Inter-Account Transfer', 'other', 'Inter-Account Transfer', 1);

SELECT '1836_payment_voucher_internal_transfer.sql applied' AS migration_status;
```
Note: `source_type` may already include `vendor_advance`/`vendor_advance_application` from an
earlier migration this repo already has — before writing this file for real, run
`SHOW COLUMNS FROM payment_voucher LIKE 'source_type'` (Task 8's sandbox) and copy the exact
current ENUM list into the `MODIFY COLUMN` above rather than assuming it, per CLAUDE.md's
"run SHOW COLUMNS before writing the query" rule.

- [ ] **Step 2: Commit**
```bash
git add backend/sql/1836_payment_voucher_internal_transfer.sql
git commit -m "feat(finance): add internal_transfer voucher schema (destination account + seeded payable head)"
```
(Not run against production — see Task 8 for local-sandbox verification. Running it against the
live DB requires the user's explicit go-ahead per CLAUDE.md.)

---

## Task 6 — Backend: `raise()` accepts `internal_transfer`

**Files:**
- Modify: `backend/src/modules/finance/payment-voucher.service.ts`
- Test: `backend/src/modules/finance/__tests__/payment-voucher.internal-transfer.test.ts` (new)

**Interfaces:**
- Consumes: `destination_bank_account_id` column, `'internal_transfer'` ENUM value, `'Inter-Account Transfer'` payable row (Task 5).
- Produces: `RaiseVoucherInput` gains `destinationBankAccountId?: string`.

- [ ] **Step 1: Write failing test**
```ts
// backend/src/modules/finance/__tests__/payment-voucher.internal-transfer.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const executeMock = vi.fn();
const connection = { execute: executeMock, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
vi.mock("../../../db/mysql.js", () => ({ db: { getConnection: vi.fn().mockResolvedValue(connection) } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));

describe("raise() — internal_transfer", () => {
  beforeEach(() => executeMock.mockReset());

  it("rejects a destination account equal to the source account", async () => {
    executeMock.mockResolvedValueOnce([[{ id: "acc-1", active_status: 1 }]]); // bank account lock
    executeMock.mockResolvedValueOnce([[{ id: "pam-1", active_status: 1 }]]); // payable account
    const { paymentVoucherService, PaymentVoucherError } = await import("../payment-voucher.service.js");
    await expect(paymentVoucherService.raise({
      sourceType: "internal_transfer",
      bankAccountId: "acc-1",
      destinationBankAccountId: "acc-1",
      payableAccountId: "pam-1",
      amount: "1000",
    } as any, "user-1")).rejects.toThrow(/destination.*same|same.*account/i);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**
Run: `cd backend && npx vitest run src/modules/finance/__tests__/payment-voucher.internal-transfer.test.ts`
Expected: FAIL — `"internal_transfer"` is rejected by the current `if (!["vendor_grn", ...].includes(...))` guard before the same-account check is ever reached (wrong error message).

- [ ] **Step 3: Implement**

In `payment-voucher.service.ts`, in `raise()`:
1. Add `"internal_transfer"` to the allowed-sourceType array (the `if (!["vendor_grn", "imprest_allocation", "general", "vendor_advance", "vendor_advance_application", "sales_receipt"].includes(input.sourceType))` line) — add it there.
2. Add `destinationBankAccountId?: string;` to the `RaiseVoucherInput` type.
3. After the existing per-sourceType `if/else if` chain (after the `vendor_advance_application` branch, before the `general`/`sales_receipt` comment), add:
```ts
      } else if (input.sourceType === "internal_transfer") {
        if (!input.destinationBankAccountId) {
          throw new PaymentVoucherError("A destination bank account is required for an internal transfer");
        }
        if (input.destinationBankAccountId === input.bankAccountId) {
          throw new PaymentVoucherError("The destination account cannot be the same as the source account");
        }
        const [[destAccount]] = await connection.execute<RowDataPacket[]>(
          `SELECT id, active_status FROM company_bank_account WHERE id = ? FOR UPDATE`,
          [input.destinationBankAccountId],
        );
        if (!destAccount) throw new PaymentVoucherError("Destination bank account not found", 404);
        if (!(destAccount as any).active_status) throw new PaymentVoucherError("The destination bank account is closed");
      }
```
4. Add `destination_bank_account_id` to the `INSERT INTO payment_voucher` column list and the bound
   params array (`input.destinationBankAccountId ?? null`), right after `bank_account_id`/its param.

- [ ] **Step 4: Run test, confirm it passes**
Run: `cd backend && npx vitest run src/modules/finance/__tests__/payment-voucher.internal-transfer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add backend/src/modules/finance/payment-voucher.service.ts backend/src/modules/finance/__tests__/payment-voucher.internal-transfer.test.ts
git commit -m "feat(finance): raise() accepts internal_transfer source type"
```

---

## Task 7 — Backend: `release()` posts the debit/credit pair

**Files:**
- Modify: `backend/src/modules/finance/payment-voucher.service.ts`
- Test: extend `backend/src/modules/finance/__tests__/payment-voucher.internal-transfer.test.ts`

**Interfaces:**
- Produces: `release()` on an `internal_transfer` voucher inserts exactly 2 `bank_account_ledger_entry` rows in the same transaction: one debit on `v.bank_account_id`, one credit on `v.destination_bank_account_id`, both `voucher_id = v.id`.

- [ ] **Step 1: Write failing test**
```ts
// append to payment-voucher.internal-transfer.test.ts
describe("release() — internal_transfer", () => {
  beforeEach(() => executeMock.mockReset());

  it("posts one debit row on the source account and one credit row on the destination account", async () => {
    executeMock
      .mockResolvedValueOnce([[{ // voucher row, FOR UPDATE
        id: "v1", status: "ceo_approved", source_type: "internal_transfer",
        bank_account_id: "acc-src", destination_bank_account_id: "acc-dst",
        payable_account_id: "pam-transfer", amount: "5000.00", ceo_approved_by: "ceo-1",
        voucher_number: "PV/001",
      }]])
      .mockResolvedValueOnce([[{ id: "acc-src", bank_id: "b1", branch_id: "br1", opening_balance: "100000", active_status: 1 }]]) // source lock
      .mockResolvedValueOnce([[]]) // assertNotInClosedPeriod internals / last entry lookups etc — adjust per actual release() call order found in Task 7 Step 2
      .mockResolvedValue([[]]); // catch-all for remaining calls

    const { paymentVoucherService } = await import("../payment-voucher.service.js");
    await paymentVoucherService.release("v1", "finance-1", "finance_head", {
      paymentMode: "NEFT", paymentDate: "2026-09-22",
    });

    const ledgerInserts = executeMock.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO bank_account_ledger_entry"));
    expect(ledgerInserts).toHaveLength(2);
  });
});
```
This test's exact mock sequencing depends on the real call order inside `release()` (read it fully
in Step 2 below before finalizing the mock chain — `assertNotInClosedPeriod`, the running-balance
lookup, and any journal posting calls all execute first). Get the real order from the file, then
adjust the `mockResolvedValueOnce` chain to match before treating this as the RED baseline.

- [ ] **Step 2: Run it, confirm it fails**
Run: `cd backend && npx vitest run src/modules/finance/__tests__/payment-voucher.internal-transfer.test.ts`
Expected: FAIL — today's `release()` has no `source_type === "internal_transfer"` branch at all, so
it falls through to whichever `else`/default lane exists (read the full `release()` body — Task 6's
exploration only covered the `vendor_grn` lane in detail — to find that default and confirm it
does NOT already post two rows).

- [ ] **Step 3: Implement**

Read the rest of `release()` (the `vendor_grn` lane was already read; read the `imprest_allocation`,
`general`, and `sales_receipt`/default lanes that follow it in the same `if/else if` chain) to find
where to insert a new `else if (v.source_type === "internal_transfer")` branch, matching the existing
running-balance/journal-line bookkeeping style. Post:

```ts
      } else if (v.source_type === "internal_transfer") {
        // Debit leg — source account.
        runningBalance = roundMoney(runningBalance - amount);
        await connection.execute(
          `INSERT INTO bank_account_ledger_entry
             (id, bank_account_id, entry_date, voucher_id, debit_amount, credit_amount,
              payable_account_id, narration, instrument_ref, running_balance, source_type, created_by)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'voucher', ?)`,
          [
            randomUUID(), v.bank_account_id, paymentDate, id, amount, v.payable_account_id,
            `Internal transfer out — voucher ${v.voucher_number}`, transactionRef, runningBalance, actorUserId,
          ],
        );

        // Credit leg — destination account. Locked and given its own running_balance lineage,
        // same FOR UPDATE discipline the source account already got above.
        const [[destAccount]] = await connection.execute<RowDataPacket[]>(
          `SELECT opening_balance FROM company_bank_account WHERE id = ? FOR UPDATE`,
          [v.destination_bank_account_id],
        );
        const [[destLastEntry]] = await connection.execute<RowDataPacket[]>(
          `SELECT running_balance FROM bank_account_ledger_entry
             WHERE bank_account_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
          [v.destination_bank_account_id],
        );
        const destRunningBalance = roundMoney(
          (destLastEntry ? Number((destLastEntry as any).running_balance) : Number((destAccount as any).opening_balance)) + amount,
        );
        await connection.execute(
          `INSERT INTO bank_account_ledger_entry
             (id, bank_account_id, entry_date, voucher_id, debit_amount, credit_amount,
              payable_account_id, narration, instrument_ref, running_balance, source_type, created_by)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'voucher', ?)`,
          [
            randomUUID(), v.destination_bank_account_id, paymentDate, id, amount, v.payable_account_id,
            `Internal transfer in — voucher ${v.voucher_number}`, transactionRef, destRunningBalance, actorUserId,
          ],
        );
      }
```
Place this alongside (not replacing) the existing lanes, matching whatever bracket structure Step 3's
reading found (the file may use `if/else if` or a `switch` — match the existing shape exactly).

- [ ] **Step 4: Run test, confirm it passes**
Run: `cd backend && npx vitest run src/modules/finance/__tests__/payment-voucher.internal-transfer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add backend/src/modules/finance/payment-voucher.service.ts backend/src/modules/finance/__tests__/payment-voucher.internal-transfer.test.ts
git commit -m "feat(finance): release() posts matching debit/credit pair for internal_transfer vouchers"
```

---

## Task 8 — Frontend: Raise Voucher form gains Internal Transfer

**Files:**
- Modify: `src/pages/finance/PaymentVouchersPage.tsx`

- [ ] **Step 1 — form state**

Add `destinationBankAccountId: ""` to `emptyRaiseForm`.

- [ ] **Step 2 — Purpose dropdown**

Add `<SelectItem value="internal_transfer">Internal Transfer (own accounts)</SelectItem>` to the
Purpose `<Select>` (after the existing 5 items).

- [ ] **Step 3 — conditional form section**

Change the `isVendorLane ? (...) : raiseForm.sourceType === "imprest_allocation" ? (...) : (...)`
chain to insert a new branch before the final `general`/fallback one:
```tsx
            ) : raiseForm.sourceType === "internal_transfer" ? (
              <div>
                <Label>Destination Bank Account (receiving)</Label>
                <SearchableSelect
                  id="payment-voucher-destination-bank-account"
                  aria-label="Destination Bank Account"
                  loading={bankAccountsQuery.isLoading}
                  options={(bankAccountsQuery.data ?? [])
                    .filter((a: any) => a.id !== raiseForm.bankAccountId)
                    .map((a: any) => ({ value: a.id, label: a.account_name, hint: a.account_number_masked ?? undefined }))}
                  value={raiseForm.destinationBankAccountId}
                  onChange={(v) => setRaiseForm((f) => ({ ...f, destinationBankAccountId: v }))}
                  placeholder="Select destination account"
                  searchPlaceholder="Type an account name…"
                />
                <p className="mt-1 text-xs text-slate-500">Moves funds between two of the company's own bank accounts — no vendor or GRN involved.</p>
              </div>
            ) : (
```

- [ ] **Step 4 — auto-fill and hide the Payable Account field for this source type**

Add, near the other `useEffect`s:
```tsx
  useEffect(() => {
    if (raiseForm.sourceType !== "internal_transfer" || raiseForm.payableAccountId) return;
    const transferAccount = (payableAccountsQuery.data ?? []).find((a: any) => a.account_name === "Inter-Account Transfer");
    if (transferAccount) setRaiseForm((f) => ({ ...f, payableAccountId: transferAccount.id }));
  }, [raiseForm.sourceType, raiseForm.payableAccountId, payableAccountsQuery.data]);
```
Wrap the existing "Payable Account" `<div>` block with
`{raiseForm.sourceType !== "internal_transfer" && ( ... )}` so it's hidden (auto-filled, not
user-facing) for this source type.

- [ ] **Step 5 — mutation payload**

In `raiseMutation`'s `mutationFn`, add:
```ts
      destinationBankAccountId: raiseForm.sourceType === "internal_transfer" ? raiseForm.destinationBankAccountId : undefined,
```

- [ ] **Step 6 — submit-disabled guard**

In the Raise dialog's submit `<Button disabled={...}>`, extend the condition to also disable when
`raiseForm.sourceType === "internal_transfer" && !raiseForm.destinationBankAccountId`.

- [ ] **Step 7 — manual verification**
Run: `npm run build` (zero TypeScript errors). Start dev server, open Payment Vouchers, select
"Internal Transfer", confirm the destination picker appears, the Payable Account field is hidden,
and (against a running backend + sandbox DB from Task 9) the voucher raises successfully.

- [ ] **Step 8: Commit**
```bash
git add src/pages/finance/PaymentVouchersPage.tsx
git commit -m "feat(ui): Internal Transfer option on Raise Voucher form"
```

---

## Task 9 — Local sandbox verification (no production writes)

Per CLAUDE.md: never run migrations or hit real data without approval; verify locally instead.

- [ ] **Step 1** — Confirm local MySQL 8.4 is available (`C:\Program Files\MySQL\MySQL Server 8.4`,
  per the `hrms2-local-mysql-sandbox-e2e` precedent). Initialize a scratch datadir, start on
  `127.0.0.1:3306`, set `sql_mode` to match prod
  (`ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION`).
- [ ] **Step 2** — Apply only the tables touched by this change:
  `CREATE TABLE` from `backend/sql/002_employees.sql`, `011_exit_management.sql`,
  `1701_company_bank_account.sql`, `1702_payable_account_master.sql`, `1703_payment_voucher.sql`
  (+ its later `ALTER`-only migrations that touch `source_type`/`particulars`), `1704_bank_account_ledger_entry.sql`,
  `1727_payment_voucher_grn_allocation.sql`, `ats_onboarding_bridge`, `branch_master`, `designation_master`,
  `candidate_bgv_report`, `appointment_letter_issue` (grep each `CREATE TABLE` name from the service
  files touched in Tasks 2–7 to build the exact list — do not guess; missing one surfaces as a clean
  `ER_NO_SUCH_TABLE`, not a silent gap).
- [ ] **Step 3** — Run the new migration `1836_payment_voucher_internal_transfer.sql` against the
  sandbox. Confirm with `SHOW COLUMNS FROM payment_voucher LIKE 'destination_bank_account_id'` and
  `SELECT account_name FROM payable_account_master WHERE account_name = 'Inter-Account Transfer'`.
- [ ] **Step 4** — Seed one employee row with `created_at` 5 days in the past and
  `employment_status = 'not_joined'`; run the exact `SELECT` Task 2/3 now produce directly against
  the sandbox; confirm the row is excluded and `days_since_id_created = 5`.
- [ ] **Step 5** — Seed two `company_bank_account` rows + one `ceo_approved` `internal_transfer`
  `payment_voucher` row; call `paymentVoucherService.release()` against the sandbox connection (not
  mocked this time); `SELECT * FROM bank_account_ledger_entry WHERE voucher_id = ?` and confirm
  exactly 2 rows, correct debit/credit amounts, and correct independent `running_balance` per account.
- [ ] **Step 6** — Delete the sandbox datadir when done (it holds copied schema only in this scoped
  version, no real employee data, but delete it anyway as standing practice).
- [ ] **Step 7** — Report results: which of the above passed against real MySQL, and explicitly flag
  anything not verified (e.g., full authenticated browser click-through, if time/session state
  didn't allow booting the full authenticated frontend+backend stack).

---

## Self-Review Notes
- **Spec coverage:** Task 1–4 cover Part A (SLA visibility, Mark Left/Dropped, exclusion filter
  fixes) in full. Task 5–8 cover Part B (internal transfer voucher, schema, raise, release, form) in
  full. Task 9 covers the spec's testing sections for both parts against a real database.
- **Type consistency:** `EmployeeRow`/`TrackerSummary` (Task 2 backend / Task 4 frontend),
  `EligibilityResult` (Task 3 backend / Task 4 frontend), `RaiseVoucherInput` (Task 6 backend /
  Task 8 frontend) — field names cross-checked identical on both sides in each task above.
- **No placeholders:** every step shows real code against the real file contents read during
  planning; Task 7 Step 1's test explicitly flags the one place (exact mock call order in
  `release()`) that must be confirmed from the live file before it's treated as final, rather than
  guessed.
