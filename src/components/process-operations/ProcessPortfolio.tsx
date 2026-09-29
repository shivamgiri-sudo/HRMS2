import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Clock, Loader2, Search, Users } from "lucide-react";
import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";
import { formatValue } from "./kpi-deck-model";
import { HealthRing, STATUS_COLOR } from "./KpiDeckCharts";

export interface PortfolioRow {
  processId: string; processName: string; processCode: string | null; branchName: string | null; headcount: number;
  metrics: number; pass: number; fail: number; none: number; score: number | null;
  newestDate: string | null; staleDays: number | null; feedStopped: boolean;
  worst: { metricKey: string; label: string; unit: string | null; value: number; target: number; direction: string; gapRatio: number } | null;
}

type SortKey = "health" | "stale" | "name" | "metrics";
type Show = "all" | "below" | "stopped" | "notargets";

const CARD = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";

/** Pure so it is testable: which rows to show, in which order. */
export function arrange(rows: PortfolioRow[], q: string, show: Show, sort: SortKey): PortfolioRow[] {
  const s = q.trim().toLowerCase();
  const kept = rows.filter((r) => r.metrics > 0)
    .filter((r) => !s || r.processName.toLowerCase().includes(s) || (r.processCode ?? "").toLowerCase().includes(s) || (r.branchName ?? "").toLowerCase().includes(s))
    .filter((r) => show === "all" ? true : show === "below" ? r.fail > 0 : show === "stopped" ? r.feedStopped : r.pass + r.fail === 0);
  const byName = (a: PortfolioRow, b: PortfolioRow) => a.processName.localeCompare(b.processName);
  return kept.sort((a, b) => {
    if (sort === "name") return byName(a, b);
    if (sort === "metrics") return b.metrics - a.metrics || byName(a, b);
    if (sort === "stale") return (b.staleDays ?? -1) - (a.staleDays ?? -1) || byName(a, b);
    // health: lowest score first; processes with no targets sink below those with a measurable score
    const sa = a.score ?? 1000, sb = b.score ?? 1000;
    return sa - sb || b.fail - a.fail || byName(a, b);
  });
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "bad" | "warn" | "ok" }) {
  const color = tone === "bad" ? "text-rose-600" : tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-emerald-600" : "text-slate-900 dark:text-slate-100";
  return (
    <div className={`${CARD} p-4`}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-3xl font-black tabular-nums ${color}`}>{value}</p>
      <p className="text-xs text-slate-500">{sub}</p>
    </div>
  );
}

export function ProcessPortfolio({ onSelect }: { onSelect: (processId: string) => void }) {
  const [q, setQ] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [sort, setSort] = useState<SortKey>("health");
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["process-operations", "portfolio"],
    queryFn: () => hrmsApi.get<HrmsEnvelope<PortfolioRow[]>>("/api/process-operations/portfolio"),
    staleTime: 60_000,
  });
  const all = useMemo(() => (data?.data ?? []).filter((r) => r.metrics > 0), [data]);
  const rows = useMemo(() => arrange(data?.data ?? [], q, show, sort), [data, q, show, sort]);

  if (isLoading) return <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Comparing every process…</div>;
  if (isError) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" aria-hidden />Could not load the process comparison.</span>
        <button type="button" onClick={() => refetch()} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white">Retry</button>
      </div>
    );
  }

  const stopped = all.filter((r) => r.feedStopped).length;
  const noTargets = all.filter((r) => r.pass + r.fail === 0).length;
  const scored = all.filter((r) => r.score !== null);
  const avg = scored.length ? Math.round(scored.reduce((s, r) => s + (r.score as number), 0) / scored.length) : null;
  const totalMetrics = all.reduce((s, r) => s + r.metrics, 0);
  const totalNone = all.reduce((s, r) => s + r.none, 0);

  const chips: Array<{ k: Show; label: string; n: number }> = [
    { k: "all", label: "All", n: all.length },
    { k: "below", label: "Has a metric below target", n: all.filter((r) => r.fail > 0).length },
    { k: "stopped", label: "Feed stopped", n: stopped },
    { k: "notargets", label: "No targets set", n: noTargets },
  ];

  return (
    <section aria-label="All processes" className="space-y-4">
      {stopped > 0 && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span><b>{stopped} of {all.length} processes have a stopped data feed.</b> Their newest reading is more than 3 days old, so the health figures below describe the past, not today.</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Processes reporting" value={String(all.length)} sub={`${totalMetrics.toLocaleString("en-IN")} metrics in total`} />
        <Stat label="Average health" value={avg === null ? "—" : `${avg}%`} sub="of targeted metrics on target" tone={avg === null ? undefined : avg >= 80 ? "ok" : avg >= 50 ? "warn" : "bad"} />
        <Stat label="Feeds stopped" value={String(stopped)} sub="newest reading > 3 days old" tone={stopped > 0 ? "bad" : "ok"} />
        <Stat label="Metrics with no target" value={totalMetrics ? `${Math.round((100 * totalNone) / totalMetrics)}%` : "—"} sub={`${totalNone.toLocaleString("en-IN")} can't show pass or fail`} tone={totalNone / Math.max(1, totalMetrics) > 0.5 ? "warn" : undefined} />
      </div>

      <div className={`${CARD} p-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[200px] flex-1">
            <span className="sr-only">Search processes</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search process, code or branch…"
              className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900" />
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900">
              <option value="health">Lowest health first</option>
              <option value="stale">Stalest feed first</option>
              <option value="metrics">Most metrics</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Filter processes">
          {chips.map((c) => (
            <button key={c.k} type="button" aria-pressed={show === c.k} onClick={() => setShow(c.k)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${show === c.k ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900" : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>
              {c.label} <span className="opacity-70">{c.n}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={`${CARD} overflow-hidden`}>
        <div className="hidden grid-cols-[minmax(180px,1.4fr)_120px_minmax(150px,1fr)_130px_minmax(200px,1.4fr)_28px] gap-4 border-b border-slate-100 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:border-slate-800 md:grid">
          <span>Process</span><span>Health</span><span>On / below / no target</span><span>Feed</span><span>Biggest miss</span><span />
        </div>
        {rows.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No process matches this filter.</p>}
        <ul>
          {rows.map((r) => {
            const total = Math.max(1, r.metrics);
            return (
              <li key={r.processId}>
                <button type="button" onClick={() => onSelect(r.processId)} aria-label={`${r.processName}: ${r.score === null ? "no targets" : `${r.score} percent on target`}. Open KPI metrics`}
                  className="group grid w-full grid-cols-2 items-center gap-x-4 gap-y-2 border-t border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-slate-800 dark:hover:bg-slate-800/60 md:grid-cols-[minmax(180px,1.4fr)_120px_minmax(150px,1fr)_130px_minmax(200px,1.4fr)_28px]">
                  <span className="col-span-2 min-w-0 md:col-span-1">
                    <span className="block truncate text-sm font-bold text-slate-900 dark:text-slate-100">{r.processName}</span>
                    <span className="flex items-center gap-2 text-[11px] text-slate-500">{r.branchName ?? "no branch"}<span aria-hidden>·</span><Users className="h-3 w-3" aria-hidden />{r.headcount}<span aria-hidden>·</span>{r.metrics} metrics</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-slate-900 dark:text-slate-100"><HealthRing pct={r.score} size={46} label={r.score === null ? "No targets" : `${r.score} percent on target`} /></span>
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{r.score === null ? "no targets" : r.score >= 80 ? "healthy" : r.score >= 50 ? "watch" : "critical"}</span>
                  </span>
                  <span className="flex flex-col gap-1">
                    <span className="flex h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="img" aria-label={`${r.pass} on target, ${r.fail} below, ${r.none} without target`}>
                      <span style={{ width: `${(r.pass / total) * 100}%`, background: STATUS_COLOR.pass }} />
                      <span style={{ width: `${(r.fail / total) * 100}%`, background: STATUS_COLOR.fail }} />
                      <span style={{ width: `${(r.none / total) * 100}%`, background: STATUS_COLOR.none, opacity: 0.5 }} />
                    </span>
                    <span className="text-[11px] text-slate-500"><b className="text-emerald-600">{r.pass}</b> · <b className="text-rose-600">{r.fail}</b> · <b>{r.none}</b></span>
                  </span>
                  <span>
                    {r.feedStopped
                      ? <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-300"><Clock className="h-3 w-3" aria-hidden />stopped · {r.staleDays}d</span>
                      : <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{r.staleDays === 0 ? "live today" : r.staleDays === null ? "no data" : `${r.staleDays}d ago`}</span>}
                  </span>
                  <span className="col-span-2 min-w-0 text-xs md:col-span-1">
                    {r.worst
                      ? <><span className="block truncate font-semibold text-slate-800 dark:text-slate-200">{r.worst.label}</span>
                        <span className="text-slate-500"><b className="text-rose-600">{formatValue(r.worst.value, r.worst.unit)}</b> vs {r.worst.direction === "higher_is_better" ? "≥" : "≤"} {formatValue(r.worst.target, r.worst.unit)}</span></>
                      : <span className="text-slate-400">{r.fail === 0 && r.pass > 0 ? "nothing below target" : "no targets to compare"}</span>}
                  </span>
                  <ArrowRight className="hidden h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500 md:block" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
