import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * KPI Live Performance: real KPI values for a process, scoped by the API to the caller (self / team / branch / process /
 * org). Every KPI comes from the KPI Catalogue; a KPI with no data feed says so and shows its source and freshness
 * instead of a zero. Auto-refreshes every 60 seconds.
 */

type Period = "today" | "yesterday" | "wtd" | "mtd" | "last30";
type GroupBy = "employee" | "team" | "branch";
type ProcessSummary = { process_key: string; process_name: string; kpi_count: number };
type Breakdown = { key: string; label: string; value: number | null; target: number | null; attainmentPct: number | null; rating: string | null; samples: number };
type Kpi = {
  id: string; metric_key: string; name: string; theme: string; unit: string; direction: string; grain: string; freshness: string;
  source_kind: string; source_ref: string | null; formula: string | null; metric_code: string | null;
  availability: "ok" | "no_data" | "not_tracked"; value: number | null; target: number | null; attainment_pct: number | null;
  rating: string | null; last_data_date: string | null; staleness_days: number | null; samples: number;
  series: Array<{ date: string; value: number | null }>; breakdown: Breakdown[];
};
type Perf = {
  process: { key: string; name: string }; window: { from: string; to: string; days: number }; scope: { level: string }; headcount: number;
  summary: { kpis: number; ok: number; no_data: number; not_tracked: number; overall_attainment: number | null; overall_rating: string | null };
  kpis: Kpi[];
};

const PERIODS: Array<{ v: Period; label: string }> = [
  { v: "today", label: "Today" }, { v: "yesterday", label: "Yesterday" }, { v: "wtd", label: "Week to date" },
  { v: "mtd", label: "Month to date" }, { v: "last30", label: "Last 30 days" },
];
const GROUPS: Array<{ v: GroupBy; label: string }> = [{ v: "employee", label: "By employee" }, { v: "team", label: "By team" }, { v: "branch", label: "By branch" }];
const RATING_STYLE: Record<string, string> = {
  S: "bg-emerald-100 text-emerald-800 border-emerald-300", A: "bg-sky-100 text-sky-800 border-sky-300",
  B: "bg-amber-100 text-amber-800 border-amber-300", C: "bg-orange-100 text-orange-800 border-orange-300", D: "bg-red-100 text-red-800 border-red-300",
};
const FRESH_STYLE: Record<string, string> = {
  realtime: "bg-emerald-100 text-emerald-800 border-emerald-300", hourly: "bg-sky-100 text-sky-800 border-sky-300",
  daily: "bg-slate-100 text-slate-700 border-slate-300", upload: "bg-amber-100 text-amber-800 border-amber-300",
};
const ALL = "__all__";

/** Catalogue process key -> Process Performance V2 company key (only where V2 has dashboards for that process). */
export const PPV2_COMPANY: Record<string, string> = {
  bellavita: "bellavita", gnc: "gnc", neemans: "neemans", appreciate_health: "appreciate_health", housing_owner: "housing_owner",
  housing_premium: "housing_premium", clovia: "clovia", birlanu: "birlanu", satya_retail: "satya_retail", lp_feedback: "lp_feedback",
  lp_onboarding: "lp_onboarding", dalmia: "dalmia", du_bangladesh: "dubangladesh", viega: "viega", exicom: "exicom", sbi_card: "sbi_card",
};

