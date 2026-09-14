import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users, AlertTriangle, FileText, TrendingUp, CheckCircle2,
  XCircle, Clock, ChevronDown, ChevronUp, Loader2, RefreshCw,
  Play, Plus, Shield, TrendingDown, Calculator
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";

type Branch   = { id: string; branch_name: string };
type Process  = { id: string; process_name?: string; process_code?: string };
type Summary  = { coverage_rows: number; active_headcount: number; open_drafts: number };
type CoverageRow = { branch_name: string; process_name: string; active_headcount: number };
type DraftRow = {
  id: string;
  branch_name: string;
  process_name: string;
  roster_date: string;
  shift_code: string | null;
  required_count: number;
  planned_count: number;
  shortage_count: number;
  status: "draft" | "submitted" | "approved" | "rejected" | "cancelled";
};
type SimResult = {
  required_count: number;
  planned_count: number;
  shortage_count: number;
  coverage_percent: number;
  risk_level: "low" | "medium" | "high";
};

// --- Analytics tab types ---
type AttritionSummary = {
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  total_active: number;
  predicted_exits_30d: number;
};
type AtRiskEmployee = {
  RISK_AGENT: string;
  agent_name: string;
  risk_tier: string;
  prediction_score: number;
  exit_probability_30d: number;
  branch_name: string;
  process_name: string;
  designation_name: string;
  aon_days: number;
  attendance_pct: number;
  avg_quality: number;
};
type ManagerRisk = {
  manager_id: string;
  employee_code: string;
  manager_name: string;
  designation_name: string;
  branch_name: string;
  process_name: string;
  team_size: number;
  team_shrinkage_pct: number;
  team_30d_attrition_pct: number;
  team_avg_quality: number;
  manager_risk_score: number;
  risk_level: string;
  critical_employees_count: number;
};
type HcFormula = {
  scope: { process_id: string; process_name: string; branch_id?: string; branch_name?: string };
  mandate: { mandated_hc: number; shrinkage_pct: number; attrition_buffer_pct: number; training_buffer_pct: number; effective_from: string };
  derived_live: { rolling_30d_attrition_rate: number; rolling_60d_shrinkage_pct: number };
  formula_output: {
    required_staffed_hc: number;
    active_hc: number;
    on_notice_hc: number;
    long_leave_hc: number;
    in_training_hc: number;
    available_production_hc: number;
    net_gap: number;
    hiring_demand: number;
    coverage_pct: number;
    risk_signal: 'green' | 'amber' | 'red';
  };
};

function unwrapArr<T>(res: any): T[] { return (res?.data ?? res ?? []) as T[]; }
function unwrapObj<T>(res: any): T   { return (res?.data ?? res) as T; }
function n(v: any): number { return Number(v ?? 0); }

function rosterDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function statusPill(s: DraftRow["status"]) {
  const map: Record<string, string> = {
    draft: "bg-slate-100 text-slate-600",
    submitted: "bg-blue-100 text-blue-700",
    approved: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
    cancelled: "bg-slate-100 text-slate-400",
  };
  return map[s] ?? "bg-slate-100 text-slate-500";
}

function riskStyle(r: string) {
  if (r === "high")   return "text-red-600 bg-red-50 border-red-200";
  if (r === "medium") return "text-amber-600 bg-amber-50 border-amber-200";
  return "text-green-600 bg-green-50 border-green-200";
}

function tierBadge(tier: string) {
  if (tier === "CRITICAL") return "bg-red-100 text-red-700";
  if (tier === "HIGH")     return "bg-orange-100 text-orange-700";
  if (tier === "MEDIUM")   return "bg-amber-100 text-amber-700";
  return "bg-green-100 text-green-700";
}

function riskLevelBadge(level: string) {
  if (level === "CRITICAL") return "bg-red-100 text-red-700";
  if (level === "HIGH")     return "bg-orange-100 text-orange-700";
  if (level === "MEDIUM")   return "bg-amber-100 text-amber-700";
  return "bg-green-100 text-green-700";
}

function riskSignalDot(signal: 'green' | 'amber' | 'red') {
  if (signal === 'red')   return "bg-red-500";
  if (signal === 'amber') return "bg-amber-400";
  return "bg-green-500";
}
function riskSignalText(signal: 'green' | 'amber' | 'red') {
  if (signal === 'red')   return "text-red-600";
  if (signal === 'amber') return "text-amber-600";
  return "text-green-600";
}

