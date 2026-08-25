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

### Task 5: Frontend — DrillDownProvider + Panel 1 (Slice Detail)

**Files:**
- Create: `src/components/analytics/drilldown/DrillDownProvider.tsx`
- Create: `src/components/analytics/drilldown/SliceDetailPanel.tsx`
- Test: `src/components/analytics/drilldown/__tests__/DrillDownProvider.test.tsx`

**Interfaces:**
- Produces:
  - `DrillDownChip = { dimension: string; value: string; label: string }`
  - `useDrillDown()` hook returning `{ chips: DrillDownChip[], pushChip: (c: DrillDownChip) => void, popToChip: (index: number) => void, clear: () => void, showEmployeeList: boolean, openEmployeeList: () => void, closeEmployeeList: () => void }`
  - `<DrillDownProvider>` wraps children and supplies the above via context.
  - `<SliceDetailPanel metric, groupByLabel, drilldownReportCode />` — Task 6 consumes
    `openEmployeeList`.

- [ ] **Step 1: Write the failing test**

Create `src/components/analytics/drilldown/__tests__/DrillDownProvider.test.tsx`:

```typescript
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DrillDownProvider, useDrillDown } from "../DrillDownProvider";

function Harness() {
  const { chips, pushChip, popToChip, clear } = useDrillDown();
  return (
    <div>
      <span data-testid="chip-count">{chips.length}</span>
      <button onClick={() => pushChip({ dimension: "costCentre", value: "cc-1", label: "Kolkata CC" })}>
        add cc
      </button>
      <button onClick={() => pushChip({ dimension: "aonBucket", value: "31-60", label: "31-60d" })}>
        add bucket
      </button>
      <button onClick={() => popToChip(0)}>pop to 0</button>
      <button onClick={clear}>clear</button>
      {chips.map((c, i) => <span key={c.dimension} data-testid={`chip-${i}`}>{c.label}</span>)}
    </div>
  );
}

describe("DrillDownProvider", () => {
  it("pushChip appends, popToChip truncates, clear empties", () => {
    render(<DrillDownProvider><Harness /></DrillDownProvider>);
    expect(screen.getByTestId("chip-count").textContent).toBe("0");

    fireEvent.click(screen.getByText("add cc"));
    fireEvent.click(screen.getByText("add bucket"));
    expect(screen.getByTestId("chip-count").textContent).toBe("2");
    expect(screen.getByTestId("chip-0").textContent).toBe("Kolkata CC");
    expect(screen.getByTestId("chip-1").textContent).toBe("31-60d");

    fireEvent.click(screen.getByText("pop to 0"));
    expect(screen.getByTestId("chip-count").textContent).toBe("1");

    fireEvent.click(screen.getByText("clear"));
    expect(screen.getByTestId("chip-count").textContent).toBe("0");
  });
});
```

Check the existing test setup for how other components in this codebase render with
`@testing-library/react` (search `grep -rl "@testing-library/react" src/components/**/__tests__/*.test.tsx | head -3` and mirror one for provider/setup imports if this project uses a custom render wrapper).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/analytics/drilldown/__tests__/DrillDownProvider.test.tsx`
Expected: FAIL — module `../DrillDownProvider` does not exist.

- [ ] **Step 3: Implement `DrillDownProvider.tsx`**

Create `src/components/analytics/drilldown/DrillDownProvider.tsx`:

```typescript
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

export interface DrillDownChip {
  dimension: string;
  value: string;
  label: string;
}

interface DrillDownContextValue {
  chips: DrillDownChip[];
  pushChip: (chip: DrillDownChip) => void;
  popToChip: (index: number) => void;
  clear: () => void;
  showEmployeeList: boolean;
  openEmployeeList: () => void;
  closeEmployeeList: () => void;
}

const DrillDownContext = createContext<DrillDownContextValue | null>(null);

export function DrillDownProvider({ children }: { children: React.ReactNode }) {
  const [chips, setChips] = useState<DrillDownChip[]>([]);
  const [showEmployeeList, setShowEmployeeList] = useState(false);

  const pushChip = useCallback((chip: DrillDownChip) => {
    setChips(prev => {
      // Replace an existing chip of the same dimension rather than stacking a duplicate --
      // e.g. clicking a different AON bucket cell replaces the current bucket chip, it
      // doesn't add a second one.
      const withoutSameDimension = prev.filter(c => c.dimension !== chip.dimension);
      return [...withoutSameDimension, chip];
    });
  }, []);

  const popToChip = useCallback((index: number) => {
    setChips(prev => prev.slice(0, index));
  }, []);

  const clear = useCallback(() => {
    setChips([]);
    setShowEmployeeList(false);
  }, []);

  const openEmployeeList = useCallback(() => setShowEmployeeList(true), []);
  const closeEmployeeList = useCallback(() => setShowEmployeeList(false), []);

  const value = useMemo(
    () => ({ chips, pushChip, popToChip, clear, showEmployeeList, openEmployeeList, closeEmployeeList }),
    [chips, pushChip, popToChip, clear, showEmployeeList, openEmployeeList, closeEmployeeList],
  );

  return <DrillDownContext.Provider value={value}>{children}</DrillDownContext.Provider>;
}

