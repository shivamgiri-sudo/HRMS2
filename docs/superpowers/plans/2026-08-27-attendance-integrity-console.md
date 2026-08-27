# Attendance Integrity Console — merge 4 WFM pages into one, fix all audit findings

Date: 2026-08-27
Ledger section: "Attendance Integrity Console"

## Background

Four live pages were audited 2026-08-27 against route -> gate -> component -> API -> live DB:

| Route | Verdict |
|---|---|
| `/wfm/attendance-exceptions` | intact (scoped, windowed, deep-linkable, export) |
| `/attendance/billing-config` | intact backend, but UI shows write controls the API refuses |
| `/wfm/cosec-monitoring` | 12-line stub over a generic JSON dumper; 3 of 4 backend endpoints have zero callers |
| `/wfm/mismatch-queue` | broken: ~10s load, no RBAC scoping, dead payroll-lock guard, client-only search, 403 renders as "No pending items" |

The user has decided: **merge all four into ONE page** and fix every finding.

## Target design

One page — **Attendance Integrity Console** at `/wfm/attendance-integrity` — with four tabs:

| Tab key | Panel | Existing page code that gates it |
|---|---|---|
| `exceptions` | Reconciliation & data-integrity exceptions (`attendance_reconciliation_issue`) | `WFM_ATTENDANCE_EXCEPTIONS` |
| `mismatches` | APR/biometric mismatch review (`attendance_daily_record`) | `WFM_LIVE_TRACKER` |
| `biometric` | COSEC sync/device health (`integration_sync_run`, `biometric_attendance_log`) | `WFM_LIVE_TRACKER` |
| `billing` | Attendance billing rules (`attendance_billing_config`) | `ATTENDANCE_BILLING_CONFIG` |

**No new page code, no migration.** Tabs are gated individually by the three page codes that already
exist in `role_page_access`. This is deliberate: minting a new code would require a migration, and
`runPendingMigrations` executes against PROD from a local `tsx watch`.

The four old routes become redirects that **preserve the query string**, because live dashboards
deep-link them (e.g. `ReferenceSharedPanels.tsx` links
`/wfm/attendance-exceptions?issueType=missing_adr&status=open`).

## Global Constraints

These bind every task. A reviewer must check each one.

1. **Never change payroll arithmetic.** No task may alter how any salary, LWP, or payable-day
   figure is computed. Fixing a *guard* that protects payroll data is in scope; changing a
   *calculation* is not.
2. **Do not weaken RBAC.** Every role widening in this plan is paired with row-level scope
   enforcement in the same task. Widening without scoping is a defect, not a fix.
3. **Page gate and API roles must agree.** After this plan, for every tab, the set of roles that can
   see the tab must equal the set of roles the tab's API accepts. A role that can open a surface it
   cannot load is the defect class this plan exists to remove.
4. **No silent failures.** Every `catch` must distinguish 403 from an empty result. A forbidden
   response must never render as an empty-success state. (Existing repo rule: silent failure is the
   dominant defect class here.)
5. **Frontend calls go through `hrmsApi` with an explicit `/api` prefix.** `hrmsApi` does not add
   one; a path without it returns the SPA's index.html at HTTP 200 and the panel renders blank.
6. **Design system (frozen, MAS PeopleOS):** Inter; `rounded-2xl` cards, `rounded-xl` inputs;
   card shadow `shadow-sm hover:shadow-md`; tone colours blue=info, green=success, amber=warning,
   red=critical; Lucide SVG icons only, never emoji; `transition-all duration-200` on hover;
   visible `focus-visible:ring-2` on every interactive element; no raw hex in `className`.
7. **Responsive without exceptions.** Every grid needs breakpoints (`grid-cols-1 sm:grid-cols-2
   lg:grid-cols-4`); no fixed pixel widths; tables wrapped in `overflow-x-auto`; tap targets >= 44px;
   no horizontal scroll on the page body at 375px.
8. **Every panel needs four states:** loading (skeleton/spinner, never blank), empty, error,
   and forbidden — each visually distinct from the others.
