# Task 3 Report — Frontend: extract three existing pages into panels

## What was created

`src/pages/wfm/attendance-integrity/`:

- `ExceptionsPanel.tsx` — extracted from `src/pages/NativeAttendanceExceptionEngine.tsx`.
- `MismatchesPanel.tsx` — extracted from `src/pages/NativeAttendanceMismatchQueue.tsx`, with 3a/3b.
- `BillingRulesPanel.tsx` — extracted from `src/pages/NativeAttendanceBillingConfig.tsx`, with 3c.

The three original source pages were **not modified or deleted** — confirmed via
`git status --porcelain` showing no diff on any of the three, only the new
`attendance-integrity/` directory as untracked. They remain importable for Task 6 to
repoint routes and delete later.

Each panel is a self-contained `export default function XPanel()` with no required props —
it owns its own fetch/filter state. None of them import `DashboardLayout` or render a
page-level `<h1>`; the future console shell (Task 5) owns that chrome.

## ExceptionsPanel — behaviour proof

I diffed the new file against its source line-by-line (`diff src/pages/NativeAttendanceExceptionEngine.tsx src/pages/wfm/attendance-integrity/ExceptionsPanel.tsx`). The only deltas are:

1. Removed `import { DashboardLayout } from "@/components/layout/DashboardLayout"`.
2. Renamed the export from `NativeAttendanceExceptionEngine` to `ExceptionsPanel`.
3. Removed the `<DashboardLayout>` wrapper tags and the page-level `<h1>Attendance Exception
   Engine</h1>` (kept the "Attendance" eyebrow label, the description paragraph with its link
   to the mismatch queue, and the Export/Refresh buttons, exactly as the brief specified).
4. Changed the `setSearchParams(new URLSearchParams(queryString), { replace: true })` call to
   a functional update that deletes and re-sets only the seven keys this panel manages
   (`status`, `issueType`, `severity`, `fromDate`, `toDate`, `search`, `branchId`) against the
   *current* `searchParams`, instead of replacing the whole query string. This is the fix
   called for under "Ambiguity I am resolving for you — Deep-link params": Task 5's shell will
   add a `tab` param, and the original code's `setSearchParams(new URLSearchParams(queryString))`
   would have silently deleted it on the panel's very first render (every filter effect fires
   on mount). The new version leaves any param this panel doesn't own untouched.

Every filter, the CSV export (with truncation-aware toast), the 403 branch via
`getHrmsApiErrorStatus`, pagination, the branch deep-link banner, and the distinct empty
state are byte-identical to the source. No other line changed.

## MismatchesPanel — 3a and 3b

**3a (403 renders as success).** The source's `load()` had a bare `catch { toast(...) }`
that left `records = []`, which the table rendered as the emerald "No pending items"
success state — indistinguishable from a real empty queue, over a 49,826-row backlog on a
403. Fixed by:
- Adding `error` state (`{ status: number | null; message: string } | null`), populated via
  `getHrmsApiErrorStatus(err)` in the catch, mirroring `ExceptionsPanel`'s pattern exactly.
- `isForbidden = error?.status === 403`.
- Three now-distinct states: an amber `ShieldAlert` card for forbidden (hides the
  filters/table/pagination entirely, same as `ExceptionsPanel`), a red `AlertTriangle` card
  for any other error (table/filters still render, matching the reference panel's own
  choice to let the user retry/adjust filters), and the original emerald `CheckCircle2` "No
  pending items" only when the fetch actually succeeded with zero rows.

**3b (search only filtered the current page).** Removed `filteredRecords` (the client-side
`.filter()` over the 50 rows already on screen) entirely. The search box now writes to a
`searchInput` state, debounced 400ms into `search` (same debounce pattern as
`ExceptionsPanel`), which is sent as the API's `search` query param (added in Task 1g) —
matches server-side against `employee_code` and `first_name`/`last_name` per
`mismatch-review.routes.ts`. A `useEffect` on `[fromDate, toDate, search]` resets `page` to
1 whenever any filter changes, replacing the three separate inline `setPage(1)` calls that
used to live in the date-picker `onChange` handlers.

