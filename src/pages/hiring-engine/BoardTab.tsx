/**
 * Walk-in board: today's active drives, how many candidates are expected within 30 minutes (confirmed slots, with
 * consented live-location ETA taking precedence), and each candidate's tracking state. Polls every 30s.
 * Reads GET /api/he/board; the numbers are the same ones the branch HR arrival alert is sent from.
 */
import { useCallback, useEffect, useState } from "react";
import { ListChecks, MapPin, RefreshCcw, Radio } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { EmptyState } from "@/components/analytics/analytics-kit";
import ControlRoom from "./ControlRoom";
import OutcomeReasons from "./OutcomeReasons";
import ConfirmedSheet from "./responses/ConfirmedSheet";

interface Cand { matchId: string; leadId: string; name: string | null; mobile10: string; slotAt: string | null; state: string; liveKm: number | null; etaMin: number | null; tracked: boolean }
interface BoardDrive { driveId: string; branchName: string; role: string; slotCapacity: number; expected: number; confirmed: number; live: number; arrived: number; candidates: Cand[] }

const STATE: Record<string, string> = {
  arrived: "bg-emerald-50 text-emerald-700 ring-emerald-200", confirmed: "bg-blue-50 text-blue-700 ring-blue-200", invited: "bg-slate-50 text-slate-600 ring-slate-200",
};
const hhmm = (s: string | null) => (s ? s.slice(11, 16) : "—");

export default function BoardTab() {
  const [data, setData] = useState<BoardDrive[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  const [confirmedOf, setConfirmedOf] = useState<BoardDrive | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await hrmsApi.get<{ data: BoardDrive[] }>("/api/he/board");
      setData(r.data ?? []); setError(null); setAt(new Date());
    } catch (e: unknown) { setError((e as { message?: string })?.message || "Unable to load the board"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="space-y-5">
      <ControlRoom />
      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>{at ? `Updated ${at.toLocaleTimeString()}` : "Loading…"} · refreshes every 30 seconds</span>
        <button type="button" onClick={() => void load()} aria-label="Refresh board" className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden /> Refresh
        </button>
      </div>
      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {!loading && data.length === 0 && !error && <EmptyState label="No active drive today" hint="Create a drive in the Drives tab and set it to Active." />}

      {data.map((d) => (
        <section key={d.driveId} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label={`${d.branchName} board`}>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
            <div>
              <h3 className="font-semibold text-slate-900">{d.branchName}</h3>
              <p className="text-sm text-slate-600">{d.role}</p>
            </div>
            <div className="flex flex-wrap items-center gap-5 text-center">
              <div><div className="text-3xl font-bold tabular-nums leading-none text-blue-700">{d.expected}</div><div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">expected in 30 min</div></div>
              <div><div className="text-xl font-bold tabular-nums leading-none text-slate-900">{d.confirmed}</div><div className="mt-1 text-[11px] uppercase tracking-wider text-slate-500">confirmed</div></div>
              <div><div className="text-xl font-bold tabular-nums leading-none text-emerald-700">{d.live}</div><div className="mt-1 text-[11px] uppercase tracking-wider text-slate-500">live tracked</div></div>
              <div><div className="text-xl font-bold tabular-nums leading-none text-slate-900">{d.arrived}</div><div className="mt-1 text-[11px] uppercase tracking-wider text-slate-500">arrived</div></div>
              <button type="button" onClick={() => setConfirmedOf(d)} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:min-h-9">
                <ListChecks className="h-4 w-4" aria-hidden /> Confirmed to attend ({d.confirmed})
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-[11px] font-bold uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-2">Candidate</th><th className="px-4 py-2">Slot</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Location</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {d.candidates.map((c) => (
                  <tr key={c.matchId}>
                    <td className="px-4 py-2.5"><div className="font-medium text-slate-900">{c.name || "Unknown"}</div><div className="text-xs text-slate-500">{c.mobile10}</div></td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-700">{hhmm(c.slotAt)}</td>
                    <td className="px-4 py-2.5"><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ring-inset ${STATE[c.state] ?? STATE.invited}`}>{c.state}</span></td>
                    <td className="px-4 py-2.5">
                      {c.tracked
                        ? <span className="inline-flex items-center gap-1.5 text-emerald-700"><Radio className="h-4 w-4" aria-hidden /> {c.liveKm != null ? `${c.liveKm} km` : "live"}{c.etaMin != null ? ` · ~${c.etaMin} min` : ""}</span>
                        : <span className="inline-flex items-center gap-1.5 text-slate-400"><MapPin className="h-4 w-4" aria-hidden /> not sharing</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <OutcomeReasons />
      {confirmedOf && <ConfirmedSheet driveId={confirmedOf.driveId} title={`Confirmed to attend: ${confirmedOf.branchName}, ${confirmedOf.role}`} onClose={() => setConfirmedOf(null)} />}
    </div>
  );
}
