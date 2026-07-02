# CEO Business Intelligence Dashboard Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add business-money-impact intelligence to the existing Admin Workforce Dashboard and Management Dashboard — billable vs active HC, revenue-at-risk, payroll liability, shrinkage cost, HC gap against mandate, and deep CEO/Finance/Operations/HR lens cards — all using data already in the live DB.

**Architecture:** New `GET /api/management/ceo-metrics` endpoint aggregates data from `salary_prep_run`, `salary_prep_line`, `workforce_mandate`, `shrinkage_daily_snapshot`, `billing_invoice`, `billing_unit`, `process_master`, `attrition_snapshot`, `employees`, `ats_candidate` into a single payload. `AdminWorkforceDashboard.tsx` gains a second "Business Impact" row of cards. `NativeManagementDashboard.tsx` gets deeper lens card sets for all four lenses. `NativeControlTower.tsx` gains owner + SLA age + escalation level fields using existing `control_tower_inbox` / `adherence_alert` tables. The Operations Dashboard route is unwired from the placeholder and wired to the real `NativeOperationsDashboard` component. The Quality Dashboard is added to sidebar nav.

**Tech Stack:** Express + TypeScript (ESM, `.js` imports), mysql2, React 18, TanStack Query v5, shadcn/ui, existing `hrmsApi`, existing `managementService` pattern, existing `numberValue()` helper.

---

## Scope note — this plan covers 5 independent deliverables:

| # | Deliverable | Files touched |
|---|-------------|---------------|
| 1 | `ceo-metrics` backend endpoint | `management.service.ts`, `management.routes.ts` |
| 2 | Admin Workforce Dashboard — Business Impact row | `AdminWorkforceDashboard.tsx` |
| 3 | Management Dashboard — deep lens cards | `NativeManagementDashboard.tsx` |
| 4 | Control Tower — war-room fields | `NativeControlTower.tsx`, `control-tower.service.ts` |
| 5 | Route & nav wiring: Operations + Quality | `App.tsx`, `CompactDashboardLayout.tsx` |

**Plans for future phases (not in this plan):**
- Plan 2: Client Portal scorecard enhancements
- Plan 3: WFM forecast + shrinkage decomposition dashboard
- Plan 4: Quality CAPA / coaching / calibration dashboard
- Plan 5: LMS sync health + ramp readiness dashboard
- Plan 6: Business hierarchy expansion (seat_master, billable_flag on employees)

---

## Existing patterns to follow

- Service functions in `backend/src/modules/management/management.service.ts` — use `Promise.all()` for parallel DB calls, `numberValue()` helper for safe number coercion
- Route handler style: `h(async (req, res) => { res.json({ data: await service.fn() }); })` — see `management.routes.ts:54`
- Frontend data fetch pattern: `hrmsApi.get<{ data: T }>(url)` inside `useQuery` from TanStack Query v5 — see `AdminWorkforceDashboard.tsx`
- Card component: `StatCard` in `NativeManagementDashboard.tsx` — reuse it
- DB: `db.execute<RowDataPacket[]>(sql, params)` — mysql2

---

## Task 1: Backend — `getCeoMetrics()` service function

**Files:**
- Modify: `backend/src/modules/management/management.service.ts` (add after `getWorkforceDashboard`)

- [ ] **Step 1: Add `getCeoMetrics()` to `managementService`**

Add this function to the `managementService` object in `management.service.ts`, after the closing brace of `getWorkforceDashboard`:

```typescript
async getCeoMetrics() {
  const [
    payrollResult,
    mandateGapResult,
    shrinkageResult,
    billingResult,
    attritionCostResult,
    hiringGapResult,
    ffLiabilityResult,
  ] = await Promise.all([
    // 1. Payroll liability this month (latest completed run)
    db.execute<RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(spl.gross_salary), 0)  AS total_gross,
         COALESCE(SUM(spl.net_salary), 0)    AS total_net,
         COALESCE(SUM(spl.pf_employer), 0)   AS total_pf_employer,
         COALESCE(SUM(spl.esic_employer), 0) AS total_esic_employer,
         COUNT(DISTINCT spl.employee_id)     AS employee_count,
         spr.run_month
       FROM salary_prep_run spr
       JOIN salary_prep_line spl ON spl.run_id = spr.id
       WHERE spr.run_month = (
         SELECT MAX(run_month) FROM salary_prep_run WHERE status IN ('draft','processing','completed')
       )
       GROUP BY spr.run_month
       LIMIT 1`
    ),
    // 2. HC gap: mandated vs available, by process
    db.execute<RowDataPacket[]>(
      `SELECT
         p.process_name,
         wm.mandated_hc,
         CEIL(wm.mandated_hc * (1 + (wm.buffer_pct + wm.shrinkage_pct + wm.attrition_buffer_pct + wm.training_buffer_pct) / 100)) AS required_hc,
         COALESCE(emp_count.active_hc, 0) AS active_hc,
         CEIL(wm.mandated_hc * (1 + (wm.buffer_pct + wm.shrinkage_pct + wm.attrition_buffer_pct + wm.training_buffer_pct) / 100))
           - COALESCE(emp_count.active_hc, 0) AS hc_gap
       FROM workforce_mandate wm
       JOIN process_master p ON p.id = wm.process_id
       LEFT JOIN (
         SELECT process_id, COUNT(*) AS active_hc
         FROM employees
         WHERE active_status = 1
         GROUP BY process_id
       ) emp_count ON emp_count.process_id = wm.process_id
       WHERE wm.active_status = 1
         AND wm.effective_from <= CURDATE()
         AND (wm.effective_to IS NULL OR wm.effective_to >= CURDATE())
       ORDER BY hc_gap DESC
       LIMIT 10`
    ),
    // 3. Shrinkage cost today (from latest shrinkage snapshot)
    db.execute<RowDataPacket[]>(
      `SELECT
         sds.process_id,
         p.process_name,
         sds.rostered_hc,
         sds.absent_hc,
         sds.total_shrinkage_pct,
         sds.snapshot_date,
         ROUND(
           COALESCE(sds.absent_hc, 0)
           * COALESCE(
               (SELECT AVG(esa.ctc_annual / 365 / 8)
                FROM employee_salary_assignment esa
                JOIN employees e ON e.id = esa.employee_id
                WHERE e.process_id = sds.process_id
                  AND esa.effective_from <= CURDATE()
                  AND (esa.effective_to IS NULL OR esa.effective_to >= CURDATE())
               ), 0
             ),
           2
         ) AS estimated_daily_revenue_at_risk
       FROM shrinkage_daily_snapshot sds
       LEFT JOIN process_master p ON p.id = sds.process_id
       WHERE sds.snapshot_date = (
         SELECT MAX(snapshot_date) FROM shrinkage_daily_snapshot WHERE snapshot_date <= CURDATE()
       )
       ORDER BY sds.total_shrinkage_pct DESC
       LIMIT 8`
    ),
    // 4. Billing vs payroll cost (last closed invoice month)
    db.execute<RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(bi.net_amount), 0)   AS total_billed,
         COALESCE(SUM(bi.gross_amount), 0) AS total_gross_billed,
         COUNT(DISTINCT bi.process_id)     AS process_count,
         DATE_FORMAT(bi.period_from, '%Y-%m') AS billing_month
       FROM billing_invoice bi
       WHERE bi.status IN ('approved', 'paid')
         AND bi.period_from >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')
       GROUP BY DATE_FORMAT(bi.period_from, '%Y-%m')
       ORDER BY billing_month DESC
       LIMIT 1`
    ),
    // 5. Attrition replacement cost (exits last 30d × avg CTC)
    db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS exits_30d,
         ROUND(
           COUNT(*) * COALESCE(
             (SELECT AVG(esa.ctc_annual)
              FROM employee_salary_assignment esa
              WHERE esa.effective_from <= CURDATE()
                AND (esa.effective_to IS NULL OR esa.effective_to >= CURDATE())
             ), 0
           ) / 12,
           0
         ) AS replacement_cost_estimate
       FROM employees
       WHERE COALESCE(date_of_leaving, resignation_date, date_of_exit)
         BETWEEN DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND CURDATE()`
    ),
    // 6. Open hiring gap (ATS pipeline not yet joined)
    db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS open_candidates,
         SUM(CASE WHEN current_stage IN ('offer_sent','offer_accepted') THEN 1 ELSE 0 END) AS offers_pending_joining,
         SUM(CASE WHEN current_stage IN ('screened','interview_scheduled','interview_done') THEN 1 ELSE 0 END) AS in_pipeline
       FROM ats_candidate
       WHERE active_status = 1
         AND current_stage NOT IN ('joined','rejected','declined','withdrawn','absconded')`
    ),
    // 7. F&F pending liability
    db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS pending_ff_count,
         COALESCE(SUM(ffc.net_payable), 0) AS pending_ff_liability
       FROM full_final_calculation ffc
       JOIN exit_request er ON er.id = ffc.exit_request_id
       WHERE er.status NOT IN ('completed','cancelled')
         AND ffc.is_ff_provisional = 1`
    ),
  ]);

  const payroll = payrollResult[0][0] ?? {};
  const mandateGaps = mandateGapResult[0] as RowDataPacket[];
  const shrinkageByProcess = shrinkageResult[0] as RowDataPacket[];
  const billing = billingResult[0][0] ?? {};
  const attrition = attritionCostResult[0][0] ?? {};
  const hiring = hiringGapResult[0][0] ?? {};
  const ff = ffLiabilityResult[0][0] ?? {};

  const totalHcGap = mandateGaps.reduce((s, r) => s + Math.max(0, numberValue(r.hc_gap)), 0);
  const totalRevenueAtRisk = shrinkageByProcess.reduce(
    (s, r) => s + numberValue(r.estimated_daily_revenue_at_risk), 0
  );
  const processesUnderStaffed = mandateGaps.filter(r => numberValue(r.hc_gap) > 0).length;

  return {
    payroll_liability: {
      run_month: payroll.run_month ?? null,
      total_gross: numberValue(payroll.total_gross),
      total_net: numberValue(payroll.total_net),
      employer_statutory: numberValue(payroll.total_pf_employer) + numberValue(payroll.total_esic_employer),
      employee_count: numberValue(payroll.employee_count),
    },
    hc_gap: {
      total_gap: totalHcGap,
      processes_understaffed: processesUnderStaffed,
      by_process: mandateGaps.map(r => ({
        process_name: String(r.process_name),
        mandated_hc: numberValue(r.mandated_hc),
        required_hc: numberValue(r.required_hc),
        active_hc: numberValue(r.active_hc),
        gap: Math.max(0, numberValue(r.hc_gap)),
      })),
    },
    revenue_at_risk: {
      total_daily_estimate: totalRevenueAtRisk,
      by_process: shrinkageByProcess.map(r => ({
        process_name: String(r.process_name ?? 'Unknown'),
        shrinkage_pct: numberValue(r.total_shrinkage_pct),
        absent_hc: numberValue(r.absent_hc),
        daily_revenue_at_risk: numberValue(r.estimated_daily_revenue_at_risk),
        snapshot_date: r.snapshot_date ?? null,
      })),
    },
    billing: {
      last_month_billed: numberValue(billing.total_billed),
      billing_month: billing.billing_month ?? null,
      process_count: numberValue(billing.process_count),
    },
    attrition_cost: {
      exits_30d: numberValue(attrition.exits_30d),
      replacement_cost_estimate: numberValue(attrition.replacement_cost_estimate),
    },
    hiring_pipeline: {
      open_candidates: numberValue(hiring.open_candidates),
      offers_pending_joining: numberValue(hiring.offers_pending_joining),
      in_pipeline: numberValue(hiring.in_pipeline),
    },
    ff_liability: {
      pending_count: numberValue(ff.pending_ff_count),
      pending_amount: numberValue(ff.pending_ff_liability),
    },
  };
},
```

- [ ] **Step 2: Register the route in `management.routes.ts`**

Add after the `workforce-dashboard` route (line ~55):

```typescript
router.get("/ceo-metrics", requireRole("admin", "hr", "ceo", "finance"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await managementService.getCeoMetrics() });
}));
```

- [ ] **Step 3: Smoke-test the endpoint**

```bash
curl -s -H "Authorization: Bearer <your-token>" http://localhost:5055/api/management/ceo-metrics | jq .
```

Expected: JSON with keys `payroll_liability`, `hc_gap`, `revenue_at_risk`, `billing`, `attrition_cost`, `hiring_pipeline`, `ff_liability`. No 500 errors. If a table doesn't exist yet (e.g. `shrinkage_daily_snapshot`), the query will return zero rows — that's fine, `numberValue` returns 0.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/management/management.service.ts backend/src/modules/management/management.routes.ts
git commit -m "feat(management): add getCeoMetrics endpoint with payroll liability, HC gap, revenue-at-risk"
```

