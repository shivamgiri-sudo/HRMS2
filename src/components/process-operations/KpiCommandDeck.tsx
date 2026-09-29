import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, BarChart3, Clock, LayoutGrid, List, Search, Target, X } from "lucide-react";
import {
  DELTA_BASIS, dailyHealth, deltaOf, formatValue, freshnessOf, gapText, matchesQuery, rankWorstFirst,
  statusOf, summarize, targetText,
  type DeckPeriod, type DeckReading, type DeckSection, type Status,
} from "./kpi-deck-model";
import { AttentionChart, Bullet, HealthRing, HealthTimeline, HeatStrip, Sparkline, STATUS_COLOR } from "./KpiDeckCharts";

type View = "rows" | "tiles" | "matrix";
type Filter = "all" | "fail" | "pass" | "none" | "stale";

const CARD = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
const VIEW_KEY = "po-kpi-deck-view";

function readView(): View {
  try { const v = localStorage.getItem(VIEW_KEY); if (v === "rows" || v === "tiles" || v === "matrix") return v; } catch { /* storage blocked */ }
  return "rows";
}

const CHIP: Record<Status, { text: string; cls: string }> = {
  pass: { text: "On target", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  fail: { text: "Below target", cls: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300" },
  none: { text: "No target", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  nodata: { text: "No data", cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
};

function StatusChip({ r, staleAfter }: { r: DeckReading; staleAfter: number }) {
  const s = statusOf(r);
  const stale = r.staleDays !== null && r.staleDays > staleAfter && r.value !== null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${CHIP[s].cls}`}>{CHIP[s].text}</span>
      {stale && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-300"><Clock className="h-3 w-3" aria-hidden />{r.staleDays}d old</span>}
      {r.source === "manual" && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300">manual</span>}
    </span>
  );
}

function Delta({ r, period }: { r: DeckReading; period: DeckPeriod }) {
  const d = deltaOf(r);
  if (!d) return <span className="text-xs text-slate-400">no baseline yet</span>;
  const color = d.good === null ? "text-slate-500" : d.good ? "text-emerald-600" : "text-rose-600";
  return <span className="text-xs"><b className={color}>{d.text}</b> <span className="text-slate-500">{DELTA_BASIS[period]}</span></span>;
}

function Row({ r, period, staleAfter, onOpen }: { r: DeckReading; period: DeckPeriod; staleAfter: number; onOpen: (k: string) => void }) {
  const s = statusOf(r);
  const tt = targetText(r);
  const gap = gapText(r);
  return (
    <li>
      <button type="button" onClick={() => onOpen(r.metricKey)} aria-label={`${r.label}, ${formatValue(r.value, r.unit)}. Open drill-down`}
        className="group grid w-full grid-cols-2 items-center gap-x-4 gap-y-2 border-t border-slate-100 px-3 py-3 text-left transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-slate-800 dark:hover:bg-slate-800/60 md:grid-cols-[minmax(150px,1.5fr)_88px_minmax(150px,1fr)_minmax(130px,.9fr)_minmax(170px,1.1fr)]">
        <span className="col-span-2 flex items-center gap-2 md:col-span-1">
          <span className="h-8 w-1 rounded-full" style={{ background: STATUS_COLOR[s] }} aria-hidden />
          <span>
            <span className="block text-[13px] font-semibold text-slate-900 dark:text-slate-100">{r.label}</span>
            <span className="block text-[11px] text-slate-500">{r.latestDate ?? "never reported"}{r.provisional ? " · today, still filling" : ""}</span>
          </span>
        </span>
        <span className="text-xl font-extrabold tabular-nums" style={{ color: s === "fail" ? STATUS_COLOR.fail : s === "pass" ? STATUS_COLOR.pass : undefined }}>
          {formatValue(r.value, r.unit)}
        </span>
        <span className="flex flex-col gap-1">
          <Bullet r={r} />
          <span className="text-[11px] text-slate-500">{tt ? <>target {tt}{gap ? <> · <b className={s === "fail" ? "text-rose-600" : "text-emerald-600"}>{gap}</b></> : null}</> : "no target set"}</span>
        </span>
        <span className="hidden md:block"><Sparkline r={r} /></span>
        <span className="col-span-2 flex flex-wrap items-center justify-between gap-2 md:col-span-1">
          <span className="flex flex-col gap-1"><Delta r={r} period={period} /><StatusChip r={r} staleAfter={staleAfter} /></span>
          <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" aria-hidden />
        </span>
      </button>
    </li>
  );
}

function Tile({ r, period, staleAfter, onOpen }: { r: DeckReading; period: DeckPeriod; staleAfter: number; onOpen: (k: string) => void }) {
  const s = statusOf(r);
  const gap = gapText(r);
  const tt = targetText(r);
  return (
    <button type="button" onClick={() => onOpen(r.metricKey)} aria-label={`${r.label}, ${formatValue(r.value, r.unit)}. Open drill-down`}
      className={`${CARD} flex flex-col gap-2 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500`}
      style={{ borderTop: `4px solid ${STATUS_COLOR[s]}` }}>
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{r.label}</span>
      <span className="text-3xl font-black tabular-nums" style={{ color: s === "fail" ? STATUS_COLOR.fail : s === "pass" ? STATUS_COLOR.pass : undefined }}>{formatValue(r.value, r.unit)}</span>
      <span className="text-xs text-slate-500">{tt ? <>target {tt}{gap ? <> · <b className={s === "fail" ? "text-rose-600" : "text-emerald-600"}>{gap}</b></> : null}</> : "no target set"}</span>
      <Bullet r={r} width={200} />
      <Sparkline r={r} width={200} height={40} />
      <Delta r={r} period={period} />
      <StatusChip r={r} staleAfter={staleAfter} />
    </button>
  );
}

export interface KpiCommandDeckProps {
  sections: DeckSection[];
  ungrouped: DeckReading[];
  staleAfterDays: number;
  period: DeckPeriod;
  periodLabel: string | null;
  processName: string;
  onDrill: (metricKey: string) => void;
}

export function KpiCommandDeck({ sections, ungrouped, staleAfterDays, period, periodLabel, processName, onDrill }: KpiCommandDeckProps) {
  const [view, setViewState] = useState<View>(readView);
  const [filter, setFilter] = useState<Filter>("all");
  const [sectionKey, setSectionKey] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage blocked */ } };

  const groups = useMemo<DeckSection[]>(
    () => [...sections, ...(ungrouped.length ? [{ key: "other", title: "Other metrics", blurb: null, metrics: ungrouped }] : [])].filter((g) => g.metrics.length > 0),
    [sections, ungrouped],
  );
  const all = useMemo(() => groups.flatMap((g) => g.metrics), [groups]);
  const health = useMemo(() => summarize(all), [all]);
  const fresh = useMemo(() => freshnessOf(all, staleAfterDays), [all, staleAfterDays]);
  const timeline = useMemo(() => dailyHealth(all, 14), [all]);
  const worst = useMemo(() => rankWorstFirst(all).filter((m) => statusOf(m) === "fail").slice(0, 3), [all]);
  const dates = useMemo(() => {
    const s = new Set<string>();
    all.forEach((m) => m.trend.forEach((t) => { if (t.value !== null) s.add(t.date); }));
    return [...s].sort().slice(-14);
  }, [all]);

  const isStale = (m: DeckReading) => m.value !== null && m.staleDays !== null && m.staleDays > staleAfterDays;
  const passesFilter = (m: DeckReading) => {
    const s = statusOf(m);
    return filter === "all" ? true : filter === "stale" ? isStale(m) : filter === "none" ? (s === "none" || s === "nodata") : s === filter;
  };
  const visible = (g: DeckSection) => rankWorstFirst(g.metrics.filter((m) => passesFilter(m) && matchesQuery(m, q)));
  const shownGroups = groups.filter((g) => !sectionKey || g.key === sectionKey).map((g) => ({ g, ms: visible(g) })).filter((x) => x.ms.length > 0);
  const staleCount = all.filter(isStale).length;

  const chips: Array<{ k: Filter; label: string; n: number; cls: string }> = [
    { k: "all", label: "All", n: all.length, cls: "" },
    { k: "fail", label: "Below target", n: health.fail, cls: "text-rose-700" },
    { k: "pass", label: "On target", n: health.pass, cls: "text-emerald-700" },
    { k: "none", label: "No target / data", n: health.none + health.nodata, cls: "text-slate-600" },
    { k: "stale", label: "Stale", n: staleCount, cls: "text-amber-700" },
  ];

  if (all.length === 0) {
    return <div className={`${CARD} p-8 text-center text-sm text-slate-500`}>No metrics are wired for {processName} yet.</div>;
  }

  return (
    <section aria-label={`KPI metrics for ${processName}`} className="space-y-4">
      {fresh.feedStopped && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span><b>The data feed has stopped.</b> The newest reading for this process is {fresh.newestDate} ({fresh.newestAgeDays} day{fresh.newestAgeDays === 1 ? "" : "s"} ago). Every figure below is from that day, not from today.</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className={`${CARD} flex items-center gap-5 p-5`}>
          <div className="text-slate-900 dark:text-slate-100"><HealthRing pct={health.score} label={health.score === null ? "No targets set" : `${health.score} percent of targeted metrics on target`} /></div>
          <div className="min-w-0 space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Process health · {processName}{periodLabel ? ` · ${periodLabel}` : ""}</p>
            <p className="text-sm text-slate-800 dark:text-slate-200">
              <b className="text-emerald-600">{health.pass} on target</b> · <b className="text-rose-600">{health.fail} below</b> · <b className="text-slate-500">{health.none + health.nodata} without a target or data</b>
            </p>
            <p className="text-xs leading-relaxed text-slate-500">Health is the share of metrics <i>that have a target</i> currently meeting it. {health.none > 0 && <>{health.none} metric{health.none === 1 ? " has" : "s have"} no target, so they cannot show pass or fail. <a className="font-semibold text-blue-600 underline" href="/kpi-studio">Set targets</a>.</>}</p>
          </div>
        </div>
        <div className={`${CARD} p-4`}>
          <p className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500"><BarChart3 className="h-3.5 w-3.5" aria-hidden />Share of targeted metrics on target, per day</p>
          <HealthTimeline data={timeline} />
        </div>
      </div>

      {worst.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-extrabold text-slate-800 dark:text-slate-100"><Target className="h-4 w-4 text-rose-600" aria-hidden />Needs attention first</h3>
          <div className="grid gap-3 md:grid-cols-3">
            {worst.map((m) => (
              <button key={m.metricKey} type="button" onClick={() => onDrill(m.metricKey)} aria-label={`${m.label}: ${formatValue(m.value, m.unit)}. Open drill-down`}
                className={`${CARD} p-4 text-left transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500`} style={{ borderLeft: `4px solid ${STATUS_COLOR.fail}` }}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{m.label}</span>
                  <span className="text-2xl font-black tabular-nums text-rose-600">{formatValue(m.value, m.unit)}</span>
                </div>
                <p className="text-xs text-slate-500">target {targetText(m)} · <b className="text-rose-600">{gapText(m)}</b></p>
                <AttentionChart r={m} />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`${CARD} p-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[200px] flex-1">
            <span className="sr-only">Search metrics</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search metrics…"
              className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-8 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900" />
            {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"><X className="h-4 w-4" /></button>}
          </label>
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="group" aria-label="View">
            {([["rows", List, "Rows"], ["tiles", LayoutGrid, "Tiles"], ["matrix", BarChart3, "Day matrix"]] as const).map(([k, Icon, label]) => (
              <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold ${view === k ? "bg-slate-900 text-amber-300" : "text-slate-600 dark:text-slate-300"}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden />{label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
          {chips.map((c) => (
            <button key={c.k} type="button" aria-pressed={filter === c.k} onClick={() => setFilter(c.k)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${filter === c.k ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900" : `border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 ${c.cls}`}`}>
              {c.label} <span className="opacity-70">{c.n}</span>
            </button>
          ))}
          <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" aria-hidden />
          {groups.map((g) => (
            <button key={g.key} type="button" aria-pressed={sectionKey === g.key} onClick={() => setSectionKey(sectionKey === g.key ? null : g.key)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${sectionKey === g.key ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>
              {g.title} <span className="opacity-70">{g.metrics.length}</span>
            </button>
          ))}
        </div>
      </div>

      {shownGroups.length === 0 && <div className={`${CARD} p-8 text-center text-sm text-slate-500`}>No metrics match this filter. <button type="button" className="font-semibold text-blue-600 underline" onClick={() => { setFilter("all"); setSectionKey(null); setQ(""); }}>Clear filters</button></div>}

      {shownGroups.map(({ g, ms }) => {
        const gh = summarize(g.metrics);
        return (
          <div key={g.key} className={`${CARD} overflow-hidden`}>
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">{g.title}</h3>
              <span className="text-xs text-slate-500">{gh.pass} on target · {gh.fail} below · {gh.none + gh.nodata} without target or data</span>
              <div className="ml-auto flex h-1.5 w-32 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="img" aria-label={`${gh.pass} on target, ${gh.fail} below`}>
                <div style={{ width: `${(gh.pass / Math.max(1, g.metrics.length)) * 100}%`, background: STATUS_COLOR.pass }} />
                <div style={{ width: `${(gh.fail / Math.max(1, g.metrics.length)) * 100}%`, background: STATUS_COLOR.fail }} />
              </div>
            </div>
            {g.blurb && <p className="px-4 pb-2 text-xs text-slate-500">{g.blurb}</p>}
            {view === "rows" && <ul>{ms.map((m) => <Row key={m.metricKey} r={m} period={period} staleAfter={staleAfterDays} onOpen={onDrill} />)}</ul>}
            {view === "tiles" && <div className="grid gap-3 p-4 pt-1 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">{ms.map((m) => <Tile key={m.metricKey} r={m} period={period} staleAfter={staleAfterDays} onOpen={onDrill} />)}</div>}
            {view === "matrix" && (
              <div className="overflow-x-auto px-4 pb-4">
                <div className="min-w-[640px] space-y-1.5">
                  <div className="grid grid-cols-[minmax(150px,1.2fr)_76px_minmax(300px,3fr)] items-end gap-3 text-[10px] font-bold text-slate-400">
                    <span /><span />
                    <span className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(10px, 1fr))` }}>{dates.map((d) => <span key={d} className="text-center">{d.slice(8)}</span>)}</span>
                  </div>
                  {ms.map((m) => (
                    <button key={m.metricKey} type="button" onClick={() => onDrill(m.metricKey)} aria-label={`${m.label}. Open drill-down`}
                      className="grid w-full grid-cols-[minmax(150px,1.2fr)_76px_minmax(300px,3fr)] items-center gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:hover:bg-slate-800/60">
                      <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{m.label}</span>
                      <span className="text-sm font-extrabold tabular-nums" style={{ color: STATUS_COLOR[statusOf(m)] }}>{formatValue(m.value, m.unit)}</span>
                      <HeatStrip r={m} dates={dates} />
                    </button>
                  ))}
                  <div className="flex flex-wrap gap-4 pt-2 text-[11px] text-slate-500">
                    {([["pass", "on target"], ["fail", "below target"], ["none", "no target"]] as const).map(([s, l]) => (
                      <span key={s} className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_COLOR[s] }} />{l}</span>
                    ))}
                    <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-slate-400" />no reading that day</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
