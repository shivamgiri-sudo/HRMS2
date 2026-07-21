# P&L Task 1 Report

## Status
DONE

## Commit hash
4cf5240f

## tsc result
0 errors (no output from `npx tsc --noEmit`)

## What changed
- Removed dark hero section (gradient + large heading + 4 nav link cards + 4 KPI cards)
- Added 48px slim header with inline revenue chip and at-risk badge (keyed off `summary.kpis.lossMakingProcesses`)
- Added filter bar: month input, branch select, client select, search input + Apply button (all h-7)
- Wrapped content in 3 tabs: Process Matrix / Charts / KPI Strip
- Dropped unused imports: `Link`, `Card/CardContent/CardHeader/CardTitle`, `Banknote`, `BriefcaseBusiness`, `Building2`, `Filter`, `Gauge`, `ReceiptIndianRupee`, `TrendingUp`, `UsersRound`
- Kept all hooks (`useProcessPnl`, `useBpoProcessPnl`, `downloadBpoPnlExport`), all component imports, `currentPeriod`, `formatCurrency`, `percent`
- Removed `MixBar` helper (no longer rendered)
- Added imports: `Tabs/TabsContent/TabsList/TabsTrigger`, `Badge`

## Prop alignment notes
- `BpoPnlMatrixTable`: accepts `{ rows, period }` — passed correctly; no `branchId`/`search` prop exists
- `PnlWaterfallChart`: accepts `{ revenue, directCost, indirectCost, profit }` — passed from `summary.kpis` as before
- `ProfitabilityTrendChart`: accepts `{ trend }` — passed from `legacySummaryQuery.data.trend` as before
- `PnlDataQualityPanel`: accepts `{ alerts }` — passed from `summary.alerts` as before
- `PnlExecutiveKpiStrip`: accepts `{ items: Kpi[] }` — passed `kpiItems` as before

## Concerns
None. All prop signatures matched. No TS errors introduced.
