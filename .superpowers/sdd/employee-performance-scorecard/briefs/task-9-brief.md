# Task 9 Brief: Frontend — shared `PerformanceScorecardTable`

Source plan: `docs/superpowers/plans/2026-08-25-employee-performance-scorecard.md` (Task 9)

## Mandatory design-system consultation (CLAUDE.md rule)

Before writing any JSX/styling, run:
```bash
"C:/Users/ADMIN/AppData/Local/Programs/Python/Python312/python.exe" "C:/Users/ADMIN/.claude/skills/ui-ux-pro-max/scripts/search.py" "performance scorecard data table hrms dashboard" --design-system --stack shadcn -p "MAS PeopleOS"
```
and a domain search for the table pattern:
```bash
"C:/Users/ADMIN/AppData/Local/Programs/Python/Python312/python.exe" "C:/Users/ADMIN/.claude/skills/ui-ux-pro-max/scripts/search.py" "dense data table sticky column" --domain ux --stack shadcn
```
Follow the GlassCard/gradient/tone-color conventions these return, consistent with the rest of this HRMS (rounded-2xl cards, `bg-white/95 backdrop-blur-sm`, tone colors for metric values — do not invent a new visual language for this one component).

## Prior task output you depend on

`GET /api/performance-scorecard?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD` (Task 7, with its fail-closed fix) returns:
- `200 { success: true, data: ScorecardRow[] }` where each row has: `employeeId, employeeName, employeeCode, snapshotDate, attendanceStatus, lateByMinutes, unplannedLeaveFlag, pipStatus, designationId, qualityScore, templateMetrics, teamAttritionPct, teamShrinkagePct, teamRevenue`
- `400` if `dateFrom`/`dateTo` missing
- `403` if the caller's role isn't granted, OR if the caller's team scope can't be resolved (no employees row and not org-wide) — your component must handle a 403 response gracefully (show an access-denied message, not a blank table or a thrown error), since this is a real, reachable response shape, not just a hypothetical.

The existing, already-live `DashboardDrilldownDrawer` component takes props `{ open, onClose, metricCode, metricName, dashboardCode, filters? }` and fetches its own detail data — you do not fetch drilldown data yourself, just pass the right props.

## Task

**Files:**
- Create: `src/components/performance-scorecard/PerformanceScorecardTable.tsx`
- Create: `src/components/performance-scorecard/performanceScorecardColumns.ts`

**Interfaces:**
- Consumes: `GET /api/performance-scorecard` via `hrmsApi.get<T>(path)` (paths always start with `/api/...`), `DashboardDrilldownDrawer` (existing component, import path `@/components/dashboard/DashboardDrilldownDrawer` — confirm this exact path first).
- Produces: `<PerformanceScorecardTable dateFrom={string} dateTo={string} />` — consumed by Task 10 (wiring into `TeamPerformanceTab`) and Task 11 (new Command Center page).

- [ ] **Step 1: Confirm real import paths**

Read `src/components/dashboard/DashboardDrilldownDrawer.tsx`'s export (default or named?) and exact prop types. Read `src/lib/hrmsApi.ts` (or wherever `hrmsApi` actually lives — confirm the path) for its `get<T>` signature. Read an existing shadcn `Table`/`Avatar`/`Badge` import path used elsewhere in this codebase (e.g. in `TeamPerformanceTab.tsx`) to match conventions exactly.

- [ ] **Step 2: Write the column config**

```ts
// src/components/performance-scorecard/performanceScorecardColumns.ts
export interface ScorecardColumn {
  key: string;
  label: string;
  metricCode: string;
  format: (row: ScorecardRow) => string;
}

export interface ScorecardRow {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  snapshotDate: string;
  attendanceStatus: string | null;
  lateByMinutes: number;
  unplannedLeaveFlag: boolean;
  pipStatus: "active" | "at_risk" | "off_track" | "none";
  qualityScore: number | null;
  teamAttritionPct: number | null;
  teamShrinkagePct: number | null;
  teamRevenue: number | null;
}

export const BASELINE_COLUMNS: ScorecardColumn[] = [
  { key: "attendanceStatus", label: "Attendance", metricCode: "ATTENDANCE_STATUS", format: (r) => r.attendanceStatus ?? "—" },
  { key: "lateByMinutes", label: "Latecoming", metricCode: "LATECOMING", format: (r) => `${r.lateByMinutes} min` },
  { key: "unplannedLeaveFlag", label: "Unplanned Leave", metricCode: "UNPLANNED_LEAVE", format: (r) => (r.unplannedLeaveFlag ? "Yes" : "No") },
  { key: "pipStatus", label: "PIP", metricCode: "PIP_STATUS", format: (r) => r.pipStatus },
];

export const TEMPLATE_COLUMNS: ScorecardColumn[] = [
  { key: "qualityScore", label: "Quality", metricCode: "QUALITY_BASELINE", format: (r) => (r.qualityScore === null ? "—" : r.qualityScore.toFixed(1)) },
  { key: "teamAttritionPct", label: "Attrition", metricCode: "ATTRITION", format: (r) => (r.teamAttritionPct === null ? "—" : `${r.teamAttritionPct.toFixed(1)}%`) },
  { key: "teamShrinkagePct", label: "Shrinkage", metricCode: "SHRINKAGE", format: (r) => (r.teamShrinkagePct === null ? "—" : `${r.teamShrinkagePct.toFixed(1)}%`) },
  { key: "teamRevenue", label: "Revenue", metricCode: "REVENUE", format: (r) => (r.teamRevenue === null ? "—" : `₹${r.teamRevenue.toLocaleString("en-IN")}`) },
];
```