export function useDrillDown(): DrillDownContextValue {
  const ctx = useContext(DrillDownContext);
  if (!ctx) throw new Error("useDrillDown must be used inside a DrillDownProvider");
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/analytics/drilldown/__tests__/DrillDownProvider.test.tsx`
Expected: PASS

- [ ] **Step 5: Implement `SliceDetailPanel.tsx` (Panel 1)**

Create `src/components/analytics/drilldown/SliceDetailPanel.tsx`. This queries
`aon-bucket-headcount` / `aon-bucket-attrition` / `aon-bucket-shrinkage` (whichever the passed-in
`metric` needs — reusing the same `useReport`-style hook pattern already in `AonAnalyticsView.tsx`,
duplicated here rather than imported since `useReport` is not currently exported from that file —
add `export` to it in Task 8 once this panel needs to share it) filtered by the current chip set,
and renders the chip bar, a loading/empty/error state, and a "View employees" button:

```typescript
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useDrillDown } from "./DrillDownProvider";

interface SliceDetailPanelProps {
  open: boolean;
  onClose: () => void;
  metric: "headcount" | "exits" | "shrinkage";
  reportCode: string; // "aon-bucket-headcount" | "aon-bucket-attrition" | "aon-bucket-shrinkage"
  from: string;
  to: string;
}

function chipsToFilterParams(chips: { dimension: string; value: string }[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const chip of chips) {
    if (chip.dimension === "costCentre") params.costCentreId = chip.value;
    else if (chip.dimension === "process") params.processId = chip.value;
    else if (chip.dimension === "branch") params.branchId = chip.value;
    else if (chip.dimension === "aonBucket") params.aonBucket = chip.value;
  }
  return params;
}

export function SliceDetailPanel({ open, onClose, metric, reportCode, from, to }: SliceDetailPanelProps) {
  const { chips, popToChip, openEmployeeList } = useDrillDown();
  const filterParams = chipsToFilterParams(chips);

  const q = useQuery({
    queryKey: [reportCode, "slice-detail", JSON.stringify(filterParams), from, to],
    enabled: open && chips.length > 0,
    queryFn: async () => {
      const qs = new URLSearchParams({ ...filterParams, from, to, limit: "500", offset: "0" });
      const res = await hrmsApi.get<{ data?: Record<string, unknown>[] }>(
        `/api/reports/suite/${reportCode}?${qs.toString()}`,
        60_000,
      );
      return res.data ?? [];
    },
  });

  const rows = q.data ?? [];
  const valueKey = metric === "exits" ? "exits" : metric === "shrinkage" ? "shrinkage" : "headcount";
  const total = rows.reduce((a, r) => a + Number(r[valueKey] ?? 0), 0);

  return (
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Slice Detail</SheetTitle>
        </SheetHeader>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((chip, i) => (
            <span
              key={chip.dimension}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
            >
              {chip.label}
              <button
                type="button"
                onClick={() => popToChip(i)}
                className="ml-0.5 rounded-full hover:bg-slate-200"
                aria-label={`Remove ${chip.label} filter`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>

        {q.isLoading ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
        ) : q.error ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {(q.error as Error).message || "Failed to load this slice."}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                {metric === "exits" ? "Exits" : metric === "shrinkage" ? "Shrinkage" : "Headcount"} in this slice
              </p>
              <p className="text-xl font-bold text-slate-900">
                {metric === "shrinkage" ? `${total.toFixed(1)}%` : total.toLocaleString("en-IN")}
              </p>
            </div>

            <Button onClick={openEmployeeList} className="w-full">
              View employees
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 6: Frontend build check**

Run: `npx vite build --mode development 2>&1 | tail -40`
Expected: build succeeds with no new errors referencing `DrillDownProvider` or `SliceDetailPanel`
(a full production build is the real gate here per this repo's convention — a green
`tsc --noEmit` alone has shipped an unbuildable tree before).

- [ ] **Step 7: Commit**

```bash
git add src/components/analytics/drilldown/DrillDownProvider.tsx src/components/analytics/drilldown/SliceDetailPanel.tsx src/components/analytics/drilldown/__tests__/DrillDownProvider.test.tsx
git commit -m "feat(analytics): DrillDownProvider + Panel 1 (Slice Detail) for AON Analytics

Chip-based drill state (add/remove/replace-by-dimension) shared via context;
Panel 1 queries the existing aon-bucket-* report codes filtered by the current
chip set and shows a View Employees button opening Panel 2 (next task)."
```

---

