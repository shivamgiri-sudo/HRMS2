# Task 4 Report — BiometricSyncPanel

Commit: `1ccab66fc3fcd5410a56d79489f626941cbcce23` (parent `1b0c8b66`, local `main`, not pushed)
File: `src/pages/wfm/attendance-integrity/BiometricSyncPanel.tsx` (new, 633 lines)

## Panel structure

Drop-in `<BiometricSyncPanel />`, no required props, matching `ExceptionsPanel` /
`MismatchesPanel` / `BillingRulesPanel` (Task 3 siblings) in card idiom, state handling,
and import conventions. Read-only — no `useWorkforceAccess`/`canEditPage`, no mutating
control, since all four backing endpoints are GET-only.

Layout, top to bottom:
1. Header (eyebrow "Integrations", description, single Refresh button — no date filter,
   since none of the four endpoints accept a date range).
2. KPI row, 5 tiles, `grid-cols-1 sm:grid-cols-2 lg:grid-cols-5`: Last Sync, Run Status
   (breakdown, not a lone status word), Failed Runs, Punch-Log Freshness, Devices Seen.
3. Core group (sync-status + sync-runs + sync-errors): overall status/confidence line,
   Recent Sync Runs table, Failed/Partially Failed Runs table — both `overflow-x-auto`.
4. Punches group (latest-punches): Per-Employee Day Rollups table, `overflow-x-auto`,
   explicitly labelled "not individual punches", with a `device_id` column rendered as a
   badge.

## Per-section 403 degradation

Backend reality (`peopleos.routes.ts`, Task 2, read before writing this panel):
`cosecMonitoringRouter` applies `requireRole(...COSEC_RUN_ROLES)` (the wide union) at
router level for `/sync-status`, `/sync-runs`, `/sync-errors`, then applies a second,
narrower `requireRole(...COSEC_PUNCH_ROLES)` specifically on `/latest-punches`. A role
outside `COSEC_RUN_ROLES` entirely gets 403 on all four; a role inside `COSEC_RUN_ROLES`
but outside `COSEC_PUNCH_ROLES` (e.g. `branch_head`, `branch_wfm`, `manager`,
`process_manager`) gets 200 on the first three and 403 only on the fourth.

The panel mirrors this exactly with two independent `LoadState` groups:
- `core` — one `Promise.all([sync-status, sync-runs, sync-errors])`, one shared
  loading/error/forbidden state, since a router-level 403 on one of these three means
  403 on all three identically. Drives 3 of the 5 KPI tiles + both core tables.
- `punches` — its own independent load/error/forbidden state. Drives 2 of the 5 KPI
  tiles (Punch-Log Freshness, Devices Seen) + the rollup table.

Detection: `getHrmsApiErrorStatus(err) === 403` per group (same helper `ExceptionsPanel`
uses). Each group's forbidden state renders its own amber `ShieldAlert` card in place of
its tables, and the two KPI tiles fed by that group individually swap their value for a
"Not available for your role" note (via a `forbidden` prop on the shared `KpiCard`)
instead of the row disappearing. Nothing in a `punches`-403 renders as core's empty
state or vice versa — they are separate `useState`s with separate loaders (`loadCore`,
`loadPunches`), fired together by `refresh()` but never sharing an error object.

How I convinced myself this holds: traced the exact middleware order in
`cosecMonitoringRouter` (router-level `requireRole` runs before the route-level one on
`/latest-punches` per the code comment), confirmed `COSEC_RUN_ROLES` is a strict
superset of `COSEC_PUNCH_ROLES` (`admin, hr, ceo, wfm, super_admin` all appear in the
wider list), so the only 403 combinations that can actually occur in production are (a)
all four 403 (role outside `COSEC_RUN_ROLES`) or (b) only `latest-punches` 403s (role
inside the run-role union but outside the punch-role list) — both are handled correctly
because `core` and `punches` are fully decoupled state, and there is no code path where a
403 on one silently produces an empty-success render on the other (each `catch` sets
`data: null` + a typed `error`, never leaves stale/default data standing in for a
failure).

