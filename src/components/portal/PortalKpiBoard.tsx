import { useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, ChevronRight,
  Clock, HelpCircle, Info, Minus, ShieldAlert, Target, TrendingDown, TrendingUp, X,
} from "lucide-react";
import type { PortalKpiDetail, PortalKpiMetric, PortalRag } from "@/lib/portalApi";

/**
 * Client-facing performance board.
 *
 * Replaces a grid of bare numbers with something a client can act on, and it is built around one
 * principle: never present a number as more certain than it is.
 *
 * Three specific things it refuses to do, each of which the previous scorecard did:
 *
 *  1. Show a missing metric as red. `rag: "no_data"` renders slate with the engine's stated reason,
 *     so "we have no arrival-time feed for April" cannot be mistaken for "lateness was catastrophic
 *     in April".
 *  2. Show a percentage without its basis. Every card can be opened to see the numerator and
 *     denominator the engine used, because "attendance 68%" invites a different conversation from
 *     "3,616 of 5,318 confirmed working days".
 *  3. Hide the reconciliation backlog. Data completeness is a metric on the same board as attendance,
 *     because on real data 28.5% of one process's August days were unreconciled and an attendance
 *     figure that quietly excludes them is only honest if the exclusion is visible.
 */

const RAG_STYLE: Record<PortalRag, { border: string; chip: string; text: string; label: string }> = {
  green:   { border: "border-l-emerald-500 shadow-emerald-950/20", chip: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", text: "text-emerald-400", label: "On target" },
  amber:   { border: "border-l-amber-500 shadow-amber-950/20",     chip: "bg-amber-500/10 text-amber-400 border-amber-500/20",       text: "text-amber-400",   label: "Watch" },
  red:     { border: "border-l-rose-500 shadow-rose-950/20",       chip: "bg-rose-500/10 text-rose-400 border-rose-500/20",         text: "text-rose-400",    label: "Off target" },
  no_data: { border: "border-l-slate-600",                          chip: "bg-slate-700/40 text-slate-400 border-slate-600/40",      text: "text-slate-400",   label: "Not measured" },
};

/** Icon per metric, so a client can scan the board without reading every label. */
function MetricIcon({ code }: { code: string }) {
  const cls = "w-4 h-4";
  if (code === "ATT") return <CheckCircle2 className={cls} />;
  if (code === "ABN") return <AlertTriangle className={cls} />;
  if (code === "LAT") return <Clock className={cls} />;
  if (code === "LVE") return <Activity className={cls} />;
  if (code === "RET") return <TrendingUp className={cls} />;
  if (code === "HDY") return <Minus className={cls} />;
  if (code === "DQ") return <ShieldAlert className={cls} />;
  return <Target className={cls} />;
}

function formatValue(value: number | null, unit: string): string {
  if (value === null) return "—";
  if (unit === "percent") return `${Math.round(value * 10) / 10}%`;
  if (unit === "seconds") return `${Math.round(value)}s`;
  if (unit === "count") return String(Math.round(value));
  return String(Math.round(value * 10) / 10);
}

/** Sparkline over the metric's own range, with the target drawn in where it falls inside it. */
function Trend({ metric }: { metric: PortalKpiMetric }) {
  const points = metric.sparkline;
  if (points.length < 2) {
    return (
      <div className="h-10 w-28 flex items-center justify-end text-[10px] text-slate-600">
        {points.length === 1 ? "1 month only" : "No trend"}
      </div>
    );
  }

  const values = points.map((p) => p.value);
  // The target is included in the scale so the line's position relative to it is meaningful rather
  // than an artefact of auto-scaling to the data alone.
  const min = Math.min(...values, metric.target);
  const max = Math.max(...values, metric.target);
  const range = max - min || 1;

  const w = 112, h = 40, pad = 3;
  const px = (i: number) => pad + (i / (values.length - 1)) * (w - pad * 2);
  const py = (v: number) => pad + (h - pad * 2) - ((v - min) / range) * (h - pad * 2);

  const line = values.map((v, i) => `${px(i)},${py(v)}`).join(" ");
  const stroke = metric.rag === "green" ? "#10b981" : metric.rag === "amber" ? "#f59e0b" : metric.rag === "red" ? "#f43f5e" : "#64748b";
  const gradientId = `pk-grad-${metric.metric_code}`;

  return (
    <svg width={w} height={h} className="overflow-visible" role="img" aria-label={`${metric.metric_name} six month trend`}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`${pad},${h} ${line} ${w - pad},${h}`} fill={`url(#${gradientId})`} />
      <line x1={pad} y1={py(metric.target)} x2={w - pad} y2={py(metric.target)} stroke="#475569" strokeWidth="1" strokeDasharray="3 3" />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={px(values.length - 1)} cy={py(values[values.length - 1])} r="3" fill={stroke} />
    </svg>
  );
}

