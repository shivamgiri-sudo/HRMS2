STAT:
commit b620e924f2ed2540d1d50d6fd0c099e1f77905ed
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 08:42:37 2026 +0530

    feat: wire PerformanceScorecardTable into TeamPerformanceTab

 src/components/my-team/TeamPerformanceTab.tsx | 69 +++++++--------------------
 1 file changed, 17 insertions(+), 52 deletions(-)

FULL DIFF:
commit b620e924f2ed2540d1d50d6fd0c099e1f77905ed
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 08:42:37 2026 +0530

    feat: wire PerformanceScorecardTable into TeamPerformanceTab

diff --git a/src/components/my-team/TeamPerformanceTab.tsx b/src/components/my-team/TeamPerformanceTab.tsx
index 12a2bb1a..e0828282 100644
--- a/src/components/my-team/TeamPerformanceTab.tsx
+++ b/src/components/my-team/TeamPerformanceTab.tsx
@@ -1,37 +1,38 @@
 import { useState } from "react";
 import { useQuery, useQueryClient } from "@tanstack/react-query";
 import { hrmsApi } from "@/lib/hrmsApi";
 import { Button } from "@/components/ui/button";
 import { Skeleton } from "@/components/ui/skeleton";
 import { Input } from "@/components/ui/input";
 import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
 import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
 import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
 import { AlertTriangle, Plus, BarChart2, Shield } from "lucide-react";
 import { useToast } from "@/hooks/use-toast";
 import {
   ChartContainer,
   ChartTooltip,
   ChartTooltipContent,
 } from "@/components/ui/chart";
 import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, ResponsiveContainer } from "recharts";
