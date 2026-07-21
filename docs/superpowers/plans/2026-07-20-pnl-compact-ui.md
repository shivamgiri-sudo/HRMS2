# P&L Pages — Compact UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove decorative hero banners from all 4 P&L pages, replace 8-section vertical stacks with tabbed layouts, and collapse dense metric blocks into compact `<dl>` grids.

**Architecture:** All 4 pages share the same treatment: (1) delete the dark hero div, (2) add a 48px `<div>` page header, (3) move KPI metrics from large Card rows into inline `<Badge>` chips in the header, (4) wrap remaining content in a `<Tabs>` or slim-header + single scroll. `PnlMasterControlCenterPage` additionally replaces `WorkspaceCard` form+table 2-col with a split-pane pattern where the form slides in as a panel on table row click.

**Tech Stack:** React 18, TypeScript, shadcn/ui, existing hooks (no API changes).

## Global Constraints

- Do not change any hooks: `useProcessPnl`, `useBpoProcessPnl`, `useProcessPnlDetail`, `usePnlConfiguration`, `usePnlReconciliation`
- Do not remove the chart components (`PnlWaterfallChart`, `ProfitabilityTrendChart`, `BpoPnlMatrixTable`, etc.) — move them into tab bodies
- All mutations and form submit handlers stay unchanged — only wrapping JSX changes
- TypeScript strict — no `any`

---

## File Map

| Action | File |
|---|---|
| Rewrite JSX | `src/pages/finance/ProcessPnlPage.tsx` |
| Rewrite JSX | `src/pages/finance/ProcessPnlDetailPage.tsx` |
| Rewrite JSX | `src/pages/finance/PnlMasterControlCenterPage.tsx` |
| Rewrite JSX | `src/pages/finance/PnlPeriodClosePage.tsx` |

---

### Task 1: ProcessPnlPage — slim header + 3-tab layout

**Files:**
- Modify: `src/pages/finance/ProcessPnlPage.tsx`

- [ ] **Step 1: Delete the dark hero section**

Find the dark hero `<div>` at the top of the return — it contains "Process P&L Intelligence", gradient background, and 4 navigation links. Delete from opening `<div className="relative ...bg-gradient...">` through its closing `</div>`. Also remove the `HERO_*` constants above the component if they exist.

- [ ] **Step 2: Replace hero with 48px header + inline KPI chips**

Insert at the top of the return, inside `<DashboardLayout>`:

```tsx
<div className="flex h-full flex-col">
  {/* ── Page header ── */}
  <div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
    <h1 className="text-sm font-semibold">Process P&L</h1>
    <div className="flex items-center gap-3">
      {/* KPI chips — use existing bpoPnl data */}
      {bpoPnl && (
        <>
          <span className="text-xs text-slate-500">
            Revenue: <b className="text-slate-900">{formatCurrency(bpoPnl.total_billed_revenue, true)}</b>
          </span>
          {(bpoPnl.processes_at_risk ?? 0) > 0 && (
            <Badge variant="destructive" className="text-xs">
              At risk: {bpoPnl.processes_at_risk}
            </Badge>
          )}
        </>
      )}
      <Button size="sm" variant="outline" onClick={() => downloadBpoPnlExport(period)}>
        <Download className="mr-1.5 h-3.5 w-3.5" /> Export
      </Button>
    </div>
  </div>
```

- [ ] **Step 3: Add filter bar below header**

```tsx
  {/* ── Filter bar ── */}
  <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 shrink-0">
    <Input
      type="month"
      value={period}
      onChange={e => setPeriod(e.target.value)}
      className="h-7 w-36 text-xs"
    />
    <Select value={branchFilter} onValueChange={setBranchFilter}>
      <SelectTrigger className="h-7 w-36 text-xs"><SelectValue placeholder="All branches" /></SelectTrigger>
      <SelectContent>{/* existing branch options */}</SelectContent>
    </Select>
    <Select value={clientFilter} onValueChange={setClientFilter}>
      <SelectTrigger className="h-7 w-36 text-xs"><SelectValue placeholder="All clients" /></SelectTrigger>
      <SelectContent>{/* existing client options */}</SelectContent>
    </Select>
    <Input
      className="h-7 w-44 text-xs"
      placeholder="Search process..."
      value={search}
      onChange={e => setSearch(e.target.value)}
    />
  </div>
```

