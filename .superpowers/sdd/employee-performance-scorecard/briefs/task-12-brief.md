# Task 12 Brief: Multi-metric compare panel

Source plan: `docs/superpowers/plans/2026-08-25-employee-performance-scorecard.md` (Task 12)

## Prior task output you depend on

`src/components/performance-scorecard/PerformanceScorecardTable.tsx` and `performanceScorecardColumns.ts` (Task 9), already wired into `TeamPerformanceTab.tsx` (Task 10) and `PerformanceCommandCenter.tsx` (Task 11). Read BOTH of these files in full first — Task 9's actual implementation may have small differences from what's shown here (error handling, exact prop names) since it went through a review/fix cycle; match the REAL current code, not this brief's assumptions.

## Task

**Files:**
- Create: `src/components/performance-scorecard/PerformanceCompareModal.tsx`
- Modify: `src/components/performance-scorecard/PerformanceScorecardTable.tsx`

**Interfaces:**
- Consumes: `ScorecardRow` type from `./performanceScorecardColumns` (Task 9).
- Produces: `<PerformanceCompareModal open onClose employeeName rows />` — wired into `PerformanceScorecardTable` via a new "Compare" action per row.

- [ ] **Step 1: Read the current `PerformanceScorecardTable.tsx` in full**

Confirm: the exact `data` shape returned by the `useQuery` call (is it `data.data` as an array of `ScorecardRow`, or does Task 9's error-handling wrapping change this?), the exact `ScorecardRow` field names from `performanceScorecardColumns.ts`, and where in the table JSX a new per-row action column would fit without breaking the existing sticky-column/metric-column layout.

- [ ] **Step 2: Write the compare modal**

```tsx
// src/components/performance-scorecard/PerformanceCompareModal.tsx
import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import type { ScorecardRow } from "./performanceScorecardColumns";

const COMPARABLE_METRICS: Array<{ key: keyof ScorecardRow; label: string; color: string }> = [
  { key: "lateByMinutes", label: "Latecoming (min)", color: "#dc2626" },
  { key: "qualityScore", label: "Quality", color: "#15803d" },
  { key: "teamAttritionPct", label: "Attrition (%)", color: "#ea580c" },
  { key: "teamShrinkagePct", label: "Shrinkage (%)", color: "#6d28d9" },
];

interface PerformanceCompareModalProps {
  open: boolean;
  onClose: () => void;
  employeeName: string;
  rows: ScorecardRow[]; // all snapshot-date rows for one employee across the selected range
}

export default function PerformanceCompareModal({ open, onClose, employeeName, rows }: PerformanceCompareModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(["lateByMinutes", "qualityScore"]));

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (next.size < 4) next.add(key);
      return next;
    });
  };

  const chartData = rows.map((r) => ({
    date: r.snapshotDate,
    lateByMinutes: r.lateByMinutes,
    qualityScore: r.qualityScore,
    teamAttritionPct: r.teamAttritionPct,
    teamShrinkagePct: r.teamShrinkagePct,
  }));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Compare metrics — {employeeName}</DialogTitle>
        </DialogHeader>
        <div className="flex gap-4 flex-wrap mb-4">
          {COMPARABLE_METRICS.map((m) => (
            <label key={m.key} className="flex items-center gap-2 text-sm">
              <Checkbox checked={selected.has(m.key as string)} onCheckedChange={() => toggle(m.key as string)} />
              {m.label}
            </label>
          ))}
        </div>
        {chartData.length === 0 ? (
          <div className="text-sm text-gray-500 py-10 text-center">No data points in the selected date range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              {COMPARABLE_METRICS.filter((m) => selected.has(m.key as string)).map((m) => (
                <Line key={m.key} type="monotone" dataKey={m.key as string} stroke={m.color} name={m.label} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </DialogContent>
    </Dialog>
  );
}
```
Add the empty-state check (`chartData.length === 0`) which isn't in the plan's original illustrative code but is a real edge case (an employee with no snapshot rows in range) — include it.

- [ ] **Step 3: Wire a "Compare" trigger into `PerformanceScorecardTable`**

Based on what Step 1 found as the real current structure, add:
```tsx
const [compareEmployee, setCompareEmployee] = useState<{ id: string; name: string } | null>(null);
```
Add a "Compare" button cell at the end of each row (after the metric cells), and a matching `<TableHead>Compare</TableHead>` after the metric column headers. Render the modal at the bottom of the component:
```tsx
{compareEmployee && (
  <PerformanceCompareModal
    open={true}
    onClose={() => setCompareEmployee(null)}
    employeeName={compareEmployee.name}
    rows={(ALL_UNFILTERED_ROWS_FROM_QUERY).filter((r) => r.employeeId === compareEmployee.id)}
  />
)}
```
Use the full, un-deduplicated per-day rows from the query response (not the `groupByEmployee`-reduced display rows) — the compare chart needs every day's data point, not just the latest. Confirm the exact variable name for the raw query data in the current file (Step 1) and use that.

Add the import: `import PerformanceCompareModal from "./PerformanceCompareModal";`

- [ ] **Step 4: Verify it builds**

Run the real gate: `npm run typecheck` (both halves). Expect zero new errors from the 2 touched/created files.

- [ ] **Step 5: Manual verification (if possible)**

If a dev server is available, open the scorecard table, click "Compare" on a row, toggle metrics, confirm the chart updates and stays capped at 4 selected lines. If not possible, state that explicitly.

- [ ] **Step 6: Commit**

```bash
git add src/components/performance-scorecard/PerformanceCompareModal.tsx src/components/performance-scorecard/PerformanceScorecardTable.tsx
git commit -m "feat: add multi-metric compare panel to performance scorecard"
```
Stage only these 2 explicit files.

## Report contract

Write your full report to `.superpowers/sdd/employee-performance-scorecard/reports/task-12-report.md`, then return ONLY:
- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
- Commit SHA(s)
- One-line verification summary (real typecheck result)
- Any concerns

## Important

- Do NOT push to GitHub. Commit locally to `main` only.
- This repo has concurrent sessions editing the shared tree. `git fetch` + re-check `git log` before committing; stage only your explicit files.
- Do not touch any file outside this task's file list.
- If you have questions before starting, ask them instead of guessing.