9. **Typecheck gate:** frontend is `npm run typecheck` (the root tsconfig misleadingly returns 0).
   Backend: NEVER run a full `tsc` — it surfaces unrelated orphan errors. Use a targeted
   `tsconfig.*-check.json` following the existing pattern, or run the vitest file for the module.
10. **Commit by explicit path only.** This tree is shared and has ~147 unrelated dirty files.
    Never `git add -A`, never rebase, never reset. Stage only the paths your task touched.

## Tasks

---

### Task 1 — Backend: harden `mismatch-review.routes.ts`

File: `backend/src/modules/wfm/mismatch-review.routes.ts`

Six defects, all confirmed against the live DB:

**1a. Dead payroll-lock guard (correctness, highest priority).**
The pre-update SELECT at ~line 96 reads:

    SELECT id, attendance_status, lwp_value, mismatch_flag, employee_id, record_date
    FROM attendance_daily_record WHERE id = ? LIMIT 1

It does not select `is_locked`. Three lines later `if (rec.is_locked)` tests `undefined`, so the
409 "Record is locked by payroll" refusal has **never** been reachable, while the handler goes on to
write `attendance_status` and `lwp_value`. Add `is_locked` to the SELECT column list.
Currently 0 locked rows sit in the queue, so there is no live exposure — it fires wrong the moment
payroll locks any of these months. Write a test that fails without the column and passes with it.

**1b. Unbounded list -> full table scan.**
`GET /` applies no default date window. Live `EXPLAIN`: `type: ALL, key: NULL, Using temporary;
Using filesort`, 124,954 rows examined; measured **9.9s warm** for page 1 plus **1.6s** for the
count, over a **49,826-row** queue spanning 2026-01-12..2026-08-26.
Default to `record_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)` when no `fromDate` is supplied —
same shape as `attendance-exceptions.routes.ts`, which is the good example in this codebase.

**1c. `ORDER BY` forces the filesort.**
`ORDER BY adr.record_date DESC, e.employee_code` sorts on a **joined** column, which defeats every
index. Change to `ORDER BY adr.record_date DESC, adr.employee_id` — `idx_adr_date_employee`
(`record_date, employee_id`) already exists, so this removes the temporary+filesort. Do not add an
index; the right one is already there.

**1d. No row-level scope enforcement.**
The router has zero `resolveUserBusinessScope`. `branchId`/`processId` are optional *filters*, not
enforced scope, so a branch-scoped `wfm` user sees all 49,826 rows org-wide.
Add scoping exactly as `attendance-exceptions.routes.ts` does it: `resolveUserBusinessScope` +
`buildEmployeeScopeCondition` against the LEFT-JOINed `employees` row, applied identically to the
list query, the count query, and the summary query so the three cannot drift.

**1e. Roles disagree with the page gate.**
Live `role_page_access` grants `WFM_LIVE_TRACKER` (can_view=1, active) to: `super_admin`,
`branch_head`, `branch_wfm`, `manager`, `process_manager`, `wfm`. The API accepts
`wfm, hr, admin, super_admin`. Only `wfm`/`super_admin` are in both sets.
Widen the **read** roles (`GET /`, `GET /summary`) to the union:
`wfm, branch_wfm, hr, admin, super_admin, ceo, payroll, manager, process_manager, branch_head`
— matching the VIEW_ROLES list in `attendance-exceptions.routes.ts`. This is only safe **because**
1d lands in the same task; scoping still restricts what each of them sees.
Leave the **write** role list on `PATCH /:id/resolve` as `wfm, hr, admin, super_admin` — resolving a
mismatch rewrites `attendance_status` and `lwp_value`, which payroll reads.

**1f. Summary window disagrees with the list.**
`GET /summary` is hard-coded to 60 days while the list is unbounded, so the tiles (27,700 /
19,121 / 54) and the list header (49,826) contradict each other on load. Make `/summary` accept and
honour the same `fromDate`/`toDate`/scope inputs as the list, with the same 30-day default.

**1g. Server-side search.**
Add an optional `search` query param matching `e.employee_code` or the employee's name, so the UI
can stop filtering client-side (see Task 3b).

