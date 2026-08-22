import { useEffect, useMemo, useState, useCallback } from "react";
import {
  AlertTriangle, BarChart3, CheckCircle2, Clock, FileText, Filter,
  IndianRupee, Percent, RefreshCcw, ShieldCheck, TrendingDown, TrendingUp,
  UserMinus, Users, Building2, Briefcase, Calendar, Download, Search,
  ChevronDown, ChevronRight, X, CheckSquare, Square, Loader2,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { AIInsightPanel } from "@/components/ai";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type ExitRow = {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  branch_name?: string;
  branch_id?: string;
  process_name?: string;
  process_id?: string;
  department_name?: string;
  exit_type: string;
  exit_sub_type?: string;
  exit_reason_category?: string;
  status: string;
  last_working_day_proposed?: string;
  created_at?: string;
  engagement_score?: number;
  regrettable_exit?: number;
  risk_label?: string;
  clearance_total?: number;
  clearance_cleared?: number;
};

type CenterData = {
  summary: Record<string, number>;
  requests: ExitRow[];
  clearance: Array<{ clearance_area: string; status: string; count: number }>;
  attrition_trend?: Array<{ month: string; voluntary: number; involuntary: number; rate: number }>;
  reason_breakdown?: Array<{ reason: string; count: number }>;
  branch_breakdown?: Array<{ branch: string; count: number; rate: number }>;
};

type FullFinalCalc = {
  id: string;
  exit_request_id: string;
  employee_id: string;
  employee_name?: string;
  calculation_date: string;
  notice_period_days: number;
  notice_shortfall_days: number;
  notice_recovery: number;
  earned_leave_encashment: number;
  gratuity_amount: number;
  salary_hold: number;
  advances_recovery: number;
  net_payable: number;
  status: "draft" | "verified" | "approved" | "paid";
  is_ff_provisional: number;
};

const statusFlow = ["submitted", "manager_review", "accepted", "notice_serving", "exited"];
const CHART_COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316"];
const REASON_COLORS: Record<string, string> = {
  better_opportunity: "#3B82F6",
  personal_reasons: "#10B981",
  health: "#EF4444",
  relocation: "#F59E0B",
  higher_studies: "#8B5CF6",
  dissatisfaction_management: "#EC4899",
  dissatisfaction_compensation: "#F97316",
  family_reasons: "#14B8A6",
  termination_performance: "#DC2626",
  termination_misconduct: "#991B1B",
  absconding: "#7C2D12",
  other: "#64748B",
};

// ─────────────────────────────────────────────────────────────────────────────
// Reusable Components
// ─────────────────────────────────────────────────────────────────────────────
function Pill({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "amber" | "red" | "blue" | "violet" }) {
  const cls = {
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
  }[tone];
  return <span className={`rounded-full px-3 py-1 text-xs font-bold border ${cls}`}>{children}</span>;
}

function KpiTile({ title, value, icon, note, trend, trendLabel, tone = "slate" }: {
  title: string; value: number | string; icon: React.ReactNode; note: string;
  trend?: number; trendLabel?: string; tone?: "blue" | "green" | "amber" | "red" | "violet" | "slate";
}) {
  const tones = {
    blue: { bg: "from-blue-50 to-indigo-50", border: "border-blue-200", icon: "bg-blue-100 text-blue-600", value: "text-blue-700" },
    green: { bg: "from-emerald-50 to-green-50", border: "border-emerald-200", icon: "bg-emerald-100 text-emerald-600", value: "text-emerald-700" },
    amber: { bg: "from-amber-50 to-orange-50", border: "border-amber-200", icon: "bg-amber-100 text-amber-600", value: "text-amber-700" },
    red: { bg: "from-red-50 to-rose-50", border: "border-red-200", icon: "bg-red-100 text-red-600", value: "text-red-700" },
    violet: { bg: "from-violet-50 to-purple-50", border: "border-violet-200", icon: "bg-violet-100 text-violet-600", value: "text-violet-700" },
    slate: { bg: "from-slate-50 to-gray-50", border: "border-slate-200", icon: "bg-slate-100 text-slate-600", value: "text-slate-700" },
  };
  const t = tones[tone];
  return (
    <div className={`rounded-2xl border ${t.border} bg-gradient-to-br ${t.bg} p-5 shadow-sm hover:shadow-md transition-all duration-200`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</p>
          <p className={`mt-2 text-3xl font-bold ${t.value} leading-none`}>{value ?? 0}</p>
          <div className="mt-2 flex items-center gap-2">
            <p className="text-xs text-slate-500">{note}</p>
            {trend !== undefined && (
              <span className={`flex items-center gap-0.5 text-xs font-semibold ${trend >= 0 ? "text-red-600" : "text-emerald-600"}`}>
                {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {Math.abs(trend).toFixed(1)}%
                {trendLabel && <span className="text-slate-400 font-normal ml-1">{trendLabel}</span>}
              </span>
            )}
          </div>
        </div>
        <div className={`w-12 h-12 rounded-xl ${t.icon} flex items-center justify-center shrink-0`}>{icon}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Tab
// ─────────────────────────────────────────────────────────────────────────────
function AnalyticsTab({ data, loading }: { data: CenterData | null; loading: boolean }) {
  const trendData = data?.attrition_trend ?? [];
  const reasonData = data?.reason_breakdown ?? [];
  const branchData = data?.branch_breakdown ?? [];

  const avgAttritionRate = trendData.length > 0
    ? (trendData.reduce((s, d) => s + d.rate, 0) / trendData.length).toFixed(1)
    : "0.0";

  const totalVoluntary = trendData.reduce((s, d) => s + d.voluntary, 0);
  const totalInvoluntary = trendData.reduce((s, d) => s + d.involuntary, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        <span className="ml-2 text-slate-500">Loading analytics...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          title="Avg Attrition Rate"
          value={`${avgAttritionRate}%`}
          icon={<Percent className="w-5 h-5" />}
          note="Rolling 6 months"
          tone="red"
        />
        <KpiTile
          title="Voluntary Exits"
          value={totalVoluntary}
          icon={<UserMinus className="w-5 h-5" />}
          note="Resignations"
          tone="blue"
        />
        <KpiTile
          title="Involuntary Exits"
          value={totalInvoluntary}
          icon={<AlertTriangle className="w-5 h-5" />}
          note="Terminations"
          tone="amber"
        />
        <KpiTile
          title="Active Notices"
          value={data?.summary?.active_notice ?? 0}
          icon={<Clock className="w-5 h-5" />}
          note="Currently serving"
          tone="violet"
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Attrition Trend */}
        <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-800">Attrition Trend</h3>
              <p className="text-xs text-slate-500 mt-0.5">Monthly exits over time</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> Voluntary</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Involuntary</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
              <Line type="monotone" dataKey="voluntary" stroke="#3B82F6" strokeWidth={2} dot={false} name="Voluntary" />
              <Line type="monotone" dataKey="involuntary" stroke="#EF4444" strokeWidth={2} dot={false} name="Involuntary" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Attrition Rate Trend */}
        <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-800">Attrition Rate %</h3>
              <p className="text-xs text-slate-500 mt-0.5">Monthly percentage</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trendData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} formatter={(v: number) => [`${v.toFixed(1)}%`, "Rate"]} />
              <Bar dataKey="rate" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Exit Reasons */}
        <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-800">Exit Reasons</h3>
            <p className="text-xs text-slate-500 mt-0.5">Distribution by category</p>
          </div>
          {reasonData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={180} height={180}>
                <PieChart>
                  <Pie
                    data={reasonData}
                    dataKey="count"
                    nameKey="reason"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {reasonData.map((entry, i) => (
                      <Cell key={entry.reason} fill={REASON_COLORS[entry.reason] ?? CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5 max-h-44 overflow-y-auto">
                {reasonData.map((r, i) => (
                  <div key={r.reason} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: REASON_COLORS[r.reason] ?? CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="text-slate-600 capitalize">{r.reason.replace(/_/g, " ")}</span>
                    </span>
                    <span className="font-bold text-slate-800">{r.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-slate-400">No reason data available</div>
          )}
        </div>

        {/* Branch Breakdown */}
        <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-800">Branch Attrition</h3>
            <p className="text-xs text-slate-500 mt-0.5">Exits by location</p>
          </div>
          {branchData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={branchData.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="branch" tick={{ fontSize: 10 }} width={80} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="count" fill="#3B82F6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-12 text-center text-sm text-slate-400">No branch data available</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk Actions Tab
// ─────────────────────────────────────────────────────────────────────────────
function BulkActionsTab({ exitRequests, onRefresh }: { exitRequests: ExitRow[]; onRefresh: () => void }) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [bulkAction, setBulkAction] = useState("");
  const [processing, setProcessing] = useState(false);
  const [expandedBranch, setExpandedBranch] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return exitRequests.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.employee_name?.toLowerCase().includes(q) &&
          !r.employee_code?.toLowerCase().includes(q) &&
          !r.branch_name?.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [exitRequests, statusFilter, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, ExitRow[]>();
    filtered.forEach((r) => {
      const key = r.branch_name ?? "Unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    });
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(filtered.map((r) => r.id)));
  const clearSelection = () => setSelected(new Set());

  const handleBulkAction = async () => {
    if (!bulkAction || selected.size === 0) return;
    setProcessing(true);
    let success = 0;
    let failed = 0;

    for (const id of selected) {
      try {
        if (bulkAction === "generate_clearance") {
          await hrmsApi.post(`/api/exit/${id}/clearance/generate`, {});
        } else {
          await hrmsApi.patch(`/api/exit/${id}/status`, { status: bulkAction, remarks: `Bulk action: ${bulkAction}` });
        }
        success++;
      } catch {
        failed++;
      }
    }

    toast({
      title: "Bulk action complete",
      description: `${success} succeeded, ${failed} failed`,
      variant: failed > 0 ? "destructive" : "default",
    });
    setSelected(new Set());
    setBulkAction("");
    setProcessing(false);
    onRefresh();
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search employee..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {statusFlow.map((s) => (
                <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
              ))}
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="revoked">Revoked</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex-1" />

          {selected.size > 0 && (
            <>
              <Badge variant="secondary" className="font-mono">{selected.size} selected</Badge>
              <Select value={bulkAction} onValueChange={setBulkAction}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Bulk action..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager_review">Move to Manager Review</SelectItem>
                  <SelectItem value="accepted">Accept (Manager Approved)</SelectItem>
                  <SelectItem value="notice_serving">Start Notice</SelectItem>
                  <SelectItem value="exited">Mark Exited</SelectItem>
                  <SelectItem value="generate_clearance">Generate Clearance</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={handleBulkAction}
                disabled={!bulkAction || processing}
                className="bg-rose-600 hover:bg-rose-700"
              >
                {processing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                Apply
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                <X className="w-4 h-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Selection Actions */}
      <div className="flex items-center gap-2 text-sm">
        <Button variant="outline" size="sm" onClick={selectAll}>Select All ({filtered.length})</Button>
        <Button variant="outline" size="sm" onClick={clearSelection}>Clear</Button>
      </div>

      {/* Grouped List */}
      <div className="space-y-3">
        {grouped.map(([branch, rows]) => (
          <div key={branch} className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm overflow-hidden">
            <button
              onClick={() => setExpandedBranch(expandedBranch === branch ? null : branch)}
              className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Building2 className="w-5 h-5 text-slate-400" />
                <span className="font-semibold text-slate-800">{branch}</span>
                <Badge variant="secondary">{rows.length}</Badge>
              </div>
              {expandedBranch === branch ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
            </button>
            {expandedBranch === branch && (
              <div className="border-t">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="p-3 w-10"></th>
                      <th className="p-3 text-left">Employee</th>
                      <th className="p-3 text-left">Process</th>
                      <th className="p-3 text-left">Status</th>
                      <th className="p-3 text-left">LWD</th>
                      <th className="p-3 text-left">Clearance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t hover:bg-slate-50/60">
                        <td className="p-3">
                          <button onClick={() => toggleSelect(r.id)} className="cursor-pointer">
                            {selected.has(r.id) ? (
                              <CheckSquare className="w-5 h-5 text-rose-600" />
                            ) : (
                              <Square className="w-5 h-5 text-slate-300" />
                            )}
                          </button>
                        </td>
                        <td className="p-3">
                          <div className="font-semibold text-slate-800">{r.employee_name ?? r.employee_id}</div>
                          <div className="text-xs text-slate-500 font-mono">{r.employee_code}</div>
                        </td>
                        <td className="p-3 text-slate-600">{r.process_name ?? "—"}</td>
                        <td className="p-3"><Pill tone="blue">{r.status.replace(/_/g, " ")}</Pill></td>
                        <td className="p-3 font-mono text-xs text-slate-600">{r.last_working_day_proposed ?? "—"}</td>
                        <td className="p-3">
                          <span className="text-xs font-semibold">
                            {r.clearance_cleared ?? 0}/{r.clearance_total ?? 0}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-400">
          No exit requests match your filters
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// F&F Settlement Panel
// ─────────────────────────────────────────────────────────────────────────────
function FfSettlementPanel({ exitRequests }: { exitRequests: ExitRow[] }) {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string>("");
  const [ff, setFf] = useState<FullFinalCalc | null>(null);
  const [loadingFf, setLoadingFf] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(false);
  const [advances, setAdvances] = useState<{
    outstanding_amount: number;
    advances: Array<{ id: string; advance_date: string; amount: number; recovered_amount: number; remaining: number; notes: string | null }>;
  } | null>(null);
  const [loadingAdvances, setLoadingAdvances] = useState(false);
  const [form, setForm] = useState({
    noticePeriodDays: 0,
    noticeShortfallDays: 0,
    noticeRecovery: 0,
    gratuityAmount: 0,
    salaryHold: 0,
    advancesRecovery: 0,
    netPayable: 0,
  });

  const loadFf = async (exitRequestId: string) => {
    setLoadingFf(true);
    setFf(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: FullFinalCalc }>(`/api/exit/ff/${exitRequestId}`);
      setFf(res.data);
      setForm({
        noticePeriodDays: res.data.notice_period_days ?? 0,
        noticeShortfallDays: res.data.notice_shortfall_days ?? 0,
        noticeRecovery: res.data.notice_recovery ?? 0,
        gratuityAmount: res.data.gratuity_amount ?? 0,
        salaryHold: res.data.salary_hold ?? 0,
        advancesRecovery: res.data.advances_recovery ?? 0,
        netPayable: res.data.net_payable ?? 0,
      });
    } catch {
      setFf(null);
      setForm({ noticePeriodDays: 0, noticeShortfallDays: 0, noticeRecovery: 0, gratuityAmount: 0, salaryHold: 0, advancesRecovery: 0, netPayable: 0 });
    } finally {
      setLoadingFf(false);
    }
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    if (id) void loadFf(id);
    else setFf(null);
  };

  useEffect(() => {
    if (!selectedId) { setAdvances(null); return; }
    setLoadingAdvances(true);
    hrmsApi.get<{ success: boolean; data: { outstanding_amount: number; advances: any[] } }>(`/api/exit/ff/${selectedId}/outstanding-advances`)
      .then((r) => setAdvances((r as any).data))
      .catch(() => setAdvances(null))
      .finally(() => setLoadingAdvances(false));
  }, [selectedId]);

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await hrmsApi.post(`/api/exit/ff/${selectedId}`, { calculationDate: new Date().toISOString().slice(0, 10), earnedLeaveEncashment: 0, ...form });
      toast({ title: "F&F calculation saved" });
      await loadFf(selectedId);
    } catch (err: any) {
      toast({ title: "Save failed", description: err?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    if (!ff) return;
    const reason = window.prompt("Reason for clearing the provisional F&F calculation:")?.trim();
    if (!reason) return;
    setActing(true);
    try {
      await hrmsApi.post(`/api/exit/ff/${ff.id}/verify`, { reason });
      toast({ title: "Marked as verified — provisional cleared" });
      await loadFf(selectedId);
    } catch (err: any) {
      toast({ title: "Verify failed", description: err?.message, variant: "destructive" });
    } finally {
      setActing(false);
    }
  };

  const handleApprove = async () => {
    if (!ff) return;
    setActing(true);
    try {
      await hrmsApi.post(`/api/exit/ff/${ff.id}/approve`, {});
      toast({ title: "F&F approved" });
      await loadFf(selectedId);
    } catch (err: any) {
      toast({ title: "Approve failed", description: err?.message, variant: "destructive" });
    } finally {
      setActing(false);
    }
  };

  const fmt = (n: number) => `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
  const eligible = exitRequests.filter((e) => ["accepted", "notice_serving", "exited", "exit_confirmed"].includes(e.status));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label className="whitespace-nowrap text-sm font-medium">Employee Exit</Label>
        <Select value={selectedId} onValueChange={handleSelect}>
          <SelectTrigger className="w-80"><SelectValue placeholder="Select an exit request…" /></SelectTrigger>
          <SelectContent>
            {eligible.map((e) => (
              <SelectItem key={e.id} value={e.id}>{e.employee_name ?? e.employee_id} — {e.status.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedId && (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center text-slate-400 text-sm">
          Select an accepted or exited employee to view or create their F&amp;F settlement.
        </div>
      )}

      {selectedId && loadingFf && <div className="py-8 text-center text-sm text-slate-500">Loading F&amp;F data…</div>}

      {selectedId && !loadingFf && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="rounded-2xl border-white/60 bg-white/95 backdrop-blur-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{ff ? "Current F&F Calculation" : "Create F&F Calculation"}</CardTitle>
              {ff?.is_ff_provisional === 1 && (
                <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Provisional — must be verified before approval
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {([
                ["noticePeriodDays", "Notice Period (days)"],
                ["noticeShortfallDays", "Notice Shortfall (days)"],
                ["noticeRecovery", "Notice Recovery (₹)"],
                ["gratuityAmount", "Gratuity (₹)"],
                ["salaryHold", "Salary Hold (₹)"],
                ["advancesRecovery", "Advances Recovery (₹)"],
                ["netPayable", "Net Payable (₹)"],
              ] as [keyof typeof form, string][]).map(([key, label]) => (
                <div key={key} className="grid grid-cols-2 items-center gap-2">
                  <Label className="text-sm">{label}</Label>
                  <Input type="number" value={form[key]} onChange={(e) => setForm((prev) => ({ ...prev, [key]: Number(e.target.value) }))} className="h-8 text-right text-sm" />
                </div>
              ))}
              {!loadingAdvances && advances && advances.outstanding_amount > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 flex items-start justify-between gap-3">
                  <span>Auto-detected outstanding advances: <strong>{fmt(advances.outstanding_amount)}</strong></span>
                  <button type="button" className="shrink-0 rounded bg-amber-700 px-2 py-1 text-xs font-bold text-white hover:bg-amber-800" onClick={() => setForm((prev) => ({ ...prev, advancesRecovery: advances.outstanding_amount }))}>
                    Use this amount
                  </button>
                </div>
              )}
              <Button size="sm" className="w-full mt-2" onClick={() => void handleSave()} disabled={saving}>
                {saving ? "Saving…" : ff ? "Update & Recalculate" : "Create F&F Calculation"}
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-white/60 bg-white/95 backdrop-blur-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><IndianRupee className="h-4 w-4" />Settlement Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg bg-slate-50 p-3 space-y-2 text-sm">
                {([["Gratuity", form.gratuityAmount, false], ["Notice Recovery", form.noticeRecovery, true], ["Salary Hold", form.salaryHold, true], ["Advances Recovery", form.advancesRecovery, true]] as [string, number, boolean][]).map(([label, val, negative]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-slate-600">{label}{negative ? " (−)" : ""}</span>
                    <span className={negative ? "text-red-600" : "text-slate-900"}>{fmt(val)}</span>
                  </div>
                ))}
                <div className="border-t border-slate-200 pt-2 flex justify-between font-semibold">
                  <span>Net Payable</span>
                  <span className="text-emerald-700">{fmt(form.netPayable)}</span>
                </div>
              </div>

              {ff && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={ff.status === "approved" ? "default" : "secondary"}>{ff.status}</Badge>
                  {ff.is_ff_provisional === 1 && <Badge variant="outline" className="text-amber-700 border-amber-300">Provisional</Badge>}
                </div>
              )}

              <div className="flex flex-col gap-2 mt-2">
                {ff && ff.is_ff_provisional === 1 && ff.status !== "approved" && (
                  <Button size="sm" variant="outline" onClick={() => void handleVerify()} disabled={acting}>
                    {acting ? "Working…" : "Mark as Verified (Clear Provisional)"}
                  </Button>
                )}
                {ff && ff.is_ff_provisional === 0 && ff.status !== "approved" && (
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => void handleApprove()} disabled={acting}>
                    <CheckCircle2 className="h-4 w-4 mr-1" />{acting ? "Approving…" : "Approve F&F"}
                  </Button>
                )}
                {ff?.status === "approved" && (
                  <div className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />Approved — ready for disbursement</div>
                )}
                {!ff && <p className="text-xs text-slate-500">No F&amp;F calculation exists yet. Fill the form and save to create one.</p>}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview Tab
// ─────────────────────────────────────────────────────────────────────────────
function OverviewTab({ data, loading, onStatusChange, onGenerateClearance }: {
  data: CenterData | null;
  loading: boolean;
  onStatusChange: (id: string, status: string) => Promise<void>;
  onGenerateClearance: (id: string) => Promise<void>;
}) {
  const [status, setStatus] = useState("all");
  const [message, setMessage] = useState("");

  const filtered = useMemo(() => {
    const rows = data?.requests ?? [];
    return status === "all" ? rows : rows.filter((r) => r.status === status);
  }, [data, status]);

  const moveStatus = async (id: string, nextStatus: string) => {
    try {
      await onStatusChange(id, nextStatus);
      setMessage(`Moved to ${nextStatus.replace(/_/g, " ")}`);
    } catch (err: any) {
      setMessage(err?.message || "Status update failed");
    }
  };

  const generateClearance = async (id: string) => {
    try {
      await onGenerateClearance(id);
      setMessage("Clearance tasks generated");
    } catch (err: any) {
      setMessage(err?.message || "Unable to generate clearance");
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI Grid */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
        <KpiTile title="Total Exits" value={Number(data?.summary?.total ?? 0)} icon={<UserMinus className="w-5 h-5" />} note="All exit records" tone="slate" />
        <KpiTile title="Pending Review" value={Number(data?.summary?.pending_review ?? 0)} icon={<Clock className="w-5 h-5" />} note="Manager/HR/Admin" tone="amber" />
        <KpiTile title="Active Notice" value={Number(data?.summary?.active_notice ?? 0)} icon={<FileText className="w-5 h-5" />} note="Accepted or serving" tone="blue" />
        <KpiTile title="Completed" value={Number(data?.summary?.completed ?? 0)} icon={<CheckCircle2 className="w-5 h-5" />} note="Exit confirmed" tone="green" />
        <KpiTile title="Regrettable" value={Number(data?.summary?.regrettable ?? 0)} icon={<AlertTriangle className="w-5 h-5" />} note="Retention attention" tone="red" />
      </div>

      {/* AI Insight */}
      <AIInsightPanel
        contextType="exit_risk"
        role="hr"
        title="Exit Risk AI Brief"
        enabled={data !== null && !loading}
        data={{
          total_exits: Number(data?.summary?.total ?? 0),
          pending_offboarding: Number(data?.summary?.pending_review ?? 0),
          regrettable_exits: Number(data?.summary?.regrettable ?? 0),
          active_notice: Number(data?.summary?.active_notice ?? 0),
          completed: Number(data?.summary?.completed ?? 0),
          kt_incomplete: data?.requests?.filter((r) => r.status !== "exited" && r.status !== "exit_confirmed").length ?? 0,
          clearance_pending: data?.clearance?.filter((c) => c.status === "pending").reduce((s, c) => s + c.count, 0) ?? 0,
        }}
      />

      {message && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">{message}</div>}

      {/* Status Filter */}
      <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm p-4 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {["all", ...statusFlow, "rejected", "revoked"].map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold capitalize transition-all ${status === s ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {s.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </div>

      {/* Journey Board */}
      <div className="overflow-hidden rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
        <div className="border-b p-5">
          <h2 className="font-bold text-slate-800">Exit Journey Board</h2>
          <p className="text-sm text-slate-500">{filtered.length} records</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1150px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                {["Employee", "Branch / Process", "LWD", "Status", "Health", "Clearance", "Risk", "Actions"].map((h) => (
                  <th key={h} className="p-4 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const currentIndex = statusFlow.indexOf(r.status === "exit_confirmed" ? "exited" : r.status);
                const nextStatus = currentIndex >= 0 && currentIndex < statusFlow.length - 1 ? statusFlow[currentIndex + 1] : null;
                const total = Number(r.clearance_total ?? 0);
                const cleared = Number(r.clearance_cleared ?? 0);
                return (
                  <tr key={r.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4">
                      <div className="font-semibold text-slate-800">{r.employee_name ?? r.employee_id}</div>
                      <div className="font-mono text-xs text-slate-500">{r.employee_code ?? r.employee_id?.slice(0, 8)}</div>
                    </td>
                    <td className="p-4 text-slate-600">
                      <div>{r.branch_name ?? "—"}</div>
                      <div className="text-xs">{r.process_name ?? "—"}</div>
                    </td>
                    <td className="p-4 font-mono text-xs text-slate-600">{r.last_working_day_proposed ?? "—"}</td>
                    <td className="p-4"><Pill tone="blue">{r.status?.replace(/_/g, " ")}</Pill></td>
                    <td className="p-4">
                      <div className="font-bold">{Math.round(Number(r.engagement_score ?? 0))}%</div>
                      <div className="text-xs text-slate-500">Engagement</div>
                    </td>
                    <td className="p-4">
                      <div className="font-bold">{cleared}/{total}</div>
                      <div className="text-xs text-slate-500">Cleared</div>
                    </td>
                    <td className="p-4">
                      {r.regrettable_exit ? (
                        <Pill tone="red">Regrettable</Pill>
                      ) : (
                        <Pill tone={r.risk_label === "high" || r.risk_label === "critical" ? "amber" : "green"}>
                          {r.risk_label ?? "low"}
                        </Pill>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-2">
                        {nextStatus && (
                          <button
                            onClick={() => moveStatus(r.id, nextStatus)}
                            className="rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition-colors"
                          >
                            Move to {nextStatus.replace(/_/g, " ")}
                          </button>
                        )}
                        {total === 0 && (
                          <button
                            onClick={() => generateClearance(r.id)}
                            className="inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            <ShieldCheck className="h-3 w-3" /> Generate clearance
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!filtered.length && <div className="p-10 text-center text-sm text-slate-500">No exit records found.</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function NativeExitCommandCenter() {
  const [data, setData] = useState<CenterData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: CenterData }>("/api/exit/command-center");
      setData(res.data);
    } catch (err: any) {
      console.error("Exit command center load failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleStatusChange = async (id: string, status: string) => {
    await hrmsApi.patch(`/api/exit/${id}/status`, { status, remarks: `Moved to ${status}` });
    await load();
  };

  const handleGenerateClearance = async (id: string) => {
    await hrmsApi.post(`/api/exit/${id}/clearance/generate`, {});
    await load();
  };

  return (
    <DashboardLayout>
      <main className="space-y-6 p-6 lg:p-8">
        {/* Header */}
        <div className="rounded-2xl bg-gradient-to-br from-rose-600 via-red-600 to-orange-600 text-white p-6 shadow-lg">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                <UserMinus className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight leading-tight">Exit Command Center</h1>
                <p className="text-rose-200 text-sm mt-0.5">
                  Resignation · Retention · Clearance · F&F · Analytics
                </p>
              </div>
            </div>
            <Button
              onClick={load}
              disabled={loading}
              variant="outline"
              className="bg-white/10 border-white/30 text-white hover:bg-white/20 hover:text-white"
            >
              <RefreshCcw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="bg-white/95 border border-white/60 backdrop-blur-sm p-1 rounded-xl">
            <TabsTrigger value="overview" className="data-[state=active]:bg-rose-600 data-[state=active]:text-white rounded-lg">
              <Users className="w-4 h-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="analytics" className="data-[state=active]:bg-rose-600 data-[state=active]:text-white rounded-lg">
              <BarChart3 className="w-4 h-4 mr-2" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="bulk" className="data-[state=active]:bg-rose-600 data-[state=active]:text-white rounded-lg">
              <CheckSquare className="w-4 h-4 mr-2" />
              Bulk Actions
            </TabsTrigger>
            <TabsTrigger value="ff" className="data-[state=active]:bg-rose-600 data-[state=active]:text-white rounded-lg">
              <IndianRupee className="w-4 h-4 mr-2" />
              F&F Settlement
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab
              data={data}
              loading={loading}
              onStatusChange={handleStatusChange}
              onGenerateClearance={handleGenerateClearance}
            />
          </TabsContent>

          <TabsContent value="analytics">
            <AnalyticsTab data={data} loading={loading} />
          </TabsContent>

          <TabsContent value="bulk">
            <BulkActionsTab exitRequests={data?.requests ?? []} onRefresh={load} />
          </TabsContent>

          <TabsContent value="ff">
            <FfSettlementPanel exitRequests={data?.requests ?? []} />
          </TabsContent>
        </Tabs>
      </main>
    </DashboardLayout>
  );
}