---

## Task 2: Admin Workforce Dashboard — Business Impact Row

**Files:**
- Modify: `src/components/dashboard/AdminWorkforceDashboard.tsx`

The existing dashboard fetches `/api/management/workforce-dashboard`. We add a second `useQuery` for `/api/management/ceo-metrics` and render a "Business Impact" section below the existing KPI cards.

- [ ] **Step 1: Add the CEO metrics query**

In `AdminWorkforceDashboard.tsx`, find the existing `useQuery` block. Add a second query below it:

```typescript
type CeoMetrics = {
  payroll_liability: { run_month: string | null; total_gross: number; total_net: number; employer_statutory: number; employee_count: number };
  hc_gap: { total_gap: number; processes_understaffed: number; by_process: { process_name: string; mandated_hc: number; required_hc: number; active_hc: number; gap: number }[] };
  revenue_at_risk: { total_daily_estimate: number; by_process: { process_name: string; shrinkage_pct: number; absent_hc: number; daily_revenue_at_risk: number }[] };
  billing: { last_month_billed: number; billing_month: string | null; process_count: number };
  attrition_cost: { exits_30d: number; replacement_cost_estimate: number };
  hiring_pipeline: { open_candidates: number; offers_pending_joining: number; in_pipeline: number };
  ff_liability: { pending_count: number; pending_amount: number };
};

const { data: ceoRaw } = useQuery({
  queryKey: ["ceo-metrics"],
  queryFn: async () => {
    const res = await hrmsApi.get<{ data: CeoMetrics }>("/api/management/ceo-metrics");
    return res.data ?? null;
  },
  refetchInterval: 60_000,
  staleTime: 30_000,
});
const ceo = ceoRaw ?? null;
```

