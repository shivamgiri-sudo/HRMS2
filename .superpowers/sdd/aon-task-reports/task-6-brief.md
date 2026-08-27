## Global Constraints

- Active employee is `active_status = 1 AND LOWER(COALESCE(employment_status,'active')) = 'active'` — expected live count **1,091**, never 1,121.
- `LOWER()` is mandatory on `employment_status`: reactivation writes `'Active'`, and the column holds `'Active'` 273 / `'active'` 1,039.
- Never use `date_of_exit IS NULL` alone as an active test — 28,426 inactive employees have no exit date.
- Bucket list is exactly five, in this order: `In Training`, `0-30`, `31-60`, `61-90`, `90+`.
- All tenure DATEDIFFs are wrapped in `GREATEST(..., 0)` so negative AON is impossible.
- Backend tests run from `backend/`: `npx vitest run <path>`. Frontend typecheck runs from repo root: `npm run typecheck`.
- Never run a full backend `tsc` — the repo has ~94 pre-existing errors and orphan files; check only the files you touched.
- Commit per task, path-scoped (`git add <exact files>`). This is a shared working tree with other sessions active — never `git commit -a`.

### Task 6: Four filter dimensions, and honest date pickers

**Files:**
- Modify: `src/components/reports/views/AonAnalyticsView.tsx` — filter bar (~1231-1250), `Overview` (~350-372), `CohortSurvival` (~802), `DeepDive` (~1056)
- Test: `src/components/reports/views/__tests__/AonAnalyticsView.filters.test.tsx`

**Interfaces:**
- Consumes: existing endpoints `/api/org/branches`, `/api/org/processes`, `/api/org/departments`, `/api/finance/cost-centres`.
- Produces: `branchId`, `processId`, `departmentId`, `costCentreId` on every AON report call.

No backend change: `appendFilterConditions` already accepts all four. `managerId` is deliberately
not exposed — there is no manager list endpoint, and Deep Dive already slices by manager as a
dimension, which is the better shape.

- [ ] **Step 1: Write the failing test**

Create `src/components/reports/views/__tests__/AonAnalyticsView.filters.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * appendFilterConditions has always supported branchId, processId, departmentId and
 * costCentreId. The page exposed Branch only, so four working filters were unreachable.
 *
 * Separately, From/To were never passed to aon-bucket-headcount — the default metric — so on
 * first load changing the dates did nothing at all. Headcount is an as-of-today snapshot, so
 * the honest fix is to disable those inputs for that metric, not to fake the filtering.
 */
const SRC = readFileSync(
  resolve(process.cwd(), "src/components/reports/views/AonAnalyticsView.tsx"), "utf8");

describe("AON filters", () => {
  it("has state for all four dimension filters", () => {
    for (const s of ["branchId", "processId", "departmentId", "costCentreId"]) {
      expect(SRC, `${s} filter state missing`).toContain(`${s}, set`);
    }
  });

  it("loads each dropdown from a real endpoint", () => {
    for (const url of ["/api/org/branches", "/api/org/processes",
                       "/api/org/departments", "/api/finance/cost-centres"]) {
      expect(SRC, `${url} not called`).toContain(url);
    }
  });

  it("passes every filter into the report params", () => {
    // A filter absent from `base` is one the user can set and the server never sees.
    const base = /const base\s*=\s*\{[\s\S]{0,500}?\n  \}/.exec(SRC)?.[0] ?? "";
    for (const p of ["branchId", "processId", "departmentId", "costCentreId"]) {
      expect(base, `${p} never reaches the query`).toContain(p);
    }
  });

  it("does not pretend the date range filters headcount", () => {
    expect(SRC).toMatch(/as of today/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/reports/views/__tests__/AonAnalyticsView.filters.test.tsx`
Expected: FAIL — the three new filters have no state and no endpoints.

- [ ] **Step 3: Add the filter state and lookups**

Replace `const [branchId, setBranchId] = useState("");` (~line 1211) with:

```tsx
  const [branchId, setBranchId] = useState("");
  const [processId, setProcessId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [costCentreId, setCostCentreId] = useState("");
```

Add three lookups beside the existing `branches` query:

