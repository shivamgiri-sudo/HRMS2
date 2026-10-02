import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ChartEmpty, Panel, type InsightSeries, type InsightTable } from "../../kit";

/** Seven-day "who is out" calendar: one cell per day shaded by head-count, names listed underneath. */
export function WeekOutStrip({ series, list }: { series?: InsightSeries; list?: InsightTable }) {
  const pts = series?.points ?? [];
  const max = Math.max(1, ...pts.map((p) => Number(p.value) || 0));
  return (
    <Panel title="Who's out this week" subtitle="Approved leave, next 7 days" href="/leaves" hrefLabel="Leave calendar">
      {!pts.length ? <ChartEmpty text={series?.unavailable ?? "No leave data for this team"} /> : (
        <>
          <ol className="grid grid-cols-7 gap-1.5">
            {pts.map((p, i) => {
              const v = Number(p.value) || 0;
              const [wd, dd] = String(p.label).split(" ");
              return (
                <li key={i} className={cn("rounded-xl border px-1 py-2 text-center", v === 0 ? "border-slate-100 bg-slate-50" : "border-violet-200")} style={v ? { background: `rgba(124,58,237,${0.1 + (v / max) * 0.45})` } : undefined}>
                  <p className="text-[10px] font-bold uppercase text-slate-500">{wd}</p>
                  <p className="kit-num text-[18px] font-extrabold text-slate-900">{v}</p>
                  <p className="text-[10px] text-slate-400">{dd}</p>
                </li>
              );
            })}
          </ol>
          <ul className="mt-3 divide-y divide-slate-100">
            {(list?.rows ?? []).slice(0, 6).map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-1.5 text-[12px]">
                <Link to="/leaves" className="truncate font-medium text-slate-800 hover:text-blue-700">{String(r.name)}</Link>
                <span className="shrink-0 text-slate-500">{String(r.type)} · {String(r.from)}{r.from !== r.to ? ` - ${String(r.to)}` : ""}</span>
              </li>
            ))}
            {list && !list.rows.length ? <li className="py-2 text-[12px] text-slate-400">Nobody on approved leave this week.</li> : null}
          </ul>
        </>
      )}
    </Panel>
  );
}
