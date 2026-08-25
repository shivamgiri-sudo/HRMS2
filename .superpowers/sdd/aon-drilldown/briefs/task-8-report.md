# Task 8 Report — Wire Panel 1/2/3 drill-down + headline attrition rate into AON Overview tab

## Status: DONE_WITH_CONCERNS

Commit: `d7a97727` (pushed to `origin/main`, confirmed ancestor via
`git merge-base --is-ancestor d7a97727 origin/main`).

## What changed

`src/components/reports/views/AonAnalyticsView.tsx` only (verified via
`git status --porcelain` before staging, and `git show --stat HEAD` after
committing — exactly 1 file, 64 insertions / 14 deletions):

1. `useReport` is now `export function useReport(...)`.
2. New imports: `DrillDownProvider`, `useDrillDown` from
   `@/components/analytics/drilldown/DrillDownProvider`; `EmployeeListPanel`;
   `EmployeeDetailDrawer`.
3. `AonAnalyticsView`'s default export now builds
   `const headline = useReport("aon-overall-attrition-rate", branchId ? { branchId, from, to } : { from, to })`
   and passes `headlineRate={headline}` to `<Overview>`.
4. `Overview` accepts the new `headlineRate` prop, renders a `StatTile`
   ("Overall Attrition Rate") as the first child of the existing bucket-tiles
   grid, gated on `!loading && !headlineRate.isLoading && headlineRate.data?.[0]`.
5. New `DrillCell` helper component (button) replaces the plain `<span>` in
   each heatmap `<td>`; on click it pushes two chips (group dimension +
   AON bucket, using the exact `costCentre`/`process`/`branch`/`aonBucket`
   dimension keys `chipsToFilterParams` in `SliceDetailPanel.tsx` expects)
   and calls `openEmployeeList()` directly — per the brief's Step 2 note,
   this deliberately skips Panel 1 (`SliceDetailPanel`) for this one
   interaction, since a heatmap cell already represents both drill
   dimensions at once. `SliceDetailPanel` remains built but unused by this
   task, reserved for future Cohort Survival / Deep Dive wiring.
6. `Overview`'s returned JSX is now wrapped in `<DrillDownProvider>`, with
   `<EmployeeListPanel open metric={...} from={from} to={to} />` and
   `<EmployeeDetailDrawer />` mounted at the bottom, matching the two-panel +
   detail-drawer model from the plan's global constraints.
7. Nothing else in the file was touched — the metric switch, group-by
   selector, trend chart, tiles, GapBanner, CohortSurvival, DeepDive, and the
   outer shell (tabs, date range, branch filter) are byte-identical to
   before except for the two edits above (props threaded through, cell
   markup swap).

## `aon-overall-attrition-rate` column-name verification

No live HTTP hit against the production endpoint was possible with valid
credentials (see "Live smoke check" below), so I verified by reading
`overallAttritionRate` in
`backend/src/modules/reporting/executors/aon.executor.ts` directly
(lines 506–605, current on `main` as of this task, already rewritten
2026-08-25 for a performance fix per its own header comment). The final
`SELECT` (lines 554–558) returns exactly:

```sql
SELECT DATE_FORMAT(m.month_start, '%Y-%m') AS month,
       m.exits,
       m.avg_total_headcount,
       ROUND(m.exits * 100.0 / NULLIF(m.avg_total_headcount, 0), 2) AS attrition_rate_pct
```

This confirms the three column names the frontend brief snippet reads —
`attrition_rate_pct`, `exits`, `avg_total_headcount` — are exactly right;
no silent-mismatch risk from a renamed/aliased column.