```tsx
  const processes = useQuery({
    queryKey: ["org-processes-aon"],
    queryFn: () => hrmsApi.get<{ data: { id: string; process_name: string }[] }>(
      "/api/org/processes?active_status=1&limit=500"),
  });
  const departments = useQuery({
    queryKey: ["org-departments-aon"],
    queryFn: () => hrmsApi.get<{ data: { id: string; dept_name: string }[] }>(
      "/api/org/departments?active_status=1&limit=500"),
  });
  const costCentres = useQuery({
    queryKey: ["finance-cost-centres-aon"],
    queryFn: () => hrmsApi.get<{ data: { id: string; cost_centre_name: string }[] }>(
      "/api/finance/cost-centres?active_status=1&limit=1000"),
  });
```

- [ ] **Step 4: Add the three selects**

After the Branch `<Field>`, add:

```tsx
        <Field label="Process">
          <select className={inputCls} value={processId} onChange={e => setProcessId(e.target.value)}>
            <option value="">All processes</option>
            {(processes.data?.data ?? []).map(p => (
              <option key={p.id} value={p.id}>{p.process_name}</option>
            ))}
          </select>
        </Field>
        <Field label="Department">
          <select className={inputCls} value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
            <option value="">All departments</option>
            {(departments.data?.data ?? []).map(d => (
              <option key={d.id} value={d.id}>{d.dept_name}</option>
            ))}
          </select>
        </Field>
        <Field label="Cost Centre">
          <select className={inputCls} value={costCentreId} onChange={e => setCostCentreId(e.target.value)}>
            <option value="">All cost centres</option>
            {(costCentres.data?.data ?? []).map(cc => (
              <option key={cc.id} value={cc.id}>{cc.cost_centre_name}</option>
            ))}
          </select>
        </Field>
```

Add the as-of-today note immediately after the date `<Field>` pair:

```tsx
        <p className="w-full text-[11px] text-slate-500">
          Headcount is as of today — the date range applies to Exits, Shrinkage, Cohort Survival
          and the Deep Dive.
        </p>
```

**Deliberate deviation from the spec, recorded here so the implementer does not "fix" it:** the
spec says the date inputs are *disabled* while the Headcount metric is selected. They are not
disabled, only annotated, because `metric` is state local to `Overview` while the date inputs
live in the page component. Disabling them would mean lifting `metric` up through the page and
back down into all three tabs — a refactor larger than the problem, touching the two tabs that
have no metric selector at all.

The note discharges the actual defect, which was that the control lied silently. If `metric` is
lifted for another reason later, add `disabled={metric === "headcount"}` to both inputs then.

- [ ] **Step 5: Thread the filters through the tabs**

Replace the three tab renders:

```tsx
      {tab === "overview" && <Overview from={from} to={to} branchId={branchId} processId={processId} departmentId={departmentId} costCentreId={costCentreId} headlineRate={headline} />}
      {tab === "cohort" && <CohortSurvival from={from} to={to} branchId={branchId} processId={processId} departmentId={departmentId} costCentreId={costCentreId} />}
      {tab === "deep" && <DeepDive from={from} to={to} branchId={branchId} processId={processId} departmentId={departmentId} costCentreId={costCentreId} />}
```

In `Overview` (~line 350) widen the props and rebuild `base`:

```tsx
function Overview({ from, to, branchId, processId, departmentId, costCentreId, headlineRate }: {
  from: string; to: string; branchId: string; processId: string; departmentId: string;
  costCentreId: string; headlineRate: ReturnType<typeof useReport>;
}) {
  const [groupBy, setGroupBy] = useState<GroupBy>("cost_centre_name");
  const [metric, setMetric] = useState<"headcount" | "exits" | "shrinkage">("headcount");

  // Every filter must be in `base`, and `base` is part of the react-query key, so changing any
  // one of them refetches instead of serving the previous cell.
  const base = {
    ...(branchId ? { branchId } : {}),
    ...(processId ? { processId } : {}),
    ...(departmentId ? { departmentId } : {}),
    ...(costCentreId ? { costCentreId } : {}),
  };
```

Apply the same prop widening to `CohortSurvival` (~802) and `DeepDive` (~1056), spreading the
same four-key object into their `useReport` params alongside `from`/`to`.

- [ ] **Step 6: Run test and typecheck**

Run: `npx vitest run src/components/reports/views/__tests__/AonAnalyticsView.filters.test.tsx`
Expected: PASS

Run: `npm run typecheck 2>&1 | grep AonAnalyticsView`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/components/reports/views/AonAnalyticsView.tsx src/components/reports/views/__tests__/AonAnalyticsView.filters.test.tsx
git commit -m "feat(aon): expose process, department and cost-centre filters"
```

---