**Summary tile relabelling.** `/api/wfm/mismatches/summary` now honours the same
`fromDate`/`toDate` the list uses (previously hard-coded to 60 days), so `loadSummary()` now
forwards those two params. The hard-coded `"(60d)"` suffix on two of the three tiles is
replaced with a `windowLabel(fromDate, toDate)` helper that reads: `"last 30 days"` with no
dates picked (the backend's actual default), `"since <date>"` / `"through <date>"` with one
bound set, or `"<from> to <to>"` with both — applied to all three tiles, since all three are
now equally windowed (previously only two of the three carried any window text at all,
which was itself inconsistent).

**Responsive grid.** `grid grid-cols-3 gap-4` → `grid grid-cols-1 gap-4 sm:grid-cols-3`.

## BillingRulesPanel — 3c

The source page never imported `useWorkforceAccess`, so every write control rendered
unconditionally. Fixed:
- Imported `useWorkforceAccess` from `@/hooks/useUserRole`, `canEdit = isResolved &&
  canEditPage("ATTENDANCE_BILLING_CONFIG")`.
- "Add Rule" button: wrapped in `{canEdit && (...)}`.
- Per-row "Edit" (pencil) and "Deactivate" (trash) buttons: both now additionally require
  `canEdit` (previously gated only on `entry.active_status === 1`).
- Confirmed against `backend/src/modules/attendance/billing-config.routes.ts`: `POST /` and
  `PATCH /:id` (used for both edit and deactivate — deactivate is a `PATCH` with
  `active_status: 0`) both require `finance_head`/`super_admin`; `DELETE /:id` requires
  `super_admin` only but isn't used by this UI. A single `canEdit` gate is therefore correct
  for all three controls.

Also added the four-state handling this panel was missing entirely (Global Constraint 8,
called out as binding for "the two weaker panels"): `error` state via
`getHrmsApiErrorStatus` on the list fetch (previously a bare `catch { toast(...) }`), an
amber forbidden card, a red error card, a `Loader2` spinner for loading (previously plain
text), and an explicit "No billing rules configured." empty state when `entries.length ===
0` (distinct from the existing per-scope "No rules at this scope" text, which still renders
inside each scope card when only some scopes are empty).

### Admin / stale grant note (as instructed)

I queried `role_page_access` directly against the live `mas_hrms` database:

```
role_key      can_view  can_edit
admin         1         1
finance_head  1         1
hr            1         0
super_admin   1         1
wfm           1         0
```

`admin` carries `can_edit = 1` on `ATTENDANCE_BILLING_CONFIG`, but
`billing-config.routes.ts` only accepts `finance_head`/`super_admin` on `POST`/`PATCH`
(and `super_admin` alone on `DELETE`). `canEditPage()` is a straight read of that grant row,
so **admin will still see Add Rule / Edit / Deactivate** after this fix — clicking them
will hit a live 403 from the API rather than silently failing, but the button itself
shouldn't be there. Per the task's own instruction, this is left as-is; correcting the
`role_page_access` row is a separate migration, out of scope for this frontend-only task.

## Typecheck

```
npm run typecheck
```

Full output: 83 pre-existing `error TS...` lines, none in any file under
`src/pages/wfm/attendance-integrity/` (verified with `grep -c "attendance-integrity"` on
the full output → 0 matches). The 83 errors are spread across unrelated files I did not
touch: `FraudComparisonPanel.tsx`, `BudgetTopupPanel.tsx` + its test, `GrnSearchWorkspace.tsx`,
`OnboardingSteps1to5V2.tsx`, `AonAnalyticsView.tsx`, `useCostCentres.ts`,
`NativeFullFinal.test.tsx`, `NativeIncentives.tsx`, `NativeOpsCommandCenter.tsx`,
`NativeOrgMasters.tsx`, `EsiRegDocsTab.tsx`, `ProfileEnhanced.tsx`, `ProfileEnhancedV2.tsx`,
`ProfileV3.tsx`, `RosterImportPage.tsx` (+ its contract test). These are pre-existing and out
of this task's scope.

## Deviations / decisions

1. **`ExceptionsPanel`'s `setSearchParams` rewritten as a functional update** (see above) —
   required so the console shell's future `tab` param survives this panel's own filter
   effects; explicitly directed under "Ambiguity I am resolving for you."
2. **`MismatchesPanel` gained an `error` state and a forbidden/error card pair** that the
   source page never had at all (not just the 3a bug) — required to satisfy Global
   Constraint 4/8, which the task description marks as live for this task, not just for the
   literal 3a defect line.
3. **`BillingRulesPanel` gained the same error/forbidden/loading/empty four-state handling**
   from scratch — the source page had none of it (bare catch, plain-text loading, no
   forbidden branch). Constraint 8 is called out as binding on "the two weaker panels," and
   this panel had none of the four states distinctly implemented, so I added them rather than
   leaving Constraint 8 unmet.
4. Left `ExceptionsPanel`'s cosmetic JSX indentation slightly uneven after removing the
   `DashboardLayout` nesting level (tsc/JSX don't care about whitespace) rather than
   re-indenting the ~280-line return block wholesale, to keep the diff minimal and auditable.

## Noticed but left alone

- `NativeAttendanceBillingConfig.tsx`'s Create/Edit dialog uses a bare `grid grid-cols-2
  gap-3` for the two effective-date fields inside a `max-w-lg` `Dialog`. Not touched — the
  brief's Constraint 6-8 callout was specific to the mismatch summary row, and a
  dialog-internal 2-column grid at that width doesn't cause page-level horizontal scroll.
- `loadSummary()`'s catch in `MismatchesPanel` stays "non-critical" (tiles simply don't
  render on failure) rather than surfacing its own 403 — the source page's original comment
  already documented this as intentional, and a hidden tile row is not a false-success
  state the way the source table's `filteredRecords.length === 0` branch was.

## Commit

Staged and committed by explicit path only (`src/pages/wfm/attendance-integrity/*.tsx` — all
newly created files, so no risk of picking up unrelated dirty tree state).

## Fix pass — review findings

Commit: `de1d2751921504d6f6255ce1d5313a3fbc028793` (parent `d5781bf4`, local `main`, not pushed — same convention as Task 4's commit, per `git status --porcelain` showing 147 unrelated dirty files in this shared tree). `git show --stat HEAD` confirms exactly one file changed: `src/pages/wfm/attendance-integrity/BillingRulesPanel.tsx` (35 insertions, 22 deletions). Built via a private `GIT_INDEX_FILE` (`git read-tree HEAD && git add -- <file> && git write-tree && git commit-tree ... -p HEAD && git update-ref refs/heads/main`) because the shared `.git/index` had this same file staged as a deletion by another session at the time (`git status --porcelain` showed both `D` and `??` for it).

### Finding 1 — write controls gated to API-real roles

Read `backend/src/modules/attendance/billing-config.routes.ts` directly (not from the prompt) to get the actual `requireRole(...)` calls:
- `POST /` (create): `requireRole('finance_head', 'super_admin')`
- `PATCH /:id` (update): `requireRole('finance_head', 'super_admin')`
- `DELETE /:id` (deactivate): `requireRole('super_admin')`

Replaced the single `canEdit` with:
```ts
const canWrite = isResolved && canEditPage("ATTENDANCE_BILLING_CONFIG");
const canCreateOrEdit = canWrite && hasAnyRole("finance_head", "super_admin");
const canDeactivate = canWrite && hasAnyRole("super_admin");
```
`canCreateOrEdit` gates Add Rule and the Edit (Pencil) button; `canDeactivate` gates the Deactivate (Trash2) button. `isResolved` stayed in the base `canWrite` so controls don't flicker on for a frame before role data lands (per the hook's own doc comment).

Used `hasAnyRole` from `useWorkforceAccess`, not `primaryRole`. `primaryRole` collapses a user to one highest-priority role (see `getPrimaryRole`'s priority list in `useUserRole.ts`) — a user who holds both `hr` (or any role above `finance_head` in that list) and `finance_head` would have `primaryRole !== 'finance_head'` and be wrongly denied. `hasAnyRole(...)` checks the full expanded `roleKeys` set, so it is correct for a multi-role user regardless of which role is "primary".

Did not touch `role_page_access` or write a migration — the stale `admin` grant stays as recorded in the file-header comment; the frontend now refuses to trust it alone.

### Role-to-control mapping (verified against the router)

- **Add Rule / Edit**: rendered only for `super_admin` or `finance_head` (`canEditPage` grant AND `hasAnyRole('finance_head','super_admin')`). Matches `POST /` and `PATCH /:id` exactly — both accept exactly these two roles, no more, no less.
- **Deactivate**: rendered only for `super_admin` (`canEditPage` grant AND `hasAnyRole('super_admin')`). Matches `DELETE /:id` exactly.
- One real asymmetry the static role gate cannot fully close: `PATCH /:id` special-cases `existing.scope_type === 'global'` to require `super_admin` even for a `finance_head` (`if (existing.scope_type === 'global' && req.authUser?.role !== 'super_admin') return 403`). The UI's Edit button has no such per-row exception — `canCreateOrEdit` does not check `entry.scope_type`, so a `finance_head` still sees Edit on the Global Default row and gets a 403 on save. (Deactivate is unaffected: it is already excluded for `scope_type === "global"` rows by the existing `entry.scope_type !== "global"` check, which predates this fix and I left alone — the API's `DELETE` handler also refuses to deactivate a global row for anyone, so that exclusion is correct as-is.) Closing the Edit gap would mean adding an `entry.scope_type !== "global" || hasAnyRole("super_admin")` condition to the per-row Edit button specifically — a targeted, single-line fix, but it goes beyond "one gating expression" scoped to the page-level `canEdit` computation this task named, and changes gating logic per-row rather than the named expression at line ~149. Flagging it here rather than silently leaving finance_head with a 403-yielding button on that one row.

### Finding 2 — accessibility

Added `aria-label="Edit billing rule"` to the Pencil button and `aria-label="Deactivate billing rule"` to the Trash2 button. Removed the dead `h-7 w-7` className from both — confirmed via the shared `Button` component that its icon-size variant already sets `min-h-[44px] min-w-[44px]`, which overrides the smaller inline class. No other className or behavior on those two buttons was changed.

### Typecheck

`npm run typecheck` (root `tsconfig.app.json` + `tsconfig.node.json`): exit code 2, 83 `error TS` lines total — matches the documented ~83 pre-existing baseline exactly (same count as Task 4's report same day). `grep "BillingRulesPanel" <output>` returns zero matches — this file is clean. All 83 errors are in unrelated files (`OnboardingSteps1to5V2.tsx`, `AonAnalyticsView.tsx`, `useCostCentres.ts`, `NativeFullFinal.test.tsx`, `NativeIncentives.tsx`, `NativeOpsCommandCenter.tsx`, `NativeOrgMasters.tsx`, `EsiRegDocsTab.tsx`, `ProfileEnhanced(V2).tsx`, `ProfileV3.tsx`, `RosterImportPage.tsx` + its test), not touched.