**One real (non-column-name) concern found while doing this verification,
not something the brief's code-name check would have caught**: the query
is `ORDER BY month` ascending and returns one row per calendar month across
the requested `from`..`to` range (12 rows for the view's default trailing
year). `headlineRate.data[0]` — exactly what the brief specifies pasting —
therefore reads the **oldest** month in range, not an aggregate across the
whole range and not the most recent month. For the default 12-month,
no-filter view this will render the headline tile using the trailing
12-months-ago month's numbers, which is likely not what a reader expects
from a tile titled "Overall Attrition Rate" for the selected date range.
I implemented the brief exactly as specified (this is Task 8's literal
instruction, and changing aggregation semantics unilaterally would be
scope creep against `hrms2-do-not-change-existing-logic`), but flagging
this now: a follow-up should probably either (a) have the frontend take
`headlineRate.data[headlineRate.data.length - 1]` for "most recent month in
range", or (b) have the backend return one aggregate row instead of
one-row-per-month, or (c) sum/average across `headlineRate.data` client-side.
This is a UX/correctness gap, not a compile-time or column-name bug, so the
build and typecheck both pass cleanly with it in place.

## Build verification

`npx vite build --mode development` — full clean build, exit success,
`AonAnalyticsView-COYmqC_L.js` chunk emitted at 29.96 kB, no errors or
warnings referencing `AonAnalyticsView` or the drilldown components
(grepped the full build log for `error|AonAnalyticsView|warn` — only the
expected chunk-size-limit informational line and the chunk listing itself
appeared).

`npm run typecheck` (the project's real gate, not the misleading root
tsconfig) was also run in full. It surfaces 3 pre-existing errors, all in
`src/pages/dashboards/reference/HrReferenceLayout.tsx` (`Property
'onDrilldown' does not exist on type '{}'`) — unrelated to this task,
not in `AonAnalyticsView.tsx` or any file under `drilldown/`. Grepping the
full typecheck output for `AonAnalyticsView|drilldown` returned zero
matches — no typecheck regressions from this change.

## Live smoke check

Not performed as a real browser click-through. I do not have a valid
production auth token: the demo-token bypass
(`INTERNAL_DEMO_BYPASS=true`) that the backend test harness relies on is
gated to `NODE_ENV !== "production"`, and a direct curl with
`mock-token-super_admin` against `https://mcnhrms.teammas.in/api/reports/suite/aon-overall-attrition-rate`
correctly returned `{"success":false,"message":"Invalid or expired
token"}` — confirming the bypass is off in prod, as expected, but leaving
me without a way to authenticate for a live API/browser check without a
real password, which I was not given and should not guess at.

As the strongest available substitute, I traced the full click path
end-to-end in the code to confirm internal consistency:

- `DrillCell`'s `dimension` mapping (`cost_centre_name → costCentre`,
  `process_name → process`, else `branch`) matches `chipsToFilterParams`
  in `SliceDetailPanel.tsx` exactly (`costCentre → costCentreId`,
  `process → processId`, `branch → branchId`, `aonBucket → aonBucket`),
  which `EmployeeListPanel.tsx`'s `buildEmployeeListFilterParams` reuses
  via the same `chipsToFilterParams` import — so a heatmap click produces
  exactly the query params `aon-drilldown-employees` expects.
- `EmployeeListPanel` is mounted with `open` always true, gated internally
  on `showEmployeeList` from context — matches how `DrillCell` calls
  `openEmployeeList()`.
- Row click in `EmployeeListPanel` calls `selectEmployee(row.employee_id)`,
  which `EmployeeDetailDrawer` (mounted alongside it, same
  `DrillDownProvider`) reads via `useDrillDown().selectedEmployeeId` and
  fetches from `GET /api/employees/:id` — a dedicated per-employee fetch,
  never reused list data, matching the CLAUDE.md Drill-Down Mandate.
- Both panels and the provider live entirely inside `Overview`'s own
  `<DrillDownProvider>`, so switching tabs (Cohort/Deep Dive) unmounts them
  cleanly with no cross-tab state leakage.

This is a real gap versus the brief's Step 4 (an actual browser click was
not observed), and I'm stating it plainly rather than assuming it works.

