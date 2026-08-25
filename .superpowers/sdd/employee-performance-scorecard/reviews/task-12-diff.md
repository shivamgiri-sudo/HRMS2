STAT:
commit e160679a5c085a2553721f4874ba6a93f7c61b80
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 09:32:03 2026 +0530

    feat: add multi-metric compare panel to performance scorecard

 .../PerformanceCompareModal.tsx                    | 74 ++++++++++++++++++++++
 .../PerformanceScorecardTable.tsx                  | 23 ++++++-
 2 files changed, 96 insertions(+), 1 deletion(-)

FULL DIFF:
commit e160679a5c085a2553721f4874ba6a93f7c61b80
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 09:32:03 2026 +0530

    feat: add multi-metric compare panel to performance scorecard

diff --git a/src/components/performance-scorecard/PerformanceCompareModal.tsx b/src/components/performance-scorecard/PerformanceCompareModal.tsx
new file mode 100644
index 00000000..612cde61
--- /dev/null
+++ b/src/components/performance-scorecard/PerformanceCompareModal.tsx
@@ -0,0 +1,74 @@
+import { useState } from "react";
+import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
+import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
+import { Checkbox } from "@/components/ui/checkbox";
+import type { ScorecardRow } from "./performanceScorecardColumns";
+
+const COMPARABLE_METRICS: Array<{ key: keyof ScorecardRow; label: string; color: string }> = [
+  { key: "lateByMinutes", label: "Latecoming (min)", color: "#dc2626" },
+  { key: "qualityScore", label: "Quality", color: "#15803d" },
+  { key: "teamAttritionPct", label: "Attrition (%)", color: "#ea580c" },
+  { key: "teamShrinkagePct", label: "Shrinkage (%)", color: "#6d28d9" },
+];
+
+interface PerformanceCompareModalProps {
+  open: boolean;
+  onClose: () => void;
+  employeeName: string;
+  rows: ScorecardRow[]; // all snapshot-date rows for one employee across the selected range
+}
+
+export default function PerformanceCompareModal({ open, onClose, employeeName, rows }: PerformanceCompareModalProps) {
+  const [selected, setSelected] = useState<Set<string>>(new Set(["lateByMinutes", "qualityScore"]));
+
+  const toggle = (key: string) => {
+    setSelected((prev) => {
+      const next = new Set(prev);
+      if (next.has(key)) next.delete(key);
+      else if (next.size < 4) next.add(key);
+      return next;
+    });
+  };
+
+  const chartData = rows.map((r) => ({
+    date: r.snapshotDate,
+    lateByMinutes: r.lateByMinutes,
+    qualityScore: r.qualityScore,
+    teamAttritionPct: r.teamAttritionPct,
+    teamShrinkagePct: r.teamShrinkagePct,
+  }));
+
+  return (
+    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
+      <DialogContent className="max-w-3xl">
+        <DialogHeader>
+          <DialogTitle>Compare metrics — {employeeName}</DialogTitle>
+        </DialogHeader>
+        <div className="flex gap-4 flex-wrap mb-4">
+          {COMPARABLE_METRICS.map((m) => (
+            <label key={m.key} className="flex items-center gap-2 text-sm">
+              <Checkbox checked={selected.has(m.key as string)} onCheckedChange={() => toggle(m.key as string)} />
+              {m.label}
+            </label>
+          ))}
+        </div>
+        {chartData.length === 0 ? (
+          <div className="text-sm text-gray-500 py-10 text-center">No data points in the selected date range.</div>
+        ) : (
+          <ResponsiveContainer width="100%" height={320}>
+            <LineChart data={chartData}>
+              <CartesianGrid strokeDasharray="3 3" />
+              <XAxis dataKey="date" />
+              <YAxis />
+              <Tooltip />
+              <Legend />
+              {COMPARABLE_METRICS.filter((m) => selected.has(m.key as string)).map((m) => (
+                <Line key={m.key} type="monotone" dataKey={m.key as string} stroke={m.color} name={m.label} connectNulls />
+              ))}
+            </LineChart>
+          </ResponsiveContainer>
+        )}
+      </DialogContent>
+    </Dialog>
+  );
+}
diff --git a/src/components/performance-scorecard/PerformanceScorecardTable.tsx b/src/components/performance-scorecard/PerformanceScorecardTable.tsx
index ea1423fc..f65e4eb3 100644
--- a/src/components/performance-scorecard/PerformanceScorecardTable.tsx
+++ b/src/components/performance-scorecard/PerformanceScorecardTable.tsx
@@ -1,40 +1,43 @@
 import { useState, useMemo } from "react";
 import { useQuery } from "@tanstack/react-query";
 import { hrmsApi, getHrmsApiErrorStatus, type HrmsEnvelope } from "@/lib/hrmsApi";
 import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
 import { Avatar, AvatarFallback } from "@/components/ui/avatar";
 import { Badge } from "@/components/ui/badge";
 import { DashboardDrilldownDrawer } from "@/components/dashboard/DashboardDrilldownDrawer";
 import { BASELINE_COLUMNS, TEMPLATE_COLUMNS, type ScorecardRow } from "./performanceScorecardColumns";
+import { Button } from "@/components/ui/button";
+import PerformanceCompareModal from "./PerformanceCompareModal";
 
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
+  const [compareEmployee, setCompareEmployee] = useState<{ id: string; name: string } | null>(null);
 
   const { data, isLoading, error } = useQuery({
     queryKey: ["performance-scorecard", dateFrom, dateTo],
     queryFn: () =>
       hrmsApi.get<HrmsEnvelope<ScorecardRow[]>>(
         `/api/performance-scorecard?dateFrom=${dateFrom}&dateTo=${dateTo}`,
       ),
     staleTime: 5 * 60_000,
   });
 
   const rows = useMemo(() => groupByEmployee(data?.data ?? []), [data]);
   const columns = [...BASELINE_COLUMNS, ...TEMPLATE_COLUMNS];
 
   if (isLoading) return <div className="p-6 text-sm text-gray-500">Loading scorecard…</div>;
 
@@ -48,67 +51,85 @@ export default function PerformanceScorecardTable({ dateFrom, dateTo }: Performa
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
+            <TableHead>Compare</TableHead>
           </TableRow>
         </TableHeader>
         <TableBody>
           {rows.length === 0 && (
             <TableRow>
-              <TableCell colSpan={columns.length + 1} className="text-center text-sm text-gray-500 py-6">
+              <TableCell colSpan={columns.length + 2} className="text-center text-sm text-gray-500 py-6">
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
+              <TableCell>
+                <Button
+                  variant="outline"
+                  size="sm"
+                  onClick={() => setCompareEmployee({ id: row.employeeId, name: row.employeeName })}
+                >
+                  Compare
+                </Button>
+              </TableCell>
             </TableRow>
           ))}
         </TableBody>
       </Table>
+      {compareEmployee && (
+        <PerformanceCompareModal
+          open={true}
+          onClose={() => setCompareEmployee(null)}
+          employeeName={compareEmployee.name}
+          rows={(data?.data ?? []).filter((r) => r.employeeId === compareEmployee.id)}
+        />
+      )}
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
