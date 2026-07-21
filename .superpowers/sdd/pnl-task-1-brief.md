# Task Brief: P&L Task 1 — ProcessPnlPage slim header + 3-tab layout

## Context
MAS PeopleOS HRMS compact UI redesign. P&L Task 1 of 4.
Working directory: `C:\Users\ADMIN\Desktop\HRMS2-latest`

## Goal
Rewrite `src/pages/finance/ProcessPnlPage.tsx` (344 lines) to remove the dark hero and collapse into a slim header + 3-tab layout.

## What to keep
- ALL hooks: `useProcessPnl`, `useBpoProcessPnl`, `downloadBpoPnlExport`
- ALL component imports: `BpoPnlMatrixTable`, `PnlWaterfallChart`, `ProfitabilityTrendChart`, `PnlDataQualityPanel`, `PnlExecutiveKpiStrip`
- `currentPeriod`, `formatCurrency`, `percent`, `MixBar` helper functions — keep if still used, remove if not
- All filter state variables (period, branchFilter, clientFilter, search)

## What to change

### Step 1: Delete the dark hero section
Find the hero `<div>` at the top of the return — it contains gradient background, "Process P&L" or similar large heading, and 4 navigation link cards. Delete it entirely.

### Step 2: Add 48px header + inline KPI chips
Replace hero with:
```tsx
<div className="flex h-full flex-col">
  <div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
    <h1 className="text-sm font-semibold">Process P&L</h1>
    <div className="flex items-center gap-3">
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

Note: `bpoPnl` is the data from `useBpoProcessPnl` hook — find the exact variable name in the file.

### Step 3: Add filter bar
```tsx
  <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 shrink-0">
    <Input
      type="month"
      value={period}
      onChange={e => setPeriod(e.target.value)}
      className="h-7 w-36 text-xs"
    />
    <Input
      className="h-7 w-44 text-xs"
      placeholder="Search process..."
      value={search}
      onChange={e => setSearch(e.target.value)}
    />
  </div>
```

(Keep any existing branch/client filter selects if they exist, just convert to h-7 size)

### Step 4: Wrap remaining content in 3 tabs
```tsx
  <Tabs defaultValue="matrix" className="flex flex-1 flex-col overflow-hidden">
    <TabsList className="mx-4 mt-3 w-fit shrink-0">
      <TabsTrigger value="matrix">Process Matrix</TabsTrigger>
      <TabsTrigger value="charts">Charts</TabsTrigger>
      <TabsTrigger value="kpis">KPI Strip</TabsTrigger>
    </TabsList>

    <TabsContent value="matrix" className="flex-1 overflow-auto px-4 py-3 m-0">
      <BpoPnlMatrixTable period={period} branchId={branchFilter} search={search} />
    </TabsContent>

    <TabsContent value="charts" className="flex-1 overflow-auto px-4 py-3 m-0">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PnlWaterfallChart period={period} />
        <PnlDataQualityPanel period={period} />
      </div>
      <div className="mt-4">
        <ProfitabilityTrendChart period={period} />
      </div>
    </TabsContent>

    <TabsContent value="kpis" className="flex-1 overflow-auto px-4 py-3 m-0">
      <PnlExecutiveKpiStrip period={period} branchId={branchFilter} />
    </TabsContent>
  </Tabs>
</div>
```

Note: `branchFilter` may be called differently in the file — read it first to find the actual variable.

### Step 5: Add Tabs import
```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
```

Remove imports that become unused (large KPI Card components that were in the hero, `MixBar` if no longer rendered).

### Step 6: Check prop signatures
Read the actual prop signatures of `BpoPnlMatrixTable`, `PnlWaterfallChart`, `ProfitabilityTrendChart`, `PnlDataQualityPanel`, `PnlExecutiveKpiStrip`. Pass only the props they actually accept. If they don't accept `branchId` or `search`, just pass `period`.

## Steps
1. Read the full file
2. Make changes
3. Run `npx tsc --noEmit 2>&1 | grep -i "ProcessPnlPage"` — fix errors
4. Commit: `git add src/pages/finance/ProcessPnlPage.tsx && git commit -m "feat(pnl): compact ProcessPnlPage — slim header + 3-tab layout, remove hero"`
5. Write report to `.superpowers/sdd/pnl-task-1-report.md`

Return only: Status, commit hash, tsc result, concerns.