- [ ] **Step 4: Wrap remaining content in 3 tabs**

```tsx
  {/* ── Tabbed body ── */}
  <Tabs defaultValue="matrix" className="flex flex-1 flex-col overflow-hidden">
    <TabsList className="mx-4 mt-3 w-fit shrink-0">
      <TabsTrigger value="matrix">Process Matrix</TabsTrigger>
      <TabsTrigger value="overview">Charts</TabsTrigger>
      <TabsTrigger value="kpis">KPI Strip</TabsTrigger>
    </TabsList>

    {/* Matrix tab — the main table, visible immediately */}
    <TabsContent value="matrix" className="flex-1 overflow-auto px-4 py-3 m-0">
      <BpoPnlMatrixTable period={period} branchId={branchFilter} search={search} />
    </TabsContent>

    {/* Charts tab — charts that previously required 5 scrolls to reach */}
    <TabsContent value="overview" className="flex-1 overflow-auto px-4 py-3 m-0">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PnlWaterfallChart period={period} />
        <PnlDataQualityPanel period={period} />
      </div>
      <div className="mt-4">
        <ProfitabilityTrendChart period={period} />
      </div>
    </TabsContent>

    {/* KPI strip tab */}
    <TabsContent value="kpis" className="flex-1 overflow-auto px-4 py-3 m-0">
      <PnlExecutiveKpiStrip period={period} branchId={branchFilter} />
    </TabsContent>
  </Tabs>
</div>
```

- [ ] **Step 5: Add Tabs import**

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
```

Remove the 4 large KPI Card imports at the top of the return (the ones showing revenue model coverage, revenue at risk, available budget, loss-making — these are now in the header chips).

- [ ] **Step 6: Build check**

```bash
npx tsc --noEmit 2>&1 | grep -i "ProcessPnlPage"
```
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/pages/finance/ProcessPnlPage.tsx
git commit -m "feat(pnl): compact ProcessPnlPage — slim header + 3-tab layout, remove hero"
```

---

### Task 2: ProcessPnlDetailPage — slim header, collapse statement cards

**Files:**
- Modify: `src/pages/finance/ProcessPnlDetailPage.tsx`

- [ ] **Step 1: Delete the dark hero section**

Find the dark hero at top of return (contains process name, period, KPI strip). Delete it. The process name and period move to the 48px header.

- [ ] **Step 2: Add 48px header**

```tsx
<div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
  <div className="flex items-center gap-2">
    <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => navigate(-1)}>
      ← Back
    </Button>
    <span className="text-sm font-semibold">{processName}</span>
    <Badge variant="outline" className="text-xs">{period}</Badge>
  </div>
  <div className="flex items-center gap-2">
    {operatingProfit != null && (
      <span className={`text-xs font-medium ${operatingProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
        OP: {formatCurrency(operatingProfit, true)}
      </span>
    )}
    <Button size="sm" variant="outline" onClick={handleExport}>Export</Button>
  </div>
</div>
```

- [ ] **Step 3: Collapse StatementCard metric rows to compact dl grids**

Find all `StatementCard` or card components that render 10–12 metric rows. For each one, replace the card wrapper with a compact `<section>` and convert the metric rows to a `<dl>` grid:

Before pattern (inside any tab's StatementCard):
```tsx
<Card>
  <CardHeader><CardTitle>Section name</CardTitle></CardHeader>
  <CardContent>
    <MetricRow label="Revenue" value={x} />
    <MetricRow label="Cost" value={y} />
    ...
  </CardContent>
</Card>
```

After pattern:
```tsx
<section className="rounded-lg border p-3">
  <h3 className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Section name</h3>
  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
    <dt className="text-slate-500">Revenue</dt>
    <dd className="text-right font-medium text-slate-900">{formatCurrency(x)}</dd>
    <dt className="text-slate-500">Cost</dt>
    <dd className="text-right font-medium text-slate-900">{formatCurrency(y)}</dd>
    {/* ... */}
  </dl>