export function formatValue(v: number | null, unit: string): string {
  if (v == null) return "—";
  switch (unit) {
    case "percent": return `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;
    case "seconds": return v >= 120 ? `${Math.floor(v / 60)}m ${Math.round(v % 60)}s` : `${Math.round(v)}s`;
    case "minutes": return `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })} min`;
    case "hours": return `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })} h`;
    case "currency": return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
    default: return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }
}

export default function KpiPerformancePage() {
  const [processKey, setProcessKey] = useState("");
  const [period, setPeriod] = useState<Period>("mtd");
  const [groupBy, setGroupBy] = useState<GroupBy>("employee");
  const [theme, setTheme] = useState(ALL);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const processes = useQuery<ProcessSummary[]>({
    queryKey: ["kpi-catalogue", "processes"],
    queryFn: () => hrmsApi.get<any>("/api/kpi-catalogue/processes").then((d: any) => d.data ?? []),
  });
  const activeKey = processKey || processes.data?.find((p) => p.process_key !== "_global")?.process_key || processes.data?.[0]?.process_key || "";

  const perf = useQuery<Perf>({
    queryKey: ["kpi-performance", activeKey, period, groupBy],
    enabled: Boolean(activeKey),
    refetchInterval: 60_000,
    queryFn: () => hrmsApi.get<any>(`/api/kpi-catalogue/performance/${activeKey}?period=${period}&groupBy=${groupBy}`).then((d: any) => d.data),
  });

  const themes = useMemo(() => Array.from(new Set((perf.data?.kpis ?? []).map((k) => k.theme))).sort(), [perf.data]);
  const shown = useMemo(
    () => (perf.data?.kpis ?? []).filter((k) => theme === ALL || k.theme === theme)
      // measured KPIs first, then those waiting for data, then untracked
      .sort((a, b) => ["ok", "no_data", "not_tracked"].indexOf(a.availability) - ["ok", "no_data", "not_tracked"].indexOf(b.availability)),
    [perf.data, theme],
  );
  const open = shown.find((k) => k.id === openKey) ?? null;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-[1400px] mx-auto space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">KPI Live Performance</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Real KPI values for your scope, with trends and breakdowns. Refreshes every minute.</p>
          </div>
          <div className="flex items-center gap-2">
            {PPV2_COMPANY[activeKey] && (
              <Button asChild variant="outline" className="min-h-[44px]">
                <Link to={`/performance/process-performance-v2?company=${PPV2_COMPANY[activeKey]}`}>
                  <ExternalLink className="h-4 w-4 mr-2" /> Full process dashboard
                </Link>
              </Button>
            )}
            <Button variant="outline" onClick={() => perf.refetch()} disabled={perf.isFetching} className="min-h-[44px]">
              {perf.isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />} Refresh
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Pick label="Process" value={activeKey} onChange={(v) => { setProcessKey(v); setOpenKey(null); }}
            options={(processes.data ?? []).map((p) => ({ value: p.process_key, label: p.process_name }))} />
          <Pick label="Period" value={period} onChange={(v) => setPeriod(v as Period)} options={PERIODS.map((p) => ({ value: p.v, label: p.label }))} />
          <Pick label="Breakdown" value={groupBy} onChange={(v) => setGroupBy(v as GroupBy)} options={GROUPS.map((g) => ({ value: g.v, label: g.label }))} />
          <Pick label="Theme" value={theme} onChange={setTheme} options={[{ value: ALL, label: "All themes" }, ...themes.map((t) => ({ value: t, label: t }))]} />
        </div>

        {perf.isLoading && <p className="text-sm flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading real data…</p>}
        {perf.isError && <p className="text-sm text-red-600">{(perf.error as Error)?.message ?? "Could not load performance"}</p>}

        {perf.data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Stat label="Overall attainment" value={perf.data.summary.overall_attainment == null ? "—" : `${perf.data.summary.overall_attainment}%`}
                badge={perf.data.summary.overall_rating} />
              <Stat label="KPIs with data" value={`${perf.data.summary.ok} / ${perf.data.summary.kpis}`} />
              <Stat label="Waiting for data" value={String(perf.data.summary.no_data)} />
              <Stat label="Not tracked yet" value={String(perf.data.summary.not_tracked)} />
              <Stat label="Employees in view" value={String(perf.data.headcount)} sub={`${perf.data.window.from} → ${perf.data.window.to} · ${perf.data.scope.level.replace("_", " ").toLowerCase()}`} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((k) => <KpiCard key={k.id} kpi={k} active={k.id === openKey} onClick={() => setOpenKey(k.id === openKey ? null : k.id)} />)}
            </div>
            {shown.length === 0 && <p className="text-sm text-muted-foreground">No KPIs for this process and theme.</p>}

            {open && <Detail kpi={open} groupBy={groupBy} />}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function KpiCard({ kpi: k, active, onClick }: { kpi: Kpi; active: boolean; onClick: () => void }) {
  const muted = k.availability !== "ok";
  const better = k.direction === "lower_is_better" ? <ArrowDown className="h-3 w-3" aria-label="lower is better" /> : <ArrowUp className="h-3 w-3" aria-label="higher is better" />;
  return (
    <button onClick={onClick} className={`text-left border rounded-lg p-3 space-y-2 transition ${active ? "ring-2 ring-primary" : "hover:bg-muted/40"} ${muted ? "opacity-80" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate flex items-center gap-1">{k.name} {better}</div>
          <div className="text-xs text-muted-foreground">{k.theme}{k.grain === "process" ? " · process level" : ""}</div>
        </div>
        {k.rating && <span className={`text-xs px-2 py-0.5 rounded border font-semibold ${RATING_STYLE[k.rating] ?? ""}`}>{k.rating}</span>}
      </div>
      {k.availability === "ok" ? (
        <>
          <div className="flex items-end justify-between gap-2">
            <div className="text-2xl font-semibold tabular-nums">{formatValue(k.value, k.unit)}</div>
            <div className="text-xs text-muted-foreground text-right">
              {k.target != null ? <>target {formatValue(k.target, k.unit)}</> : "no target"}
              {k.attainment_pct != null && <div className="font-medium text-foreground">{k.attainment_pct}% attained</div>}
            </div>
          </div>
          <Spark series={k.series} />
        </>
      ) : (
        <div className="text-xs text-muted-foreground">
          {k.availability === "no_data"
            ? <>No data in this period{k.last_data_date ? ` — last data ${k.last_data_date} (${k.staleness_days}d ago)` : ""}.</>
            : <>Not tracked yet — no data feed. Source: {k.source_ref ?? k.source_kind}.</>}
        </div>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${FRESH_STYLE[k.freshness] ?? ""}`}>{k.freshness}</span>
        {k.availability === "ok" && k.last_data_date && <span className="text-[10px] text-muted-foreground">latest {k.last_data_date}</span>}
        {k.availability === "no_data" && <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">no data</Badge>}
        {k.availability === "not_tracked" && <Badge variant="outline" className="text-[10px]">not tracked</Badge>}
      </div>
    </button>
  );
}

function Spark({ series }: { series: Kpi["series"] }) {
  if (series.filter((s) => s.value != null).length < 2) return <div className="h-10" />;
  return (
    <div className="h-10">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Area type="monotone" dataKey="value" stroke="currentColor" fill="currentColor" fillOpacity={0.12} strokeWidth={1.5} connectNulls isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function Detail({ kpi: k, groupBy }: { kpi: Kpi; groupBy: GroupBy }) {
  return (
    <div className="border rounded-lg p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{k.name}</h2>
          <p className="text-xs text-muted-foreground">{k.formula}</p>
          <p className="text-xs text-muted-foreground">Source: {k.source_ref ?? k.source_kind} · {k.freshness}{k.metric_code ? ` · ${k.metric_code}` : ""}</p>
        </div>
        <div className="text-right text-sm">
          <div className="text-2xl font-semibold tabular-nums">{formatValue(k.value, k.unit)}</div>
          {k.target != null && <div className="text-xs text-muted-foreground">target {formatValue(k.target, k.unit)}</div>}
        </div>
      </div>
      {k.availability === "ok" ? (
        <>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={k.series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={48} />
                <Tooltip formatter={(v: number) => formatValue(v, k.unit)} />
                <Line type="monotone" dataKey="value" stroke="currentColor" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>{[groupBy === "employee" ? "Employee" : groupBy === "team" ? "Team (reporting manager)" : "Branch", "Value", "Target", "Attainment", "Rating", "Days"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {k.breakdown.map((b) => (
                  <tr key={b.key} className="border-t">
                    <td className="px-3 py-2">{b.label}</td>
                    <td className="px-3 py-2 tabular-nums">{formatValue(b.value, k.unit)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatValue(b.target, k.unit)}</td>
                    <td className="px-3 py-2 tabular-nums">{b.attainmentPct == null ? "—" : `${b.attainmentPct}%`}</td>
                    <td className="px-3 py-2">{b.rating ? <span className={`text-xs px-2 py-0.5 rounded border font-semibold ${RATING_STYLE[b.rating] ?? ""}`}>{b.rating}</span> : "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{b.samples}</td>
                  </tr>
                ))}
                {k.breakdown.length === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={6}>No breakdown: this KPI is reported at process level only.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {k.availability === "no_data" ? "This KPI has a data feed but no rows in the selected period." : "This KPI has no data feed yet, so there is nothing to show. It is listed so the gap is visible, not hidden."}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, sub, badge }: { label: string; value: string; sub?: string; badge?: string | null }) {
  return (
    <div className="border rounded-lg p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums flex items-center gap-2">{value}{badge && <span className={`text-xs px-2 py-0.5 rounded border ${RATING_STYLE[badge] ?? ""}`}>{badge}</span>}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Pick({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <div className="min-w-[170px]">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="min-h-[44px]"><SelectValue placeholder={label} /></SelectTrigger>
        <SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
