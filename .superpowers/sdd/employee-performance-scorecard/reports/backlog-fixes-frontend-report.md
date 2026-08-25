# Frontend backlog fixes — Performance Scorecard (2026-08-25)

## Fix 1 — stop showing permanently-empty metric columns as if they work

**Files changed:**
- `src/components/performance-scorecard/performanceScorecardColumns.ts`
- `src/components/performance-scorecard/PerformanceScorecardTable.tsx`
- `src/components/performance-scorecard/PerformanceCompareModal.tsx`

**What was done:**

1. `performanceScorecardColumns.ts` — added an optional `available?: boolean` field to
   `ScorecardColumn`. `qualityScore` (real data, from `kpi_daily_actual`) is marked
   `available: true`. `teamAttritionPct`, `teamShrinkagePct`, `teamRevenue` (hardcoded
   `null` forever in `performance-scorecard-snapshot.service.ts`) are marked
   `available: false`, with a comment explaining why (the KPI-role-template metric
   computation this feature's design promised was never built — out of scope here).

2. `PerformanceScorecardTable.tsx` — went with option (b) from the brief: columns for
   the 3 unavailable metrics still render (preserving the promised layout) but as a
   grayed, dashed-border "Not yet available" badge with a tooltip ("This metric isn't
   computed by the backend yet — coming in a future release."). These cells are no
   longer clickable and no longer call `setDrilldown(...)`, so they can't open a
   drawer that would return rows of nulls. `qualityScore` (and the baseline columns)
   are untouched — still clickable, still drill-down into real data.

3. `PerformanceCompareModal.tsx` — removed `teamAttritionPct` and `teamShrinkagePct`
   from `COMPARABLE_METRICS`, so they can no longer be selected as chart series (they
   would always have plotted a flat/empty line). `lateByMinutes` and `qualityScore`
   remain — both are real, populated per-row values. `chartData` mapping updated to
   drop the two removed fields.

   Checked `ScorecardRow` for a 3rd/4th real metric to backfill the panel:
   `unplannedLeaveFlag` is boolean (not a meaningful chart line), `pipStatus` and
   `attendanceStatus` are categorical, not numeric series. No other populated numeric
   field exists on the row. Left the panel with 2 real metrics rather than inventing
   a fake one — matches the brief's guidance ("that's fine — don't invent fake ones
   to pad the list").

## Fix 2 — admin regression on My Team → Performance tab

**File read:** `src/components/my-team/TeamPerformanceTab.tsx`,
`src/pages/MyTeamPage.tsx` (read-only, not modified — `MANAGER_ROLES` untouched).

**Finding:** `TeamPerformanceTab.tsx` renders `PerformanceScorecardTable` directly
with no error handling of its own — all error-state rendering already lives inside
`PerformanceScorecardTable.tsx` (from prior "Task 9" work), which already
distinguishes a 403 from a generic failure with role-appropriate copy:

> "You don't have access to view this scorecard, or your team scope could not be
> resolved. Contact HR/IT if you believe this is an error."

That copy was already correct and non-generic. The one problem: it was rendered in
the same alarming red/error-box styling (`bg-red-50 border-red-200 text-red-600`) as
a genuine failure, which reads as "something's broken" rather than "this is an
intentional restriction" — exactly the symptom described in the brief.

**Change made** (in `PerformanceScorecardTable.tsx`, not `TeamPerformanceTab.tsx` —
see rationale below): split the error branch so a 403 renders in a neutral/calm
style (`bg-slate-50 border-slate-200 text-slate-500`, no red) with updated copy
matching the brief's suggested wording: "Performance Scorecard isn't available for
your role — contact your administrator if you believe this is incorrect." Any other
error status keeps the original red error-box treatment (genuine failures should
still look alarming).

**Why the change landed in `PerformanceScorecardTable.tsx` instead of
`TeamPerformanceTab.tsx`:** the query and all its error state are fully encapsulated
inside `PerformanceScorecardTable` — `TeamPerformanceTab` has no visibility into the
query's error/status today. Threading that state out via a new callback prop just to
re-render the same message one level up would add prop-plumbing and duplicate
rendering logic for no behavioural difference, since `PerformanceScorecardTable` is
only ever used inside this one tab in the product today. The brief explicitly allows
this outcome: "If `PerformanceScorecardTable` already has decent 403 handling... you
may only need to verify it renders reasonably rather than making changes." The 403
copy was already role-appropriate; only the visual severity needed correcting, which
is naturally scoped to the component that owns the error rendering.
`TeamPerformanceTab.tsx` itself required no code change — access is still correctly
denied for admin (per the reviewed backend decision), it just now reads as an
intentional, calm state instead of a broken error.

## Verification

```
cd C:\Users\ADMIN\Desktop\HRMS2-latest
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
```

- `tsconfig.node.json`: 0 errors.
- `tsconfig.app.json`: pre-existing errors present (unrelated files: OnboardingSteps1to5V2.tsx,
  useCostCentres.ts, NativeFullFinal.test.tsx, HrReferenceLayout.tsx, NativeIncentives.tsx,
  NativeOpsCommandCenter.tsx, NativeOrgMasters.tsx, EsiRegDocsTab.tsx, ProfileEnhanced.tsx,
  ProfileEnhancedV2.tsx, ProfileV3.tsx, RosterImportPage.tsx and its test) — none of the 4
  files touched by this fix (`performanceScorecardColumns.ts`, `PerformanceScorecardTable.tsx`,
  `PerformanceCompareModal.tsx`, `TeamPerformanceTab.tsx`) appear anywhere in the error list.
  Zero new errors introduced.

No test suite exists for `src/components/performance-scorecard/*` or
`src/components/my-team/*` (`find ... -iname "*.test.*"` returned nothing), so no test
run was applicable.

## Concerns / follow-ups

- `TeamPerformanceTab.tsx` was not modified. If a future reviewer strictly wants the
  403-detection logic to live in `TeamPerformanceTab.tsx` itself (e.g. because
  `PerformanceScorecardTable` gets reused elsewhere later), it would need an
  `onError`/`status` callback prop threaded up — flagging this as a deliberate,
  documented judgment call rather than an oversight.
- Did not touch `performance-scorecard-snapshot.service.ts` or any backend code —
  the null-metric architecture gap is explicitly out of scope per the brief.
