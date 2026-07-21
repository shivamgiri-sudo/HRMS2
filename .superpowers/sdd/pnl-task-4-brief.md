# Task Brief: P&L Task 4 — PnlPeriodClosePage slim header + sticky action bar

## Context
MAS PeopleOS HRMS compact UI redesign. P&L Task 4 of 4 (final P&L task).
Working directory: `C:\Users\ADMIN\Desktop\HRMS2-latest`

## Goal
Rewrite `src/pages/finance/PnlPeriodClosePage.tsx` (270 lines):
1. Remove dark hero section
2. Add slim 48px header with period selector and inline status counts
3. Move Recalculate + Lock/Signoff buttons to a sticky bottom action bar

## What to keep
- ALL from `usePnlReconciliation`: `periodCloseQuery`, `recalculate`, `signoff`, `lockPeriod`
- ALL child components: `IndirectAllocationPanel`, `ProcessCostLedger`, `RevenueReconciliationPanel`
- `handleSignoff`, `handleLock`, `handleRecalculate` handlers (or find their actual names)
- Period selector via searchParams

## What to change

### Step 1: Delete the dark hero section
Find and delete the decorative hero `<div>` at the top of the return. It likely contains a gradient, "Period Close" heading, and navigation links.

### Step 2: Add 48px header with period selector + inline status counts
Replace hero with:
```tsx
<div className="flex h-full flex-col">
  <div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
    <h1 className="text-sm font-semibold">Period Close</h1>
    <div className="flex items-center gap-2">
      <Input
        type="month"
        value={period}
        onChange={e => setSearchParams({ period: e.target.value })}
        className="h-7 w-36 text-xs"
      />
      {closeData && (
        <>
          <Badge variant="outline" className="text-xs">
            Total: {closeData.processes?.length ?? 0}
          </Badge>
          {closeData.period?.status && (
            <Badge
              variant={closeData.period.status === "locked" ? "default" : "secondary"}
              className="text-xs"
            >
              {closeData.period.status}
            </Badge>
          )}
        </>
      )}
    </div>
  </div>
```

Note: Adapt field names (`closeData.processes`, `closeData.period.status`) to whatever the actual data shape is from `periodCloseQuery.data`. Read the file to see what fields exist.

### Step 3: Move action buttons to sticky bottom bar
Find the Recalculate button and the Lock/Signoff button(s) — they're currently in the filter bar or top section. Remove them from there.

Add at the end of the page content (before closing `</DashboardLayout>`):
```tsx
  <div className="sticky bottom-0 flex items-center justify-between border-t bg-white px-4 py-3 shrink-0">
    <span className="text-xs text-slate-500">
      Period: <b className="text-slate-900">{period}</b>
    </span>
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={recalculate.isPending}
        onClick={handleRecalculate}
      >
        {recalculate.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Recalculate
      </Button>
      {closeData?.availableActions?.canSignoff && (
        <Button
          size="sm"
          disabled={signoff.isPending}
          onClick={handleSignoff}
        >
          {signoff.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Sign off
        </Button>
      )}
      {closeData?.availableActions?.canLock && (
        <Button
          size="sm"
          variant="destructive"
          disabled={lockPeriod.isPending}
          onClick={handleLock}
        >
          {lockPeriod.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Lock period
        </Button>
      )}
    </div>
  </div>
</div>
```

Note: Read the file to find the actual handler names and mutation variable names. The brief uses `handleRecalculate`, `handleSignoff`, `handleLock` — adapt to the actual names. The `canSignoff`/`canLock` conditions should match whatever the existing code uses.

### Step 4: Remove filter Card wrapper
The period selector was probably inside a `<Card>` at the top. Now that it's in the header, delete the old Card filter bar.

### Step 5: Add Badge and Loader2 imports
```tsx
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
```

Remove Card/CardContent/CardHeader/CardTitle imports if no longer used.

### Step 6: Fix TypeScript + commit + full build
```bash
npx tsc --noEmit 2>&1 | grep -i "PnlPeriodClose"
npm run build 2>&1 | tail -5
git add src/pages/finance/PnlPeriodClosePage.tsx
git commit -m "feat(pnl): PnlPeriodClose slim header, sticky action bar, remove hero"
```

Write report to `.superpowers/sdd/pnl-task-4-report.md`

Return only: Status, commit hash, tsc result, build result, concerns.
