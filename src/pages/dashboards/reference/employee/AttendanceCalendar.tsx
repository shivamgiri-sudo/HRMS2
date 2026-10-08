import { Link } from "react-router-dom";
import { Panel } from "../../kit";
import type { InsightSeries } from "../../kit";
import { cn } from "@/lib/utils";

const CELL = {
  present: { cls: "bg-emerald-100 text-emerald-800 ring-emerald-200", label: "Present" },
  half_day: { cls: "bg-amber-100 text-amber-800 ring-amber-200", label: "Half day" },
  absent: { cls: "bg-rose-100 text-rose-800 ring-rose-200", label: "Absent" },
  missing: { cls: "bg-orange-100 text-orange-800 ring-orange-200", label: "Missing punch" },
  unreconciled: { cls: "bg-orange-50 text-orange-700 ring-orange-200", label: "Unreconciled" },
  leave: { cls: "bg-violet-100 text-violet-800 ring-violet-200", label: "Approved leave" },
  holiday: { cls: "bg-sky-100 text-sky-800 ring-sky-200", label: "Holiday" },
  week_off: { cls: "bg-slate-100 text-slate-500 ring-slate-200", label: "Week off" },
  today: { cls: "bg-white text-blue-700 ring-2 ring-blue-500", label: "Today" },
  future: { cls: "bg-white text-slate-300 ring-slate-100", label: "Upcoming" },
  norecord: { cls: "bg-slate-50 text-slate-400 ring-slate-200", label: "No record" },
} as const;
type CellKey = keyof typeof CELL;

const LEGEND: CellKey[] = ["present", "half_day", "absent", "missing", "leave", "holiday", "week_off"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface CalPoint { label: string; status?: string; late?: number; lateBy?: number; lwp?: number }

/** Month heat calendar: each day coloured by status, late days dotted, fixable days link to regularisation. */
export function AttendanceCalendar({ series, loading }: { series: InsightSeries | undefined; loading?: boolean }) {
  const points = (series?.points ?? []) as CalPoint[];
  const first = points[0] ? new Date(`${points[0].label}T00:00:00Z`).getUTCDay() : 0;
  const offset = (first + 6) % 7; // Monday-first
  const counts = LEGEND.map((k) => ({ k, n: points.filter((p) => p.status === k).length }));
  return (
    <Panel title={series?.title ?? "Attendance this month"} subtitle={series?.subtitle} href="/attendance" hrefLabel="Details">
      {loading && !series ? <div className="kit-shimmer h-60 rounded-xl" /> : !points.length ? (
        <p className="py-8 text-center text-[12px] text-slate-400">{series?.unavailable ?? "Attendance calendar is unavailable right now."}</p>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-slate-400" aria-hidden>
            {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
          </div>
          <ol className="mt-1.5 grid grid-cols-7 gap-1.5" aria-label="Attendance by day">
            {Array.from({ length: offset }, (_, i) => <li key={`b${i}`} aria-hidden />)}
            {points.map((p) => {
              const key = (p.status && p.status in CELL ? p.status : "norecord") as CellKey;
              const c = CELL[key];
              const fixable = key === "missing" || key === "absent" || key === "unreconciled";
              const text = `${Number(p.label.slice(8))} ${c.label}${p.late ? `, late by ${p.lateBy ?? 0} min` : ""}${p.lwp ? `, ${p.lwp} LOP` : ""}`;
              const inner = (
                <>
                  <span className="kit-num text-[13px] font-bold">{Number(p.label.slice(8))}</span>
                  {p.late ? <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500" /> : null}
                </>
              );
              const cls = cn("relative flex aspect-square min-h-[34px] items-center justify-center rounded-lg ring-1 ring-inset", c.cls);
              return (
                <li key={p.label}>
                  {fixable
                    ? <Link to="/attendance-regularization" aria-label={`${text}. Open regularisation`} title={`${text} — click to regularise`} className={cn(cls, "hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500")}>{inner}</Link>
                    : <div title={text} aria-label={text} className={cls}>{inner}</div>}
                </li>
              );
            })}
          </ol>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-slate-600">
            {counts.map(({ k, n }) => (
              <li key={k} className="flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-sm ring-1 ring-inset", CELL[k].cls)} />{CELL[k].label}<span className="kit-num font-bold text-slate-800">{n}</span></li>
            ))}
            <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" />Late mark</li>
          </ul>
        </>
      )}
    </Panel>
  );
}
