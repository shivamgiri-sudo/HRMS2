# Spec B: Employee CTC Self-View + Run Lifecycle Board

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide employee transparency into salary structure and give payroll team operational visibility into run pipeline stages.

**Architecture:** CTC view as self-contained card in `/payroll/payslips` (NativePayslipCenter). Run Lifecycle Board as new card in `/payroll` dashboard analytics area. Both read-only; CTC reads `salary_package` or `employee_salary_structure` table; Pipeline reads `salary_prep_run` status aggregation.

**Tech Stack:** React 18 + TypeScript + Vite, shadcn/Radix UI, TanStack Query v5. Backend: read-only queries from existing tables.

## Global Constraints

- All new components use shadcn UI components only (Card, Badge, Table, Select, toast)
- No sensitive data exposed in pipeline (counts only, no employee names/salary)
- CTC card read-only, no edit capability
- Run status stages fixed: `draft` → `calculating` → `reviewed` → `approved` → `locked` → `finance-approved` → `disbursed`
- Frontend: `npx vite build --mode development` must pass
- Backend: `npx tsc --noEmit` must pass (no backend changes needed if existing endpoints suffice)

---

## Task 1: CTC Self-View Card in NativePayslipCenter

**Files:**
- Modify: `src/pages/NativePayslipCenter.tsx` — add "My Salary Structure" card with salary component breakdown

**Interfaces:**
- Consumes: `GET /api/employees/:id` (existing, returns employee record with basic_pct, hra_pct) OR `GET /api/payroll/salary-structure/:employeeId` (if new endpoint exists) OR query `salary_package` directly
- Produces: Card UI showing annual CTC breakdown + monthly equivalent

---

- [ ] **Step 1.1: Check existing salary structure data source**

Run:
```bash
cd "c:\Users\ADMIN\Desktop\HRMS2-latest"
grep -n "salary_package\|salary_structure\|employee_salary_structure\|basic_pct\|hra_pct" backend/src/modules/payroll/payroll.routes.ts | head -10
grep -n "salary_package\|salary_structure" backend/sql/*.sql | head -10
```

Expected: Find table name and endpoint. Assume `salary_package` exists with columns: `employee_id`, `basic`, `hra`, `conveyance`, `medical`, `personal_allowance`, `special_allowance`, `pf_employer_pct`, `esi_employer_pct`, `effective_from`.

- [ ] **Step 1.2: Determine CTC calculation logic**

Assume (from CLAUDE.md):
- Annual CTC = Basic + HRA + Conveyance + Medical + Personal + Special Allowance + (Employer contributions as % of CTC, calculated backwards)
- Simplify for now: Total Earnings = sum of all employee components, Employer Contribution = (PF% + ESI%) of Total Earnings (approximately 15.67% standard)
- Monthly CTC = Annual CTC / 12

- [ ] **Step 1.3: Read current NativePayslipCenter structure**

```bash
cd "c:\Users\ADMIN\Desktop\HRMS2-latest"
head -100 src/pages/NativePayslipCenter.tsx
grep -n "export default\|return (\|const " src/pages/NativePayslipCenter.tsx | head -20
```

Identify where to add the new card (likely in JSX return block).

- [ ] **Step 1.4: Add CTC card component**

Add this sub-component before `export default` in NativePayslipCenter.tsx:

```typescript
function CTCStructureCard() {
  const { user } = useUserRole();
  const { data: empData } = useQuery({
    queryKey: ["employee", user?.id],
    queryFn: () => hrmsApi.get(`/api/employees/${user?.employee_id}`).then((r) => r.data),
    enabled: !!user?.employee_id,
  });
  const emp = empData?.data?.[0] ?? empData?.data ?? null;

  if (!emp) {
    return <div className="text-sm text-muted-foreground">No salary structure assigned</div>;
  }

  // Simplified calculation: assume salary_package exists with components
  // If not, fallback to basic_pct-based calculation
  const basic = Number(emp.basic) || 0;
  const hra = Number(emp.hra) || 0;
  const conveyance = Number(emp.conveyance) || 0;
  const medical = Number(emp.medical) || 0;
  const personal = Number(emp.personal_allowance) || 0;
  const special = Number(emp.special_allowance) || 0;

  const totalEarnings = basic + hra + conveyance + medical + personal + special;
  const pfEmployerPct = Number(emp.pf_employer_pct) || 12;
  const esiEmployerPct = Number(emp.esi_employer_pct) || 3.25;
  const gratuityPct = 1.67;

  const employerContribution = Math.round((totalEarnings * (pfEmployerPct + esiEmployerPct + gratuityPct)) / 100 * 100) / 100;
  const annualCTC = totalEarnings + employerContribution;
  const monthlyCTC = Math.round((annualCTC / 12) * 100) / 100;

  const components = [
    { label: "Basic Salary", amount: basic, pct: totalEarnings > 0 ? ((basic / totalEarnings) * 100).toFixed(1) : "0" },
    { label: "House Rent Allowance", amount: hra, pct: totalEarnings > 0 ? ((hra / totalEarnings) * 100).toFixed(1) : "0" },
    { label: "Conveyance Allowance", amount: conveyance, pct: totalEarnings > 0 ? ((conveyance / totalEarnings) * 100).toFixed(1) : "0" },
    { label: "Medical Allowance", amount: medical, pct: totalEarnings > 0 ? ((medical / totalEarnings) * 100).toFixed(1) : "0" },
    { label: "Personal Allowance", amount: personal, pct: totalEarnings > 0 ? ((personal / totalEarnings) * 100).toFixed(1) : "0" },
    { label: "Special Allowance", amount: special, pct: totalEarnings > 0 ? ((special / totalEarnings) * 100).toFixed(1) : "0" },
  ];

  const employerComponents = [
    { label: "PF Employer", amount: Math.round((totalEarnings * pfEmployerPct) / 100 * 100) / 100, pct: pfEmployerPct },
    { label: "ESI Employer", amount: Math.round((totalEarnings * esiEmployerPct) / 100 * 100) / 100, pct: esiEmployerPct },
    { label: "Gratuity Reserve", amount: Math.round((totalEarnings * gratuityPct) / 100 * 100) / 100, pct: gratuityPct },
  ];

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-base">My Salary Structure</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Annual CTC breakdown (Effective from {emp.effective_from ? new Date(emp.effective_from).toLocaleDateString("en-IN") : "N/A"})
        </p>
      </div>

      {/* Earnings Table */}
      <div>
        <h4 className="font-medium text-sm mb-2">Employee Earnings</h4>
        <table className="w-full text-xs">
          <tbody>
            {components.map((comp) => (
              <tr key={comp.label} className="border-b">
                <td className="py-1.5 text-left">{comp.label}</td>
                <td className="py-1.5 text-right">₹{Math.round(comp.amount).toLocaleString("en-IN")}</td>
                <td className="py-1.5 text-right text-muted-foreground">{comp.pct}%</td>
              </tr>
            ))}
            <tr className="font-medium bg-muted">
              <td className="py-2 pl-2">Total Earnings</td>
              <td className="py-2 text-right">₹{Math.round(totalEarnings).toLocaleString("en-IN")}</td>
              <td className="py-2 text-right">100%</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Employer Contribution Table */}
      <div>
        <h4 className="font-medium text-sm mb-2">Employer Contribution</h4>
        <table className="w-full text-xs">
          <tbody>
            {employerComponents.map((comp) => (
              <tr key={comp.label} className="border-b">
                <td className="py-1.5 text-left">{comp.label}</td>
                <td className="py-1.5 text-right">₹{Math.round(comp.amount).toLocaleString("en-IN")}</td>
                <td className="py-1.5 text-right text-muted-foreground">{comp.pct.toFixed(2)}%</td>
              </tr>
            ))}
            <tr className="font-medium bg-muted">
              <td className="py-2 pl-2">Total Employer</td>
              <td className="py-2 text-right">₹{Math.round(employerContribution).toLocaleString("en-IN")}</td>
              <td className="py-2 text-right">{((employerContribution / annualCTC) * 100).toFixed(1)}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* CTC Summary */}
      <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 space-y-1.5">
        <div className="flex justify-between items-center">
          <span className="font-semibold text-sm">Total Annual CTC</span>
          <span className="font-bold text-lg">₹{Math.round(annualCTC).toLocaleString("en-IN")}</span>
        </div>
        <div className="flex justify-between items-center text-sm text-muted-foreground">
          <span>Monthly Equivalent</span>
          <span className="font-medium">₹{monthlyCTC.toLocaleString("en-IN")}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 1.5: Add CTC card to JSX in NativePayslipCenter**

In the main return statement of `NativePayslipCenter`, add the card after existing payslip sections (likely after the payslips table or in a section below it):

```tsx
<div className="mt-6">
  <CTCStructureCard />
