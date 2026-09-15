# Live Dashboard Drill-Down + KPI Metrics UI Redesign

**Date:** 2026-09-15  
**Scope:** `src/pages/DiallerLivePanel.tsx`, `src/pages/ProcessOperationsPage.tsx`  
**Status:** Approved — ready for implementation plan

---

## 1. Problem Statement

Two separate gaps in the Process Operations page (`/process-operations`):

1. **Live Dashboard tab** — KPI summary cards (Offered, SL%, AHT, etc.) and DataTable rows (agents, daily, campaigns) are not clickable. The Drill-Down Mandate requires every data grid row to open a detail view.

2. **KPI Metrics tab** — Visual style is disconnected from the Live Dashboard. The top summary block (GasExecutiveBrief) is text-heavy. Analysis panels have inconsistent container styling. The user wants a unified look: Live Dashboard–style dark-blue Panel headers and colored KPI summary cards at the top of the KPI Metrics view.

---

## 2. Scope

### In scope
- `KpiCard` component → clickable button
- `DataTable` component → optional `onRowClick` prop
- New `LiveDetailDrawer` component inside `DiallerLivePanel.tsx`
- KPI Metrics top block → 5 colored KpiCard strip
- All analysis panels in KPI Metrics view wrapped in `Panel` containers
- Applies to all dashboards: Inbound, Reginald Cart, Molecular Email, Reginald Email, GS1, Billing

### Out of scope
- `VoiceOfCustomerPanel` — untouched
- `DailyQualityTrendPanel` (Quality Shape) — untouched
- No new backend API routes (all drill-down data from existing endpoints)
- No changes to `DrilldownDrawer` (KPI Metrics metric card drill-down — already works)

---

## 3. Architecture

### 3.1 KpiCard → Button

```tsx
// Before
function KpiCard({ label, value, sub, color }) {
  return <div ...>...</div>;
}

// After
function KpiCard({ label, value, sub, color, onClick }: {
  label: string; value: string | number; sub?: string;
  color: string; onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : "default", ... }}
    >...</Tag>
  );
}
```

When `onClick` is undefined the card renders exactly as before (non-interactive `<div>`).

### 3.2 DataTable → Row Click

```tsx
interface DataTableProps<T> {
  cols: Col<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;   // NEW — optional
}
```

When `onRowClick` is provided:
- `<tr>` gets `onClick={() => onRowClick(row)}`
- `cursor: "pointer"` on the `<tr>`
- `onMouseEnter/Leave` → background `#eef4fc` / restore

### 3.3 LiveDetailDrawer

Single new component in `DiallerLivePanel.tsx`.

```tsx
type LiveDrillContext =
  | { type: "kpi";    label: string; dashboard: DiallerProcess; filters: Filters }
  | { type: "agent";  user: string;  dashboard: DiallerProcess; filters: Filters; row: Record<string,unknown> }
  | { type: "daily";  date: string;  dashboard: DiallerProcess; filters: Filters; row: Record<string,unknown> }
  | { type: "record"; title: string; fields: { label: string; value: string }[] }

function LiveDetailDrawer({
  ctx, processName, onClose
}: {
  ctx: LiveDrillContext | null;
  processName: string;
  onClose: () => void;
})
```

Renders as a Radix `Sheet` (right side, `max-w-xl`, full height, scrollable).  
Header: `{processName} — {ctx.label or ctx.user or ctx.date}` + close button.  
Body: lazy queries using `useQuery` with `enabled: ctx !== null`.

**Fallback `{ type: "record" }`** renders a two-column labelled grid of all row fields — used when no deeper API data exists (GS1 analyst rows, Billing LOB rows, etc.).

---

## 4. Drill-Down Content Per Dashboard

### 4.1 Inbound (Bla Bli Blu)

| Trigger | `ctx.type` | Content |
|---|---|---|
| KPI card click | `kpi` | Daily trend table (date, offered, handled, SL%, AHT, holdCalls) from `/inbound/daily` |
| Agent row click | `agent` | Record detail: all agent columns displayed; daily breakdown client-filtered from already-fetched agents query |
| Daily row click | `daily` | Hourly slot table from `/inbound/hourly?date=<date>` |
| Disposition row click | `record` | Sub-disposition list as record detail from already-fetched disposition data |
| Repeat row click | `record` | Full repeat row fields |

### 4.2 Reginald Abandoned Cart

| Trigger | `ctx.type` | Content |
|---|---|---|
| KPI card click | `kpi` | Daily trend table from `/reginald-cart/daily` |
| Analyst row click | `agent` | Record detail: all analyst columns (totalDialed, uniqueDialed, connectPct, avgTalk, AHT, utilization) |
| Daily row click | `daily` | Campaign breakdown for that date (client-filter on byCampaign already in summary query) |
| Monthly row click | `record` | Full monthly row fields |

### 4.3 Molecular Email / Reginald Email APR

| Trigger | `ctx.type` | Content |
|---|---|---|
| KPI card click | `kpi` | Daily APR trend table from `/[proc]/daily` |
| Agent row click | `agent` | Record detail: all agent columns (aprCalls, netLoginTime, talk, wait, dispo, pause, breaks, acht, utilization) |
| Daily row click | `daily` | Agent list for that day — client-filter on agents query matching that date range |
| Ticket daily row click | `record` | Full ticket row fields (totalTickets, emailClosed, openPending, reopened, closurePct) |

### 4.4 GS1 India

| Trigger | `ctx.type` | Content |
|---|---|---|
| KPI card click (any sub-tab) | `kpi` | Daily trend table from the active sub-tab's daily array (already in query result) |
| Analyst row click (Email/DataKart) | `record` | Full analyst row fields (tasks, gtin, images, sla15Pct / withinTatPct, avgGtin) |
| Daily row click | `record` | Full daily row fields |
| Company row click (Approval) | `record` | Full company row (sku, audits, errors, errorPct) |
| Analyst row click (Approval) | `record` | Full approval analyst row |

