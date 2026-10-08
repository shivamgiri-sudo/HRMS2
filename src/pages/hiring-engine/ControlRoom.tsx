/**
 * Control room strip on the Walk-in board: every drive from today to the next 7 days, how many shows are expected
 * (show-up model learned from past drives), the gap to target, and the one next action. Refreshes every 60 s.
 */
import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { num } from "@/components/analytics/analytics-kit";

interface Drive { driveId: string; driveDate: string; branch: string; role: string; requisitionCode: string; status: string; targetShows: number; suggested: number; invited: number; confirmed: number; arrived: number; noShows: number; expectedShows: number; gap: number; invitesNeeded: number; reachableSuggested: number; action: string }

const dayLabel = (d: string) => {
  const t = new Date(d + "T00:00:00"); const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((t.getTime() - today.getTime()) / 86_400_000);
  return diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : t.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
};

export default function ControlRoom() {
  const [rows, setRows] = useState<Drive[] | null>(null);
  const [learned, setLearned] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => hrmsApi.get<{ data: { drives: Drive[]; learnedParams: number } }>("/api/he/control-room")
      .then((r) => { if (alive) { setRows(r.data.drives ?? []); setLearned(r.data.learnedParams ?? 0); } }).catch(() => alive && setRows([]));
    void load(); const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (rows == null) return <div className="h-24 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" aria-hidden />;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Control room">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Gauge className="h-4 w-4 text-blue-600" aria-hidden /> Next 7 days: will each drive hit its target?</h2>
        <span className="text-xs text-slate-500">{learned ? "Show-up rates learned from your past drives" : "Default show-up rates until enough drives have finished"}</span>
      </div>
      {rows.length === 0 ? <p className="text-sm text-slate-500">No drives in the next 7 days. Create one in Drives.</p> : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((d) => {
            const pct = d.targetShows ? Math.min(100, Math.round((d.expectedShows / d.targetShows) * 100)) : 0;
            const tone = !d.targetShows ? "bg-slate-300" : pct >= 100 ? "bg-emerald-500" : pct >= 70 ? "bg-amber-400" : "bg-rose-500";
            return (
              <li key={d.driveId} className="rounded-lg border border-slate-200 p-3 transition-shadow duration-200 hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <div><div className="text-sm font-semibold text-slate-900">{d.branch}</div><div className="text-xs text-slate-500">{d.role} · {d.requisitionCode}</div></div>
                  <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{dayLabel(d.driveDate)}{d.status !== "active" ? ` · ${d.status}` : ""}</span>
                </div>
                <div className="mt-3 flex items-baseline gap-1"><span className="text-2xl font-bold tabular-nums text-slate-900">{d.expectedShows}</span><span className="text-sm text-slate-500">expected / {num(d.targetShows)} target</span></div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Expected shows against target"><div className={`h-full rounded-full transition-all duration-500 motion-reduce:transition-none ${tone}`} style={{ width: `${pct}%` }} /></div>
                <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-slate-600"><span>{d.confirmed} confirmed</span><span>{d.invited} invited</span><span>{d.arrived} arrived</span><span>{d.suggested} suggested</span></div>
                <p className={`mt-2 text-sm font-medium ${d.invitesNeeded ? "text-rose-700" : "text-emerald-700"}`}>{d.action}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
