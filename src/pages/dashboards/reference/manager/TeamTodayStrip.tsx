import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Panel, TONE } from "../../kit";
import { teamSegments } from "./managerModel";

/** One stacked bar for "where is my team right now" - the manager's 9am glance. */
export function TeamTodayStrip({ team, loggedIn, onLeave, notPunched, loading }: {
  team: number | null; loggedIn: number | null; onLeave: number | null; notPunched: number | null; loading?: boolean;
}) {
  const segs = teamSegments(team, loggedIn, onLeave, notPunched);
  return (
    <Panel title="Team right now" subtitle="Live sessions today, not the processed day" href="/wfm/team-attendance" hrefLabel="Open live view">
      {loading && !segs ? <Skeleton className="h-16 w-full" /> : !segs ? (
        <p className="text-[12px] text-slate-400">Live attendance is not available for this team yet.</p>
      ) : (
        <div>
          <div className="flex h-5 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={segs.map((s) => `${s.label} ${s.value}`).join(", ")}>
            {segs.filter((s) => s.value > 0).map((s) => (
              <div key={s.key} className={cn("h-full transition-[width] duration-700", TONE[s.tone].solid)} style={{ width: `${(s.value / (team as number)) * 100}%` }} title={`${s.label}: ${s.value}`} />
            ))}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {segs.map((s) => (
              <li key={s.key}>
                <Link to="/wfm/team-attendance" className="block rounded-xl px-2 py-1.5 transition hover:bg-slate-50">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><i className={cn("h-2 w-2 rounded-full", TONE[s.tone].solid)} />{s.label}</p>
                  <p className="kit-num mt-0.5 text-[22px] font-extrabold leading-none text-slate-900">{s.value.toLocaleString("en-IN")}<span className="ml-1 text-[12px] font-semibold text-slate-400">{Math.round((s.value / (team as number)) * 100)}%</span></p>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-slate-400">"Not punched yet" includes week-offs: the live feed cannot separate them.</p>
        </div>
      )}
    </Panel>
  );
}