### 4.5 Domestic Billing

| Trigger | `ctx.type` | Content |
|---|---|---|
| KPI card click (Total Amount / Billing Hrs) | `kpi` | Full LOB matrix — all rows from `/billing/dashboard` in a DataTable inside the drawer |
| LOB row click | `record` | All fields: process, LOB, approvedHC, fteRate, planningRule, targetHrs, deliveredHrs, deliveredFTE, billingHrs, billingAmount, variance, utilization, needHcPerDay, planningDays, agentCount |

---

## 5. KPI Metrics Tab — UI Transformation

### 5.1 New Top Block (replaces GasExecutiveBrief)

Layout: `display: grid; grid-template-columns: 1fr 320px` (cards left, ActionBoard right).

Left side: row of 5 `KpiCard` components using `GasExecutiveBrief` data:

| Card | Value source | Color |
|---|---|---|
| Headcount | `ops.headcount` | `#2f6fed` (blue) |
| Total Metrics | `allMetricsForBrief.length` | `#10b8d4` (teal) |
| Passing | `passCount` | `#18a866` (green) |
| Failing | `failCount` | `#e5484d` (red) |
| Stale | `staleCount` | `#e89b19` (amber) |

Each card shows the count as the value, and a brief sub-label (e.g. `"active employees"`, `"wired metrics"`, `"on target"`, `"below target"`, `"needs refresh"`). Cards are non-interactive (no onClick — these are summary numbers, not drill-down targets).

The executive text blurb from `GasExecutiveBrief` is removed (the cards communicate the same thing visually). `GasExecutiveBrief` component is no longer rendered in the KPI Metrics view. The JSX call site is removed. The component definition stays in the file (not deleted) in case other views reference it. The data variables it previously consumed (`allMetricsForBrief`, `passCount`, `failCount`, `staleCount`, `metricsWithData`, `staleCount`) are already computed in the parent scope and are now passed directly to the 5 KpiCard components.

### 5.2 Panel Wrapper Application

The `Panel` component from `DiallerLivePanel.tsx` is duplicated inline in `ProcessOperationsPage.tsx` (it's 15 lines of inline styles, no imports needed beyond what already exists). Each analysis block wrapped as:

```tsx
<Panel title="Fatal Calls Analysis">
  <FatalCallsPanel processId={current} period={period} />
</Panel>
<Panel title="Agent Audit Summary">
  <AgentAuditSummaryPanel processId={current} period={period} />
</Panel>
// ... etc for each panel
```

Panels wrapped:
- `ProcessCardInsightsPanel` → "Performance Distribution"
- `BusinessHealthPanel` → "Business Health"
- `FatalCallsPanel` → "Fatal Calls Analysis"
- `AgentAuditSummaryPanel` → "Agent Audit Summary"
- `ScenarioDistributionPanel` → "Scenario Distribution"
- `ScoreComponentsPanel` → "Score Components"
- `AchtCategorizationPanel` → "ACHT Categorization"
- `CriticalSignalsPanel` → "Critical Signals"
- `CustomerRiskCardsPanel` → "Customer Risk"
- `FatalAnalysisPanel` → "Fatal Analysis"
- `DayWiseScenarioAuditPanel` → "Day-wise Scenario Audit"
- `RepeatAnalysisPanel` → "Repeat Analysis"
- `FraudCallPanel` → "Fraud Call Detection"
- `WorkforceCorrelationPanel` → "Workforce Correlation"
- Charts grid → `Panel` titled "Trend Charts"

**Not wrapped (untouched):**
- `VoiceOfCustomerPanel`
- `DailyQualityTrendPanel`
- Feed health banners
- `SectionOverviewStrip`
- `EnhancedSectionBlock` sections (already have their own Panel-like styling)

---

## 6. File Changes

| File | Change |
|---|---|
| `src/pages/DiallerLivePanel.tsx` | `KpiCard` → optional button; `DataTable` → optional `onRowClick`; add `LiveDetailDrawer` component; wire `onClick`/`onRowClick` in all 5 dashboards |
| `src/pages/ProcessOperationsPage.tsx` | Replace `GasExecutiveBrief` block with 5-card KpiCard strip; add inline `Panel` wrapper; wrap all analysis panels; import `Panel`-style inline styles |

No backend changes. No new routes. No new DB queries.

---

## 7. Error Handling

- Drawer query errors: show `<Err msg="..." />` inline in drawer body
- Empty rows (no data for that agent/day): show "No data for this selection" placeholder
- GS1/Billing record detail: if a field value is null/undefined, display "—"

---

## 8. Testing Checklist

- [ ] KpiCard renders as `<div>` when no `onClick`, `<button>` when `onClick` provided
- [ ] DataTable rows have hover state and pointer cursor when `onRowClick` provided
- [ ] `LiveDetailDrawer` opens and closes correctly for all 5 dashboard types
- [ ] KPI card click on Inbound shows daily trend table
- [ ] Agent row click shows record detail with all fields
- [ ] Daily row click on Inbound fetches `/inbound/hourly` correctly
- [ ] GS1 analyst row click shows record detail (no API fetch, no error)
- [ ] Billing LOB row click shows all billing fields
- [ ] KPI Metrics top block shows 5 colored cards with correct values
- [ ] All analysis panels have Panel wrapper (dark blue accent, dot header)
- [ ] `VoiceOfCustomerPanel` and `DailyQualityTrendPanel` are visually unchanged
- [ ] `npm run build` zero errors
- [ ] `tsc --noEmit` zero errors