/** Month-on-month movement, worded so the direction is unambiguous. */
function Delta({ metric }: { metric: PortalKpiMetric }) {
  if (metric.delta_vs_previous === null || metric.improved === null) {
    return <span className="text-[10px] text-slate-600">No prior month to compare</span>;
  }
  const up = metric.delta_vs_previous > 0;
  const tone = metric.improved ? "text-emerald-400" : "text-rose-400";
  return (
    <span className={`flex items-center gap-0.5 text-[11px] font-bold ${tone}`}>
      {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {formatValue(Math.abs(metric.delta_vs_previous), metric.unit)}
      <span className="font-medium text-slate-500 ml-0.5">{metric.improved ? "better" : "worse"}</span>
    </span>
  );
}

export function PortalKpiBoard({ detail }: { detail: PortalKpiDetail }) {
  const [open, setOpen] = useState<PortalKpiMetric | null>(null);

  const { metrics, summary } = detail;

  /** Counts for the summary strip. no_data is counted separately, never folded into off-target. */
  const counts = useMemo(() => ({
    green: metrics.filter((m) => m.rag === "green").length,
    amber: metrics.filter((m) => m.rag === "amber").length,
    red: metrics.filter((m) => m.rag === "red").length,
    noData: metrics.filter((m) => m.rag === "no_data").length,
  }), [metrics]);

  const attention = useMemo(
    () => metrics.filter((m) => m.rag === "red" || m.rag === "amber")
      .sort((a, b) => (a.achievement_pct ?? 999) - (b.achievement_pct ?? 999)),
    [metrics],
  );

  return (
    <div className="space-y-6">
      {/* ── Summary strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Active headcount</p>
          <p className="text-2xl font-extrabold text-white mt-1">{summary.active_headcount.toLocaleString()}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {summary.employees_with_activity.toLocaleString()} with activity this month
          </p>
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">On target</p>
          <p className="text-2xl font-extrabold text-emerald-400 mt-1">{counts.green}<span className="text-slate-600 text-base font-bold">/{metrics.length}</span></p>
          <p className="text-[10px] text-slate-500 mt-0.5">{counts.amber} watch · {counts.red} off target</p>
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Days awaiting reconciliation</p>
          <p className={`text-2xl font-extrabold mt-1 ${summary.unconfirmed_days > 0 ? "text-amber-400" : "text-emerald-400"}`}>
            {summary.unconfirmed_days.toLocaleString()}
          </p>
          {/* Stated on the summary strip, not buried: these days are excluded from attendance, and a
              client who discovers that later has reason to distrust the whole page. */}
          <p className="text-[10px] text-slate-500 mt-0.5">
            of {summary.expected_days.toLocaleString()} expected — excluded from attendance
          </p>
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Data through</p>
          <p className="text-2xl font-extrabold text-white mt-1">{summary.data_through ?? "—"}</p>
          {summary.inferred_process_pct > 0 && (
            <p className="text-[10px] text-slate-500 mt-0.5">
              {summary.inferred_process_pct}% of days attributed by current posting
            </p>
          )}
        </div>
      </div>

      {/* ── Needs attention ──
          Above the grid on purpose. A client opening this tab wants to know what to raise, and
          finding that out from twelve cards is work the page should have already done. */}
      {attention.length > 0 && (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-5">
          <h3 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-400" /> What needs attention
          </h3>
          <div className="space-y-2">
            {attention.map((metric) => (
              <button
                key={metric.metric_code}
                onClick={() => setOpen(metric)}
                className="w-full flex items-center justify-between gap-3 bg-slate-950/40 hover:bg-slate-800/50 border border-slate-800/60 rounded-lg px-3 py-2.5 text-left transition-colors cursor-pointer group"
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold border ${RAG_STYLE[metric.rag].chip}`}>
                    {RAG_STYLE[metric.rag].label}
                  </span>
                  <span className="text-sm font-semibold text-slate-100 truncate">{metric.metric_name}</span>
                </span>
                <span className="flex items-center gap-3 shrink-0">
                  <span className="text-right">
                    <span className={`block text-sm font-extrabold ${RAG_STYLE[metric.rag].text}`}>
                      {formatValue(metric.actual, metric.unit)}
                    </span>
                    <span className="block text-[10px] text-slate-500">target {formatValue(metric.target, metric.unit)}</span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-300 transition-colors" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {counts.noData > 0 && (
        <div className="flex items-start gap-2 bg-slate-900/40 border border-slate-800/60 rounded-xl px-4 py-3">
          <Info className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
          <p className="text-xs text-slate-400">
            {counts.noData} of {metrics.length} measures could not be calculated for this month. They are shown
            as <span className="text-slate-300 font-semibold">Not measured</span> rather than zero — open a card to
            see why.
          </p>
        </div>
      )}

      {/* ── The board ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {metrics.map((metric) => {
          const style = RAG_STYLE[metric.rag];
          return (
            <button
              key={metric.metric_code}
              onClick={() => setOpen(metric)}
              aria-label={`${metric.metric_name} details`}
              className={`text-left bg-slate-900/60 backdrop-blur-md rounded-xl p-5 border-l-[6px] border border-slate-800/60 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:bg-slate-800/70 cursor-pointer ${style.border}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="flex items-center gap-2.5 min-w-0">
                  <span className={`p-2 rounded-lg ${style.chip} border`}>
                    <MetricIcon code={metric.metric_code} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">{metric.metric_code}</span>
                    <span className="block text-sm font-bold text-slate-100 truncate">{metric.metric_name}</span>
                  </span>
                </span>
                <span className={`shrink-0 text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${style.chip}`}>
                  {metric.achievement_pct === null ? "n/a" : `${Math.round(metric.achievement_pct)}%`}
                </span>
              </div>

              <div className="mt-5 flex items-end justify-between gap-3">
                <span>
                  <span className={`block text-3xl font-extrabold tracking-tight ${metric.actual === null ? "text-slate-600" : "text-white"}`}>
                    {formatValue(metric.actual, metric.unit)}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-slate-500 mt-1">
                    <Target className="w-3 h-3 text-slate-600" />
                    Target {formatValue(metric.target, metric.unit)}
                    {metric.direction === "lower_is_better" && <span className="text-slate-600">or less</span>}
                  </span>
                  <span className="block mt-1"><Delta metric={metric} /></span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span className="text-[9px] text-slate-600 font-bold uppercase tracking-wider">6M trend</span>
                  <Trend metric={metric} />
                </span>
              </div>

              {/* The reason a value is absent, on the card itself. Requiring a click to discover that a
                  blank is explained is how a blank gets read as a failure. */}
              {metric.no_data_reason && (
                <p className="mt-3 pt-3 border-t border-slate-800/60 text-[11px] text-slate-500 leading-snug">
                  {metric.no_data_reason}
                </p>
              )}
            </button>
          );
        })}
      </div>

      {open && <KpiDrilldown metric={open} period={detail.period} onClose={() => setOpen(null)} />}
    </div>
  );
}

/**
 * Drill-down for one metric.
 *
 * Shows the arithmetic, the target's provenance and the month-by-month history. The arithmetic matters
 * most: a client who can see "3,616 worked days of 5,318 confirmed" can challenge the denominator,
 * which is a far more productive conversation than disputing a percentage.
 */
function KpiDrilldown({ metric, period, onClose }: { metric: PortalKpiMetric; period: string; onClose: () => void }) {
  const style = RAG_STYLE[metric.rag];

  const TARGET_SOURCE_LABEL: Record<PortalKpiMetric["target_source"], string> = {
    process_specific: "Agreed for this process",
    portal_default: "Platform default",
    engine_fallback: "Platform default",
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${metric.metric_name} detail`}
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${style.chip}`}>{style.label}</span>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{metric.metric_code}</span>
            </div>
            <h3 className="text-lg font-extrabold text-white mt-1 truncate">{metric.metric_name}</h3>
            <p className="text-[11px] text-slate-500">{period}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors cursor-pointer shrink-0" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {metric.description && (
            <div className="flex items-start gap-2 bg-slate-950/40 border border-slate-800/60 rounded-lg p-3">
              <HelpCircle className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-300 leading-relaxed">{metric.description}</p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">This month</p>
              <p className={`text-2xl font-extrabold mt-1 ${metric.actual === null ? "text-slate-600" : "text-white"}`}>
                {formatValue(metric.actual, metric.unit)}
              </p>
            </div>
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Target</p>
              <p className="text-2xl font-extrabold text-slate-300 mt-1">{formatValue(metric.target, metric.unit)}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{TARGET_SOURCE_LABEL[metric.target_source]}</p>
            </div>
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Achievement</p>
              <p className={`text-2xl font-extrabold mt-1 ${style.text}`}>
                {metric.achievement_pct === null ? "—" : `${Math.round(metric.achievement_pct)}%`}
              </p>
            </div>
          </div>

          {/* The working. This is the panel that turns a disputed percentage into a shared fact. */}
          {metric.numerator !== null && metric.denominator !== null && (
            <div>
              <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 mb-2">How this was calculated</h4>
              <div className="bg-slate-950/60 border border-slate-800/60 rounded-lg p-4 font-mono text-sm">
                <div className="flex items-center justify-between text-slate-300">
                  <span>{metric.numerator.toLocaleString()}</span>
                  <span className="text-slate-600">÷</span>
                  <span>{metric.denominator.toLocaleString()}</span>
                  <span className="text-slate-600">=</span>
                  <span className={`font-bold ${style.text}`}>{formatValue(metric.actual, metric.unit)}</span>
                </div>
              </div>
            </div>
          )}

          {metric.no_data_reason && (
            <div className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-bold text-amber-300">Not measured this month</p>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{metric.no_data_reason}</p>
              </div>
            </div>
          )}

          {/* Month-by-month, newest first. Direction-aware arrows so a falling absenteeism figure is
              not shown as a decline. */}
          {metric.sparkline.length > 0 && (
            <div>
              <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 mb-2">Month by month</h4>
              <div className="border border-slate-800/60 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-950/60 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2 font-bold uppercase tracking-wider">Month</th>
                      <th className="text-right px-3 py-2 font-bold uppercase tracking-wider">Value</th>
                      <th className="text-right px-3 py-2 font-bold uppercase tracking-wider">vs target</th>
                      <th className="text-right px-3 py-2 font-bold uppercase tracking-wider">Change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {[...metric.sparkline].reverse().map((point, index, reversed) => {
                      const earlier = reversed[index + 1];
                      const change = earlier ? point.value - earlier.value : null;
                      const better = change === null || change === 0
                        ? null
                        : metric.direction === "lower_is_better" ? change < 0 : change > 0;
                      const met = metric.direction === "lower_is_better"
                        ? point.value <= metric.target
                        : point.value >= metric.target;
                      return (
                        <tr key={point.period}>
                          <td className="px-3 py-2 text-slate-300 font-medium">{point.period}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-100">{formatValue(point.value, metric.unit)}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={met ? "text-emerald-400" : "text-rose-400"}>{met ? "met" : "missed"}</span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {change === null ? (
                              <span className="text-slate-600">—</span>
                            ) : (
                              <span className={better === null ? "text-slate-500" : better ? "text-emerald-400" : "text-rose-400"}>
                                {change > 0 ? "+" : ""}{Math.round(change * 10) / 10}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
