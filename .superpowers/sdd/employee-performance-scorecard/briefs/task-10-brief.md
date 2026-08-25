# Task 10 Brief: Wire into `TeamPerformanceTab`

Source plan: `docs/superpowers/plans/2026-08-25-employee-performance-scorecard.md` (Task 10)

## Prior task output you depend on

`src/components/performance-scorecard/PerformanceScorecardTable.tsx` (Task 9) — default export, props `{ dateFrom: string; dateTo: string }` (both `YYYY-MM-DD` strings).

## Task

**Files:**
- Modify: `src/components/my-team/TeamPerformanceTab.tsx`

**Interfaces:**
- Consumes: `PerformanceScorecardTable` from `@/components/performance-scorecard/PerformanceScorecardTable` (confirm this exact import path/export style first — Task 9's report should confirm whether it's a default or named export).

- [ ] **Step 1: Read the current file first**

Read the full current content of `TeamPerformanceTab.tsx` — it may have changed since the plan was written (concurrent sessions). Identify: (a) where to add date-range state, (b) the exact `<Table>...</Table>` JSX block that currently renders the flat quality/risk/coaching table (this is what gets replaced), (c) confirm the existing `agent-performance` query, bar chart, and coaching `Dialog` should be left untouched.

- [ ] **Step 2: Add date-range state and the new table**

Add near the top of the component body (after existing `useState` calls):
```tsx
const [dateFrom, setDateFrom] = useState(() => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
});
const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
```

Add a date-range control above the existing bar chart:
```tsx
<div className="flex items-center gap-2 mb-4">
  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
  <span className="text-gray-400">to</span>
  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
</div>
```
(Confirm `Input` is already imported in this file — it should be, per the existing file's shadcn imports; if not, add the import matching this codebase's real `Input` component path.)

Replace the existing flat `<Table>...</Table>` block (the one rendering quality/risk/coaching columns) with:
```tsx
<PerformanceScorecardTable dateFrom={dateFrom} dateTo={dateTo} />
```
Add the import at the top:
```tsx
import PerformanceScorecardTable from "@/components/performance-scorecard/PerformanceScorecardTable"; // adjust to named import if Task 9 used a named export
```

Leave the existing `agent-performance` query, bar chart, and coaching `Dialog` completely in place and unchanged — they are independent of the table being replaced and other code in this file still depends on them.

- [ ] **Step 3: Verify it builds**

Run the real gate: `npm run typecheck` (both halves — this repo's known gotcha is that a scoped/filtered tsc run can miss real errors; run the actual npm script). Also attempt `npm run build -- --mode development 2>&1 | tail -50` if time permits.
Expected: zero new errors attributable to this file.

- [ ] **Step 4: Manual verification (if a running dev server is available)**

Run the app, log in as a manager-role demo account, navigate to My Team → Performance, confirm: the new table renders with a date-range picker, the bar chart above it still works, clicking a metric cell opens the drilldown drawer. If no running app/demo login is available in this environment, state that explicitly in your report rather than fabricating a result.

- [ ] **Step 5: Commit**

```bash
git add src/components/my-team/TeamPerformanceTab.tsx
git commit -m "feat: wire PerformanceScorecardTable into TeamPerformanceTab"
```
Stage only this one file. `git status --short` first — this file may have been touched by another concurrent session.

## Report contract

Write your full report to `.superpowers/sdd/employee-performance-scorecard/reports/task-10-report.md`, then return ONLY:
- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
- Commit SHA(s)
- One-line verification summary (real typecheck result)
- Any concerns

## Important

- Do NOT push to GitHub. Commit locally to `main` only.
- This repo has concurrent sessions editing the shared tree, and `TeamPerformanceTab.tsx` specifically may have been touched by other work since the plan was written — re-read it fresh, don't assume the plan's line numbers are current.
- Do not remove or modify the existing `agent-performance` query, bar chart, or coaching dialog — only replace the flat table with the new component.
- Do not touch any file outside this task's file list.
- If you have questions before starting, ask them instead of guessing.
