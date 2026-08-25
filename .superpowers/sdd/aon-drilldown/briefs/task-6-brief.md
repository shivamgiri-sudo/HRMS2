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

### Task 6: Frontend — Panel 2 (Employee List) + Flag for Retention Review

**Files:**
- Create: `src/components/analytics/drilldown/EmployeeListPanel.tsx`
- Modify: `src/components/analytics/drilldown/DrillDownProvider.tsx` (add `selectedEmployeeId` /
  `selectEmployee` / `deselectEmployee` to the context, for Task 7's detail drawer)
- Test: `src/components/analytics/drilldown/__tests__/EmployeeListPanel.test.tsx`

**Interfaces:**
- Consumes: `useDrillDown()` from Task 5 (extended); `aon-drilldown-employees` report code from
  Task 3; `POST /api/reports/aon-analytics/flag-retention` from Task 4.
- Produces: `<EmployeeListPanel metric, from, to />`; extends `useDrillDown()`'s return type with
  `selectedEmployeeId: string | null`, `selectEmployee: (id: string) => void`,
  `deselectEmployee: () => void`.

- [ ] **Step 1: Extend `DrillDownProvider` with employee selection state**

Modify `src/components/analytics/drilldown/DrillDownProvider.tsx`: add to
`DrillDownContextValue`:

```typescript
  selectedEmployeeId: string | null;
  selectEmployee: (id: string) => void;
  deselectEmployee: () => void;
```

Add corresponding state/handlers inside `DrillDownProvider` (alongside the existing `chips` state):

```typescript
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const selectEmployee = useCallback((id: string) => setSelectedEmployeeId(id), []);
  const deselectEmployee = useCallback(() => setSelectedEmployeeId(null), []);
```

Add these to the `value` object's dependency array and returned object.

- [ ] **Step 2: Write the failing test**

Create `src/components/analytics/drilldown/__tests__/EmployeeListPanel.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/hrmsApi", () => ({
  hrmsApi: {
    get: vi.fn().mockResolvedValue({ data: [
      { employee_code: "MAS1", employee_name: "Test One", aon_days: 45, risk_score: 62 },
    ] }),
    post: vi.fn().mockResolvedValue({ success: true, outcome: "created" }),
  },
}));

import { hrmsApi } from "@/lib/hrmsApi";
import { DrillDownProvider } from "../DrillDownProvider";
import { EmployeeListPanel } from "../EmployeeListPanel";

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DrillDownProvider>
        <EmployeeListPanel open metric="headcount" from="2026-01-01" to="2026-08-25" />
      </DrillDownProvider>
    </QueryClientProvider>,
  );
}

describe("EmployeeListPanel", () => {
  it("renders employee rows and fires the flag action", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("Test One")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /flag for retention review/i }));

    await waitFor(() =>
      expect(hrmsApi.post).toHaveBeenCalledWith(
        "/api/reports/aon-analytics/flag-retention",
        expect.objectContaining({ employeeId: expect.any(String) }),
      ),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/components/analytics/drilldown/__tests__/EmployeeListPanel.test.tsx`
Expected: FAIL — module `../EmployeeListPanel` does not exist.

- [ ] **Step 4: Implement `EmployeeListPanel.tsx`**

Create `src/components/analytics/drilldown/EmployeeListPanel.tsx`:

```typescript
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useDrillDown } from "./DrillDownProvider";

interface EmployeeListPanelProps {
  open: boolean;
  metric: "headcount" | "exits" | "shrinkage";
  from: string;
  to: string;
}

interface EmployeeRow {
  employee_code: string;
  employee_name: string;
  aon_days?: number;
  risk_score?: number;
  date_of_exit?: string;
  tenure_at_exit_days?: number;
  [key: string]: unknown;
}

export function EmployeeListPanel({ open, metric, from, to }: EmployeeListPanelProps) {
  const { chips, showEmployeeList, closeEmployeeList, selectEmployee } = useDrillDown();
  const queryClient = useQueryClient();
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set());

  const filterParams: Record<string, string> = { metric, from, to };
  for (const chip of chips) {
    if (chip.dimension === "costCentre") filterParams.costCentreId = chip.value;
    else if (chip.dimension === "process") filterParams.processId = chip.value;
    else if (chip.dimension === "branch") filterParams.branchId = chip.value;
    else if (chip.dimension === "aonBucket") filterParams.aonBucket = chip.value;
  }

  const q = useQuery({
    queryKey: ["aon-drilldown-employees", JSON.stringify(filterParams)],
    enabled: open && showEmployeeList,
    queryFn: async () => {
      const qs = new URLSearchParams({ ...filterParams, limit: "200", offset: "0" });
      const res = await hrmsApi.get<{ data?: EmployeeRow[] }>(
        `/api/reports/suite/aon-drilldown-employees?${qs.toString()}`,
        60_000,
      );
      return res.data ?? [];
    },
  });

  const flagMutation = useMutation({
    mutationFn: (params: { employeeId: string; riskBand?: string }) =>
      hrmsApi.post("/api/reports/aon-analytics/flag-retention", params),
    onSuccess: (_data, params) => {
      setFlaggedIds(prev => new Set(prev).add(params.employeeId));
      void queryClient.invalidateQueries({ queryKey: ["work-inbox"] });
    },
  });

  const rows = q.data ?? [];

  return (
    <Sheet open={open && showEmployeeList} onOpenChange={o => !o && closeEmployeeList()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Employees in this slice</SheetTitle>
        </SheetHeader>

        {q.isLoading ? (
          <div className="mt-4 space-y-2">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
          </div>
        ) : q.error ? (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {(q.error as Error).message || "Failed to load employees."}
          </div>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No employees match this slice.</p>
        ) : (
          <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {rows.map(row => (
              <div key={row.employee_code} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => selectEmployee(row.employee_code)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-semibold text-slate-900 hover:underline">
                    {row.employee_name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {row.employee_code}
                    {row.aon_days != null ? ` · ${row.aon_days} days on network` : ""}
                    {row.tenure_at_exit_days != null ? ` · ${row.tenure_at_exit_days} days at exit` : ""}
                  </p>
                </button>
                {metric !== "exits" && (
                  <Button
                    size="sm"
                    variant={flaggedIds.has(row.employee_code) ? "secondary" : "outline"}
                    disabled={flaggedIds.has(row.employee_code) || flagMutation.isPending}
                    onClick={() =>
                      flagMutation.mutate({
                        employeeId: row.employee_code,
                        riskBand: (row.risk_score ?? 0) >= 60 ? "High" : (row.risk_score ?? 0) >= 35 ? "Medium" : "Low",
                      })
                    }
                  >
                    {flaggedIds.has(row.employee_code) ? "Flagged" : "Flag for Retention Review"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

Note: the endpoint in Task 4 expects `employeeId` to be the employee's UUID `id`, but this panel's
list rows only carry `employee_code` (no `id` column is selected in Task 3's query for either
shape). Before this task is considered done, add `e.id AS employee_id` to both `SELECT` branches in
`aon-drilldown.executor.ts` (Task 3) and use `row.employee_id` here instead of
`row.employee_code` in the `flagMutation.mutate` call — reconcile this now rather than shipping a
mismatch: update Task 3's test fixtures and this component together in this task's commit.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/analytics/drilldown/__tests__/EmployeeListPanel.test.tsx`
Expected: PASS

- [ ] **Step 6: Frontend build check**

Run: `npx vite build --mode development 2>&1 | tail -40`
Expected: build succeeds, no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/analytics/drilldown/EmployeeListPanel.tsx src/components/analytics/drilldown/DrillDownProvider.tsx src/components/analytics/drilldown/__tests__/EmployeeListPanel.test.tsx backend/src/modules/reporting/executors/aon-drilldown.executor.ts backend/src/modules/reporting/executors/__tests__/aon-drilldown.executor.test.ts
git commit -m "feat(analytics): Panel 2 (Employee List) with Flag for Retention Review

Named employee rows for the current chip-filtered slice, each with a Flag
for Retention Review action calling the Task 4 endpoint. Employee identity
corrected to use employee_id (UUID) rather than employee_code, matching
what the flag-retention endpoint expects."
```

---