- [ ] **Step 2: Add currency formatter**

Near the top of the component (after imports):

```typescript
const inr = (v: number) =>
  v >= 10_000_000
    ? `₹${(v / 10_000_000).toFixed(2)}Cr`
    : v >= 100_000
    ? `₹${(v / 100_000).toFixed(1)}L`
    : `₹${v.toLocaleString("en-IN")}`;
```

- [ ] **Step 3: Add Business Impact section JSX**

Find the closing `</div>` of the existing KPI cards grid (after the 6th `StatCard`). Add after it:

```tsx
{/* Business Impact Strip */}
<section>
  <h2 className="mb-4 text-base font-black tracking-tight text-slate-950">
    Business Impact
  </h2>
  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    {/* Revenue at Risk Today */}
    <div className={`rounded-2xl border p-5 ${(ceo?.revenue_at_risk.total_daily_estimate ?? 0) > 0 ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">₹ Revenue at Risk Today</p>
      <p className="mt-2 text-2xl font-black text-slate-950">{inr(ceo?.revenue_at_risk.total_daily_estimate ?? 0)}</p>
      <p className="mt-1 text-xs text-slate-500">from absenteeism across {ceo?.revenue_at_risk.by_process.length ?? 0} processes</p>
    </div>

    {/* HC Shortfall */}
    <div className={`rounded-2xl border p-5 ${(ceo?.hc_gap.total_gap ?? 0) > 0 ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">HC Shortfall vs Mandate</p>
      <p className="mt-2 text-2xl font-black text-slate-950">{ceo?.hc_gap.total_gap ?? 0}</p>
      <p className="mt-1 text-xs text-slate-500">{ceo?.hc_gap.processes_understaffed ?? 0} processes below required staffing</p>
    </div>

    {/* Payroll Liability */}
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Payroll Liability This Month</p>
      <p className="mt-2 text-2xl font-black text-slate-950">{inr(ceo?.payroll_liability.total_gross ?? 0)}</p>
      <p className="mt-1 text-xs text-slate-500">
        {ceo?.payroll_liability.employee_count ?? 0} employees · statutory {inr(ceo?.payroll_liability.employer_statutory ?? 0)}
        {ceo?.payroll_liability.run_month ? ` · ${ceo.payroll_liability.run_month}` : ""}
      </p>
    </div>

    {/* Attrition Replacement Cost */}
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Attrition Replacement Cost</p>
      <p className="mt-2 text-2xl font-black text-slate-950">{inr(ceo?.attrition_cost.replacement_cost_estimate ?? 0)}</p>
      <p className="mt-1 text-xs text-slate-500">{ceo?.attrition_cost.exits_30d ?? 0} exits last 30d · {ceo?.hiring_pipeline.open_candidates ?? 0} open in pipeline</p>
    </div>
  </div>

  {/* HC Gap by Process table */}
  {(ceo?.hc_gap.by_process.length ?? 0) > 0 && (
    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="p-4 font-semibold">Process</th>
            <th className="p-4 font-semibold text-right">Mandated</th>
            <th className="p-4 font-semibold text-right">Required</th>
            <th className="p-4 font-semibold text-right">Active</th>
            <th className="p-4 font-semibold text-right">Gap</th>
          </tr>
        </thead>
        <tbody>
          {ceo!.hc_gap.by_process.map((row) => (
            <tr key={row.process_name} className="border-t">
              <td className="p-4 font-medium text-slate-900">{row.process_name}</td>
              <td className="p-4 text-right text-slate-600">{row.mandated_hc}</td>
              <td className="p-4 text-right text-slate-600">{row.required_hc}</td>
              <td className="p-4 text-right text-slate-600">{row.active_hc}</td>
              <td className={`p-4 text-right font-bold ${row.gap > 0 ? "text-red-600" : "text-emerald-600"}`}>
                {row.gap > 0 ? `−${row.gap}` : "✓"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )}
</section>
```

- [ ] **Step 4: Verify in browser**

Start frontend dev server (`npm run dev` from `HRMS1/`). Log in as admin. Navigate to `/management/dashboard` (the workforce dashboard). Scroll down — Business Impact section should appear below existing KPI cards. If `ceo` is null (endpoint unreachable), all values show 0 — no crash.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/AdminWorkforceDashboard.tsx
git commit -m "feat(dashboard): add Business Impact row to Admin Workforce Dashboard"
```

---

## Task 3: Management Dashboard — Deep Lens Cards

**Files:**
- Modify: `src/pages/NativeManagementDashboard.tsx`

Currently each lens shows 3 shallow cards. Replace the `lensCards` map with deeper data using `ceo` metrics.

- [ ] **Step 1: Add ceo-metrics query to `NativeManagementDashboard.tsx`**

At the top of the component function body (after the existing state declarations), add:

```typescript
const [ceoMetrics, setCeoMetrics] = React.useState<CeoMetrics | null>(null);
```

And in `loadAll`:
```typescript
// inside loadAll(), add:
try {
  const ceoRes = await hrmsApi.get<{ data: CeoMetrics }>("/api/management/ceo-metrics");
  setCeoMetrics(ceoRes.data ?? null);
} catch { /* non-fatal */ }
```

Add the `CeoMetrics` type at the top of the file (same as Task 2 Step 1 — copy it verbatim).

Add the `inr` formatter (same as Task 2 Step 2 — copy it verbatim).

- [ ] **Step 2: Replace `lensCards` with enhanced sets**

Replace the existing `lensCards` object (lines 74–95 in current file) with:

```typescript
const lensCards: Record<Lens, { title: string; value: string | number; sub: string }[]> = {
  CEO: [
    { title: "Workforce Health", value: `${healthScore}%`, sub: "blended attendance/KPI/risk" },
    { title: "HC Shortfall", value: ceoMetrics?.hc_gap.total_gap ?? 0, sub: `${ceoMetrics?.hc_gap.processes_understaffed ?? 0} processes understaffed` },
    { title: "Revenue at Risk", value: inr(ceoMetrics?.revenue_at_risk.total_daily_estimate ?? 0), sub: "daily estimate from absenteeism" },
    { title: "Open Hiring Gap", value: ceoMetrics?.hiring_pipeline.open_candidates ?? 0, sub: `${ceoMetrics?.hiring_pipeline.offers_pending_joining ?? 0} offers pending joining` },
    { title: "Attrition Cost", value: inr(ceoMetrics?.attrition_cost.replacement_cost_estimate ?? 0), sub: `${ceoMetrics?.attrition_cost.exits_30d ?? 0} exits last 30d` },
    { title: "Payroll Exposure", value: inr(ceoMetrics?.payroll_liability.total_gross ?? 0), sub: `${ceoMetrics?.payroll_liability.employee_count ?? 0} employees this month` },
  ],
  HR: [
    { title: "Pending Leaves", value: dashStats?.pending_leaves ?? 0, sub: "approval backlog" },
    { title: "Coaching Open", value: pendingCoaching, sub: "sessions not closed" },
    { title: "People Alerts", value: unacknowledgedCount, sub: "pending acknowledgement" },
    { title: "Offer Pipeline", value: ceoMetrics?.hiring_pipeline.offers_pending_joining ?? 0, sub: "offers awaiting joining" },
    { title: "F&F Pending", value: ceoMetrics?.ff_liability.pending_count ?? 0, sub: `${inr(ceoMetrics?.ff_liability.pending_amount ?? 0)} liability` },
    { title: "Low KPI Count", value: lowKpiCount, sub: "employees below score 60" },
  ],
  Finance: [
    { title: "Payroll This Month", value: inr(ceoMetrics?.payroll_liability.total_gross ?? 0), sub: `net: ${inr(ceoMetrics?.payroll_liability.total_net ?? 0)}` },
    { title: "Employer Statutory", value: inr(ceoMetrics?.payroll_liability.employer_statutory ?? 0), sub: "PF + ESIC employer share" },
    { title: "Last Billed", value: inr(ceoMetrics?.billing.last_month_billed ?? 0), sub: `${ceoMetrics?.billing.billing_month ?? "–"} · ${ceoMetrics?.billing.process_count ?? 0} processes` },
    { title: "F&F Liability", value: inr(ceoMetrics?.ff_liability.pending_amount ?? 0), sub: `${ceoMetrics?.ff_liability.pending_count ?? 0} pending settlements` },
    { title: "Attrition Cost", value: inr(ceoMetrics?.attrition_cost.replacement_cost_estimate ?? 0), sub: "replacement estimate last 30d" },
    { title: "Attendance Risk", value: `${dashStats?.attendance_rate ?? 0}%`, sub: "LOP impact on payroll" },
  ],
  Operations: [
    { title: "Attendance %", value: `${dashStats?.attendance_rate ?? 0}%`, sub: "floor availability" },
    { title: "Avg KPI", value: dashStats?.avg_kpi_score ?? 0, sub: "team productivity score" },
    { title: "Revenue at Risk", value: inr(ceoMetrics?.revenue_at_risk.total_daily_estimate ?? 0), sub: "from today's absenteeism" },
    { title: "HC Gap", value: ceoMetrics?.hc_gap.total_gap ?? 0, sub: `${ceoMetrics?.hc_gap.processes_understaffed ?? 0} processes short` },
    { title: "Low KPI Teams", value: lowKpiCount, sub: "below threshold 60" },
    { title: "Critical Alerts", value: criticalAlerts, sub: "unacknowledged high/critical" },
  ],
};
```

- [ ] **Step 3: Expand the lens card grid**

Find the existing `<div className="grid gap-4 md:grid-cols-4">` that renders lens cards. Change `md:grid-cols-4` to `md:grid-cols-3 xl:grid-cols-6` to accommodate 6 cards:

```tsx
<div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
  <StatCard title="Management Health" value={`${healthScore}%`} ... />
  {lensCards[lens].map((card) => (
    <StatCard key={card.title} title={card.title} value={card.value} icon={<BarChart3 className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" sub={card.sub} />
  ))}
</div>
```

Remove the hardcoded `<StatCard title="Management Health" ...>` from outside the map — it's now inside `lensCards` CEO array as "Workforce Health".

- [ ] **Step 4: Verify in browser**

Navigate to `/management/dashboard`. Switch between CEO / HR / Finance / Operations lenses. Each should show 6 cards. Finance lens should show INR amounts.

- [ ] **Step 5: Commit**

```bash
git add src/pages/NativeManagementDashboard.tsx
git commit -m "feat(management): expand lens cards to 6-deep with payroll/billing/gap data"
```

---

## Task 4: Control Tower — War-Room Fields

**Files:**
- Modify: `backend/src/modules/control-tower/control-tower.service.ts` (add `owner_name`, `sla_due_at`, `aging_hours`, `escalation_level`, `revenue_impact` to inbox query)
- Modify: `src/pages/NativeControlTower.tsx` (render the new fields)

- [ ] **Step 1: Read the current inbox query**

Find the SQL in `control-tower.service.ts` that builds the inbox items. Locate the SELECT that returns inbox rows — it should have fields like `id`, `module`, `task_type`, `priority`, `due_date`.

Add these computed fields to the SELECT:

```sql
CONCAT(COALESCE(owner.first_name, ''), ' ', COALESCE(owner.last_name, '')) AS owner_name,
owner.employee_code AS owner_code,
TIMESTAMPDIFF(HOUR, cti.created_at, NOW()) AS aging_hours,
CASE
  WHEN TIMESTAMPDIFF(HOUR, cti.created_at, NOW()) > 72 THEN 3
  WHEN TIMESTAMPDIFF(HOUR, cti.created_at, NOW()) > 24 THEN 2
  ELSE 1
END AS escalation_level,
CASE
  WHEN TIMESTAMPDIFF(HOUR, cti.created_at, NOW()) > 72 THEN 'CEO'
  WHEN TIMESTAMPDIFF(HOUR, cti.created_at, NOW()) > 24 THEN 'HR Director'
  ELSE NULL
END AS decision_required_from,
cti.due_date AS sla_due_at
```

And add a LEFT JOIN for the owner:
```sql
LEFT JOIN employees owner ON owner.id = cti.assigned_to_employee_id
```

(If `assigned_to_employee_id` column doesn't exist on the inbox table, use `assigned_to` cast as employee lookup, or omit the owner JOIN and set `owner_name = NULL` — do not error.)

- [ ] **Step 2: Add aging bucket helper**

In `NativeControlTower.tsx`, add after imports:

```typescript
function agingBucket(hours: number): { label: string; cls: string } {
  if (hours > 72) return { label: `${Math.floor(hours / 24)}d overdue`, cls: "bg-red-100 text-red-800" };
  if (hours > 24) return { label: `${Math.floor(hours)}h`, cls: "bg-amber-100 text-amber-700" };
  return { label: `${hours}h`, cls: "bg-slate-100 text-slate-600" };
}
```

- [ ] **Step 3: Add war-room columns to Inbox tab table**

In the existing Inbox tab table (`activeTab === "inbox"` or similar), add these columns to the `<thead>`:

```tsx
<th className="p-4 font-semibold">Owner</th>
<th className="p-4 font-semibold">Aging</th>
<th className="p-4 font-semibold">Escalation</th>
```

And in each `<tr>` in the tbody:

```tsx
<td className="p-4 text-sm text-slate-600">
  {item.owner_name?.trim() || <span className="text-slate-300">Unassigned</span>}
  {item.owner_code && <div className="font-mono text-xs text-slate-400">{item.owner_code}</div>}
</td>
<td className="p-4">
  {item.aging_hours != null && (
    <span className={`rounded-full px-2 py-1 text-xs font-bold ${agingBucket(item.aging_hours).cls}`}>
      {agingBucket(item.aging_hours).label}
    </span>
  )}
</td>
<td className="p-4">
  {item.escalation_level > 1 && (
    <div>
      <span className={`rounded-full px-2 py-1 text-xs font-bold ${item.escalation_level === 3 ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-700"}`}>
        L{item.escalation_level}
      </span>
      {item.decision_required_from && (
        <div className="mt-1 text-xs font-semibold text-red-700">→ {item.decision_required_from}</div>
      )}
    </div>
  )}
</td>
```

- [ ] **Step 4: Add "Daily Standup" filter button**

At the top of the Inbox tab, add a toggle button:

```tsx
const [standupMode, setStandupMode] = React.useState(false);
// ...
<button
  onClick={() => setStandupMode(s => !s)}
  className={`rounded-xl px-3 py-1.5 text-xs font-bold ${standupMode ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`}
>
  {standupMode ? "⚡ Standup: Top 20" : "All Items"}
</button>
```

Apply filter in the rendered rows:
```typescript
const displayedInbox = standupMode
  ? [...inboxItems].sort((a, b) => (b.aging_hours ?? 0) - (a.aging_hours ?? 0)).slice(0, 20)
  : inboxItems;
```

- [ ] **Step 5: Verify**

Navigate to `/control-tower` → Inbox tab. Should see Owner, Aging, Escalation columns. Toggle standup mode — should show top 20 oldest items.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/control-tower/control-tower.service.ts src/pages/NativeControlTower.tsx
git commit -m "feat(control-tower): add owner, aging, escalation level, standup mode to inbox"
```

---

## Task 5: Wire Operations + Quality Dashboard into routing and nav

**Files:**
- Modify: `src/App.tsx` (fix Operations route to use real component)
- Modify: `src/components/layout/CompactDashboardLayout.tsx` (add Quality + Operations to nav)

The Operations Dashboard is fully built at `NativeOperationsDashboard.tsx` but the App.tsx route uses `NativePlaceholderPage`. Quality Dashboard is fully built but missing from sidebar.

- [ ] **Step 1: Fix Operations route in `App.tsx`**

Find the route:
```tsx
path="/operations/dashboard"
element={<... NativePlaceholderPage ...>}
```

Change it to use the real component. Find the lazy import for `NativeOperationsDashboard` (it may already exist — grep for it). If it already exists as a lazy import, just change the route element. If not, add:

```typescript
const NativeOperationsDashboard = lazy(() => import("./pages/NativeOperationsDashboard"));
```

Then change the route:
```tsx
<Route
  path="/operations/dashboard"
  element={
    <ProtectedRoute>
      <Gate pageCode="OPERATIONS_DASHBOARD">
        <NativeOperationsDashboard />
      </Gate>
    </ProtectedRoute>
  }
/>
```

- [ ] **Step 2: Add Operations + Quality to sidebar nav**

In `src/components/layout/CompactDashboardLayout.tsx`, find the Operations section nav items array. Add:

```typescript
{ href: "/operations/dashboard", label: "Operations Dashboard", icon: <Activity className="h-4 w-4" />, pageCode: "OPERATIONS_DASHBOARD", roles: ["admin", "hr", "ceo", "process_manager", "branch_head", "operations_manager"] },
{ href: "/quality/dashboard", label: "Quality Dashboard", icon: <BarChart2 className="h-4 w-4" />, pageCode: "QUALITY_DASHBOARD", roles: ["admin", "hr", "ceo", "qa", "process_manager", "branch_head"] },
```

Check imports — `Activity` and `BarChart2` may already be imported from `lucide-react`. If not, add them to the import line.

- [ ] **Step 3: Verify**

Open sidebar — Operations Dashboard and Quality Dashboard should be visible links. Click Operations Dashboard — should render `NativeOperationsDashboard` (live workforce status, process coverage, KPI leaderboard, attrition trend sections). Click Quality Dashboard — should render `NativeQualityDashboard`.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/layout/CompactDashboardLayout.tsx
git commit -m "fix(nav): wire Operations and Quality dashboards into routing and sidebar"
```

---

## Verification (end-to-end)

1. `GET /api/management/ceo-metrics` → returns JSON with `payroll_liability`, `hc_gap.by_process`, `revenue_at_risk.by_process` — no 500
2. Admin Workforce Dashboard (`/management/dashboard`) → "Business Impact" row visible with HC gap table
3. Management Dashboard → CEO lens shows 6 cards including INR revenue-at-risk and payroll exposure
4. Management Dashboard → Finance lens shows INR amounts for payroll, billing, F&F
5. Control Tower → Inbox tab shows Owner, Aging, Escalation columns; Standup toggle shows top 20
6. Sidebar → Operations Dashboard and Quality Dashboard links visible and functional

---

## Future plans (not in scope here)

- **Plan 2:** Client Portal scorecard — SLA trend, attrition/replacement plan, MOM tracker, export audit log
- **Plan 3:** WFM forecast + shrinkage decomposition — roster plan vs forecast, week-off conflict heatmap, shrinkage decomposition (leave/absent/late/training/breaks)
- **Plan 4:** Quality CAPA / coaching dashboard — fatal error count, QA audit coverage, CAPA status, calibration variance, repeat offender list
- **Plan 5:** LMS sync health dashboard — learner mapping coverage, course completion, expiring certifications, batch ramp readiness
- **Plan 6:** Business hierarchy DB expansion — seat_master, billable_flag on employees, productive/non-productive status field, seat_id/system_id, process assignment history table
