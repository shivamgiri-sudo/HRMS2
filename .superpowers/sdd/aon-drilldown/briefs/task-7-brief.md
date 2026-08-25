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

### Task 7: Frontend — per-employee detail drawer (third level)

**Files:**
- Create: `src/components/analytics/drilldown/EmployeeDetailDrawer.tsx`
- Test: `src/components/analytics/drilldown/__tests__/EmployeeDetailDrawer.test.tsx`

**Interfaces:**
- Consumes: `useDrillDown()`'s `selectedEmployeeId` / `deselectEmployee` from Task 6; existing
  `GET /api/employees/:id` endpoint (`backend/src/modules/employees/employee.routes.ts:1442`),
  which already applies scope checks and `redactEmployeeIdentifiers` server-side.
- Produces: `<EmployeeDetailDrawer />` — no props; reads `selectedEmployeeId` from context directly
  so it can be rendered once at the page shell level (Task 8) alongside the other two panels.

- [ ] **Step 1: Write the failing test**

Create `src/components/analytics/drilldown/__tests__/EmployeeDetailDrawer.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/hrmsApi", () => ({
  hrmsApi: {
    get: vi.fn().mockResolvedValue({ data: {
      id: "emp-1", employee_code: "MAS1", first_name: "Test", last_name: "One",
      date_of_joining: "2026-06-01", date_of_exit: null, branch_name: "Kolkata",
    } }),
  },
}));

import { hrmsApi } from "@/lib/hrmsApi";
import { DrillDownProvider, useDrillDown } from "../DrillDownProvider";
import { EmployeeDetailDrawer } from "../EmployeeDetailDrawer";

function Harness() {
  const { selectEmployee } = useDrillDown();
  return (
    <>
      <button onClick={() => selectEmployee("emp-1")}>select</button>
      <EmployeeDetailDrawer />
    </>
  );
}

describe("EmployeeDetailDrawer", () => {
  it("fetches GET /api/employees/:id when an employee is selected, never reusing list data", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <DrillDownProvider><Harness /></DrillDownProvider>
      </QueryClientProvider>,
    );

    screen.getByText("select").click();

    await waitFor(() => expect(hrmsApi.get).toHaveBeenCalledWith("/api/employees/emp-1"));
    await waitFor(() => expect(screen.getByText(/Test One/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/analytics/drilldown/__tests__/EmployeeDetailDrawer.test.tsx`
Expected: FAIL — module `../EmployeeDetailDrawer` does not exist.

- [ ] **Step 3: Implement**

Create `src/components/analytics/drilldown/EmployeeDetailDrawer.tsx`:

```typescript
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useDrillDown } from "./DrillDownProvider";

interface EmployeeDetail {
  id: string;
  employee_code: string;
  first_name: string;
  last_name?: string | null;
  date_of_joining?: string | null;
  date_of_exit?: string | null;
  branch_name?: string | null;
  cost_centre_name?: string | null;
  process_name?: string | null;
  [key: string]: unknown;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export function EmployeeDetailDrawer() {
  const { selectedEmployeeId, deselectEmployee } = useDrillDown();

  const q = useQuery({
    queryKey: ["employee-detail", selectedEmployeeId],
    enabled: !!selectedEmployeeId,
    queryFn: async () => {
      const res = await hrmsApi.get<{ data?: EmployeeDetail }>(`/api/employees/${selectedEmployeeId}`);
      return res.data;
    },
  });

  const emp = q.data;

  return (
    <Sheet open={!!selectedEmployeeId} onOpenChange={o => !o && deselectEmployee()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{emp ? `${emp.first_name} ${emp.last_name ?? ""}`.trim() : "Employee"}</SheetTitle>
          {emp && <SheetDescription>{emp.employee_code}</SheetDescription>}
        </SheetHeader>

        {q.isLoading ? (
          <div className="mt-4 space-y-2">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full rounded" />)}
          </div>
        ) : q.error ? (
          <p className="mt-4 text-sm text-rose-700">
            {(q.error as Error).message || "Failed to load employee detail."}
          </p>
        ) : emp ? (
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Assignment</p>
              <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-slate-500">Branch</dt><dd className="text-slate-900">{emp.branch_name ?? "—"}</dd>
                <dt className="text-slate-500">Cost Centre</dt><dd className="text-slate-900">{emp.cost_centre_name ?? "—"}</dd>
                <dt className="text-slate-500">Process</dt><dd className="text-slate-900">{emp.process_name ?? "—"}</dd>
              </dl>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Tenure</p>
              <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-slate-500">Joined</dt><dd className="text-slate-900">{formatDate(emp.date_of_joining)}</dd>
                <dt className="text-slate-500">Exited</dt><dd className="text-slate-900">{formatDate(emp.date_of_exit)}</dd>
              </dl>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
```

This is a first-cut subset of the full CLAUDE.md Drill-Down Mandate (assignment + tenure sections
only) — related sub-records, workflow timeline, documents, and audit trail sections are explicitly
deferred to Plan 2 (see the Open Items note at the end of this plan), since those need their own
dedicated endpoints/joins (exit workflow timeline, document list) that are out of scope for this
first vertical slice.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/analytics/drilldown/__tests__/EmployeeDetailDrawer.test.tsx`
Expected: PASS

- [ ] **Step 5: Frontend build check**

Run: `npx vite build --mode development 2>&1 | tail -40`
Expected: build succeeds, no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/analytics/drilldown/EmployeeDetailDrawer.tsx src/components/analytics/drilldown/__tests__/EmployeeDetailDrawer.test.tsx
git commit -m "feat(analytics): per-employee detail drawer (3rd drill level)

Fetches from the existing GET /api/employees/:id (never reuses the list
payload), per the CLAUDE.md Drill-Down Mandate. First cut covers assignment
and tenure sections; timeline/documents/audit-trail sections are Plan 2."
```

---