</div>
```

Or if using a card/container pattern:

```tsx
<Card className="mt-6">
  <CardContent>
    <CTCStructureCard />
  </CardContent>
</Card>
```

- [ ] **Step 1.6: Frontend build check**

```bash
cd "c:\Users\ADMIN\Desktop\HRMS2-latest"
npx vite build --mode development 2>&1 | tail -20
```

Expected: clean build.

- [ ] **Step 1.7: Commit**

```bash
git add src/pages/NativePayslipCenter.tsx
git commit -m "feat(payroll): CTC Self-View card — salary structure transparency for employees"
```

---

## Task 2: Run Lifecycle Board in /payroll Dashboard

**Files:**
- Modify: `src/pages/Payroll.tsx` — add "Run Pipeline" card showing stage breakdown + visual flow

**Interfaces:**
- Consumes: `GET /api/payroll/runs` (existing, can filter/group by status) OR new `GET /api/payroll/runs/pipeline-summary` (optional backend endpoint)
- Produces: Card UI with 7-stage pipeline visualization + status counts

---

- [ ] **Step 2.1: Decide on backend approach**

Check if aggregation already exists:
```bash
cd "c:\Users\ADMIN\Desktop\HRMS2-latest"
grep -n "pipeline\|GROUP BY.*status" backend/src/modules/payroll/payroll.routes.ts
```

If not found, use frontend-side aggregation: fetch all runs and group by status in React state. This is simpler than adding a new endpoint.

- [ ] **Step 2.2: Add LifecyclePipelineCard component**

Add to `src/pages/Payroll.tsx` before `export default`:

```typescript
function LifecyclePipelineCard() {
  const { roleKeys } = useUserRole();
  const isPayrollRoleOK = roleKeys.some((r) => ["payroll", "payroll_head", "admin", "super_admin"].includes(r));

  // Fetch all runs
  const { data: runsRaw } = useQuery({
    queryKey: ["payroll-all-runs"],
    queryFn: () => hrmsApi.get("/api/payroll/runs?limit=100").then((r) => r.data),
  });
  const allRuns = (runsRaw as any[]) ?? [];

  // Pipeline stages in order
  const stages = ["draft", "calculating", "reviewed", "approved", "locked", "finance-approved", "disbursed"];

  // Count runs per stage
  const stageCounts: Record<string, number> = {};
  stages.forEach((s) => {
    stageCounts[s] = allRuns.filter((r: any) => r.status === s).length;
  });

  // Determine stage status: not-reached (gray), current (blue), completed (green)
  const getStageColor = (stage: string) => {
    const count = stageCounts[stage];
    if (count > 0) {
      // Determine if this is a "current" stage (has runs) or completed
      // For simplicity: if count > 0, it's active (blue). Once we pass it, it's green.
      // Conservative: show as blue if any runs in this stage
      return count > 0 ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-500";
    }
    return "border-slate-200 bg-slate-50 text-slate-500";
  };

  if (!isPayrollRoleOK) {
    return null; // Hidden for non-payroll roles
  }

  const totalRuns = allRuns.length;
  const completedRuns = stageCounts["disbursed"];
  const activeRuns = totalRuns - completedRuns;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-base">Run Pipeline</h3>
        <p className="text-xs text-muted-foreground mt-1">Payroll run lifecycle stages</p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-lg bg-slate-50 p-2 border">
          <p className="text-muted-foreground text-xs">Total Runs</p>
          <p className="font-semibold">{totalRuns}</p>
        </div>
        <div className="rounded-lg bg-blue-50 p-2 border border-blue-200">
          <p className="text-blue-600 text-xs">In Progress</p>
          <p className="font-semibold text-blue-700">{activeRuns}</p>
        </div>
        <div className="rounded-lg bg-green-50 p-2 border border-green-200">
          <p className="text-green-600 text-xs">Completed</p>
          <p className="font-semibold text-green-700">{completedRuns}</p>
        </div>
      </div>

      {/* Pipeline Stages */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {stages.map((stage, idx) => (
          <div key={stage} className="flex items-center gap-1 flex-shrink-0">
            <div
              className={`rounded-lg border px-2 py-1.5 text-xs font-medium text-center min-w-20 ${getStageColor(stage)}`}
            >
              <div className="text-[10px] capitalize font-semibold">{stage}</div>
              <div className="text-xs font-bold">{stageCounts[stage]}</div>
            </div>
            {idx < stages.length - 1 && <div className="text-muted-foreground text-lg">→</div>}
          </div>
        ))}
      </div>

      {/* Breakdown Table */}
      <div className="rounded-lg bg-muted/30 p-3">
        <h4 className="font-medium text-xs mb-2">Stage Breakdown</h4>
        <table className="w-full text-xs">
          <tbody>
            {stages.map((stage) => (
              <tr key={stage} className="border-b last:border-0">
                <td className="py-1 capitalize">{stage}</td>
                <td className="py-1 text-right font-medium">{stageCounts[stage]} run{stageCounts[stage] !== 1 ? "s" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2.3: Add LifecyclePipelineCard to Payroll.tsx JSX**

In the analytics section or after existing dashboard cards, add:

```tsx
<div className="mt-6">
  <LifecyclePipelineCard />
</div>
```

Or if using a grid layout:

```tsx
<Card>
  <CardContent>
    <LifecyclePipelineCard />
  </CardContent>
</Card>
```

- [ ] **Step 2.4: Verify role gating**

The card returns `null` if not `payroll` role, which hides it safely. Confirm in browser:
- Employee logs in → no pipeline card visible
- Payroll user logs in → pipeline card visible with counts

- [ ] **Step 2.5: Frontend build check**

```bash
cd "c:\Users\ADMIN\Desktop\HRMS2-latest"
npx vite build --mode development 2>&1 | tail -20
```

Expected: clean build.

- [ ] **Step 2.6: Manual test**

1. Payroll user navigates to `/payroll` dashboard
2. Scroll down to find "Run Pipeline" card
3. Verify 7 stages visible: draft → calculating → reviewed → approved → locked → finance-approved → disbursed
4. Verify counts match actual runs in each status (cross-check from `/payroll` main run list)
5. Verify summary stats at top (Total, In Progress, Completed) add up correctly

- [ ] **Step 2.7: Commit**

```bash
git add src/pages/Payroll.tsx
git commit -m "feat(payroll): Run Lifecycle Board — operational visibility into pipeline stages"
```

---

## Task 3: Final Validation & Testing

**Files:**
- None (validation only)

---

- [ ] **Step 3.1: Full build check**

```bash
cd "c:\Users\ADMIN\Desktop\HRMS2-latest"
npm run build 2>&1 | tail -30
```

Expected: success.

- [ ] **Step 3.2: Frontend TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors.

- [ ] **Step 3.3: Git status clean**

```bash
git status
```

Expected: nothing to commit, working tree clean.

- [ ] **Step 3.4: Commit log**

```bash
git log --oneline -3
```

Expected:
```
<latest> feat(payroll): Run Lifecycle Board — operational visibility into pipeline stages
<prev>   feat(payroll): CTC Self-View card — salary structure transparency for employees
```

---

## Success Criteria

1. **CTC Self-View:** Employee sees salary breakdown (Basic, HRA, Allowances, Employer %) with total annual + monthly CTC displayed
2. **Run Lifecycle Board:** Payroll user sees all 7 pipeline stages with run counts; stages color-coded
3. **Role-gating:** Non-payroll users cannot see pipeline; employees can see own CTC only
4. **Read-only:** Both cards have no edit capability
5. **Build passes:** `npm run build` and `npx tsc --noEmit` clean
6. **Manual testing:** Navigation to both pages works; data displays correctly