const todayStr = () => new Date().toISOString().slice(0, 10);
const EMPTY_SIM = { branch_id: "", process_id: "", roster_date: todayStr(), shift_code: "", required_count: "", planned_count: "" };

export default function NativeWorkforcePlanning() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState<'coverage' | 'predicted' | 'managers' | 'formula'>('coverage');

  const [branchFilter, setBranchFilter]   = useState("");
  const [processFilter, setProcessFilter] = useState("");
  const [showSim, setShowSim]             = useState(false);
  const [simForm, setSimForm]             = useState({ ...EMPTY_SIM });
  const [simResult, setSimResult]         = useState<SimResult | null>(null);
  const [shortageOpen, setShortageOpen]   = useState(true);
  const [draftsOpen, setDraftsOpen]       = useState(true);

  function qs() {
    const p = new URLSearchParams();
    if (branchFilter)  p.set("branch_id", branchFilter);
    if (processFilter) p.set("process_id", processFilter);
    return p.toString() ? `?${p}` : "";
  }

  const branchesQ  = useQuery({ queryKey: ["branches-all"],   queryFn: async () => unwrapArr<Branch>(await hrmsApi.get("/api/org/branches?active_status=1&limit=500")) });
  const processesQ = useQuery({ queryKey: ["processes"],       queryFn: async () => unwrapArr<Process>(await hrmsApi.get<{ data: Process[] }>("/api/processes")) });

  const summaryQ  = useQuery({ queryKey: ["wfp-summary",  branchFilter, processFilter], queryFn: async () => unwrapObj<Summary>(await hrmsApi.get(`/api/workforce-planning/summary${qs()}`)) });
  const coverageQ = useQuery({ queryKey: ["wfp-coverage", branchFilter, processFilter], queryFn: async () => unwrapArr<CoverageRow>(await hrmsApi.get(`/api/workforce-planning/coverage${qs()}`)) });
  const shortageQ = useQuery({ queryKey: ["wfp-shortage", branchFilter, processFilter], queryFn: async () => unwrapArr<DraftRow>(await hrmsApi.get(`/api/workforce-planning/shortage${qs()}`)) });
  const draftsQ   = useQuery({ queryKey: ["wfp-drafts",   branchFilter, processFilter], queryFn: async () => unwrapArr<DraftRow>(await hrmsApi.get(`/api/workforce-planning/shift-gap${qs()}`)) });

  // Analytics tab queries
  const attritionSummaryQ = useQuery({
    queryKey: ["predicted-attrition-summary"],
    queryFn: async () => unwrapObj<AttritionSummary>(await hrmsApi.get("/api/analytics/predictive-attrition/summary")),
    enabled: tab === 'predicted',
  });
  const atRiskQ = useQuery({
    queryKey: ["predicted-attrition-at-risk"],
    queryFn: async () => unwrapArr<AtRiskEmployee>(await hrmsApi.get("/api/analytics/predictive-attrition/at-risk?limit=20")),
    enabled: tab === 'predicted',
  });
  const managerRiskQ = useQuery({
    queryKey: ["manager-risk-leaderboard"],
    queryFn: async () => unwrapArr<ManagerRisk>(await hrmsApi.get("/api/analytics/manager-risk/leaderboard?limit=30")),
    enabled: tab === 'managers',
  });
  const hcFormulaQ = useQuery({
    queryKey: ["hc-formula"],
    queryFn: async () => unwrapArr<HcFormula>(await hrmsApi.get("/api/workforce-mandate/hc-formula")),
    enabled: tab === 'formula',
  });

  const simulateMut = useMutation({
    mutationFn: (f: typeof simForm) =>
      hrmsApi.post("/api/workforce-planning/simulate-roster", {
        ...f, required_count: Number(f.required_count), planned_count: Number(f.planned_count),
      }),
    onSuccess: (res) => setSimResult(unwrapObj<SimResult>(res)),
    onError: (e: any) => toast({ variant: "destructive", title: "Simulation failed", description: e?.response?.data?.message ?? e.message }),
  });

  const saveDraftMut = useMutation({
    mutationFn: (f: typeof simForm) =>
      hrmsApi.post("/api/workforce-planning/generate-draft-roster", {
        ...f, required_count: Number(f.required_count), planned_count: Number(f.planned_count),
      }),
    onSuccess: () => {
      toast({ title: "Draft roster saved." });
      ["wfp-summary", "wfp-drafts", "wfp-shortage"].forEach(k => void qc.invalidateQueries({ queryKey: [k] }));
      setShowSim(false); setSimResult(null); setSimForm({ ...EMPTY_SIM });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Save failed", description: e?.response?.data?.message ?? e.message }),
  });

  const approveMut = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) =>
      hrmsApi.post(`/api/workforce-planning/manager-approval/${id}`, { approved }),
    onSuccess: (_, v) => {
      toast({ title: v.approved ? "Draft approved." : "Draft rejected." });
      ["wfp-summary", "wfp-drafts"].forEach(k => void qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Action failed", description: e?.response?.data?.message ?? e.message }),
  });

  function refetchAll() {
    ["wfp-summary", "wfp-coverage", "wfp-shortage", "wfp-drafts"].forEach(k => void qc.invalidateQueries({ queryKey: [k] }));
  }

  const summary   = summaryQ.data;
  const coverage  = coverageQ.data ?? [];
  const shortages = shortageQ.data ?? [];
  const drafts    = draftsQ.data ?? [];
  const branches  = branchesQ.data ?? [];
  const processes = processesQ.data ?? [];
  const avgHC     = coverage.length ? Math.round(coverage.reduce((s, r) => s + n(r.active_headcount), 0) / coverage.length) : 0;

  const attritionSummary = attritionSummaryQ.data;
  const atRiskList       = atRiskQ.data ?? [];
  const managerList      = managerRiskQ.data ?? [];
  const hcFormulaList    = hcFormulaQ.data ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-6">

        {/* Header */}
        <header className="rounded-3xl bg-gradient-to-r from-indigo-600 to-blue-600 p-6 text-white">
          <p className="text-xs font-black uppercase tracking-[.22em] text-indigo-200">WFM · Planning</p>
          <h1 className="mt-2 text-3xl font-black">Workforce Planning</h1>
          <p className="mt-2 text-sm opacity-90">
            Active headcount coverage by branch and process, shortage alerts, draft-roster simulation and approval.
          </p>
        </header>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={branchFilter} onChange={e => setBranchFilter(e.target.value)}>
            <option value="">All Branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
          </select>
          <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={processFilter} onChange={e => setProcessFilter(e.target.value)}>
            <option value="">All Processes</option>
            {processes.map(p => <option key={p.id} value={p.id}>{p.process_name ?? p.process_code}</option>)}
          </select>
          <button onClick={refetchAll}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors shadow-sm">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button onClick={() => { setShowSim(true); setSimResult(null); }}
            className="ml-auto flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-700 transition-colors">
            <Plus className="h-4 w-4" /> New Draft Roster
          </button>
        </div>

        {/* Tab navigation */}
        <div className="flex gap-1 rounded-2xl bg-slate-100 p-1">
          {[
            { id: 'coverage',  label: 'Coverage & Planning' },
            { id: 'predicted', label: '⚠ Predicted Attrition' },
            { id: 'managers',  label: 'Manager Risk' },
            { id: 'formula',   label: 'HC Formula' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-colors
                ${tab === t.id ? 'bg-white shadow text-indigo-700' : 'text-slate-500 hover:text-slate-700'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── COVERAGE & PLANNING TAB ── */}
        {tab === 'coverage' && (
          <>
            {/* KPI tiles */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: "Active HC",        value: summary?.active_headcount,  Icon: Users,         cls: "text-indigo-600 bg-indigo-50" },
                { label: "Process × Branch", value: summary?.coverage_rows,     Icon: TrendingUp,    cls: "text-blue-600 bg-blue-50" },
                { label: "Open Drafts",      value: summary?.open_drafts,       Icon: FileText,      cls: "text-amber-600 bg-amber-50" },
                { label: "Shortage Rows",    value: shortages.length,           Icon: AlertTriangle, cls: shortages.length > 0 ? "text-red-600 bg-red-50" : "text-green-600 bg-green-50" },
              ].map(({ label, value, Icon, cls }) => (
                <div key={label} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <div className={`inline-flex rounded-xl p-2.5 ${cls}`}><Icon className="h-5 w-5" /></div>
                  <p className="mt-3 text-2xl font-black text-slate-800">
                    {summaryQ.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-300" /> : (value ?? "—")}
                  </p>
                  <p className="mt-1 text-xs font-medium text-slate-500">{label}</p>
                </div>
              ))}
            </div>

            {/* Simulation form */}
            {showSim && (
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 shadow-sm">
                <h2 className="mb-4 text-base font-bold text-indigo-800">Roster Simulation</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    { label: "Branch", type: "select", key: "branch_id", opts: branches.map(b => ({ v: b.id, l: b.branch_name })) },
                    { label: "Process", type: "select", key: "process_id", opts: processes.map(p => ({ v: p.id, l: p.process_name ?? p.process_code ?? "" })) },
                  ].map(({ label, key, opts }) => (
                    <div key={key} className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-600">{label}</label>
                      <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        value={(simForm as any)[key]}
                        onChange={e => setSimForm(f => ({ ...f, [key]: e.target.value }))}>
                        <option value="">Select…</option>
                        {(opts ?? []).map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                      </select>
                    </div>
                  ))}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-600">Roster Date</label>
                    <input type="date" value={simForm.roster_date}
                      onChange={e => setSimForm(f => ({ ...f, roster_date: e.target.value }))}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-600">Shift Code</label>
                    <input type="text" placeholder="MORN / EVEN / NIGHT" value={simForm.shift_code}
                      onChange={e => setSimForm(f => ({ ...f, shift_code: e.target.value }))}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-600">Required HC</label>
                    <input type="number" min={0} placeholder="0" value={simForm.required_count}
                      onChange={e => setSimForm(f => ({ ...f, required_count: e.target.value }))}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-600">Planned HC</label>
                    <input type="number" min={0} placeholder="0" value={simForm.planned_count}
                      onChange={e => setSimForm(f => ({ ...f, planned_count: e.target.value }))}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>

                {simResult && (
                  <div className={`mt-4 rounded-2xl border p-4 ${riskStyle(simResult.risk_level)}`}>
                    <p className="mb-2 text-xs font-black uppercase tracking-wider opacity-60">Simulation Result</p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {[
                        ["Required", simResult.required_count],
                        ["Planned",  simResult.planned_count],
                        ["Shortage", simResult.shortage_count],
                        ["Coverage", `${simResult.coverage_percent}%`],
                      ].map(([l, v]) => (
                        <div key={l as string}>
                          <p className="text-xs opacity-60">{l}</p>
                          <p className="text-xl font-black">{v}</p>
                        </div>
                      ))}
                    </div>
                    <span className={`mt-3 inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-bold capitalize ${riskStyle(simResult.risk_level)}`}>
                      {simResult.risk_level === "low" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                      {simResult.risk_level} risk
                    </span>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={() => simulateMut.mutate(simForm)} disabled={simulateMut.isPending}
                    className="flex items-center gap-2 rounded-xl bg-indigo-100 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-200 disabled:opacity-60 transition-colors">
                    {simulateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    Simulate
                  </button>
                  <button onClick={() => saveDraftMut.mutate(simForm)} disabled={saveDraftMut.isPending || !simForm.required_count}
                    className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-700 disabled:opacity-60 transition-colors">
                    {saveDraftMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                    Save Draft
                  </button>
                  <button onClick={() => { setShowSim(false); setSimResult(null); setSimForm({ ...EMPTY_SIM }); }}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Coverage grid */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-slate-700">
                  Active HC by Process × Branch
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{coverage.length}</span>
                </h2>
                {coverageQ.isFetching && <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />}
              </div>
              {coverageQ.isLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-indigo-400" /></div>
              ) : coverage.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
                  <Users className="h-8 w-8 opacity-30" />
                  <p className="text-sm">No coverage data for this scope.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3 text-left">Branch</th>
                        <th className="px-4 py-3 text-left">Process</th>
                        <th className="px-4 py-3 text-right">Active HC</th>
                        <th className="px-4 py-3 text-right">vs Avg ({avgHC})</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {coverage.map((row, i) => {
                        const hc = n(row.active_headcount);
                        const diff = hc - avgHC;
                        return (
                          <tr key={i} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3 font-medium text-slate-800">{row.branch_name ?? "—"}</td>
                            <td className="px-4 py-3 text-slate-600">{row.process_name ?? "—"}</td>
                            <td className="px-4 py-3 text-right font-bold text-slate-800">{hc}</td>
                            <td className="px-4 py-3 text-right">
                              <span className={`text-xs font-semibold ${diff >= 0 ? "text-green-600" : "text-red-500"}`}>
                                {diff >= 0 ? "+" : ""}{diff}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Shortage alerts */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <button onClick={() => setShortageOpen(o => !o)}
                className="w-full flex items-center justify-between p-4 border-b border-slate-100 hover:bg-slate-50 transition-colors">
                <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <AlertTriangle className={`h-4 w-4 ${shortages.length > 0 ? "text-red-500" : "text-slate-300"}`} />
                  Shortage Alerts
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${shortages.length > 0 ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-400"}`}>
                    {shortages.length}
                  </span>
                </h2>
                {shortageOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
              </button>
              {shortageOpen && (
                shortages.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8 text-slate-400">
                    <CheckCircle2 className="h-7 w-7 opacity-30" />
                    <p className="text-sm">{shortageQ.isLoading ? "Loading…" : "No shortages detected."}</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3 text-left">Branch</th>
                          <th className="px-4 py-3 text-left">Process</th>
                          <th className="px-4 py-3 text-left">Date</th>
                          <th className="px-4 py-3 text-left">Shift</th>
                          <th className="px-4 py-3 text-right">Req</th>
                          <th className="px-4 py-3 text-right">Planned</th>
                          <th className="px-4 py-3 text-right">Short</th>
                          <th className="px-4 py-3 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {shortages.map(r => (
                          <tr key={r.id} className="hover:bg-red-50 transition-colors">
                            <td className="px-4 py-3 font-medium text-slate-800">{r.branch_name ?? "—"}</td>
                            <td className="px-4 py-3 text-slate-600">{r.process_name ?? "—"}</td>
                            <td className="px-4 py-3 text-slate-600">{rosterDate(r.roster_date)}</td>
                            <td className="px-4 py-3 text-slate-500">{r.shift_code ?? "—"}</td>
                            <td className="px-4 py-3 text-right">{n(r.required_count)}</td>
                            <td className="px-4 py-3 text-right">{n(r.planned_count)}</td>
                            <td className="px-4 py-3 text-right font-black text-red-600">{n(r.shortage_count)}</td>
                            <td className="px-4 py-3">
                              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusPill(r.status)}`}>{r.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>

            {/* Draft rosters */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <button onClick={() => setDraftsOpen(o => !o)}
                className="w-full flex items-center justify-between p-4 border-b border-slate-100 hover:bg-slate-50 transition-colors">
                <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-indigo-400" />
                  Draft Rosters
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{drafts.length}</span>
                </h2>
                {draftsOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
              </button>
              {draftsOpen && (
                drafts.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8 text-slate-400">
                    <FileText className="h-7 w-7 opacity-30" />
                    <p className="text-sm">{draftsQ.isLoading ? "Loading…" : "No draft rosters yet. Use \"New Draft Roster\" above to create one."}</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3 text-left">Branch</th>
                          <th className="px-4 py-3 text-left">Process</th>
                          <th className="px-4 py-3 text-left">Date</th>
                          <th className="px-4 py-3 text-left">Shift</th>
                          <th className="px-4 py-3 text-right">Req</th>
                          <th className="px-4 py-3 text-right">Planned</th>
                          <th className="px-4 py-3 text-right">Short</th>
                          <th className="px-4 py-3 text-left">Status</th>
                          <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {drafts.map(r => (
                          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3 font-medium text-slate-800">{r.branch_name ?? "—"}</td>
                            <td className="px-4 py-3 text-slate-600">{r.process_name ?? "—"}</td>
                            <td className="px-4 py-3 text-slate-600">{rosterDate(r.roster_date)}</td>
                            <td className="px-4 py-3 text-slate-500">{r.shift_code ?? "—"}</td>
                            <td className="px-4 py-3 text-right">{n(r.required_count)}</td>
                            <td className="px-4 py-3 text-right">{n(r.planned_count)}</td>
                            <td className={`px-4 py-3 text-right font-bold ${n(r.shortage_count) > 0 ? "text-red-600" : "text-green-600"}`}>
                              {n(r.shortage_count)}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusPill(r.status)}`}>{r.status}</span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              {(r.status === "draft" || r.status === "submitted") ? (
                                <div className="flex items-center justify-end gap-1">
                                  <button onClick={() => approveMut.mutate({ id: r.id, approved: true })}
                                    disabled={approveMut.isPending} title="Approve"
                                    className="rounded-lg p-1.5 text-green-500 hover:bg-green-50 hover:text-green-700 transition-colors">
                                    <CheckCircle2 className="h-4 w-4" />
                                  </button>
                                  <button onClick={() => approveMut.mutate({ id: r.id, approved: false })}
                                    disabled={approveMut.isPending} title="Reject"
                                    className="rounded-lg p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                                    <XCircle className="h-4 w-4" />
                                  </button>
                                </div>
                              ) : r.status === "approved" ? (
                                <Clock className="ml-auto h-4 w-4 text-green-400" />
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>
          </>
        )}

        {/* ── PREDICTED ATTRITION TAB ── */}
        {tab === 'predicted' && (
          <div className="space-y-6">
            {/* Summary cards */}
            {attritionSummaryQ.isLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-indigo-400" /></div>
            ) : attritionSummaryQ.isError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-600">
                Failed to load attrition summary.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm">
                  <div className="inline-flex rounded-xl bg-red-100 p-2.5"><TrendingDown className="h-5 w-5 text-red-600" /></div>
                  <p className="mt-3 text-2xl font-black text-red-700">{attritionSummary?.critical_count ?? "—"}</p>
                  <p className="mt-1 text-xs font-semibold text-red-500">Critical Risk</p>
                </div>
                <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 shadow-sm">
                  <div className="inline-flex rounded-xl bg-orange-100 p-2.5"><AlertTriangle className="h-5 w-5 text-orange-600" /></div>
                  <p className="mt-3 text-2xl font-black text-orange-700">{attritionSummary?.high_count ?? "—"}</p>
                  <p className="mt-1 text-xs font-semibold text-orange-500">High Risk</p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                  <div className="inline-flex rounded-xl bg-amber-100 p-2.5"><Clock className="h-5 w-5 text-amber-600" /></div>
                  <p className="mt-3 text-2xl font-black text-amber-700">{attritionSummary?.medium_count ?? "—"}</p>
                  <p className="mt-1 text-xs font-semibold text-amber-500">Medium Risk</p>
                </div>
                <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 shadow-sm">
                  <div className="inline-flex rounded-xl bg-indigo-100 p-2.5"><Users className="h-5 w-5 text-indigo-600" /></div>
                  <p className="mt-3 text-2xl font-black text-indigo-700">{attritionSummary?.predicted_exits_30d ?? "—"}</p>
                  <p className="mt-1 text-xs font-semibold text-indigo-500">Predicted Exits (30d)</p>
                </div>
              </div>
            )}

            {/* At-risk employee table */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-red-400" />
                  At-Risk Employees
                  <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{atRiskList.length}</span>
                </h2>
                {atRiskQ.isFetching && <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />}
              </div>
              {atRiskQ.isLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-indigo-400" /></div>
              ) : atRiskQ.isError ? (
                <div className="p-6 text-center text-sm text-red-500">Failed to load at-risk employees.</div>
              ) : atRiskList.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
                  <CheckCircle2 className="h-7 w-7 opacity-30" />
                  <p className="text-sm">No at-risk employees found.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3 text-left">Employee</th>
                        <th className="px-4 py-3 text-left">Process / Branch</th>
                        <th className="px-4 py-3 text-right">AoN (days)</th>
                        <th className="px-4 py-3 text-right">Attendance %</th>
                        <th className="px-4 py-3 text-right">Avg Quality</th>
                        <th className="px-4 py-3 text-right">Risk Score</th>
                        <th className="px-4 py-3 text-center">Tier</th>
                        <th className="px-4 py-3 text-right">Exit Prob (30d)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {atRiskList.map((emp, i) => (
                        <tr key={emp.RISK_AGENT ?? i} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3">
                            <p className="font-semibold text-slate-800">{emp.agent_name ?? "—"}</p>
                            <p className="text-xs text-slate-400">{emp.RISK_AGENT}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-slate-700">{emp.process_name ?? "—"}</p>
                            <p className="text-xs text-slate-400">{emp.branch_name}</p>
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700">{n(emp.aon_days)}</td>
                          <td className="px-4 py-3 text-right text-slate-700">{n(emp.attendance_pct).toFixed(1)}%</td>
                          <td className="px-4 py-3 text-right text-slate-700">{n(emp.avg_quality).toFixed(1)}</td>
                          <td className="px-4 py-3 text-right font-bold text-slate-800">{n(emp.prediction_score).toFixed(2)}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${tierBadge(emp.risk_tier)}`}>
                              {emp.risk_tier}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-slate-700">
                            {(n(emp.exit_probability_30d) * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── MANAGER RISK TAB ── */}
        {tab === 'managers' && (
          <div className="space-y-6">
            {/* Summary row */}
            {managerRiskQ.isLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-indigo-400" /></div>
            ) : managerRiskQ.isError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-600">
                Failed to load manager risk data.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="inline-flex rounded-xl bg-indigo-50 p-2.5"><Shield className="h-5 w-5 text-indigo-600" /></div>
                    <p className="mt-3 text-2xl font-black text-slate-800">{managerList.length}</p>
                    <p className="mt-1 text-xs font-medium text-slate-500">Total Managers</p>
                  </div>
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm">
                    <div className="inline-flex rounded-xl bg-red-100 p-2.5"><AlertTriangle className="h-5 w-5 text-red-600" /></div>
                    <p className="mt-3 text-2xl font-black text-red-700">
                      {managerList.filter(m => m.risk_level === 'CRITICAL').length}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-red-500">Critical Risk Managers</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="inline-flex rounded-xl bg-amber-50 p-2.5"><TrendingUp className="h-5 w-5 text-amber-600" /></div>
                    <p className="mt-3 text-2xl font-black text-slate-800">
                      {managerList.length > 0
                        ? (managerList.reduce((s, m) => s + n(m.manager_risk_score), 0) / managerList.length).toFixed(1)
                        : "—"}
                    </p>
                    <p className="mt-1 text-xs font-medium text-slate-500">Avg Risk Score</p>
                  </div>
                </div>

                {/* Manager table */}
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between p-4 border-b border-slate-100">
                    <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                      <Shield className="h-4 w-4 text-indigo-400" />
                      Manager Risk Leaderboard
                    </h2>
                    {managerRiskQ.isFetching && <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />}
                  </div>
                  {managerList.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
                      <Users className="h-7 w-7 opacity-30" />
                      <p className="text-sm">No manager risk data found.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-3 text-left">Manager</th>
                            <th className="px-4 py-3 text-left">Branch</th>
                            <th className="px-4 py-3 text-left">Process</th>
                            <th className="px-4 py-3 text-right">Team</th>
                            <th className="px-4 py-3 text-right">Shrinkage %</th>
                            <th className="px-4 py-3 text-right">30d Attrition %</th>
                            <th className="px-4 py-3 text-right">Avg Quality</th>
                            <th className="px-4 py-3 text-right">Risk Score</th>
                            <th className="px-4 py-3 text-center">Level</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {managerList.map((mgr, i) => (
                            <tr key={mgr.manager_id ?? i} className="hover:bg-slate-50 transition-colors">
                              <td className="px-4 py-3">
                                <p className="font-semibold text-slate-800">{mgr.manager_name ?? "—"}</p>
                                <p className="text-xs text-slate-400">{mgr.designation_name}</p>
                                {n(mgr.critical_employees_count) > 0 && (
                                  <span className="mt-0.5 inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600">
                                    {mgr.critical_employees_count} critical member{mgr.critical_employees_count !== 1 ? 's' : ''}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-slate-600">{mgr.branch_name ?? "—"}</td>
                              <td className="px-4 py-3 text-slate-600">{mgr.process_name ?? "—"}</td>
                              <td className="px-4 py-3 text-right text-slate-700">{n(mgr.team_size)}</td>
                              <td className="px-4 py-3 text-right text-slate-700">{n(mgr.team_shrinkage_pct).toFixed(1)}%</td>
                              <td className="px-4 py-3 text-right text-slate-700">{n(mgr.team_30d_attrition_pct).toFixed(1)}%</td>
                              <td className="px-4 py-3 text-right text-slate-700">{n(mgr.team_avg_quality).toFixed(1)}</td>
                              <td className="px-4 py-3 text-right font-bold text-slate-800">{n(mgr.manager_risk_score).toFixed(1)}</td>
                              <td className="px-4 py-3 text-center">
                                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${riskLevelBadge(mgr.risk_level)}`}>
                                  {mgr.risk_level}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── HC FORMULA TAB ── */}
        {tab === 'formula' && (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="inline-flex rounded-xl bg-indigo-100 p-2.5">
                <Calculator className="h-5 w-5 text-indigo-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-800">BPO Headcount Formula Calculator — Live Analysis</h2>
                <p className="text-xs text-slate-500">Required staffed HC per mandate, derived from live attrition and shrinkage rates.</p>
              </div>
            </div>

            {hcFormulaQ.isLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-indigo-400" /></div>
            ) : hcFormulaQ.isError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-600">
                Failed to load HC formula data.
              </div>
            ) : hcFormulaList.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
                <Calculator className="h-10 w-10 opacity-20" />
                <p className="text-sm">No active workforce mandates found.</p>
              </div>
            ) : (
              hcFormulaList.map((item, i) => {
                const { scope, mandate, derived_live, formula_output: fo } = item;
                const shrinkPct   = n(mandate.shrinkage_pct);
                const attrPct     = n(mandate.attrition_buffer_pct);
                const trainPct    = n(mandate.training_buffer_pct);
                const mandatedHc  = n(mandate.mandated_hc);
                const reqHc       = n(fo.required_staffed_hc);

                return (
                  <div key={i} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    {/* Scope header */}
                    <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
                      <div>
                        <p className="font-bold text-slate-800">{scope.process_name}</p>
                        {scope.branch_name && <p className="text-xs text-slate-500">{scope.branch_name}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full ${riskSignalDot(fo.risk_signal)}`} />
                        <span className={`text-xs font-bold uppercase ${riskSignalText(fo.risk_signal)}`}>
                          {fo.risk_signal === 'green' ? 'On Track' : fo.risk_signal === 'amber' ? 'Watch' : 'At Risk'}
                        </span>
                      </div>
                    </div>

                    <div className="p-5 space-y-5">
                      {/* Inputs / Live derived */}
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                          <p className="mb-3 text-xs font-black uppercase tracking-wider text-slate-400">Formula Inputs</p>
                          <div className="space-y-2">
                            {[
                              ["Mandated HC", mandatedHc],
                              ["Shrinkage %", `${shrinkPct}%`],
                              ["Attrition Buffer %", `${attrPct}%`],
                              ["Training Buffer %", `${trainPct}%`],
                            ].map(([label, val]) => (
                              <div key={label as string} className="flex items-center justify-between text-sm">
                                <span className="text-slate-500">{label}</span>
                                <span className="font-semibold text-slate-800">{val}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                          <p className="mb-3 text-xs font-black uppercase tracking-wider text-blue-400">Live Derived</p>
                          <div className="space-y-2">
                            {[
                              ["Rolling 30d Attrition %", `${n(derived_live.rolling_30d_attrition_rate).toFixed(2)}%`],
                              ["Rolling 60d Shrinkage %", `${n(derived_live.rolling_60d_shrinkage_pct).toFixed(2)}%`],
                            ].map(([label, val]) => (
                              <div key={label as string} className="flex items-center justify-between text-sm">
                                <span className="text-blue-600">{label}</span>
                                <span className="font-semibold text-blue-800">{val}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Formula output tiles */}
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div className="rounded-xl border-2 border-indigo-300 bg-indigo-50 p-3 text-center">
                          <p className="text-xs font-semibold text-indigo-500 mb-1">Required Staffed HC</p>
                          <p className="text-2xl font-black text-indigo-700">{reqHc}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
                          <p className="text-xs font-semibold text-slate-500 mb-1">Available Production HC</p>
                          <p className="text-2xl font-black text-slate-800">{n(fo.available_production_hc)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
                          <p className="text-xs font-semibold text-slate-500 mb-1">Net Gap</p>
                          <p className={`text-2xl font-black ${n(fo.net_gap) > 0 ? "text-red-600" : "text-green-600"}`}>
                            {n(fo.net_gap) > 0 ? "+" : ""}{n(fo.net_gap)}
                          </p>
                        </div>
                        <div className={`rounded-xl border p-3 text-center ${n(fo.hiring_demand) > 0 ? "border-orange-300 bg-orange-50" : "border-slate-200 bg-white"}`}>
                          <p className={`text-xs font-semibold mb-1 ${n(fo.hiring_demand) > 0 ? "text-orange-500" : "text-slate-500"}`}>Hiring Demand</p>
                          <p className={`text-2xl font-black ${n(fo.hiring_demand) > 0 ? "text-orange-700" : "text-slate-700"}`}>
                            {n(fo.hiring_demand)}
                          </p>
                        </div>
                      </div>

                      {/* Coverage % progress bar */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold text-slate-500">Coverage %</span>
                          <span className={`text-sm font-black ${riskSignalText(fo.risk_signal)}`}>
                            {n(fo.coverage_pct).toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              fo.risk_signal === 'green' ? 'bg-green-500' :
                              fo.risk_signal === 'amber' ? 'bg-amber-400' : 'bg-red-500'
                            }`}
                            style={{ width: `${Math.min(100, n(fo.coverage_pct))}%` }}
                          />
                        </div>
                      </div>

                      {/* Formula equation display */}
                      <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 font-mono text-xs text-slate-600 space-y-1">
                        <p className="font-black text-slate-700 not-italic font-sans text-xs uppercase tracking-wider mb-2">Formula</p>
                        <p>
                          Required HC = mandated_hc × (1 + shrinkage% / 100) / (1 − attrition% / 100 − training% / 100)
                        </p>
                        <p className="text-slate-400">
                          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; = {mandatedHc} × (1 + {shrinkPct}/100) / (1 − {attrPct}/100 − {trainPct}/100)
                        </p>
                        <p className="font-bold text-indigo-600">
                          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; = {reqHc}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