Tests: `backend/src/__tests__/mismatch-review.routes.contract.test.ts` (new). Cover 1a (locked
record returns 409), 1d (a branch-scoped caller does not see another branch's row), 1e (a
`branch_head` caller gets 200 not 403), and 1f (summary honours the passed window).
Run: `cd backend && npx vitest run src/__tests__/mismatch-review.routes.contract.test.ts`

---

### Task 2 — Backend: COSEC monitoring + billing-config API alignment

**2a. `cosecMonitoringRouter` roles** (`backend/src/modules/peopleos/peopleos.routes.ts`).
Currently `requireRole("admin","hr","ceo","wfm")` while the page code `WFM_LIVE_TRACKER` grants
view to `super_admin, branch_head, branch_wfm, manager, process_manager, wfm`.
Widen to the union of both sets. This data is read-only device/run health with no per-employee
rows in the three run endpoints, so no scoping is required for them.
`GET /latest-punches` **does** return per-employee rows — leave its role list at the narrower
`admin, hr, ceo, wfm, super_admin` OR scope it; pick one and say which in the report. Do not
return per-employee punches to a role that cannot otherwise see that employee.

**2b. `getCosecMonitoring` does 4 queries and throws 3 away.**
(`backend/src/modules/peopleos/peopleos.service.ts:527`) Every one of the four endpoints calls the
same function, so `/sync-status` runs the 100-row punch join and the two 50-row run queries and
discards them. Split it into focused readers so each endpoint issues only the queries it returns.
Keep the existing SQL verbatim — it was fixed once already (the `biometric_punch` table never
existed; the live table is `biometric_attendance_log`) and that comment block must survive.

**2c. Billing-config GET roles** (`backend/src/modules/attendance/billing-config.routes.ts:24`).
`ATTENDANCE_BILLING_CONFIG` grants view to `super_admin, admin, finance_head, hr, wfm`; the list
endpoint accepts `finance_head, super_admin, admin, hr`. Add `wfm` — today `wfm` can open the page
and the list 403s.
Leave every write endpoint's roles unchanged: create/update stay `finance_head, super_admin`,
delete stays `super_admin`. This table drives the extra-day-salary rule in
`payrollCalculate.service.ts`, so the write surface stays narrow; the UI is fixed to match in
Task 3c rather than the API being widened to match the UI.

Tests: `backend/src/__tests__/cosec-monitoring.roles.contract.test.ts` (new) — assert a
`process_manager` gets 200 on `/sync-runs`, and that `/sync-status` no longer issues the punch
query. Plus one case for 2c.
Run: `cd backend && npx vitest run src/__tests__/cosec-monitoring.roles.contract.test.ts`

---

### Task 3 — Frontend: extract three existing pages into panels

Pure refactor plus the three UI defects listed below. **No new features.** The exceptions page is
the healthiest surface in this group — preserve its behaviour exactly.

Create `src/pages/wfm/attendance-integrity/` and move the render bodies in:

- `ExceptionsPanel.tsx` — from `NativeAttendanceExceptionEngine.tsx`. Remove its `DashboardLayout`
  wrapper (line ~292) and its own page `<h1>`; the console shell owns both. Keep every
  filter, the deep-link `useSearchParams` wiring, the CSV export, the 403 branch, and the
  distinct empty state. Behaviour must not change.
- `MismatchesPanel.tsx` — from `NativeAttendanceMismatchQueue.tsx`, with fixes 3a/3b below.
- `BillingRulesPanel.tsx` — from `NativeAttendanceBillingConfig.tsx`, with fix 3c below.

**3a. 403 renders as success.** `NativeAttendanceMismatchQueue.tsx:122` is a bare
`catch { toast(...) }`; the table then shows a green checkmark reading **"No pending items"** over a
49,826-row backlog. Capture the status with `getHrmsApiErrorStatus` (the pattern
`NativeAttendanceExceptionEngine.tsx` already uses) and render a distinct forbidden state. Empty,
error, and forbidden must be three visually different things.