- [ ] **Step 3: Write the table component**

```tsx
// src/components/performance-scorecard/PerformanceScorecardTable.tsx
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "PLACEHOLDER_CONFIRM_REAL_PATH"; // confirm in Step 1
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import DashboardDrilldownDrawer from "PLACEHOLDER_CONFIRM_REAL_PATH"; // confirm in Step 1 (default vs named export)
import { BASELINE_COLUMNS, TEMPLATE_COLUMNS, type ScorecardRow } from "./performanceScorecardColumns";

interface PerformanceScorecardTableProps {
  dateFrom: string;
  dateTo: string;
}

function groupByEmployee(rows: ScorecardRow[]): ScorecardRow[] {
  const byEmployee = new Map<string, ScorecardRow>();
  for (const row of rows) {
    const existing = byEmployee.get(row.employeeId);
    if (!existing || row.snapshotDate > existing.snapshotDate) byEmployee.set(row.employeeId, row);
  }
  return Array.from(byEmployee.values());
}

export default function PerformanceScorecardTable({ dateFrom, dateTo }: PerformanceScorecardTableProps) {
  const [drilldown, setDrilldown] = useState<{ employeeId: string; metricCode: string; metricName: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["performance-scorecard", dateFrom, dateTo],
    queryFn: () =>
      hrmsApi.get<{ success: boolean; data: ScorecardRow[] }>(
        `/api/performance-scorecard?dateFrom=${dateFrom}&dateTo=${dateTo}`,
      ),
    staleTime: 5 * 60_000,
  });

  const rows = useMemo(() => groupByEmployee(data?.data ?? []), [data]);
  const columns = [...BASELINE_COLUMNS, ...TEMPLATE_COLUMNS];

  if (isLoading) return <div className="p-6 text-sm text-gray-500">Loading scorecard…</div>;

  // The route returns 403 when the caller's role isn't granted OR their team scope
  // can't be resolved — surface this distinctly, don't let it look like an empty table.
  const status = (error as any)?.response?.status ?? (error as any)?.status;
  if (error) {
    return (
      <div className="p-6 text-sm text-red-600 bg-red-50 rounded-2xl border border-red-200">
        {status === 403
          ? "You don't have access to view this scorecard, or your team scope could not be resolved. Contact HR/IT if you believe this is an error."
          : "Failed to load the performance scorecard. Please try again."}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 bg-white/95 z-10">Employee</TableHead>
            {columns.map((col) => (
              <TableHead key={col.key}>{col.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length + 1} className="text-center text-sm text-gray-500 py-6">
                No performance data for this date range.
              </TableCell>
            </TableRow>
          )}
          {rows.map((row) => (
            <TableRow key={row.employeeId}>
              <TableCell className="sticky left-0 bg-white z-10">
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>{row.employeeName.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="font-semibold text-gray-800">{row.employeeName}</span>
                </div>
              </TableCell>
              {columns.map((col) => (
                <TableCell
                  key={col.key}
                  className="cursor-pointer hover:underline"
                  onClick={() => setDrilldown({ employeeId: row.employeeId, metricCode: col.metricCode, metricName: col.label })}
                >
                  {col.key === "pipStatus" ? (
                    <Badge variant={row.pipStatus === "off_track" ? "destructive" : row.pipStatus === "at_risk" ? "secondary" : "outline"}>
                      {col.format(row)}
                    </Badge>
                  ) : (
                    col.format(row)
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {drilldown && (
        <DashboardDrilldownDrawer
          open={true}
          onClose={() => setDrilldown(null)}
          metricCode={drilldown.metricCode}
          metricName={drilldown.metricName}
          dashboardCode="PERFORMANCE_SCORECARD"
          filters={{ employeeId: drilldown.employeeId, dateFrom, dateTo }}
        />
      )}
    </div>
  );
}
```
Replace `PLACEHOLDER_CONFIRM_REAL_PATH` with the real import paths confirmed in Step 1. If `DashboardDrilldownDrawer` is a named export, adjust the import syntax accordingly. If `hrmsApi.get` doesn't surface HTTP status the way this illustrative code assumes (`error.response.status` vs `error.status`), adapt to however this codebase's `hrmsApi` actually surfaces failed-request status — check an existing page that handles a 403/error response from `hrmsApi` for the real pattern.

- [ ] **Step 4: Verify it builds**

Run: `npx tsc --noEmit` scoped to this component if possible, or `npm run build -- --mode development 2>&1 | tail -50`. Expect no new TypeScript errors from these 2 new files.

- [ ] **Step 5: Commit**

```bash
git add src/components/performance-scorecard/
git commit -m "feat: add shared PerformanceScorecardTable component"
```

## Report contract

Write your full report to `.superpowers/sdd/employee-performance-scorecard/reports/task-9-report.md`, then return ONLY:
- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
- Commit SHA(s)
- One-line verification summary (design-system search run + build result)
- Any concerns

## Important

- Do NOT push to GitHub. Commit locally to `main` only.
- This repo has concurrent sessions editing the shared tree. `git fetch` + re-check `git log` before committing; stage only the new directory's files.
- Do not touch any file outside this task's file list — this task creates new files only, nothing existing should be modified.
- No sensitive data (salary/PAN/Aadhaar) should ever appear on the row surface — this table only shows performance metrics, which is fine, just don't add anything beyond what's specified.
- If you have questions before starting, ask them instead of guessing.
