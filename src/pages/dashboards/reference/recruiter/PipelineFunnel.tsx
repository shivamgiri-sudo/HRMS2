import { Link } from "react-router-dom";
import type { InsightSeries } from "../../kit";
import { ChartEmpty, Panel } from "../../kit";

const COLORS = ["#4f46e5", "#6366f1", "#7c3aed", "#8b5cf6", "#a855f7", "#c026d3", "#db2777", "#e11d48", "#059669"];

/**
 * Funnel-first hero panel: every step is a bar sized by candidates who reached it, with step conversion,
 * the share of the top, and the change against the previous 30 days. Cumulative by construction, so it
 * only ever narrows (unlike a per-stage snapshot).
 */
export function PipelineFunnel({ series, loading }: { series?: InsightSeries; loading?: boolean }) {
  const pts = (series?.points ?? []) as Array<{ label: string; value: number; fromPrevPct: number | null; fromTopPct: number | null; prevFromTopPct: number | null }>;
  const top = Math.max(1, ...pts.map((p) => Number(p.value) || 0));
  return (
    <Panel title="Hiring funnel" subtitle={series?.subtitle ?? "last 30 days, cumulative"} href={series?.href} hrefLabel="Open candidates">
      {loading && !pts.length ? <div className="kit-shimmer h-72 rounded-xl" /> : !pts.length ? <ChartEmpty text={series?.unavailable ?? "Funnel unavailable"} /> : (
        <ol className="space-y-2" aria-label="Hiring funnel">
          {pts.map((p, i) => {
            const delta = p.fromTopPct !== null && p.prevFromTopPct !== null ? Math.round((p.fromTopPct - p.prevFromTopPct) * 10) / 10 : null;
            const leak = i > 0 && p.fromPrevPct !== null && p.fromPrevPct < 60;
            return (
              <li key={p.label} className="grid grid-cols-[88px_1fr_auto] items-center gap-2 sm:grid-cols-[140px_1fr_150px] sm:gap-3">
                <span className="truncate text-[12px] font-semibold text-slate-600">{p.label}</span>
                <div className="relative h-8 overflow-hidden rounded-lg bg-slate-100">
                  <div className="h-full rounded-lg transition-[width] duration-700" style={{ width: `${Math.max(3, (Number(p.value) / top) * 100)}%`, background: COLORS[i % COLORS.length] }} />
                  <span className="kit-num absolute inset-y-0 left-2 flex items-center text-[13px] font-extrabold text-white drop-shadow">{Number(p.value).toLocaleString("en-IN")}</span>
                </div>
                <span className="flex items-center justify-end gap-1.5 text-[11px]">
                  {i > 0 && p.fromPrevPct !== null ? <span className={leak ? "rounded bg-rose-50 px-1.5 py-0.5 font-bold text-rose-700" : "font-semibold text-slate-500"}>{p.fromPrevPct}% step</span> : null}
                  {delta !== null && delta !== 0 ? <span className={delta > 0 ? "font-semibold text-emerald-600" : "font-semibold text-rose-600"}>{delta > 0 ? "+" : ""}{delta}pp</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-3 text-[11px] text-slate-400">Step % = reached this step / reached the previous one. pp = change in share of registrations vs the previous 30 days. <Link to="/ats/candidate-master" className="text-blue-600 hover:underline">Candidate master</Link></p>
    </Panel>
  );
}
