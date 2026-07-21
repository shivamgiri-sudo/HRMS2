# Task Brief: P&L Task 2 — ProcessPnlDetailPage slim header + compact dl grids

## Context
MAS PeopleOS HRMS compact UI redesign. P&L Task 2 of 4.
Working directory: `C:\Users\ADMIN\Desktop\HRMS2-latest`

## Goal
Rewrite `src/pages/finance/ProcessPnlDetailPage.tsx` (576 lines):
1. Remove dark hero section
2. Add slim 48px header with back button, process name, period badge
3. Collapse all `StatementCard`/`Card` metric rows into compact `<dl>` grids (20px rows)
4. Keep the existing 6-tab structure, just slim the tab labels

## What to keep
- ALL hooks: `useBpoProcessPnlDetail`, `useProcessPnlSection`
- ALL helper functions: `currency`, `number`, `percent`, `date`, `moneyTone`, `statusTone`
- The 6-tab structure with their tab values
- `PnlExecutiveKpiStrip` component

## What to change

### Step 1: Delete the dark hero section
Find the hero `<div>` at the top of the return (contains process name large heading, gradient, KPI badges). Delete it.

### Step 2: Add 48px header
Replace hero with:
```tsx
<div className="flex h-full flex-col">
  <div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => navigate(-1)}>
        ← Back
      </Button>
      <span className="text-sm font-semibold">{processName}</span>
      {period && <Badge variant="outline" className="text-xs">{period}</Badge>}
    </div>
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={handleExport}>Export</Button>
    </div>
  </div>
```

Note: Find the actual variable names for processName/period/navigate/handleExport from the file. If handleExport doesn't exist, omit the export button or use `downloadBpoPnlExport(period)`.

### Step 3: Slim the 6-tab bar
Find the existing `<TabsList>`. Change tab trigger sizes:
```tsx
<TabsList className="mx-0 h-8">
  {/* keep the same tab values, just add text-xs h-7 to each trigger */}
</TabsList>
```

### Step 4: Collapse StatementCard / Card metric rows to compact dl grids

This is the main work. The file has multiple Card components inside each tab body that render metric rows like:
```tsx
<Card>
  <CardHeader><CardTitle>Section name</CardTitle></CardHeader>
  <CardContent>
    <MetricRow label="Revenue" value={x} />
    ...
  </CardContent>
</Card>
```

Or they may be `MetricCard`, `StatRow`, inline `div` rows, or similar patterns.

For EACH such card/section, replace it with a compact `<section>` + `<dl>` grid:
```tsx
<section className="rounded-lg border p-3">
  <h3 className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Section name</h3>
  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
    <dt className="text-slate-500">Revenue</dt>
    <dd className="text-right font-medium text-slate-900">{currency(x)}</dd>
    <dt className="text-slate-500">Cost</dt>
    <dd className="text-right font-medium text-slate-900">{currency(y)}</dd>
    {/* ... */}
  </dl>
</section>
```

Apply this pattern to ALL tabs. Each metric row goes from ~40px height to ~20px.

Important: DO NOT lose any data fields. Every metric that existed before must still be present in the dl grid.

### Step 5: Add needed imports
```tsx
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom"; // if navigate is needed
import { Fragment } from "react";
```

Remove Card/CardContent/CardHeader/CardTitle imports if they're no longer used.

### Step 6: TypeScript fix + commit
```bash
npx tsc --noEmit 2>&1 | grep -i "ProcessPnlDetail"
git add src/pages/finance/ProcessPnlDetailPage.tsx
git commit -m "feat(pnl): collapse ProcessPnlDetail statement cards to compact dl grids, slim header"
```

Write report to `.superpowers/sdd/pnl-task-2-report.md`

Return only: Status, commit hash, tsc result, concerns.
