import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
  ActivitySquare,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCcw,
  Search,
  Wrench,
  Zap,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { SkeletonCard } from "@/components/ui/skeletons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type AnyRow = Record<string, unknown>;

type WebData = {
  ok: boolean;
  orgName: string;
  refreshTime: string;
  todayISO: string;
  summary: AnyRow;
  trends: Record<string, AnyRow>;
  options: {
    branches: string[];
    processes: string[];
    roles: string[];
    recruiters: string[];
    sources: string[];
    statuses: string[];
    months: string[];
    slots: string[];
  };
  queueRows: AnyRow[];
  candidateRows: AnyRow[];
  dashboardRows: AnyRow[];
  branchTable: AnyRow[];
  processTable: AnyRow[];
  roleTable: AnyRow[];
  recruiterTable: AnyRow[];
  sourceTable: AnyRow[];
  slotTable: AnyRow[];
  reusablePool: AnyRow[];
};

const periods = ["ALL", "FTD", "WTD", "MTD"];
const TAB_IDS = ["Cover", "Dashboard", "Trends", "Rejections", "Recruiters", "Sourcing", "Live Queue", "Journey", "Health"];

const n = (v: unknown) => Number(v || 0).toLocaleString("en-IN");
const pct = (v: unknown) => `${Number(v || 0).toFixed(Number(v || 0) % 1 ? 1 : 0)}%`;
const mins = (v: unknown) => {
  const min = Number(v || 0);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
};

function Kpi({ label, value, foot, loading }: { label: string; value: string; foot?: string; loading?: boolean }) {
  if (loading) {
    return <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4 shadow-sm h-[88px]" />;
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-black text-slate-900">{value}</div>
      {foot && <div className="mt-1 text-sm text-slate-500">{foot}</div>}
    </div>
  );
}

