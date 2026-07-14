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
  if (!score) return { label: "Low", cls: "bg-emerald-100 text-emerald-700" };
  if (score >= 70) return { label: "High",   cls: "bg-rose-100 text-rose-700" };
  if (score >= 45) return { label: "Medium", cls: "bg-amber-100 text-amber-700" };
  return { label: "Low", cls: "bg-emerald-100 text-emerald-700" };
}

// ── Score bar visual ──────────────────────────────────────────
function ScoreBar({ score }: { score: number }) {
  const { bar, ring } = scoreColor(score);
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative h-2 w-28 overflow-hidden rounded-full bg-slate-100">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, score)}%`, background: bar }}
        />
      </div>
      <span className={`min-w-[2.5rem] rounded-full px-2 py-0.5 text-xs font-bold text-center ${ring}`}>
        {score}
      </span>
    </div>
  );
}

const chartConfig = {
  score: { label: "KPI Score", color: "#6366f1" },
};

export default function TeamPerformanceTab() {
  const [coachModal, setCoachModal] = useState(false);
  const [coachEmpId, setCoachEmpId] = useState("");
  const [coachDate, setCoachDate] = useState(new Date().toISOString().slice(0, 10));
  const [coachType, setCoachType] = useState("performance");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
  }));

  const avgScore = agents.length
    ? Math.round(agents.reduce((s, a) => s + (a.quality_pct ?? 0), 0) / agents.length)
    : null;

  async function submitCoaching() {
    if (!coachEmpId || !coachDate || !coachType) return;
    setSubmitting(true);
    try {
      await hrmsApi.post("/api/management/coaching", {
        employee_id: coachEmpId,
        session_date: coachDate,
        session_type: coachType,
      });
      toast({ title: "Coaching session created" });
      queryClient.invalidateQueries({ queryKey: ["management", "coaching"] });
      setCoachModal(false);
    } catch (err: unknown) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-700">Team KPI Performance</h3>
          {avgScore != null && (
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

          {/* Table */}
          <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead className="font-semibold text-slate-600">Employee</TableHead>
                  <TableHead className="font-semibold text-slate-600">KPI Score</TableHead>
                  <TableHead className="font-semibold text-slate-600">Risk Level</TableHead>
                  <TableHead className="font-semibold text-slate-600">Coaching</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((a, i) => {
                  const risk = riskLabel(a.risk_score);
                  return (
                    <TableRow key={a.agent_id ?? i} className="hover:bg-slate-50/60 transition-colors">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                            style={{ background: scoreColor(Math.round(a.quality_pct)).bar }}
                          >
                            {(a.agent_name ?? "?").charAt(0).toUpperCase()}
                          </div>
                          <span className="text-sm font-medium text-slate-900">{a.agent_name}</span>
                        </div>
                      </TableCell>
                      <TableCell><ScoreBar score={Math.round(a.quality_pct ?? 0)} /></TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${risk.cls}`}>
                          <Shield className="h-3 w-3" />{risk.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        {a.coaching_needed ? (
                          <button
                            type="button"
                            onClick={() => { setCoachEmpId(a.agent_id ?? ""); setCoachModal(true); }}
                            className="inline-flex items-center gap-1 rounded-lg bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100 cursor-pointer transition-colors"
                          >
                            <AlertTriangle className="h-3 w-3" />Schedule
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
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
              <label className="mb-1 block text-xs font-semibold text-slate-600">Session Date</label>
              <Input type="date" value={coachDate} onChange={(e) => setCoachDate(e.target.value)} className="rounded-xl" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Session Type</label>
              <Select value={coachType} onValueChange={setCoachType}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["performance", "quality", "behaviour", "skills", "attendance", "general"].map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="rounded-xl" onClick={() => setCoachModal(false)}>Cancel</Button>
            <Button className="rounded-xl" onClick={submitCoaching} disabled={submitting || !coachEmpId}>
              {submitting ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