**3b. Search only filters the current page.** `filteredRecords` (line ~174) filters the 50 rows
already on screen. Across ~997 pages it finds nothing. Send `search` to the API (Task 1g) with a
debounce, and reset to page 1 on change. Delete the client-side filter.

**3c. Write controls render for roles the API refuses.** `NativeAttendanceBillingConfig.tsx` never
imports `useWorkforceAccess`, so New Rule / Edit render for `hr`, `wfm` and `admin` (API allows
`finance_head`, `super_admin`) and Deactivate renders for `finance_head` (API allows `super_admin`).
Gate each control on `isResolved && canEditPage("ATTENDANCE_BILLING_CONFIG")` — and note the hook's
documented caveat: `canEditPage` returns false for every code until `isResolved` is true, so gating
without it flickers the control off on first render. Where the DB grant is broader than the API
(admin has `can_edit=1` but the API refuses admin), the control must still not render — say so in
the report so the residual `role_page_access` row can be corrected separately.

Also apply Global Constraints 6-8 to the two weaker panels: the mismatch summary row is
`grid grid-cols-3` with no breakpoints (three cards crushed at 375px) and its tiles must be
relabelled to match the window the list is actually showing (Task 1f).

Run after: `npm run typecheck`

---

### Task 4 — Frontend: build a real `BiometricSyncPanel`

`src/pages/wfm/attendance-integrity/BiometricSyncPanel.tsx` (new).

Replaces `NativeCosecSyncMonitoring.tsx` — 12 lines wrapping `PeopleOSDataPage`, a generic JSON
dumper that renders one KPI and the latest run as `JSON.stringify` in a black `<pre>`, with a date
picker whose `from`/`to` the endpoint ignores. Meanwhile the nav calls this "Biometric sync" and
the CEO/WFM dashboards link to it labelled **"Devices"** — and there is no device list on it.

Build the panel the backend already supports. Live data as of 2026-08-27: **2,067 COSEC sync runs
(2,051 warning, 15 failed, 1 success), latest 2026-08-27 13:32; 209,437 rows in
`biometric_attendance_log`.** All four endpoints exist and are mounted; three have never had a
caller:

- `GET /api/integrations/cosec/sync-status` — health header: current status, last run, confidence
- `GET /api/integrations/cosec/sync-runs` — recent runs (50): started/completed, status, counts
- `GET /api/integrations/cosec/sync-errors` — failed runs / non-zero `records_failed` (50)
- `GET /api/integrations/cosec/latest-punches` — per-day rollups (100): employee, device, first in,
  last out, total punches, raw minutes. Note these are **day rollups, not individual punches** —
  label them accordingly; do not call them "punches".

Requirements: a KPI row (last sync, status, failed runs, punch-log freshness) using the tone system;
a runs table and an errors table, both in `overflow-x-auto`; a device column surfaced from
`device_id` so the "Devices" label the dashboards use is finally true. Loading skeleton, empty,
error and forbidden states. No raw JSON anywhere on the surface.

Since `2,051 of 2,067` runs carry status `warning`, a single status KPI reading "warning" is not
informative on its own — show the run-status breakdown so the number means something.

Run after: `npm run typecheck`

---

### Task 5 — Frontend: the console shell

`src/pages/wfm/AttendanceIntegrityConsole.tsx` (new).

- Header: title "Attendance Integrity", one-line description, no per-panel page `<h1>`.
- Tab bar: Exceptions / Mismatches / Biometric Sync / Billing Rules, keyboard-navigable
  (arrow keys), `focus-visible:ring-2`, 44px tap targets, horizontally scrollable at 375px.
- Tab state lives in the URL as `?tab=<key>` via `useSearchParams`, so a tab is linkable and
  survives reload. **Changing tabs must not drop the other panels' query params** — the deep links
  in Task 6 arrive with `issueType`/`status`/`severity` attached.
- **Per-tab gating from existing page codes.** Render a tab only if `canViewPage(code)` for that
  tab's code (table in "Target design"). The route itself carries **no** single `Gate` wrapper —
  a single code cannot express the union. If zero tabs are visible, render the same
  "Access not available" panel `WorkforcePageGate` renders, including its Request Access button, so
  the denied experience is identical to every other gated page.