</section>
```

Apply this to ALL statement cards across all 6 tabs. This reduces each card from ~120px height per metric to 20px per metric row.

- [ ] **Step 4: Keep 6-tab structure but reduce tab label size**

```tsx
<TabsList className="mx-0 h-8">
  <TabsTrigger value="statement" className="text-xs h-7">P&L Statement</TabsTrigger>
  <TabsTrigger value="revenue" className="text-xs h-7">Revenue</TabsTrigger>
  <TabsTrigger value="agents" className="text-xs h-7">Agents</TabsTrigger>
  <TabsTrigger value="grn" className="text-xs h-7">GRN</TabsTrigger>
  <TabsTrigger value="ledger" className="text-xs h-7">Ledger</TabsTrigger>
  <TabsTrigger value="recon" className="text-xs h-7">Reconciliation</TabsTrigger>
</TabsList>
```

- [ ] **Step 5: Build check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -i "ProcessPnlDetail"
git add src/pages/finance/ProcessPnlDetailPage.tsx
git commit -m "feat(pnl): collapse ProcessPnlDetail statement cards to compact dl grids, slim header"
```

---

### Task 3: PnlMasterControlCenterPage — split-pane form pattern

**Files:**
- Modify: `src/pages/finance/PnlMasterControlCenterPage.tsx`

- [ ] **Step 1: Delete hero + replace with 48px header**

Same as previous tasks. Find dark hero, delete, add:
```tsx
<div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
  <h1 className="text-sm font-semibold">P&L Control Centre</h1>
  <div className="flex items-center gap-3">
    <Badge variant="outline" className="text-xs">{period}</Badge>
    <Badge variant="outline" className="text-xs">{branchLabel}</Badge>
  </div>
</div>
```

Delete the 4 large metric cards row below the hero too (revenue model coverage, etc.). These are captured in header badges above.

- [ ] **Step 2: Replace each tab's WorkspaceCard 2-col pattern with split-pane**

For each of the 8 tabs that has `form-left + table-right` inside `WorkspaceCard`:

Before (WorkspaceCard wrapping form + table side by side):
```tsx
<div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
  <WorkspaceCard title="..." icon={...}>
    <form fields...>
  </WorkspaceCard>
  <WorkspaceCard title="..." icon={...}>
    <MasterTable ...>
  </WorkspaceCard>
</div>
```

After (table fills space, form slides in as a right panel on row click):
```tsx
<div className="flex h-full gap-0 overflow-hidden">
  {/* Table side */}
  <div className={`flex flex-col overflow-hidden transition-all ${selectedRow ? "w-[55%]" : "w-full"}`}>
    <div className="flex items-center justify-between border-b px-3 py-2">
      <span className="text-xs font-medium text-slate-500">Tab Name</span>
      <Button size="sm" onClick={() => { setSelectedRow(null); setFormMode("create"); setFormOpen(true); }}>
        + Add
      </Button>
    </div>
    <div className="flex-1 overflow-auto">
      <MasterTable
        data={tableData}
        onRowClick={row => { setSelectedRow(row); setFormOpen(true); }}
      />
    </div>
  </div>

  {/* Form panel slides in from right */}
  {formOpen && (
    <div className="w-[45%] border-l flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-semibold">
          {selectedRow ? "Edit" : "Add New"}
        </span>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setFormOpen(false)}>
          ×
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {/* existing form fields — paste unchanged */}
      </div>
      <div className="border-t px-3 py-2 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setFormOpen(false)}>Cancel</Button>
        <Button size="sm" onClick={handleFormSubmit} disabled={savePending}>
          {savePending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  )}
</div>
```

Add per-tab state:
```tsx
const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
const [formOpen, setFormOpen] = useState(false);
const [formMode, setFormMode] = useState<"create" | "edit">("create");
```

Apply this pattern to all 8 tabs. Each tab gets its own `selectedRow`/`formOpen` state pair, or use a single set of state variables (simpler since only one tab is active at a time — safe to share).

- [ ] **Step 3: Remove WorkspaceCard import if no longer used**

Check if `WorkspaceCard` is used anywhere else in the file. If not:
```tsx
// Remove: import { WorkspaceCard } from "@/components/finance/pnl/WorkspaceCard";
```

