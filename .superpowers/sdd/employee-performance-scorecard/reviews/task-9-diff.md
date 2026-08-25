STAT:
commit 22b92a90f1fa5bd70248443bf2e4663e1eea4629
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 08:24:43 2026 +0530

    feat: add shared PerformanceScorecardTable component
    
    Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

 .../PerformanceScorecardTable.tsx                  | 114 +++++++++++++++++++++
 .../performanceScorecardColumns.ts                 |  37 +++++++
 2 files changed, 151 insertions(+)

FULL DIFF:
commit 22b92a90f1fa5bd70248443bf2e4663e1eea4629
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 08:24:43 2026 +0530

    feat: add shared PerformanceScorecardTable component
    
    Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

diff --git a/src/components/performance-scorecard/PerformanceScorecardTable.tsx b/src/components/performance-scorecard/PerformanceScorecardTable.tsx
new file mode 100644
index 00000000..ea1423fc
--- /dev/null
+++ b/src/components/performance-scorecard/PerformanceScorecardTable.tsx
@@ -0,0 +1,114 @@
+import { useState, useMemo } from "react";
+import { useQuery } from "@tanstack/react-query";
+import { hrmsApi, getHrmsApiErrorStatus, type HrmsEnvelope } from "@/lib/hrmsApi";
+import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
+import { Avatar, AvatarFallback } from "@/components/ui/avatar";
+import { Badge } from "@/components/ui/badge";
+import { DashboardDrilldownDrawer } from "@/components/dashboard/DashboardDrilldownDrawer";
+import { BASELINE_COLUMNS, TEMPLATE_COLUMNS, type ScorecardRow } from "./performanceScorecardColumns";
+
+interface PerformanceScorecardTableProps {
+  dateFrom: string;
+  dateTo: string;
+}
+
+function groupByEmployee(rows: ScorecardRow[]): ScorecardRow[] {
+  const byEmployee = new Map<string, ScorecardRow>();
+  for (const row of rows) {
+    const existing = byEmployee.get(row.employeeId);
+    if (!existing || row.snapshotDate > existing.snapshotDate) byEmployee.set(row.employeeId, row);
+  }
+  return Array.from(byEmployee.values());
+}
+
+export default function PerformanceScorecardTable({ dateFrom, dateTo }: PerformanceScorecardTableProps) {
+  const [drilldown, setDrilldown] = useState<{ employeeId: string; metricCode: string; metricName: string } | null>(null);
+
+  const { data, isLoading, error } = useQuery({
+    queryKey: ["performance-scorecard", dateFrom, dateTo],
+    queryFn: () =>
+      hrmsApi.get<HrmsEnvelope<ScorecardRow[]>>(
+        `/api/performance-scorecard?dateFrom=${dateFrom}&dateTo=${dateTo}`,
+      ),
+    staleTime: 5 * 60_000,
+  });
+
+  const rows = useMemo(() => groupByEmployee(data?.data ?? []), [data]);
+  const columns = [...BASELINE_COLUMNS, ...TEMPLATE_COLUMNS];
+
+  if (isLoading) return <div className="p-6 text-sm text-gray-500">Loading scorecard…</div>;
+
+  // The route returns 403 when the caller's role isn't granted OR their team scope
+  // can't be resolved — surface this distinctly, don't let it look like an empty table.
+  if (error) {
+    const status = getHrmsApiErrorStatus(error);
+    return (
+      <div className="p-6 text-sm text-red-600 bg-red-50 rounded-2xl border border-red-200">
+        {status === 403
+          ? "You don't have access to view this scorecard, or your team scope could not be resolved. Contact HR/IT if you believe this is an error."
+          : "Failed to load the performance scorecard. Please try again."}
+      </div>
+    );
+  }
+
+  return (
+    <div className="overflow-x-auto rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
+      <Table>
+        <TableHeader>
+          <TableRow>
+            <TableHead className="sticky left-0 bg-white/95 z-10">Employee</TableHead>
+            {columns.map((col) => (
+              <TableHead key={col.key}>{col.label}</TableHead>
+            ))}
+          </TableRow>
+        </TableHeader>
+        <TableBody>
+          {rows.length === 0 && (
+            <TableRow>
+              <TableCell colSpan={columns.length + 1} className="text-center text-sm text-gray-500 py-6">
+                No performance data for this date range.
+              </TableCell>
+            </TableRow>
+          )}
+          {rows.map((row) => (
+            <TableRow key={row.employeeId}>
+              <TableCell className="sticky left-0 bg-white z-10">
+                <div className="flex items-center gap-2">
+                  <Avatar className="h-8 w-8">
+                    <AvatarFallback>{row.employeeName.slice(0, 2).toUpperCase()}</AvatarFallback>
+                  </Avatar>
+                  <span className="font-semibold text-gray-800">{row.employeeName}</span>
+                </div>
+              </TableCell>
+              {columns.map((col) => (
+                <TableCell
+                  key={col.key}
+                  className="cursor-pointer hover:underline"
+                  onClick={() => setDrilldown({ employeeId: row.employeeId, metricCode: col.metricCode, metricName: col.label })}
+                >
+                  {col.key === "pipStatus" ? (
+                    <Badge variant={row.pipStatus === "off_track" ? "destructive" : row.pipStatus === "at_risk" ? "secondary" : "outline"}>
+                      {col.format(row)}
+                    </Badge>
+                  ) : (
+                    col.format(row)
+                  )}
+                </TableCell>
+              ))}
+            </TableRow>
+          ))}
+        </TableBody>
+      </Table>
+      {drilldown && (
+        <DashboardDrilldownDrawer
+          open={true}
+          onClose={() => setDrilldown(null)}
+          metricCode={drilldown.metricCode}
+          metricName={drilldown.metricName}
+          dashboardCode="PERFORMANCE_SCORECARD"
+          filters={{ employeeId: drilldown.employeeId, dateFrom, dateTo }}
+        />
+      )}
+    </div>
+  );
+}
diff --git a/src/components/performance-scorecard/performanceScorecardColumns.ts b/src/components/performance-scorecard/performanceScorecardColumns.ts
new file mode 100644
index 00000000..3666ea43
--- /dev/null
+++ b/src/components/performance-scorecard/performanceScorecardColumns.ts
@@ -0,0 +1,37 @@
+export interface ScorecardColumn {
+  key: string;
+  label: string;
+  metricCode: string;
+  format: (row: ScorecardRow) => string;
+}
+
+export interface ScorecardRow {
+  employeeId: string;
+  employeeName: string;
+  employeeCode: string;
+  snapshotDate: string;
+  attendanceStatus: string | null;
+  lateByMinutes: number;
+  unplannedLeaveFlag: boolean;
+  pipStatus: "active" | "at_risk" | "off_track" | "none";
+  designationId?: string | null;
+  qualityScore: number | null;
+  templateMetrics?: Record<string, unknown> | null;
+  teamAttritionPct: number | null;
+  teamShrinkagePct: number | null;
+  teamRevenue: number | null;
+}
+
+export const BASELINE_COLUMNS: ScorecardColumn[] = [
+  { key: "attendanceStatus", label: "Attendance", metricCode: "ATTENDANCE_STATUS", format: (r) => r.attendanceStatus ?? "—" },
+  { key: "lateByMinutes", label: "Latecoming", metricCode: "LATECOMING", format: (r) => `${r.lateByMinutes} min` },
+  { key: "unplannedLeaveFlag", label: "Unplanned Leave", metricCode: "UNPLANNED_LEAVE", format: (r) => (r.unplannedLeaveFlag ? "Yes" : "No") },
+  { key: "pipStatus", label: "PIP", metricCode: "PIP_STATUS", format: (r) => r.pipStatus },
+];
+
+export const TEMPLATE_COLUMNS: ScorecardColumn[] = [
+  { key: "qualityScore", label: "Quality", metricCode: "QUALITY_BASELINE", format: (r) => (r.qualityScore === null ? "—" : r.qualityScore.toFixed(1)) },
+  { key: "teamAttritionPct", label: "Attrition", metricCode: "ATTRITION", format: (r) => (r.teamAttritionPct === null ? "—" : `${r.teamAttritionPct.toFixed(1)}%`) },
+  { key: "teamShrinkagePct", label: "Shrinkage", metricCode: "SHRINKAGE", format: (r) => (r.teamShrinkagePct === null ? "—" : `${r.teamShrinkagePct.toFixed(1)}%`) },
+  { key: "teamRevenue", label: "Revenue", metricCode: "REVENUE", format: (r) => (r.teamRevenue === null ? "—" : `₹${r.teamRevenue.toLocaleString("en-IN")}`) },
+];