- Respect `isResolved` before computing visible tabs, or every tab flickers off on first render.
- If the URL names a tab the viewer cannot see, fall back to their first visible tab rather than
  rendering an empty shell.
- Lazy-load the four panels so opening the console does not fetch all four datasets at once.

Run after: `npm run typecheck`

---

### Task 6 — Routes, redirects, navigation, inbound links, tests

**6a. Route** (`src/config/routes/workforce.routes.tsx`): add `/wfm/attendance-integrity`
-> `<ProtectedRoute><DashboardLayout><AttendanceIntegrityConsole /></DashboardLayout></ProtectedRoute>`.
No `Gate` wrapper (Task 5 explains why). Note the existing routes are inconsistent about
`DashboardLayout` — exceptions and cosec self-wrap, billing and mismatch are wrapped by the route.
After the merge there must be exactly one wrapper, in the route.

**6b. Redirects preserving the query string.** A bare `<Navigate to>` drops the search string, and
the live dashboards deep-link with params. Write one small redirect component that reads
`useLocation().search` and forwards it with the tab appended:

| From | To |
|---|---|
| `/wfm/attendance-exceptions` | `/wfm/attendance-integrity?tab=exceptions&<original params>` |
| `/wfm/mismatch-queue` | `?tab=mismatches&<original params>` |
| `/wfm/cosec-monitoring` | `?tab=biometric` |
| `/attendance/billing-config` | `?tab=billing` |

**6c. `src/lib/pageRoutePageCodes.ts`** currently maps `/wfm/mismatch-queue` and
`/wfm/attendance-exceptions`. Those routes now redirect. Update per that file's own convention —
do not leave a mapping pointing at a route that no longer renders a page.

**6d. `src/components/layout/navConfig.tsx:246-249`** — replace the four sibling entries under
"Live Monitoring" with a single **"Attendance Integrity"** entry pointing at the new route.
Note the entries are inconsistent today (two use `pageCode`, two use `roles`); the merged entry
should use `pageCode: "WFM_ATTENDANCE_EXCEPTIONS"` as its visibility hint — it is the broadest of
the three grants — and the console's own per-tab gating does the real work.

**6e. Inbound links.** Update every caller to the new route + tab. Confirmed call sites:
- `src/pages/dashboards/reference/ReferenceSharedPanels.tsx` — 8 links, several carrying
  `?issueType=...&status=open`; preserve every param exactly.
- `src/pages/dashboards/reference/ReferenceDashboardShell.tsx` — 2 ("Devices")
- `src/pages/dashboards/reference/WfmAttendanceReferenceLayout.tsx` — 2
- `src/pages/NativeConfigurationCenter.tsx` — 1
- the cross-links the two queue pages hold to each other become tab switches, not navigations.

**6f. Tests.** `src/tests/app-shell-routing.contract.test.ts` asserts the old nav labels and paths
at lines 55-56 and 87-88 — update to the merged entry. `e2e/pending-items.smoke.ts:76` checks
`/wfm/mismatch-queue` is reachable — it must still pass via the redirect; if it cannot, update it.
Add a test that each old path redirects to the right tab **with its query string intact** — that is
the regression this task most needs to prevent.

**6g.** Delete the four now-unused page files only after everything above passes:
`NativeCosecSyncMonitoring.tsx`, and the three whose bodies moved in Task 3. Check for other
importers first.

Run after: `npm run typecheck` and `npx vitest run src/tests/app-shell-routing.contract.test.ts`

---

## Out of scope

- Changing any payroll calculation.
- Repointing the 19,451 unresolved `missing_punch` rows — under the standing ruling an unresolved
  `missing_punch` pays zero; this plan surfaces them, it does not reclassify them.
- Correcting the `role_page_access` rows that are themselves wrong (admin's `can_edit=1` on
  billing config; admin's inactive `WFM_LIVE_TRACKER` row). Task 3c reports them; fixing them is a
  migration and a separate decision.
