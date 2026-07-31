import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BadgeCheck,
  CheckCircle2,
  Filter,
  PhoneCall,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  Target,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  AXIS_TICK,
  ChartCard,
  ChartSkeleton,
  CoverageNote,
  EmptyState,
  FUNNEL_RAMP,
  GRID_PROPS,
  ProvenanceBar,
  SERIES,
  StatTile,
  TOOLTIP_STYLE,
  num,
  pct,
  ratio,
} from "@/components/analytics/analytics-kit";

type MetricData = Record<string, number>;
type GroupRow = {
  label: string;
  total: number;
  contacted: number;
  walkins: number;
  selected: number;
  joined: number;
};
type DashboardData = {
  metrics: MetricData;
  byRecruiter: GroupRow[];
  bySource: GroupRow[];
  byProcess: GroupRow[];
  byBranch: GroupRow[];
};

const initialFilters = {
  fromDate: "", toDate: "", month: "", recruiter: "", hiringSource: "", wpGroup: "",
  position: "", location: "", branch: "", process: "", gender: "", education: "",
  experienceLevel: "", recruiterRemarks: "", hrInterviewStatus: "", aiInterviewResult: "",
  opsInterviewStatus: "", offerLetterStatus: "", joiningStatus: "", batchNo: "",
  currentStatus: "", walkin: "", finalSelection: "", joined: "", contacted: "", search: "",
};

function countActiveFilters(f: typeof initialFilters) {
  return Object.values(f).filter(Boolean).length;
}