## Status breakdown and device_id

- **Status breakdown**: a single "warning" KPI is meaningless given 2,051/2,067 live runs
  carry that status. Computed client-side from the loaded `sync-runs` list (`useMemo`
  over `core.data.runs`, capped at the API's own LIMIT 50) into success/warning/failed/
  running counts, rendered as three colored badges in one KPI tile, labelled "(last 50)"
  so it's clear this is a window, not the full 2,067-run history.
- **device_id**: added as its own column in the Per-Employee Day Rollups table (rendered
  as a slate badge) and rolled up into a "Devices Seen" KPI tile (`useMemo` over
  `punches.data`, `Set` of non-null `device_id`, capped/labelled "distinct device_id,
  last 100 rollups" for the same reason). This directly answers the brief's "Surface
  `device_id`" requirement and the fact that CEO/WFM dashboards already link here
  labelled "Devices" with nothing device-related previously on the page.

## Typecheck output

```
> vite_react_shadcn_ts@0.0.0 typecheck
> tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.node.json
```
Exit code 2, 83 `error TS` lines total, **none** in `BiometricSyncPanel.tsx` (verified via
`grep -n "BiometricSyncPanel" <output>` returning no matches, and `grep -c "error TS"`
returning exactly 83). All 83 pre-existing errors are in unrelated files: `FraudComparisonPanel.tsx`,
`BudgetTopupPanel.tsx` + its test, `GrnSearchWorkspace.tsx`, `OnboardingSteps1to5V2.tsx`
(bulk of them — stale `EmployeeForm` field names), `useCostCentres.ts`,
`NativeFullFinal.test.tsx`, `NativeIncentives.tsx`, `NativeOpsCommandCenter.tsx`,
`NativeOrgMasters.tsx`, `EsiRegDocsTab.tsx`, `ProfileEnhanced.tsx`/`V2.tsx`, `ProfileV3.tsx`,
`RosterImportPage.tsx` + its test — matching the documented ~83 baseline. Not fixed, per
scope.

## Deviations / interpretation calls

- Brief's KPI list says "Loading skeleton" — sibling panels (Task 3) use a centered
  `Loader2` spinner inside table `CardContent`, not a skeleton. I used `Skeleton` for the
  KPI tile values specifically (so the row never goes blank while its own numbers are
  still loading) and kept the sibling `Loader2` spinner convention for the two table
  bodies, to satisfy both "skeleton, never blank" and "consistency with siblings matters
  more than independent design choice."
- Added a small `data_confidence.risk_level` badge next to the overall status line. The
  `/sync-status` response includes `data_confidence` (score, risk_level, missing_items)
  which the brief doesn't explicitly ask to render, but discarding a returned field
  silently felt worse than surfacing it compactly — it's one badge, not a new section.
- KPI tiles are always rendered in shape (5 tiles, every load) rather than hiding the
  whole KPI row on a group's 403, so the row layout never jumps as roles differ — only
  the two group-specific tiles individually swap to "Not available for your role" while
  the other three stay populated. This is a more granular reading of "the panel must
  therefore degrade gracefully *per section*" than a page-level or table-level-only
  interpretation, applied at the tile level too since two of the five KPIs are
  punches-derived.

## Left alone / not investigated further

- `NativeCosecSyncMonitoring.tsx` (the stub) was not touched or deleted, per instructions
  — Task 6 removes it once routes are repointed.
- Did not add the panel to any route or nav entry — out of scope (Task 6).
- Did not build the console shell/tab wiring — out of scope (Task 5).
- Did not investigate why 2,051/2,067 runs are `warning` rather than `success` (a backend/
  data question, not a frontend rendering question); the panel surfaces the number
  accurately rather than editorializing about the cause.
