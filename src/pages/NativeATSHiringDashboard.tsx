import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  Filter,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  TrendingUp,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCard } from "@/components/ui/skeletons";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";

type MetricData = Record<string, number>;
type DashboardData = {
  metrics: MetricData;
  byRecruiter: Array<{ label: string; total: number; contacted: number; selected: number; joined: number }>;
  bySource: Array<{ label: string; total: number; contacted: number; selected: number; joined: number }>;
  byProcess: Array<{ label: string; total: number; contacted: number; selected: number; joined: number }>;
  byBranch: Array<{ label: string; total: number; contacted: number; selected: number; joined: number }>;
};

const initialFilters = {
  fromDate: "",
  toDate: "",
  month: "",
  recruiter: "",
  hiringSource: "",
  wpGroup: "",
  position: "",
  location: "",
  branch: "",
  process: "",
  gender: "",
  education: "",
  experienceLevel: "",
  recruiterRemarks: "",
  hrInterviewStatus: "",
  aiInterviewResult: "",
  opsInterviewStatus: "",
  offerLetterStatus: "",
  joiningStatus: "",
  batchNo: "",
  currentStatus: "",
  walkin: "",
  finalSelection: "",
  joined: "",
  contacted: "",
  search: "",
};

function countActiveFilters(f: typeof initialFilters) {
  return Object.values(f).filter(Boolean).length;
}