function FilterInput({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? label}
        className="h-9 w-full rounded-lg border border-slate-200 px-2.5 text-sm outline-none transition-colors duration-150 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full cursor-pointer rounded-lg border border-slate-200 px-2.5 text-sm outline-none transition-colors duration-150 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      >
        <option value="">All</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/**
 * Grouped breakdown chart. Shows the top N groups and reports what it left out,
 * rather than quietly cutting the tail.
 */
function BreakdownChart({ title, subtitle, rows, cap = 10 }: {
  title: string; subtitle: string; rows: GroupRow[]; cap?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, cap);
  const tail = rows.slice(cap);
  const totalAll = rows.reduce((sum, r) => sum + r.total, 0);
  const shownTotal = shown.reduce((sum, r) => sum + r.total, 0);

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      action={
        rows.length > cap && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="cursor-pointer rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 transition-colors duration-150 hover:bg-slate-50"
          >
            {expanded ? `Top ${cap}` : `All ${rows.length}`}
          </button>
        )
      }
      footer={
        <CoverageNote
          shownGroups={shown.length}
          distinctGroups={rows.length}
          shownRecords={shownTotal}
          otherGroups={tail.length}
          otherRecords={totalAll - shownTotal}
          unit="candidates"
        />
      }
    >
      {rows.length === 0 ? (
        <EmptyState label="No data for these filters" hint="Widen the filters and refresh." />
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(200, shown.length * 34)}>
          <BarChart data={shown} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 4 }}>
            <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
            <XAxis type="number" tick={AXIS_TICK} allowDecimals={false} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="label" width={140} tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: "#f1f5f9" }}
              contentStyle={TOOLTIP_STYLE}
              formatter={(value: number, name: string) => [num(value), name]}
              labelFormatter={(label, payload) => {
                const row: any = payload?.[0]?.payload;
                if (!row) return label;
                const sel = ratio(row.selected, row.walkins);
                return `${label} — ${num(row.total)} logged${sel !== null ? ` · ${pct(sel)} select rate from walk-ins` : ""}`;
              }}
            />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
            <Bar dataKey="total" name="Logged" fill={SERIES[0]} radius={[0, 3, 3, 0]} barSize={9} />
            <Bar dataKey="walkins" name="Walk-in" fill={SERIES[3]} radius={[0, 3, 3, 0]} barSize={9} />
            <Bar dataKey="selected" name="Selected" fill={SERIES[2]} radius={[0, 3, 3, 0]} barSize={9} />
            <Bar dataKey="joined" name="Joined" fill={SERIES[5]} radius={[0, 3, 3, 0]} barSize={9} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
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
  const [appliedFilters, setAppliedFilters] = useState({ ...initialFilters });
  const [sheetOpen, setSheetOpen] = useState(false);
  const didInitLoad = useRef(false);

  const set = (key: keyof typeof initialFilters, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

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
      setAppliedFilters({ ...activeFilters });
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
    void load({ ...filters });
  };

  const clearFilters = () => {
    const cleared = { ...initialFilters };
    setFilters(cleared);
    setSheetOpen(false);
    void load(cleared);
  };

  const activeFilterCount = countActiveFilters(appliedFilters);
  const m = data?.metrics ?? {};

  /**
   * The funnel. Server-side these stages are monotonic (each implies all earlier
   * ones), so the shape can never invert.
   */
  const funnel = useMemo(() => {
    const stages = callingView
      ? [
          { label: "Logged", value: Number(m.total_records ?? 0) },
          { label: "Contacted", value: Number(m.total_contacted ?? 0) },
          { label: "Shortlisted", value: Number(m.shortlisted ?? 0) },
          { label: "Walked In", value: Number(m.walkins ?? 0) },
        ]
      : [
          { label: "Logged", value: Number(m.total_records ?? 0) },
          { label: "Contacted", value: Number(m.total_contacted ?? 0) },
          { label: "Shortlisted", value: Number(m.shortlisted ?? 0) },
          { label: "Walked In", value: Number(m.walkins ?? 0) },
          { label: "Selected", value: Number(m.final_selected ?? 0) },
          { label: "Joined", value: Number(m.joined ?? 0) },
        ];
    const top = stages[0]?.value ?? 0;
    return stages.map((stage, i) => {
      const prev = i === 0 ? stage.value : stages[i - 1].value;
      return {
        ...stage,
        ofTop: ratio(stage.value, top),
        ofPrev: i === 0 ? null : ratio(stage.value, prev),
        dropped: i === 0 ? 0 : Math.max(0, prev - stage.value),
      };
    });
  }, [m, callingView]);

  const totalRecords = Number(m.total_records ?? 0);

  /** Interview outcomes, each with its own explicit denominator. */
  const interviewStages = useMemo(
    () => [
      { stage: "HR round", selected: Number(m.hr_selected ?? 0), rejected: Number(m.hr_rejected ?? 0) },
      { stage: "AI round", selected: Number(m.ai_selected ?? 0), rejected: Number(m.ai_rejected ?? 0) },
      { stage: "Ops round", selected: Number(m.ops_selected ?? 0), rejected: Number(m.ops_rejected ?? 0) },
    ],
    [m]
  );
  const anyInterviewData = interviewStages.some((s) => s.selected + s.rejected > 0);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="space-y-4">
          <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />)}
          </div>
          <ChartSkeleton height={280} />
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartSkeleton height={220} />
            <ChartSkeleton height={220} />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-slate-900">
              {callingView ? "Recruiter Calling Dashboard" : "Recruiter Hiring Dashboard"}
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Every stage below counts a candidate once, at the furthest point they reached.
              Later stages include all earlier ones.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={filters.search}
                onChange={(e) => set("search", e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
                placeholder="Quick search…"
                className="h-9 w-44 rounded-lg border border-slate-200 bg-white pl-8 pr-2.5 text-sm outline-none transition-colors duration-150 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 lg:w-56"
              />
            </div>

            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <button className="relative inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-50">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Filters
                  {activeFilterCount > 0 && (
                    <Badge className="ml-0.5 h-4 min-w-4 rounded-full bg-blue-700 px-1 text-[10px] text-white">
                      {activeFilterCount}
                    </Badge>
                  )}
                </button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2 text-base">
                    <Filter className="h-4 w-4" /> Filters
                  </SheetTitle>
                </SheetHeader>
                <div className="mt-5 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FilterInput label="From Date" type="date" value={filters.fromDate} onChange={(v) => set("fromDate", v)} />
                    <FilterInput label="To Date" type="date" value={filters.toDate} onChange={(v) => set("toDate", v)} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FilterInput label="Recruiter" value={filters.recruiter} onChange={(v) => set("recruiter", v)} />
                    <FilterInput label="Hiring Source" value={filters.hiringSource} onChange={(v) => set("hiringSource", v)} />
                    <FilterInput label="Branch" value={filters.branch} onChange={(v) => set("branch", v)} />
                    <FilterInput label="Process" value={filters.process} onChange={(v) => set("process", v)} />
                    <FilterInput label="WP Group" value={filters.wpGroup} onChange={(v) => set("wpGroup", v)} />
                    <FilterInput label="Position" value={filters.position} onChange={(v) => set("position", v)} />
                    <FilterInput label="Location" value={filters.location} onChange={(v) => set("location", v)} />
                    <FilterInput label="Gender" value={filters.gender} onChange={(v) => set("gender", v)} />
                    <FilterInput label="Education" value={filters.education} onChange={(v) => set("education", v)} />
                    <FilterInput label="Experience" value={filters.experienceLevel} onChange={(v) => set("experienceLevel", v)} />
                    <FilterInput label="Batch No." value={filters.batchNo} onChange={(v) => set("batchNo", v)} />
                    <FilterInput label="Current Status" value={filters.currentStatus} onChange={(v) => set("currentStatus", v)} />
                    <FilterInput label="Remarks" value={filters.recruiterRemarks} onChange={(v) => set("recruiterRemarks", v)} />
                    <FilterInput label="HR Status" value={filters.hrInterviewStatus} onChange={(v) => set("hrInterviewStatus", v)} />
                    <FilterInput label="AI Result" value={filters.aiInterviewResult} onChange={(v) => set("aiInterviewResult", v)} />
                    <FilterInput label="Ops Status" value={filters.opsInterviewStatus} onChange={(v) => set("opsInterviewStatus", v)} />
                    <FilterInput label="Offer Status" value={filters.offerLetterStatus} onChange={(v) => set("offerLetterStatus", v)} />
                    <FilterInput label="Joining Status" value={filters.joiningStatus} onChange={(v) => set("joiningStatus", v)} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FilterSelect label="Walk-in" value={filters.walkin} onChange={(v) => set("walkin", v)} options={[{ value: "1", label: "Yes" }, { value: "0", label: "No" }]} />
                    <FilterSelect label="Final Selection" value={filters.finalSelection} onChange={(v) => set("finalSelection", v)} options={[{ value: "1", label: "Yes" }, { value: "0", label: "No" }]} />
                    <FilterSelect label="Joined" value={filters.joined} onChange={(v) => set("joined", v)} options={[{ value: "1", label: "Yes" }, { value: "0", label: "No" }]} />
                    <FilterSelect label="Contacted" value={filters.contacted} onChange={(v) => set("contacted", v)} options={[{ value: "1", label: "Yes" }, { value: "0", label: "No" }]} />
                  </div>
                </div>
                <div className="mt-6 flex gap-2">
                  <button
                    onClick={applyFilters}
                    className="flex-1 cursor-pointer rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white transition-colors duration-150 hover:bg-blue-800"
                  >
                    Apply Filters
                  </button>
                  <button
                    onClick={clearFilters}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-50"
                  >
                    <X className="h-3.5 w-3.5" /> Clear
                  </button>
                </div>
              </SheetContent>
            </Sheet>

            <button
              onClick={() => void load()}
              disabled={refreshing}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-slate-700 disabled:opacity-60"
            >
              <RefreshCcw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Loading…" : "Refresh"}
            </button>
          </div>
        </header>

        {errorMsg && (
          <div role="alert" className="rounded-xl border-2 border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
            {errorMsg}
          </div>
        )}

        <ProvenanceBar
          items={[
            {
              label: "Date range",
              value: appliedFilters.fromDate || appliedFilters.toDate
                ? `${appliedFilters.fromDate || "start"} → ${appliedFilters.toDate || "today"}`
                : "All dates",
            },
            { label: "Branch", value: appliedFilters.branch || "All branches" },
            { label: "Process", value: appliedFilters.process || "All processes" },
            { label: "Filters", value: activeFilterCount > 0 ? `${activeFilterCount} active` : "None", warn: activeFilterCount > 0 },
            { label: "Records", value: num(totalRecords) },
            { label: "Excludes", value: "follow-up attempts" },
          ]}
        />

        {/* ── Headline stats ─────────────────────────────────────────────── */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <StatTile
            label="Candidate Records"
            value={num(totalRecords)}
            denominator="Base for every share below"
            icon={<Users className="h-4 w-4" />}
          />
          <StatTile
            label="Contacted"
            value={num(Number(m.total_contacted ?? 0))}
            denominator={`${pct(Number(m.contacted_pct ?? 0))} of records · ${num(Number(m.not_contacted ?? 0))} not contacted`}
            icon={<PhoneCall className="h-4 w-4" />}
          />
          <StatTile
            label="Shortlisted"
            value={num(Number(m.shortlisted ?? 0))}
            denominator={`${pct(ratio(Number(m.shortlisted ?? 0), Number(m.total_contacted ?? 0)) ?? 0)} of contacted`}
            icon={<Target className="h-4 w-4" />}
          />
          <StatTile
            label="Walk-ins"
            value={num(Number(m.walkins ?? 0))}
            denominator={`${pct(ratio(Number(m.walkins ?? 0), Number(m.shortlisted ?? 0)) ?? 0)} of shortlisted`}
            intent="warning"
            icon={<UserRound className="h-4 w-4" />}
          />
          {!callingView && (
            <StatTile
              label="Selected"
              value={num(Number(m.final_selected ?? 0))}
              denominator={`${pct(ratio(Number(m.final_selected ?? 0), Number(m.walkins ?? 0)) ?? 0)} of walk-ins`}
              intent="good"
              icon={<CheckCircle2 className="h-4 w-4" />}
            />
          )}
          {!callingView && (
            <StatTile
              label="Joined"
              value={num(Number(m.joined ?? 0))}
              denominator={`${pct(ratio(Number(m.joined ?? 0), Number(m.final_selected ?? 0)) ?? 0)} of selected · ${pct(ratio(Number(m.joined ?? 0), totalRecords) ?? 0)} end-to-end`}
              intent="good"
              icon={<BadgeCheck className="h-4 w-4" />}
            />
          )}
          {callingView && (
            <StatTile
              label="Rejected by Recruiter"
              value={num(Number(m.recruiter_rejected ?? 0))}
              denominator={`${pct(ratio(Number(m.recruiter_rejected ?? 0), totalRecords) ?? 0)} of records`}
              intent="critical"
              icon={<X className="h-4 w-4" />}
            />
          )}
        </div>

        {/* ── Funnel ─────────────────────────────────────────────────────── */}
        <ChartCard
          title="Hiring Funnel"
          subtitle="Each bar's width is its share of all logged records. Both denominators are labelled, so no percentage is ambiguous."
          action={
            <span className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
              {pct(ratio(funnel[funnel.length - 1]?.value ?? 0, totalRecords) ?? 0)} end-to-end
            </span>
          }
        >
          {totalRecords === 0 ? (
            <EmptyState label="No candidate records for these filters" hint="Clear the filters and refresh." />
          ) : (
            <div className="space-y-1">
              {funnel.map((stage, i) => (
                <div key={stage.label}>
                  {i > 0 && stage.dropped > 0 && (
                    <div className="flex items-center gap-2 py-1 pl-[132px]">
                      <span className="h-px w-6 bg-rose-200" />
                      <span className="text-[10px] font-semibold text-rose-600">
                        −{num(stage.dropped)} dropped
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <span className="w-[120px] shrink-0 text-right text-xs font-semibold text-slate-700">
                      {stage.label}
                    </span>
                    <div className="relative h-9 flex-1 overflow-hidden rounded-md bg-slate-50">
                      <div
                        className="flex h-full items-center justify-between rounded-md px-3 transition-[width] duration-500"
                        style={{
                          width: `${Math.max(stage.ofTop ?? 0, 6)}%`,
                          backgroundColor: FUNNEL_RAMP[i % FUNNEL_RAMP.length],
                        }}
                      >
                        <span className="text-xs font-bold tabular-nums text-white drop-shadow-sm">
                          {num(stage.value)}
                        </span>
                      </div>
                      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center gap-2">
                        <span className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600">
                          {pct(stage.ofTop ?? 0)} of logged
                        </span>
                        {stage.ofPrev !== null && (
                          <span className="rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-700">
                            {pct(stage.ofPrev)} of {funnel[i - 1].label.toLowerCase()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ChartCard>

        {/* ── Interview rounds + pipeline health ─────────────────────────── */}
        {!callingView && (
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard
              title="Interview Round Outcomes"
              subtitle="Recorded decisions per round. Candidates with no decision logged appear in neither bar."
            >
              {!anyInterviewData ? (
                <EmptyState label="No interview decisions recorded" hint="Rounds are logged as candidates progress." />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={interviewStages} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="stage" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                    <YAxis tick={AXIS_TICK} allowDecimals={false} axisLine={false} tickLine={false} width={40} />
                    <Tooltip
                      cursor={{ fill: "#f1f5f9" }}
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(value: number, name: string) => [num(value), name]}
                      labelFormatter={(label, payload) => {
                        const row: any = payload?.[0]?.payload;
                        const decided = (row?.selected ?? 0) + (row?.rejected ?? 0);
                        const rate = ratio(row?.selected ?? 0, decided);
                        return `${label} — ${num(decided)} decisions${rate !== null ? ` · ${pct(rate)} pass rate` : ""}`;
                      }}
                    />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                    <Bar dataKey="selected" name="Selected" fill={SERIES[5]} radius={[3, 3, 0, 0]} barSize={26} />
                    <Bar dataKey="rejected" name="Rejected" fill={SERIES[1]} radius={[3, 3, 0, 0]} barSize={26} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard
              title="Offer & Joining Pipeline"
              subtitle="What happens between selection and day one."
            >
              <div className="grid grid-cols-2 gap-3">
                <StatTile
                  label="Offers Issued"
                  value={num(Number(m.offer_letter_issued ?? 0))}
                  denominator={`${pct(ratio(Number(m.offer_letter_issued ?? 0), Number(m.final_selected ?? 0)) ?? 0)} of selected`}
                />
                <StatTile
                  label="Joining Pending"
                  value={num(Number(m.joining_pending ?? 0))}
                  denominator="Accepted, not yet joined"
                  intent="warning"
                />
                <StatTile
                  label="Employee Referrals"
                  value={num(Number(m.employee_referrals ?? 0))}
                  denominator={`${pct(ratio(Number(m.employee_referrals ?? 0), totalRecords) ?? 0)} of all records`}
                />
                <StatTile
                  label="Recruiters Active"
                  value={`${num(Number(m.active_recruiters ?? 0))} / ${num(Number(m.recruiters_in_scope ?? 0))}`}
                  denominator="Logged activity in last 2 days"
                  intent={
                    Number(m.recruiters_in_scope ?? 0) > 0 &&
                    Number(m.active_recruiters ?? 0) / Number(m.recruiters_in_scope ?? 1) < 0.5
                      ? "warning"
                      : "neutral"
                  }
                />
              </div>
            </ChartCard>
          </div>
        )}

        {/* ── Breakdowns ─────────────────────────────────────────────────── */}
        {data && (
          <div className="grid gap-4 xl:grid-cols-2">
            <BreakdownChart
              title="By Recruiter"
              subtitle="Volume and conversion per recruiter, highest volume first."
              rows={data.byRecruiter ?? []}
            />
            <BreakdownChart
              title="By Source"
              subtitle="Which channels produce candidates that actually join."
              rows={data.bySource ?? []}
            />
            <BreakdownChart
              title="By Process"
              subtitle="Demand and conversion per process."
              rows={data.byProcess ?? []}
            />
            <BreakdownChart
              title="By Branch"
              subtitle="Branch-level volume and conversion."
              rows={data.byBranch ?? []}
            />
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
