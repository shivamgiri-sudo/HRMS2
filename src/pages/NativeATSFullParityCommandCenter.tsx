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
import { CoverTab } from "@/components/ats/command-center/CoverTab";
import { DashboardTab } from "@/components/ats/command-center/DashboardTab";
import { TrendsTab } from "@/components/ats/command-center/TrendsTab";
import { RecruitersTab } from "@/components/ats/command-center/RecruitersTab";
import { RejectionsTab } from "@/components/ats/command-center/RejectionsTab";
import { SourcingTab } from "@/components/ats/command-center/SourcingTab";
import { LiveQueueTab } from "@/components/ats/command-center/LiveQueueTab";
import { JourneyTab } from "@/components/ats/command-center/JourneyTab";
import { HealthTab } from "@/components/ats/command-center/HealthTab";

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

          {/* Cover tab - Enhanced Dashboard */}
          <TabsContent value="Cover" className="mt-4">
            <CoverTab
              summary={summary}
              queueRows={data?.queueRows || []}
              branchTable={data?.branchTable || []}
              processTable={data?.processTable || []}
              recruiterTable={data?.recruiterTable || []}
              sourceTable={data?.sourceTable || []}
              dashboardRows={data?.dashboardRows || []}
              loading={loading}
            />
          </TabsContent>

          {/* Dashboard tab */}
          <TabsContent value="Dashboard" className="mt-4">
            <DashboardTab
              dashboardRows={data?.dashboardRows || []}
              branchTable={data?.branchTable || []}
              loading={loading}
            />
          </TabsContent>

          {/* Trends tab */}
          <TabsContent value="Trends" className="mt-4">
            <TrendsTab
              processTable={data?.processTable || []}
              sourceTable={data?.sourceTable || []}
              slotTable={data?.slotTable || []}
              loading={loading}
            />
          </TabsContent>

          {/* Rejections tab */}
          <TabsContent value="Rejections" className="mt-4">
            <RejectionsTab
              candidateRows={data?.candidateRows || []}
              loading={loading}
            />
          </TabsContent>

          {/* Recruiters tab */}
          <TabsContent value="Recruiters" className="mt-4">
            <RecruitersTab
              recruiterTable={data?.recruiterTable || []}
              loading={loading}
            />
          </TabsContent>

          {/* Sourcing tab */}
          <TabsContent value="Sourcing" className="mt-4">
            <SourcingTab
              sourceTable={data?.sourceTable || []}
              reusablePool={data?.reusablePool || []}
              loading={loading}
            />
          </TabsContent>

          {/* Live Queue tab */}
          <TabsContent value="Live Queue" className="mt-4">
            <LiveQueueTab
              queueRows={data?.queueRows || []}
              loading={loading}
            />
          </TabsContent>

          {/* Journey tab - Candidate 360° View */}
          <TabsContent value="Journey" className="mt-4">
            <JourneyTab />
          </TabsContent>

          {/* Health tab - System Diagnostics */}
          <TabsContent value="Health" className="mt-4">
            <HealthTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
