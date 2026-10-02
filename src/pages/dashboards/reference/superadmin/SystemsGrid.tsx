import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { LIGHT, type SystemTile } from "./superAdminModel";

const GROUPS: Array<[string, string]> = [["core", "Core platform"], ["integration", "Integrations"], ["comms", "Messaging"], ["jobs", "Scheduled work"]];

/** "Status board": one light per platform system, each a link to where it is fixed. */
export function SystemsGrid({ systems, loading, error }: { systems: SystemTile[]; loading?: boolean; error?: string | null }) {
  return (
    <section aria-label="System status" className="kit-card kit-rise p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-extrabold uppercase tracking-[.16em] text-slate-700">Systems status</h2>
        <p className="text-[11px] text-slate-500">Live probes of the database, integrations, messaging and jobs</p>
      </div>
      {loading && !systems.length ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl bg-slate-100" />)}</div>
      ) : !systems.length ? (
        <p className="text-[12px] text-amber-700">System probes unavailable{error ? `: ${error}` : "."}</p>
      ) : (
        <div className="space-y-4">
          {GROUPS.map(([key, title]) => {
            const items = systems.filter((s) => s.group === key);
            if (!items.length) return null;
            return (
              <div key={key}>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">{title}</p>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
                  {items.map((s) => {
                    const l = LIGHT[s.status];
                    return (
                      <Link key={s.id} to={s.href} title={s.detail}
                        className={cn("group rounded-2xl bg-white/5 p-3.5 ring-1 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400", l.ring)}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-[12px] font-semibold text-slate-700">{s.name}</p>
                          <span className="flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-full", l.dot)} aria-hidden /><span className={cn("text-[10px] font-bold uppercase", l.text)}>{l.label}</span></span>
                        </div>
                        <p className="kit-num mt-2 text-[20px] font-extrabold leading-none text-slate-900">{s.headline}</p>
                        <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-slate-500">{s.detail}</p>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