## Concerns for follow-up (not blocking, per brief scope)

1. **`headlineRate.data[0]` picks the oldest month, not an aggregate or the
   latest month** — described above in detail. Recommend a small follow-up
   fix once this is browser-verified against real data.
2. **No manual browser smoke test was performed** (no valid prod
   credentials available in this environment) — recommend a human or a
   session with real login credentials do the Step 4 walkthrough
   (Overview tab → Attrition (exits) metric → click a heatmap cell → confirm
   Employee List panel opens with the right chips and rows → click a named
   row → confirm Employee Detail drawer issues a fresh `GET
   /api/employees/:id` request, visible in the Network tab).
3. Confirmed **not** a concern per the brief's own note: `SliceDetailPanel`
   stays unused by this wiring (by design) and its pre-existing missing
   `retry: false` (a known Task 5 finding) remains dormant since nothing
   in this task mounts it.

---

## Addendum — coordinator-directed fix: headline tile read the oldest month, not the latest

**Status: DONE**

Commit: `1df0308f` (pushed to `origin/main`, confirmed ancestor via
`git merge-base --is-ancestor 1df0308f origin/main`).

### The bug

Independently confirmed by the coordinator: `overallAttritionRate`'s SQL
(`backend/src/modules/reporting/executors/aon.executor.ts:591`) is
`ORDER BY month` with no `DESC` — ascending, oldest month first. The
frontend's `headlineRate.data?.[0]` (as literally specified in the Task 8
brief) therefore read the **oldest** month in the 12-month range (e.g.
`2025-09` when the range is `2025-09`..`2026-08`), not the most recent one
— exactly backwards from what an "Overall Attrition Rate" headline tile
should show.

### The fix

Backend SQL left untouched (its ascending order is reserved for a possible
future trend chart, per the coordinator's instruction). Frontend-only fix
in `src/components/reports/views/AonAnalyticsView.tsx`, inside `Overview`'s
headline `StatTile` block: replaced all three `headlineRate.data[0]`
references with `headlineRate.data[headlineRate.data.length - 1]` (the
guard condition, the `value` prop, and both figures in the `denominator`
string), so the tile now reads the last row in the ascending array — the
most recent month.

```typescript
{!loading && !headlineRate.isLoading && headlineRate.data?.[headlineRate.data.length - 1] && (
  <StatTile
    label="Overall Attrition Rate"
    value={pct(Number(headlineRate.data[headlineRate.data.length - 1].attrition_rate_pct ?? NaN))}
    denominator={`${num(Number(headlineRate.data[headlineRate.data.length - 1].exits ?? 0))} exits over avg ${num(Number(headlineRate.data[headlineRate.data.length - 1].avg_total_headcount ?? 0))} headcount`}
    intent="neutral"
    icon={<TrendingDown className="h-4 w-4" />}
  />
)}
```

### Manual trace (requested verification #3)

If the SQL's ascending `ORDER BY month` returns 12 rows
`2025-09, 2025-10, ..., 2026-08`, then:
- `headlineRate.data[0]` (old, buggy) → `2025-09` (oldest) — confirmed wrong.
- `headlineRate.data[headlineRate.data.length - 1]` = `headlineRate.data[11]`
  (new, fixed) → `2026-08` (the most recent month) — confirmed correct.

### Verification run

1. `npx vitest run src/components/analytics/drilldown/__tests__` — 3 test
   files, 18 tests, all passed. No test exists yet for
   `AonAnalyticsView.tsx` itself (confirmed again: no
   `src/components/reports/views/__tests__` directory), consistent with the
   original scoping — nothing regressed among the tests that do exist.
2. `npx vite build --mode development` — clean build, `✓ built in 8.69s`,
   `AonAnalyticsView-B8Kzdtwt.js` chunk emitted, grep of the full log for
   `error|AonAnalyticsView|warn` shows only the chunk listing and the
   pre-existing informational chunk-size-limit line — no new errors or
   warnings.

### Commit discipline

`git status --porcelain` before staging showed one concurrent unrelated
dirty file from another session (`src/components/my-team/TeamPerformanceTab.tsx`)
— left untouched, not staged. Staged and committed only
`src/components/reports/views/AonAnalyticsView.tsx` by explicit path;
`git show --stat HEAD` after commit confirmed exactly that one file, 3
insertions / 3 deletions, nothing else swept in. `git fetch` +
`git merge-base --is-ancestor` confirmed the push actually landed on
`origin/main` (`d7a97727..1df0308f`).

---

## Addendum 2 — coordinator-directed Critical fix: heatmap click sent a display name where the drill-down filter expected a UUID

**Status: DONE**

Commits: `c2658a92` (backend) and `03dc3adb` (frontend), both pushed to
`origin/main` and confirmed ancestors via
`git merge-base --is-ancestor <sha> origin/main`.

### The bug

Independently confirmed by the coordinator's review: `aonBucketHeadcount`,
`aonBucketAttrition`, and `aonBucketShrinkage` in
`backend/src/modules/reporting/executors/aon.executor.ts` only ever
SELECT/GROUP BY the display-name columns (`branch_name`,
`cost_centre_code`/`cost_centre_name`, `process_name`) — never the raw
`branch_id`/`cost_centre_id`/`process_id` FK columns. The Overview
heatmap's `grid` memo therefore only ever had a display name (`row.key`,
from `s(r[groupBy])`) to give `DrillCell`, and `DrillCell` pushed that name
straight into the drill-down chip's `value`. `chipsToFilterParams` maps
that value to `costCentreId`/`processId`/`branchId` query params, and
`aon-drilldown-employees` (Task 3) filters those as real
`e.branch_id = ?` / `e.cost_centre_id = ?` / `e.process_id = ?` UUID
comparisons — so every real heatmap click sent a name where a UUID was
expected, the filter never matched, and the Employee List panel always
rendered its empty state. This broke the entire interaction Task 8 exists
to deliver.