+import PerformanceScorecardTable from "@/components/performance-scorecard/PerformanceScorecardTable";
 
 // Agent performance fields from /api/management/agent-performance
 interface AgentPerf {
   agent_id?: string;
   agent_name: string;
   quality_pct: number;    // actually KPI overall_score
   calls?: number;
   risk_score?: number;
   coaching_needed?: boolean;
 }
 
 interface TeamMember { id: string; employee_code: string; full_name: string; }
 
 function scoreColor(score: number) {
   if (score >= 80) return { bar: "#22c55e", ring: "bg-emerald-100 text-emerald-700" };
   if (score >= 65) return { bar: "#f59e0b", ring: "bg-amber-100 text-amber-700" };
   return { bar: "#ef4444", ring: "bg-rose-100 text-rose-700" };
 }
 
 function riskLabel(score?: number) {
@@ -60,40 +61,47 @@ function ScoreBar({ score }: { score: number }) {
 }
 
 const chartConfig = {
   score: { label: "KPI Score", color: "#6366f1" },
 };
 
 export default function TeamPerformanceTab() {
   const [coachModal, setCoachModal] = useState(false);
   const [coachEmpId, setCoachEmpId] = useState("");
   const [coachDate, setCoachDate] = useState(
     // IST date — toISOString() is UTC and defaults to yesterday before 05:30 IST.
     new Intl.DateTimeFormat("en-CA", {
       timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
     }).format(new Date())
   );
   const [coachType, setCoachType] = useState("performance");
   const [submitting, setSubmitting] = useState(false);
   const { toast } = useToast();
   const queryClient = useQueryClient();
 
+  const [dateFrom, setDateFrom] = useState(() => {
+    const d = new Date();
+    d.setDate(d.getDate() - 30);
+    return d.toISOString().slice(0, 10);
+  });
+  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
+
   const { data: perfData, isLoading } = useQuery({
     queryKey: ["management", "agent-performance"],
     queryFn: () => hrmsApi.get<any>("/api/management/agent-performance"),
     staleTime: 5 * 60_000,
   });
 
   const { data: membersData } = useQuery({
     queryKey: ["management", "team-members"],
     queryFn: () => hrmsApi.get<any>("/api/management/team-members"),
     staleTime: 5 * 60_000,
   });
 
   const agents: AgentPerf[] = (perfData as any)?.data ?? [];
   const members: TeamMember[] = (membersData as any)?.data ?? [];
 
   // Short names for chart x-axis
   const chartData = agents.slice(0, 20).map((a) => ({
     name: (a.agent_name ?? "").split(" ")[0] ?? "?",
     score: Math.round(a.quality_pct ?? 0),
     fill: scoreColor(Math.round(a.quality_pct ?? 0)).bar,
@@ -133,108 +141,65 @@ export default function TeamPerformanceTab() {
             <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${scoreColor(avgScore).ring}`}>
               Avg {avgScore}
             </span>
           )}
         </div>
         <Button size="sm" variant="outline" className="gap-1.5 rounded-xl shadow-sm" onClick={() => setCoachModal(true)}>
           <Plus className="h-3.5 w-3.5" />
           Coaching Session
         </Button>
       </div>
 
       {isLoading ? (
         <Skeleton className="h-52 w-full rounded-2xl" />
       ) : agents.length === 0 ? (
         <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white py-16">
           <BarChart2 className="h-8 w-8 text-slate-300 mb-2" />
           <p className="text-sm text-slate-500">No KPI data available for your team.</p>
         </div>
       ) : (
         <>
+          {/* Date range control */}
+          <div className="flex items-center gap-2 mb-4">
+            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
+            <span className="text-gray-400">to</span>
+            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
+          </div>
+
           {/* Chart */}
           <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
             <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-4">KPI Score by Agent</p>
             <ChartContainer config={chartConfig} className="h-48 w-full">
               <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
                 <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                 <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                 <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                 <ChartTooltip content={<ChartTooltipContent />} />
                 <Bar dataKey="score" radius={[6, 6, 0, 0]} maxBarSize={36}>
                   {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                 </Bar>
               </BarChart>
             </ChartContainer>
           </div>
 
-          {/* Table */}
-          <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
-            <Table>
-              <TableHeader>
-                <TableRow className="bg-slate-50 hover:bg-slate-50">
-                  <TableHead className="font-semibold text-slate-600">Employee</TableHead>
-                  <TableHead className="font-semibold text-slate-600">KPI Score</TableHead>
-                  <TableHead className="font-semibold text-slate-600">Risk Level</TableHead>
-                  <TableHead className="font-semibold text-slate-600">Coaching</TableHead>
-                </TableRow>
-              </TableHeader>
-              <TableBody>
-                {agents.map((a, i) => {
-                  const risk = riskLabel(a.risk_score);
-                  return (
-                    <TableRow key={a.agent_id ?? i} className="hover:bg-slate-50/60 transition-colors">
-                      <TableCell>
-                        <div className="flex items-center gap-2">
-                          <div
-                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
-                            style={{ background: scoreColor(Math.round(a.quality_pct)).bar }}
-                          >
-                            {(a.agent_name ?? "?").charAt(0).toUpperCase()}
-                          </div>
-                          <span className="text-sm font-medium text-slate-900">{a.agent_name}</span>
-                        </div>
-                      </TableCell>
-                      <TableCell><ScoreBar score={Math.round(a.quality_pct ?? 0)} /></TableCell>
-                      <TableCell>
-                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${risk.cls}`}>
-                          <Shield className="h-3 w-3" />{risk.label}
-                        </span>
-                      </TableCell>
-                      <TableCell>
-                        {a.coaching_needed ? (
-                          <button
-                            type="button"
-                            onClick={() => { setCoachEmpId(a.agent_id ?? ""); setCoachModal(true); }}
-                            className="inline-flex items-center gap-1 rounded-lg bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100 cursor-pointer transition-colors"
-                          >
-                            <AlertTriangle className="h-3 w-3" />Schedule
-                          </button>
-                        ) : (
-                          <span className="text-xs text-slate-400">—</span>
-                        )}
-                      </TableCell>
-                    </TableRow>
-                  );
-                })}
-              </TableBody>
-            </Table>
-          </div>
+          {/* Scorecard table */}
+          <PerformanceScorecardTable dateFrom={dateFrom} dateTo={dateTo} />
         </>
       )}
 
       {/* Coaching modal */}
       <Dialog open={coachModal} onOpenChange={setCoachModal}>
         <DialogContent className="max-w-sm rounded-2xl">
           <DialogHeader><DialogTitle>Create Coaching Session</DialogTitle></DialogHeader>
           <div className="space-y-3">
             <div>
               <label className="mb-1 block text-xs font-semibold text-slate-600">Employee</label>
               <Select value={coachEmpId} onValueChange={setCoachEmpId}>
                 <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select employee…" /></SelectTrigger>
                 <SelectContent>
                   {members.map((m) => (
                     <SelectItem key={m.id} value={m.id}>{m.full_name} ({m.employee_code})</SelectItem>
                   ))}
                 </SelectContent>
               </Select>
             </div>
             <div>