function StatCard({ title, value, tone, icon }: { title: string; value: string | number; tone: string; icon: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</div>
          <div className="mt-2 text-2xl font-black text-slate-950">{value}</div>
        </div>
        <div className={`rounded-xl p-2 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

function BandList({
  title,
  rows,
  expanded,
  onToggle,
}: {
  title: string;
  rows: DashboardData["byRecruiter"];
  expanded: boolean;
  onToggle: () => void;
}) {
  const max = Math.max(1, ...rows.map((r) => Number(r.total) || 0));
  const visible = expanded ? rows : rows.slice(0, 8);
  const hasMore = rows.length > 8;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-900">
        <BarChart3 className="h-4 w-4" /> {title}
      </div>
      {rows.length === 0 ? (
        <div className="py-6 text-center text-sm text-slate-400">No data for this filter</div>
      ) : (
        <>
          <div className="space-y-3">
            {visible.map((row) => (
              <div key={row.label}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-semibold text-slate-700">{row.label}</span>
                  <div className="flex items-center gap-2 text-right">
                    <span className="text-xs text-slate-500">{row.selected} sel</span>
                    <span className="font-black text-slate-950">{row.total}</span>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-slate-900"
                    style={{ width: `${Math.max(8, (Number(row.total) / max) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          {hasMore && (
            <button
              type="button"
              onClick={onToggle}
              className="mt-4 flex w-full items-center justify-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-800"
            >
              {expanded ? <><ChevronUp className="h-3 w-3" /> Show less</> : <><ChevronDown className="h-3 w-3" /> Show all {rows.length}</>}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function FilterInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? label}
        className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
      />
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
      >
        <option value="">All</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export default function NativeATSHiringDashboard() {
  const location = useLocation();
  const callingView = location.pathname.includes("/calling-dashboard");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [filters, setFilters] = useState({ ...initialFilters });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const didInitLoad = useRef(false);

  const set = (key: keyof typeof initialFilters, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  // load accepts an explicit filterOverride so Clear doesn't hit stale-closure
  const load = useCallback(async (filterOverride?: typeof initialFilters) => {
    const activeFilters = filterOverride ?? filters;
    if (didInitLoad.current) setRefreshing(true);
    else setLoading(true);
    setErrorMsg("");
    try {
      const params = new URLSearchParams();
      Object.entries(activeFilters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const path = callingView
        ? "/api/ats/recruiter/calling-dashboard"
        : "/api/ats/recruiter/hiring-dashboard";
      const res = await hrmsApi.get<{ success: boolean; data: DashboardData }>(`${path}?${params.toString()}`);
      setData(res.data);
    } catch (err: unknown) {
      setErrorMsg((err as { message?: string })?.message || "Unable to load dashboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
      didInitLoad.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callingView, filters]);

  useEffect(() => {
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = () => {
    setSheetOpen(false);
    void load();
  };

  const clearFilters = () => {
    const cleared = { ...initialFilters };
    setFilters(cleared);
    setSheetOpen(false);
    void load(cleared);
  };

  const activeFilterCount = countActiveFilters(filters);

  const metrics = data?.metrics ?? {};
  const cards = callingView
    ? [
        ["Total Records", metrics.total_records ?? 0],
        ["Contacted", metrics.total_contacted ?? 0],
        ["Contacted %", `${metrics.contacted_pct ?? 0}%`],
        ["Not Contacted", metrics.not_contacted ?? 0],
        ["Shortlisted", metrics.shortlisted ?? 0],
        ["Recruiter Rejected", metrics.recruiter_rejected ?? 0],
        ["Walk-ins", metrics.walkins ?? 0],
        ["Active Recruiters", metrics.active_recruiters ?? 0],
      ]
    : [
        ["Total records", metrics.total_records ?? 0],
        ["Total contacted", metrics.total_contacted ?? 0],
        ["Contacted %", `${metrics.contacted_pct ?? 0}%`],
        ["Not contacted", metrics.not_contacted ?? 0],
        ["Shortlisted", metrics.shortlisted ?? 0],
        ["Rejected by recruiter", metrics.recruiter_rejected ?? 0],
        ["HR selected", metrics.hr_selected ?? 0],
        ["HR rejected", metrics.hr_rejected ?? 0],
        ["AI selected", metrics.ai_selected ?? 0],
        ["AI rejected", metrics.ai_rejected ?? 0],
        ["Ops selected", metrics.ops_selected ?? 0],
        ["Ops rejected", metrics.ops_rejected ?? 0],
        ["Final selected", metrics.final_selected ?? 0],
        ["Offer letter issued", metrics.offer_letter_issued ?? 0],
        ["Joined", metrics.joined ?? 0],
        ["Joining pending", metrics.joining_pending ?? 0],
        ["Walk-ins", metrics.walkins ?? 0],
        ["Employee referrals", metrics.employee_referrals ?? 0],
        ["Active recruiters", metrics.active_recruiters ?? 0],
        ["Recruiter inactive", metrics.recruiter_inactive_count ?? 0],
      ];

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  if (loading) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div className="h-16 animate-pulse rounded-2xl bg-slate-100" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-48 animate-pulse rounded-2xl bg-slate-100" />)}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-slate-500">
              {callingView ? "Calling Dashboard" : "Hiring Dashboard"}
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
              {callingView ? "Recruiter Calling Dashboard" : "Recruiter Hiring Dashboard"}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Reconciled from the recruiter hiring activity table.{" "}
              {activeFilterCount > 0 && (
                <span className="font-semibold text-blue-700">{activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""} active.</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Quick search bar */}
            <div className="relative hidden sm:block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={filters.search}
                onChange={(e) => set("search", e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
                placeholder="Quick search…"
                className="h-11 w-48 rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-400 lg:w-64"
              />
            </div>

            {/* Advanced filters sheet */}
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <button className="relative inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">
                  <SlidersHorizontal className="h-4 w-4" />
                  Filters
                  {activeFilterCount > 0 && (
                    <Badge className="ml-1 h-5 min-w-5 rounded-full bg-blue-600 px-1.5 text-[10px] text-white">
                      {activeFilterCount}
                    </Badge>
                  )}
                </button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <Filter className="h-4 w-4" /> Advanced Filters
                  </SheetTitle>
                </SheetHeader>
                <div className="mt-6 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FilterInput label="From Date" value={filters.fromDate} onChange={(v) => set("fromDate", v)} />
                    <FilterInput label="To Date" value={filters.toDate} onChange={(v) => set("toDate", v)} />
                  </div>
                  <FilterInput label="Month" value={filters.month} onChange={(v) => set("month", v)} placeholder="e.g. Jun-25" />
                  <FilterInput label="Recruiter" value={filters.recruiter} onChange={(v) => set("recruiter", v)} />
                  <FilterInput label="Hiring Source" value={filters.hiringSource} onChange={(v) => set("hiringSource", v)} />
                  <FilterInput label="Branch" value={filters.branch} onChange={(v) => set("branch", v)} />
                  <FilterInput label="Process" value={filters.process} onChange={(v) => set("process", v)} />
                  <FilterInput label="WP Group" value={filters.wpGroup} onChange={(v) => set("wpGroup", v)} />
                  <FilterInput label="Position" value={filters.position} onChange={(v) => set("position", v)} />
                  <FilterInput label="Location" value={filters.location} onChange={(v) => set("location", v)} />
                  <FilterInput label="Gender" value={filters.gender} onChange={(v) => set("gender", v)} />
                  <FilterInput label="Education" value={filters.education} onChange={(v) => set("education", v)} />
                  <FilterInput label="Experience Level" value={filters.experienceLevel} onChange={(v) => set("experienceLevel", v)} />
                  <FilterInput label="Batch No." value={filters.batchNo} onChange={(v) => set("batchNo", v)} />
                  <FilterInput label="Current Status" value={filters.currentStatus} onChange={(v) => set("currentStatus", v)} />
                  <FilterInput label="Recruiter Remarks" value={filters.recruiterRemarks} onChange={(v) => set("recruiterRemarks", v)} />
                  <FilterInput label="HR Status" value={filters.hrInterviewStatus} onChange={(v) => set("hrInterviewStatus", v)} />
                  <FilterInput label="AI Result" value={filters.aiInterviewResult} onChange={(v) => set("aiInterviewResult", v)} />
                  <FilterInput label="Ops Status" value={filters.opsInterviewStatus} onChange={(v) => set("opsInterviewStatus", v)} />
                  <FilterInput label="Offer Letter Status" value={filters.offerLetterStatus} onChange={(v) => set("offerLetterStatus", v)} />
                  <FilterInput label="Joining Status" value={filters.joiningStatus} onChange={(v) => set("joiningStatus", v)} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FilterSelect label="Walk-in" value={filters.walkin} onChange={(v) => set("walkin", v)} options={[{ value: "1", label: "Yes" }, { value: "0", label: "No" }]} />
                    <FilterSelect label="Final Selection" value={filters.finalSelection} onChange={(v) => set("finalSelection", v)} options={[{ value: "1", label: "Yes" }, { value: "0", label: "No" }]} />
                    <FilterSelect label="Joined" value={filters.joined} onChange={(v) => set("joined", v)} options={[{ value: "1", label: "Yes" }, { value: "0", label: "No" }]} />
                    <FilterSelect label="Contacted" value={filters.contacted} onChange={(v) => set("contacted", v)} options={[{ value: "1", label: "Yes" }, { value: "0", label: "No" }]} />
                  </div>
                </div>
                <div className="mt-8 flex gap-3">
                  <button
                    onClick={applyFilters}
                    className="flex-1 rounded-xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800"
                  >
                    <Search className="mr-2 inline h-4 w-4" />
                    Apply Filters
                  </button>
                  <button
                    onClick={clearFilters}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <X className="h-4 w-4" /> Clear
                  </button>
                </div>
              </SheetContent>
            </Sheet>

            <button
              onClick={() => void load()}
              disabled={refreshing}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              <RefreshCcw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {errorMsg}
          </div>
        )}

        {/* Refreshing overlay indicator on data area */}
        <div className="relative">
          {refreshing && (
            <div className="absolute inset-0 z-10 flex items-start justify-end rounded-2xl">
              <div className="m-2 rounded-xl bg-white/90 px-3 py-1.5 text-xs font-bold text-slate-600 shadow-sm ring-1 ring-slate-200">
                <RefreshCcw className="mr-1.5 inline h-3 w-3 animate-spin" />
                Refreshing…
              </div>
            </div>
          )}

          {/* Metric cards */}
          {data === null && !errorMsg ? (
            <EmptyState title="No data" description="Apply filters and hit Refresh to load dashboard data." />
          ) : (
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {cards.map(([title, value]) => (
                <StatCard
                  key={String(title)}
                  title={String(title)}
                  value={value as string | number}
                  tone="bg-slate-100 text-slate-900"
                  icon={<TrendingUp className="h-4 w-4" />}
                />
              ))}
            </section>
          )}
        </div>

        {/* Breakdown charts */}
        {data && (
          <div className="grid gap-6 xl:grid-cols-2">
            <BandList
              title="By Recruiter"
              rows={data.byRecruiter ?? []}
              expanded={!!expanded["recruiter"]}
              onToggle={() => toggleExpanded("recruiter")}
            />
            <BandList
              title="By Source"
              rows={data.bySource ?? []}
              expanded={!!expanded["source"]}
              onToggle={() => toggleExpanded("source")}
            />
            <BandList
              title="By Process"
              rows={data.byProcess ?? []}
              expanded={!!expanded["process"]}
              onToggle={() => toggleExpanded("process")}
            />
            <BandList
              title="By Branch"
              rows={data.byBranch ?? []}
              expanded={!!expanded["branch"]}
              onToggle={() => toggleExpanded("branch")}
            />
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
