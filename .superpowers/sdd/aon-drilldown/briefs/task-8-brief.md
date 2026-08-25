## Global Constraints (from the plan)


- AON reference date is `COALESCE(e.salary_start_date, e.date_of_joining)` everywhere AON is
  computed — never `date_of_joining` alone (per approved spec §1).
- AON Attrition Rate = `exits_in_bucket_during_period ÷ AVG(at_risk_population_at_period_start,
  at_risk_population_at_period_end) × 100`, computed per bucket × per group (per approved spec §2).
- Headline "Overall Attrition Rate %" = `exits_in_period ÷ AVG(total_headcount_at_period_start,
  total_headcount_at_period_end) × 100` — company-wide, not bucket-scoped.
- Two-panel model only: Panel 1 (Slice Detail, chip bar, narrows in place) → Panel 2 (Employee
  List) → per-employee detail drawer. Never more than 2 stacked `Sheet` panels plus the detail
  drawer (which replaces Panel 2's content when opened, not stacks a 3rd `Sheet` alongside it).
- Every new/modified query goes through the existing `appendScopeConditions()` /
  `appendFilterConditions()` from `backend/src/modules/reporting/executors/types.ts` — no new
  scope bypass.
- Flag-for-Retention-Review reuses `upsertOpenWorkItem()` from `backend/src/shared/workItem.ts`
  unchanged — no new Work Inbox plumbing.
- No changes to payroll/salary calculation logic (per `CLAUDE.md`'s
  `hrms2-never-change-salary-calculation` discipline) — this plan only reads `salary_start_date`,
  never writes it or any payroll table.
- Drill-down drawers follow the platform-wide Drill-Down Mandate in `CLAUDE.md`: right-side
  `Sheet`/`SheetContent side="right"` at `sm:max-w-2xl`, full height, scrollable; the per-employee
  detail drawer fetches from a dedicated `GET /api/employees/:id` (never reuses the list payload);
  monetary values formatted with `₹` and Indian locale; dates as `DD/MM/YYYY HH:mm`.
- Never run a full backend `tsc` — scope typecheck to touched files only (per
  `hrms2-backend-typecheck-orphans`). Never run `npm run typecheck` and trust the root tsconfig's
  frontend result as a real gate — use the project's real `npm run typecheck` script.
- Commit frequently, by explicit path only — never `git add -A` / `git add .` (shared-tree rule).


---

### Task 8: Wire Panel 1 into the Overview tab's heatmap, add headline rate tile

**Files:**
- Modify: `src/components/reports/views/AonAnalyticsView.tsx`

**Interfaces:**
- Consumes: `DrillDownProvider`, `useDrillDown`, `SliceDetailPanel`, `EmployeeListPanel`,
  `EmployeeDetailDrawer` from Tasks 5-7.

- [ ] **Step 1: Export `useReport` and add the headline rate query**

In `AonAnalyticsView.tsx`, change `function useReport(...)` to `export function useReport(...)` so
`SliceDetailPanel` (Task 5) can share it in a later refactor (not required for this task to compile,
but avoids an immediate duplicate-logic follow-up).

Inside `AonAnalyticsView`'s default export function, add a headline-rate query and pass it down to
`Overview`:

```typescript
  const headline = useReport("aon-overall-attrition-rate", branchId ? { branchId, from, to } : { from, to });
```

Pass `headlineRate={headline}` as a new prop to `<Overview ... />`.

- [ ] **Step 2: Render the headline tile and make heatmap cells clickable**

In the `Overview` function, accept the new prop:

```typescript
function Overview({ from, to, branchId, headlineRate }: { from: string; to: string; branchId: string; headlineRate: ReturnType<typeof useReport> }) {
```

Add one more `StatTile` before the existing bucket tiles grid (inside the same
`grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4` container, as its first child):

```typescript
        {!loading && !headlineRate.isLoading && headlineRate.data?.[0] && (
          <StatTile
            label="Overall Attrition Rate"
            value={pct(Number(headlineRate.data[0].attrition_rate_pct ?? NaN))}
            denominator={`${num(Number(headlineRate.data[0].exits ?? 0))} exits over avg ${num(Number(headlineRate.data[0].avg_total_headcount ?? 0))} headcount`}
            intent="neutral"
            icon={<TrendingDown className="h-4 w-4" />}
          />
        )}
```

Wrap the whole `Overview` component body's returned JSX in `<DrillDownProvider>`, and make each
heatmap cell (`<td>` rendering `v`) clickable — replace the cell's `<span>` with a `<button>` that
pushes two chips (the group-by dimension and the AON bucket) and opens Panel 1. Modify the heatmap
`<td>` block:

```typescript
                      {row.vals.map((v, i) => (
                        <td key={BUCKETS[i]} className="px-2 py-1.5 text-right tabular-nums">
                          {v == null ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            <DrillCell
                              value={v}
                              max={max}
                              metric={metric}
                              groupBy={groupBy}
                              groupKey={row.key}
                              bucket={BUCKETS[i]}
                            />
                          )}
                        </td>
                      ))}
```

Add the `DrillCell` helper component just above `Overview`:

```typescript
function DrillCell({
  value, max, metric, groupBy, groupKey, bucket,
}: { value: number; max: number; metric: "headcount" | "exits" | "shrinkage"; groupBy: GroupBy; groupKey: string; bucket: Bucket }) {
  const { pushChip, openEmployeeList } = useDrillDown();
  const dimension = groupBy === "cost_centre_name" ? "costCentre" : groupBy === "process_name" ? "process" : "branch";

  return (
    <button
      type="button"
      onClick={() => {
        pushChip({ dimension, value: groupKey, label: groupKey });
        pushChip({ dimension: "aonBucket", value: bucket, label: `${bucket}d` });
        openEmployeeList();
      }}
      className="inline-block cursor-pointer rounded px-1.5 py-0.5 transition-opacity hover:opacity-80"
      style={{
        backgroundColor: `rgba(227, 73, 72, ${Math.min(0.75, (value / max) * 0.6)})`,
        color: value / max > 0.55 ? "#fff" : "#0f172a",
      }}
    >
      {metric === "shrinkage" ? pct(value) : num(value)}
    </button>
  );
}
```

Note: `pushChip` used here bypasses Panel 1 and opens Panel 2 (Employee List) directly by calling
`openEmployeeList()` immediately after pushing both chips — this is a deliberate simplification for
this first cut: a heatmap cell already represents one specific group+bucket combination (both
dimensions of this tab's drill path at once), so there's no intermediate narrowing step needed
before showing people. Render `<SliceDetailPanel>` only where a single chip is pushed at a time
elsewhere (not applicable to this specific Overview heatmap interaction, but kept available for
Cohort Survival / Deep Dive wiring in Plan 2, where narrowing happens one dimension at a time).

At the bottom of `Overview`'s returned JSX (after the existing trend chart), add:

```typescript
      <EmployeeListPanel open metric={metric === "headcount" ? "headcount" : metric === "exits" ? "exits" : "shrinkage"} from={from} to={to} />
      <EmployeeDetailDrawer />
```

And wrap the whole return value in `<DrillDownProvider>...</DrillDownProvider>` (adjust the JSX
nesting accordingly — the existing `<div className="space-y-4">` becomes the direct child of
`DrillDownProvider`).

Add the new imports at the top of the file:

```typescript
import { DrillDownProvider, useDrillDown } from "@/components/analytics/drilldown/DrillDownProvider";
import { EmployeeListPanel } from "@/components/analytics/drilldown/EmployeeListPanel";
import { EmployeeDetailDrawer } from "@/components/analytics/drilldown/EmployeeDetailDrawer";
```

- [ ] **Step 3: Frontend build check**

Run: `npx vite build --mode development 2>&1 | tail -60`
Expected: build succeeds with no new errors in `AonAnalyticsView.tsx` or the drilldown components.

- [ ] **Step 4: Manual smoke check**

Run the dev server per this project's existing `run` skill/pattern, navigate to
`/workforce/aon-analytics`, switch the Overview tab's metric to "Attrition (exits)", click a
heatmap cell, and confirm the Employee List panel opens with the right chip set and at least one
named row (or the correct empty state if that slice has no exits). Then click a named row and
confirm the Employee Detail drawer opens with real data from `GET /api/employees/:id` (check the
Network tab to confirm it's a fresh request, not reused list data).

- [ ] **Step 5: Commit**

```bash
git add src/components/reports/views/AonAnalyticsView.tsx
git commit -m "feat(analytics): wire drill-down + headline attrition rate into AON Overview tab

Heatmap cells are now clickable, opening the Employee List panel filtered to
that exact group+bucket slice. Added the Overall Attrition Rate headline
tile above the existing bucket tiles."
```

---