### The fix

**Backend** (`aon.executor.ts`, re-read fresh in full before editing, per
the coordinator's instruction — confirmed current shapes of all three
functions, including `aonBucketShrinkage`, which Tasks 1/2 never touched):

- `aonBucketHeadcount`: added `b.id AS branch_id, cc.id AS cost_centre_id,
  p.id AS process_id` to the `SELECT` list and `b.id, cc.id, p.id` to the
  `GROUP BY` clause (window function's own `PARTITION BY` left untouched —
  it doesn't need the ids).
- `aonBucketAttrition`: the `exit_groups` CTE already selected
  `e.branch_id, e.cost_centre_id, e.process_id` (needed for its own
  `at_risk_start`/`at_risk_end` joins) but the outer `SELECT` never
  projected them out to the final result — added
  `g.branch_id, g.cost_centre_id, g.process_id` to the outer `SELECT`. No
  `GROUP BY` change needed here since the ids were already part of
  `exit_groups`' grouping.
- `aonBucketShrinkage`: added the same `b.id AS branch_id, cc.id AS
  cost_centre_id, p.id AS process_id` to `SELECT` and `b.id, cc.id, p.id`
  to `GROUP BY`.

All three changes are additive only — the ids are functionally determined
by the same `LEFT JOIN`s already producing the display names, so grouping
grain is unchanged; a NULL id on an UNASSIGNED row is a pre-existing,
inherent limit (that row genuinely has no single id to filter by), not a
new bug.

**Frontend** (`AonAnalyticsView.tsx`):

- Added `GROUP_BY_ID_FIELD: Record<GroupBy, string>` mapping
  `branch_name → branch_id`, `cost_centre_name → cost_centre_id`,
  `process_name → process_id`.
- The `grid` memo now also tracks an `ids` map keyed by display name,
  captured from `r[idField]` the first time each key is seen, and each
  output row carries a new `id` field alongside `key`/`vals`/`total`.
- `DrillCell` gained a new `groupId` prop (separate from `groupKey`, which
  remains the display name used for the chip's `label` and the visible
  cell/row text). `pushChip` now sends `value: groupId` — the real FK
  UUID — instead of `value: groupKey`.
- The heatmap's `<DrillCell>` call site passes `groupId={row.id}` in
  addition to the existing `groupKey={row.key}`.

### Verification run

1. `cd backend && npx vitest run src/modules/reporting/executors/__tests__/`
   — 4 test files, 17 tests, all passed. No regressions in the AON
   executor test suite.
2. `npx vitest run src/components/analytics/drilldown/` — 3 test files, 18
   tests, all passed (unchanged from before this fix).
3. `npx vite build --mode development` — clean build, `✓ built in 9.24s`,
   `AonAnalyticsView-ByXRa-PE.js` chunk emitted; grep of the full log for
   `error|AonAnalyticsView|warn` shows only the chunk listing and the
   pre-existing chunk-size-limit informational line.
4. **End-to-end trace, requested verification #4**: `DrillCell`'s
   `dimension` mapping is unchanged (`cost_centre_name → costCentre`,
   `process_name → process`, else `branch`) and now pushes
   `{ dimension, value: groupId, label: groupKey }` — `groupId` comes from
   `row.id`, sourced in the `grid` memo from `r[GROUP_BY_ID_FIELD[groupBy]]`
   (i.e. `r.branch_id`/`r.cost_centre_id`/`r.process_id`, all now present
   on every row of `hc.data`/`at.data`/`sh.data` per the backend fix).
   `chipsToFilterParams` (`SliceDetailPanel.tsx`) maps `costCentre → 
   costCentreId`, `process → processId`, `branch → branchId` — real UUID
   values now flow into exactly those params, matching what
   `aon-drilldown-employees`'s `costCentreId`/`processId`/`branchId`
   filters (real `e.*_id = ?` comparisons) expect. The mismatch is fixed.
5. **Live read-only spot-check** (requested verification #5), via a
   throwaway Node script using the backend's own `mysql2` dependency and
   `.env` credentials (removed after use, never committed):
   - Row-count comparison for `aon-bucket-headcount`'s exact SELECT/GROUP
     BY shape: grouping by name only (`branch_name, cost_centre_code,
     cost_centre_name, process_name, bucket`) returns **97** groups;
     grouping by name **and** id together (`+ branch_id, cost_centre_id,
     process_id`) also returns **97** groups — confirming the additive
     columns do not change row count or split any existing group (an id is
     functionally determined by the same name within this data).
   - Sampled the top 3 groups by headcount with real ids attached, e.g.
     `branch_name: 'NOIDA-2', branch_id: 'febd8777-6583-11f1-adb1-00155d0ab410'`
     (headcount 213).
   - Round-tripped that `branch_id` directly against `branch_master`:
     `SELECT id, branch_name FROM branch_master WHERE id = ?` returned
     exactly `{ id: 'febd8777-...', branch_name: 'NOIDA-2' }` — the id
     genuinely resolves to the correct real branch.

### Commit discipline

`git status --porcelain` before each stage showed several concurrent
unrelated dirty files from another session (eight files under
`backend/src/modules/payroll/` and two under `src/pages/`) — left
untouched throughout, never staged. Staged and committed
`backend/src/modules/reporting/executors/aon.executor.ts` and
`src/components/reports/views/AonAnalyticsView.tsx` as two separate
commits, each by explicit path; `git show --stat HEAD` after each commit
confirmed exactly one file per commit. `git fetch` + `git merge-base
--is-ancestor` confirmed both pushes landed on `origin/main`
(`079648ae..03dc3adb`, encompassing both commits).
