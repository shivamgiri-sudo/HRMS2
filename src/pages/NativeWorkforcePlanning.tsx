import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users, AlertTriangle, FileText, TrendingUp, CheckCircle2,
  XCircle, Clock, ChevronDown, ChevronUp, Loader2, RefreshCw,
  Play, Plus
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

const todayStr = () => new Date().toISOString().slice(0, 10);
const EMPTY_SIM = { branch_id: "", process_id: "", roster_date: todayStr(), shift_code: "", required_count: "", planned_count: "" };

export default function NativeWorkforcePlanning() {
  const { toast } = useToast();
  const qc = useQueryClient();

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

      </div>
    </DashboardLayout>
  );
}
