import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { AlertTriangle, FileText, Loader2, RefreshCcw, Wrench, Zap } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
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
import { BMIBenchmarkTab } from "@/components/ats/command-center/BMIBenchmarkTab";
import { ProvenanceBar } from "@/components/analytics/analytics-kit";

type AnyRow = Record<string, unknown>;

/**
 * The /command-center payload.
 *
 * This page used to read /web-data, which returns every candidate row in full: 8,229 rows x
 * 206 fields = 44.7MB against hrmsApi's 30s timeout. The aggregates below are computed by the
 * same server-side helpers over the same rows; what changed is that only the rows the tabs
 * render come back, projected to the fields they render.
 */
type CommandCenterData = {
  ok: boolean;
  truncated: boolean;
  rowLimit: number;
  rowsLoaded: number;
  refreshTime: string;
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
  summary: AnyRow;
  dashboardRows: AnyRow[];
  queueRows: AnyRow[];
  queueTotal: number;
  branchTable: AnyRow[];
  processTable: AnyRow[];
  recruiterTable: AnyRow[];
  sourceTable: AnyRow[];
  slotTable: AnyRow[];
  rejections: {
    total: number;
    distinctReasons: number;
    reasons: { label: string; count: number }[];
    rows: AnyRow[];
  };
  reusablePool: AnyRow[];
};

const periods = ["ALL", "FTD", "WTD", "MTD"];
const TAB_IDS = ["Cover", "Dashboard", "Trends", "Rejections", "Recruiters", "Sourcing", "Live Queue", "Journey", "Health", "BMI"];

export default function NativeATSFullParityCommandCenter() {
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("Cover");
  const [period, setPeriod] = useState("ALL");
  const [branch, setBranch] = useState("");
  const [process, setProcess] = useState("");
  const [recruiter, setRecruiter] = useState("");
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
      const res = await hrmsApi.get<CommandCenterData>(`/api/ats-full-parity/command-center?${q.toString()}`);
      setData(res);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message || String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
      didInitLoad.current = true;
    }
  }, [period, branch, process, recruiter]);

  /**
   * Debounced because `load` is keyed on all four filters, so before this every dropdown
   * change fired its own full request — and stepping through a select with the keyboard fired
   * one per option. The first load is not delayed; only subsequent filter changes are.
   */
  useEffect(() => {
    if (!didInitLoad.current) {
      void load();
      return;
    }
    const t = setTimeout(() => void load(), 350);
    return () => clearTimeout(t);
  }, [load]);

  // HealthTab fetches /health itself on mount. A second copy here meant every activation of
  // that tab fired the probe twice.
  const summary = data?.summary || {};

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
        {/* Header — the chrome stays quiet so the data carries the colour. */}
        <header className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-slate-900">ATS Command Center</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Queue, SLA, recruiter productivity, sourcing, rejections, candidate journey and system health.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void load()}
              disabled={refreshing}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-slate-700 disabled:opacity-60"
            >
              <RefreshCcw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Loading…" : "Refresh"}
            </button>
            <button
              onClick={() => void runJob("SLA Check", () => hrmsApi.post(`/api/ats-full-parity/jobs/sla-check`, {}))}
              disabled={!!jobRunning["SLA Check"]}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-50 disabled:opacity-60"
            >
              {jobRunning["SLA Check"] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Run SLA
            </button>
            <button
              onClick={() => void runJob("Data Repair", () => hrmsApi.post(`/api/ats-full-parity/jobs/repair`, { limit: 500 }))}
              disabled={!!jobRunning["Data Repair"]}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-50 disabled:opacity-60"
            >
              {jobRunning["Data Repair"] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
              Repair
            </button>
            <button
              onClick={() => void previewDailyReport()}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-50"
            >
              <FileText className="h-3.5 w-3.5" />
              Daily Report
            </button>
          </div>
        </header>

        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border-2 border-rose-200 bg-rose-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <div className="text-xs text-rose-900">
              <p className="font-bold">Command Center data failed to load</p>
              <p className="mt-1">{error}</p>
            </div>
          </div>
        )}

        {/*
          A hit row cap understates every figure on every tab. The backend has reported
          `truncated` since the cap was raised to 25,000; nothing read it, so the warning it
          was meant to carry did not exist. It does now.
        */}
        {data?.truncated && (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border-2 border-amber-200 bg-amber-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="text-xs text-amber-900">
              <p className="font-bold">Showing a partial dataset</p>
              <p className="mt-1">
                This load hit the {data.rowLimit.toLocaleString("en-IN")}-row cap, so every figure below
                counts only the {data.rowsLoaded.toLocaleString("en-IN")} most recent candidates. Narrow the
                period or branch for complete numbers.
              </p>
            </div>
          </div>
        )}

        {/* Provenance — what the figures on every tab cover. */}
        <ProvenanceBar
          items={[
            { label: "Period", value: period === "ALL" ? "All time" : period },
            { label: "Branch", value: branch || "All branches" },
            { label: "Process", value: process || "All processes" },
            { label: "Recruiter", value: recruiter || "All recruiters" },
            { label: "Refreshed", value: data?.refreshTime || "—", warn: !data?.refreshTime },
            {
              label: "Status",
              value: refreshing ? "Refreshing…" : data ? "Loaded" : "Awaiting data",
              warn: refreshing || !data,
            },
          ]}
        />

        {/* Filter bar */}
        <div className="sticky top-0 z-20 rounded-xl border border-slate-200 bg-white/95 p-2.5 shadow-sm backdrop-blur">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Period</span>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="h-9 cursor-pointer rounded-lg border border-slate-200 px-2.5 text-sm outline-none transition-colors duration-150 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                {periods.map((p) => <option key={p}>{p}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Branch</span>
              <select
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="h-9 cursor-pointer rounded-lg border border-slate-200 px-2.5 text-sm outline-none transition-colors duration-150 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                <option value="">All branches</option>
                {(data?.options?.branches || []).map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Process</span>
              <select
                value={process}
                onChange={(e) => setProcess(e.target.value)}
                className="h-9 cursor-pointer rounded-lg border border-slate-200 px-2.5 text-sm outline-none transition-colors duration-150 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                <option value="">All processes</option>
                {(data?.options?.processes || []).map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Recruiter</span>
              <select
                value={recruiter}
                onChange={(e) => setRecruiter(e.target.value)}
                className="h-9 cursor-pointer rounded-lg border border-slate-200 px-2.5 text-sm outline-none transition-colors duration-150 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                <option value="">All recruiters</option>
                {(data?.options?.recruiters || []).map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
          </div>
        </div>

        {/* Tabs — horizontally scrollable on mobile */}
        <Tabs value={tab} onValueChange={setTab}>
          <div className="overflow-x-auto">
            <TabsList className="flex h-auto w-max gap-0.5 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              {TAB_IDS.map((t) => (
                <TabsTrigger
                  key={t}
                  value={t}
                  className="cursor-pointer whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-semibold text-slate-600 transition-colors duration-150 hover:text-slate-900 data-[state=active]:bg-blue-700 data-[state=active]:text-white"
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
              rejections={data?.rejections ?? null}
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

          {/* BMI Benchmark tab */}
          <TabsContent value="BMI" className="mt-4">
            <BMIBenchmarkTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