function SimpleTable({
  rows,
  columns,
  empty = "No data",
}: {
  rows: AnyRow[];
  columns: { key: string; label: string; render?: (row: AnyRow) => ReactNode }[];
  empty?: string;
}) {
  return (
    <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-3 py-3 text-left font-bold">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, i) => (
              <tr
                key={String(row.id ?? row.CandidateID ?? i)}
                className="border-t border-slate-100 hover:bg-slate-50"
              >
                {columns.map((c) => (
                  <td key={c.key} className="whitespace-nowrap px-3 py-3 text-slate-700">
                    {c.render ? c.render(row) : String(row[c.key] ?? "-")}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-slate-500">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function NativeATSFullParityCommandCenter() {
  const [data, setData] = useState<WebData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("Cover");
  const [period, setPeriod] = useState("ALL");
  const [branch, setBranch] = useState("");
  const [process, setProcess] = useState("");
  const [recruiter, setRecruiter] = useState("");
  const [journeyQuery, setJourneyQuery] = useState("");
  const [journeyLoading, setJourneyLoading] = useState(false);
  const [journeyError, setJourneyError] = useState("");
  const [journey, setJourney] = useState<AnyRow | null>(null);
  const [health, setHealth] = useState<AnyRow | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [jobRunning, setJobRunning] = useState<Record<string, boolean>>({});
  const didInitLoad = useRef(false);

  const load = useCallback(async () => {
    if (didInitLoad.current) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams();
      if (period) q.set("period", period);
      if (branch) q.set("branch", branch);
      if (process) q.set("process", process);
      if (recruiter) q.set("recruiter", recruiter);
      const res = await hrmsApi.get<WebData>(`/api/ats-full-parity/web-data?${q.toString()}`);
      setData(res);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message || String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
      didInitLoad.current = true;
    }
  }, [period, branch, process, recruiter]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: AnyRow }>(`/api/ats-full-parity/health`);
      setHealth(res.data);
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message || "Health check failed.");
    } finally {
      setHealthLoading(false);
    }
  }, []);

  // Refresh health whenever Health tab is activated
  useEffect(() => {
    if (tab === "Health") void loadHealth();
  }, [tab, loadHealth]);

  const summary = data?.summary || {};
  const criticalQueue = useMemo(
    () =>
      [...(data?.queueRows || [])]
        .sort((a, b) => Number(b.WaitingMinutes || 0) - Number(a.WaitingMinutes || 0))
        .slice(0, 15),
    [data]
  );

  async function runJourney() {
    if (!journeyQuery.trim()) return;
    setJourneyLoading(true);
    setJourneyError("");
    setJourney(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: AnyRow }>(
        `/api/ats-full-parity/journey?query=${encodeURIComponent(journeyQuery.trim())}`
      );
      setJourney(res.data);
      if (!res.data) setJourneyError("Candidate not found.");
    } catch (e: unknown) {
      setJourneyError((e as { message?: string })?.message || "Search failed.");
    } finally {
      setJourneyLoading(false);
    }
  }

  async function runJob(jobKey: string, fn: () => Promise<void>) {
    if (jobRunning[jobKey]) return;
    setJobRunning((prev) => ({ ...prev, [jobKey]: true }));
    try {
      await fn();
      toast.success(`${jobKey} completed successfully.`);
      await load();
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message || `${jobKey} failed.`);
    } finally {
      setJobRunning((prev) => ({ ...prev, [jobKey]: false }));
    }
  }

  async function previewDailyReport() {
    try {
      await hrmsApi.get(`/api/ats-full-parity/daily-report/snapshot?mode=preview`);
      toast.success("Daily report preview snapshot generated in ATS report log.");
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message || "Daily report preview failed.");
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* Hero header */}
        <section className="rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 p-6 text-white shadow-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex rounded-full border border-sky-300/20 bg-sky-400/10 px-3 py-1 text-xs font-black uppercase tracking-widest text-sky-100">
                ATS App Script Full Parity
              </div>
              <h1 className="mt-3 text-3xl font-black tracking-tight lg:text-4xl">ATS Command Center</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">
                Dashboard, live queue, SLA, recruiter productivity, sourcing, candidate journey, confirmation, BGV, notifications and health — full parity layer.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/10 p-4">
              <div className="mr-2 text-sm text-slate-200">
                Updated: <b>{data?.refreshTime || "--"}</b>
              </div>
              <button
                onClick={() => void load()}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 rounded-xl bg-sky-400 px-3 py-2 text-sm font-black text-slate-950 disabled:opacity-60"
              >
                <RefreshCcw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Loading…" : "Refresh"}
              </button>
              <button
                onClick={() => void runJob("SLA Check", () => hrmsApi.post(`/api/ats-full-parity/jobs/sla-check`, {}))}
                disabled={!!jobRunning["SLA Check"]}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 px-3 py-2 text-sm font-black text-slate-950 disabled:opacity-60"
              >
                {jobRunning["SLA Check"] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Run SLA
              </button>
              <button
                onClick={() => void runJob("Data Repair", () => hrmsApi.post(`/api/ats-full-parity/jobs/repair`, { limit: 500 }))}
                disabled={!!jobRunning["Data Repair"]}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-sm font-black text-white disabled:opacity-60"
              >
                {jobRunning["Data Repair"] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
                Repair
              </button>
              <button
                onClick={() => void previewDailyReport()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-sm font-black text-white"
              >
                <FileText className="h-4 w-4" />
                Daily Report
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Sticky filter bar */}
        <div className="sticky top-0 z-20 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-5">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            >
              {periods.map((p) => <option key={p}>{p}</option>)}
            </select>
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            >
              <option value="">All branches</option>
              {(data?.options?.branches || []).map((x) => <option key={x}>{x}</option>)}
            </select>
            <select
              value={process}
              onChange={(e) => setProcess(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            >
              <option value="">All processes</option>
              {(data?.options?.processes || []).map((x) => <option key={x}>{x}</option>)}
            </select>
            <select
              value={recruiter}
              onChange={(e) => setRecruiter(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            >
              <option value="">All recruiters</option>
              {(data?.options?.recruiters || []).map((x) => <option key={x}>{x}</option>)}
            </select>
            <div className="flex items-center justify-between text-xs text-slate-400">
              {refreshing ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Refreshing…
                </span>
              ) : (
                <span>{data ? "Data loaded" : "Select period & filters above"}</span>
              )}
            </div>
          </div>
        </div>

        {/* Tabs — horizontally scrollable on mobile */}
        <Tabs value={tab} onValueChange={setTab}>
          <div className="overflow-x-auto">
            <TabsList className="flex h-auto w-max gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
              {TAB_IDS.map((t) => (
                <TabsTrigger
                  key={t}
                  value={t}
                  className="whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold data-[state=active]:bg-slate-950 data-[state=active]:text-white"
                >
                  {t}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* Cover tab */}
          <TabsContent value="Cover" className="mt-4 space-y-4">
            {loading ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Kpi label="Arrivals" value={n(summary.totalArrival)} foot="Selected / rejected / pending" />
                <Kpi label="Selected" value={n(summary.totalSelection)} foot={pct(summary.selectionRate)} />
                <Kpi label="Pending" value={n(summary.pending)} foot={`${n(summary.waiting)} waiting`} />
                <Kpi label="SLA Breach" value={n(summary.slaBreach)} foot={pct(summary.slaBreachRate)} />
              </div>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-bold text-slate-700">Critical Queue (longest wait)</p>
                <SimpleTable
                  rows={criticalQueue}
                  columns={[
                    { key: "QToken", label: "Token" },
                    { key: "FullName", label: "Candidate" },
                    { key: "Branch", label: "Branch" },
                    { key: "RecruiterAssignedName", label: "Recruiter" },
                    { key: "WaitingMinutes", label: "Waiting", render: (r) => mins(r.WaitingMinutes) },
                    { key: "SLAFlag", label: "SLA" },
                  ]}
                />
              </div>
              <div>
                <p className="mb-2 text-sm font-bold text-slate-700">Branch Summary</p>
                <SimpleTable
                  rows={(data?.branchTable || []).slice(0, 12)}
                  columns={[
                    { key: "Name", label: "Branch" },
                    { key: "TotalArrival", label: "Arrival" },
                    { key: "Selection", label: "Selected" },
                    { key: "Waiting", label: "Waiting" },
                    { key: "SlaBreach", label: "SLA" },
                    { key: "SelectionRate", label: "Sel %", render: (r) => pct(r.SelectionRate) },
                  ]}
                  empty="No branch data"
                />
              </div>
            </div>
          </TabsContent>

          {/* Dashboard tab */}
          <TabsContent value="Dashboard" className="mt-4">
            <SimpleTable
              rows={data?.dashboardRows || []}
              columns={[
                { key: "Date", label: "Period" },
                { key: "Total Arrival", label: "Arrival" },
                { key: "Selection", label: "Selected" },
                { key: "Rejection", label: "Rejected" },
                { key: "Pending", label: "Pending" },
                { key: "SLA Breach", label: "SLA" },
                { key: "Avg Time", label: "Avg", render: (r) => mins(r["Avg Time"]) },
              ]}
            />
          </TabsContent>

          {/* Trends tab */}
          <TabsContent value="Trends" className="mt-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-bold text-slate-700">By Process</p>
                <SimpleTable
                  rows={data?.processTable || []}
                  columns={[
                    { key: "Name", label: "Process" },
                    { key: "TotalArrival", label: "Arrival" },
                    { key: "Selection", label: "Selected" },
                    { key: "Rejection", label: "Rejected" },
                    { key: "SelectionRate", label: "Sel %", render: (r) => pct(r.SelectionRate) },
                  ]}
                />
              </div>
              <div>
                <p className="mb-2 text-sm font-bold text-slate-700">By Slot</p>
                <SimpleTable
                  rows={data?.slotTable || []}
                  columns={[
                    { key: "Name", label: "Slot" },
                    { key: "TotalArrival", label: "Arrival" },
                    { key: "Selection", label: "Selected" },
                    { key: "SlaBreach", label: "SLA" },
                    { key: "AvgWaitMinutes", label: "Avg Wait", render: (r) => mins(r.AvgWaitMinutes) },
                  ]}
                />
              </div>
            </div>
          </TabsContent>

          {/* Rejections tab */}
          <TabsContent value="Rejections" className="mt-4">
            <SimpleTable
              rows={(data?.candidateRows || []).filter((r) => r._rejected || r._hardRejectReason)}
              columns={[
                { key: "CandidateID", label: "Candidate ID" },
                { key: "FullName", label: "Candidate" },
                { key: "Branch", label: "Branch" },
                { key: "_endStage", label: "Stage" },
                { key: "_hardRejectReason", label: "Hard reason" },
                { key: "rejection_voc", label: "VOC" },
              ]}
              empty="No rejections in this period"
            />
          </TabsContent>

          {/* Recruiters tab */}
          <TabsContent value="Recruiters" className="mt-4">
            <SimpleTable
              rows={data?.recruiterTable || []}
              columns={[
                { key: "Recruiter", label: "Recruiter" },
                { key: "Branch", label: "Branch" },
                { key: "SourcedCount", label: "Sourced" },
                { key: "AttendedCount", label: "Attended" },
                { key: "SlaCompliancePercent", label: "SLA %", render: (r) => pct(r.SlaCompliancePercent) },
                { key: "SelectionRate", label: "Sel %", render: (r) => pct(r.SelectionRate) },
                { key: "AvgWaitMinutes", label: "Avg Wait", render: (r) => mins(r.AvgWaitMinutes) },
                {
                  key: "AttentionFlag",
                  label: "Attention",
                  render: (r) =>
                    r.AttentionFlag ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                        {String(r.AttentionFlag)}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    ),
                },
              ]}
              empty="No recruiter data for this filter"
            />
          </TabsContent>

          {/* Sourcing tab */}
          <TabsContent value="Sourcing" className="mt-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-bold text-slate-700">By Source Channel</p>
                <SimpleTable
                  rows={data?.sourceTable || []}
                  columns={[
                    { key: "Name", label: "Source" },
                    { key: "TotalArrival", label: "Arrival" },
                    { key: "Selection", label: "Selected" },
                    { key: "Rejection", label: "Rejected" },
                    { key: "SelectionRate", label: "Sel %", render: (r) => pct(r.SelectionRate) },
                  ]}
                />
              </div>
              <div>
                <p className="mb-2 text-sm font-bold text-slate-700">Reusable Pool</p>
                <SimpleTable
                  rows={data?.reusablePool || []}
                  columns={[
                    { key: "CandidateID", label: "Candidate ID" },
                    { key: "FullName", label: "Candidate" },
                    { key: "Branch", label: "Branch" },
                    { key: "_candidateQualityLabel", label: "Quality" },
                    { key: "_reusableReason", label: "Reusable reason" },
                  ]}
                  empty="No reusable candidates in pool"
                />
              </div>
            </div>
          </TabsContent>

          {/* Live Queue tab */}
          <TabsContent value="Live Queue" className="mt-4">
            <SimpleTable
              rows={data?.queueRows || []}
              columns={[
                { key: "QToken", label: "Token" },
                { key: "CandidateID", label: "Candidate ID" },
                { key: "FullName", label: "Candidate" },
                { key: "Branch", label: "Branch" },
                { key: "RoleApplied", label: "Role" },
                { key: "RecruiterAssignedName", label: "Recruiter" },
                { key: "CurrentStage", label: "Stage" },
                { key: "WaitingMinutes", label: "Waiting", render: (r) => mins(r.WaitingMinutes) },
                {
                  key: "SLAFlag",
                  label: "SLA",
                  render: (r) =>
                    r.SLAFlag ? (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700">
                        Breach
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
                        OK
      </span>
                    ),
                },
              ]}
              empty="Queue is empty"
            />
          </TabsContent>

          {/* Candidate Journey tab */}
          <TabsContent value="Journey" className="mt-4 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-3 text-sm font-bold text-slate-700">Search candidate journey</p>
              <div className="flex gap-3">
                <input
                  value={journeyQuery}
                  onChange={(e) => setJourneyQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void runJourney(); }}
                  placeholder="Candidate ID / QToken / mobile / email / name"
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
                <button
                  onClick={() => void runJourney()}
                  disabled={journeyLoading || !journeyQuery.trim()}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                >
                  {journeyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {journeyLoading ? "Searching…" : "Search"}
                </button>
              </div>
              {journeyError && (
                <div className="mt-2 flex items-center gap-2 text-sm text-rose-600">
                  <AlertTriangle className="h-4 w-4" /> {journeyError}
                </div>
              )}
            </div>
            {journey && (
              <>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <Kpi label="Candidate" value={String((journey.candidate as AnyRow)?.FullName ?? "-")} foot={String((journey.candidate as AnyRow)?.CandidateID ?? (journey.candidate as AnyRow)?.candidate_code ?? "")} />
                  <Kpi label="Stage" value={String((journey.candidate as AnyRow)?.CurrentStage ?? (journey.candidate as AnyRow)?.current_stage ?? "-")} foot={String((journey.candidate as AnyRow)?.Status ?? (journey.candidate as AnyRow)?.status ?? "")} />
                  <Kpi label="Quality" value={String((journey.candidate as AnyRow)?._candidateQualityScore ?? 0)} foot={String((journey.candidate as AnyRow)?._candidateQualityLabel ?? "")} />
                  <Kpi label="Handling" value={String((journey.candidate as AnyRow)?._handlingQualityScore ?? 0)} foot={String((journey.candidate as AnyRow)?._handlingQualityLabel ?? "")} />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <p className="mb-2 text-sm font-bold text-slate-700">Stage Log</p>
                    <SimpleTable
                      rows={Array.isArray(journey.stageLogs) ? journey.stageLogs as AnyRow[] : []}
                      columns={[
                        { key: "from_stage", label: "From" },
                        { key: "to_stage", label: "To" },
                        { key: "stage_date", label: "Date" },
                        { key: "remarks", label: "Remarks" },
                      ]}
                      empty="No stage transitions recorded"
                    />
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-bold text-slate-700">Confirmations</p>
                    <SimpleTable
                      rows={Array.isArray(journey.confirmations) ? journey.confirmations as AnyRow[] : []}
                      columns={[
                        { key: "will_join", label: "Will Join" },
                        { key: "hr_query", label: "HR Query" },
                        { key: "process_name", label: "Process" },
                        { key: "created_at", label: "Date" },
                      ]}
                      empty="No confirmations"
                    />
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          {/* Health tab */}
          <TabsContent value="Health" className="mt-4 space-y-3">
            {healthLoading ? (
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin" /> Running health checks…
              </div>
            ) : health ? (
              <>
                <div
                  className={`flex items-center gap-3 rounded-2xl border p-3 text-sm font-bold ${
                    health.ok
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-rose-200 bg-rose-50 text-rose-700"
                  }`}
                >
                  {health.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                  Overall: {health.ok ? "All checks passed" : "One or more checks need attention"}
                  <button
                    onClick={() => void loadHealth()}
                    className="ml-auto inline-flex items-center gap-1 rounded-lg border border-current px-2 py-1 text-xs font-bold opacity-70 hover:opacity-100"
                  >
                    <RefreshCcw className="h-3 w-3" /> Re-run
                  </button>
                </div>
                <SimpleTable
                  rows={Array.isArray(health.checks) ? health.checks as AnyRow[] : []}
                  columns={[
                    { key: "type", label: "Type" },
                    { key: "name", label: "Check" },
                    {
                      key: "ok",
                      label: "Status",
                      render: (r) =>
                        r.ok ? (
                          <span className="flex items-center gap-1 font-bold text-emerald-600">
                            <CheckCircle2 className="h-3.5 w-3.5" /> OK
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 font-bold text-rose-600">
                            <AlertTriangle className="h-3.5 w-3.5" /> Fix needed
                          </span>
                        ),
                    },
                    { key: "count", label: "Count" },
                  ]}
                  empty="No health check results"
                />
              </>
            ) : (
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
                <ActivitySquare className="h-5 w-5" /> Health check data will appear here once loaded.
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