- [ ] **Step 4: Build check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -i "PnlMasterControl"
git add src/pages/finance/PnlMasterControlCenterPage.tsx
git commit -m "feat(pnl): PnlMasterControlCenter split-pane form panel, remove hero + WorkspaceCard nesting"
```

---

### Task 4: PnlPeriodClosePage — slim header + sticky action bar

**Files:**
- Modify: `src/pages/finance/PnlPeriodClosePage.tsx`

- [ ] **Step 1: Delete hero, add slim header with period selector and status counts**

Replace:
```tsx
{/* Delete entire dark hero div */}
```

With:
```tsx
<div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
  <h1 className="text-sm font-semibold">Period Close</h1>
  <div className="flex items-center gap-2">
    <Input
      type="month"
      value={period}
      onChange={e => setPeriod(e.target.value)}
      className="h-7 w-36 text-xs"
    />
    {stats && (
      <>
        <Badge variant="outline" className="text-xs">Total: {stats.total}</Badge>
        <Badge variant="outline" className="text-xs text-green-700">Profitable: {stats.profitable}</Badge>
        {stats.at_risk > 0 && <Badge variant="destructive" className="text-xs">At risk: {stats.at_risk}</Badge>}
        {stats.loss_making > 0 && <Badge variant="destructive" className="text-xs">Loss: {stats.loss_making}</Badge>}
      </>
    )}
  </div>
</div>
```

- [ ] **Step 2: Move Recalculate + Lock buttons to a sticky bottom bar**

Find the "Recalculate" and "Lock period" buttons in the filter bar area. Remove them from there. Add a sticky bottom action bar:

```tsx
{/* At end of main content, before closing DashboardLayout div */}
<div className="sticky bottom-0 flex items-center justify-between border-t bg-white px-4 py-3 shrink-0">
  <span className="text-xs text-slate-500">
    Period: <b>{period}</b>
    {lockStatus && <Badge variant={lockStatus === "locked" ? "default" : "secondary"} className="ml-2 text-xs">{lockStatus}</Badge>}
  </span>
  <div className="flex gap-2">
    <Button
      size="sm"
      variant="outline"
      disabled={recalcPending}
      onClick={handleRecalculate}
    >
      {recalcPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
      Recalculate
    </Button>
    <Button
      size="sm"
      variant="destructive"
      disabled={lockPending || lockStatus === "locked"}
      onClick={handleLockPeriod}
    >
      {lockPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
      Lock period
    </Button>
  </div>
</div>
```

Note: use the existing variable/function names for `recalcPending`, `handleRecalculate`, `lockPending`, `handleLockPeriod`, `lockStatus` — check the existing file for exact names.

- [ ] **Step 3: Remove the filter bar `Card` wrapper**

The filter bar is now just the header. Delete any remaining `<Card>` wrapper that was holding the period selector + count tiles.

- [ ] **Step 4: Build check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -i "PnlPeriodClose"
git add src/pages/finance/PnlPeriodClosePage.tsx
git commit -m "feat(pnl): PnlPeriodClose slim header, sticky action bar, remove hero"
```

---

### Task 5: Final build verification

- [ ] **Step 1: Full build**

```bash
cd C:\Users\ADMIN\Desktop\HRMS2-latest
npm run build 2>&1 | tail -10
```
Expected: `✓ built in ...s` with 0 errors.

- [ ] **Step 2: Visual check list**

At 1280px viewport:
- [ ] ProcessPnlPage: header + filter bar visible immediately, Process Matrix table in first tab
- [ ] ProcessPnlDetail: slim header with back button, 6 tabs with compact dl grids
- [ ] PnlMasterControlCenter: table fills tab, form slides in from right on row click
- [ ] PnlPeriodClose: slim header with inline counts, sticky bottom action bar

---

## Verification Checklist

- [ ] `npm run build` — 0 errors
- [ ] No dark gradient hero on any of the 4 P&L pages
- [ ] No page requires more than 2 full-screen scrolls to reach primary data
- [ ] Lock/Recalculate buttons visually separated from passive status badges
- [ ] Statement card metric rows render at 20px height (not 40-56px)
- [ ] MasterControlCenter form panel opens inline — no modal/dialog
