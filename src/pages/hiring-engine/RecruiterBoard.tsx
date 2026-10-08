/**
 * Recruiter productivity inside the Master tab: calls, leads, walk-ins, selections per recruiter (7 / 30 days) with
 * a coaching flag when someone converts at less than half the team rate. Reads GET /api/he/master/recruiters.
 */
import { useEffect, useState } from "react";
import { UserCog } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { num } from "@/components/analytics/analytics-kit";

interface Row { recruiter: string; attempts: number; uniqueLeads: number; walkins: number; selected: number; joined: number; walkinRate: number; selectRate: number; flag: string | null }
interface Data { days: number; team: Omit<Row, "recruiter" | "flag">; recruiters: Row[] }
const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function RecruiterBoard() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => {
    let alive = true;
    hrmsApi.get<{ data: Data }>(`/api/he/master/recruiters?days=${days}`).then((r) => alive && setData(r.data)).catch(() => alive && setData({ days, team: { attempts: 0, uniqueLeads: 0, walkins: 0, selected: 0, joined: 0, walkinRate: 0, selectRate: 0 }, recruiters: [] }));
    return () => { alive = false; };
  }, [days]);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Recruiter productivity">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><UserCog className="h-4 w-4 text-blue-600" aria-hidden /> Recruiters</h2>
        <div role="group" aria-label="Period" className="inline-flex rounded-lg border border-slate-200 p-0.5">
          {[7, 30].map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={`cursor-pointer rounded-md px-3 py-1 text-xs font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${days === d ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{d} days</button>)}
        </div>
      </div>
      {!data ? <div className="h-32 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" aria-hidden /> : data.recruiters.length === 0 ? <p className="text-sm text-slate-500">No recruiter activity in this period.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-[11px] font-bold uppercase tracking-wider text-slate-500"><tr><th className="py-2">Recruiter</th><th className="py-2 text-right">Calls</th><th className="py-2 text-right">Leads</th><th className="py-2 text-right">Walk-ins</th><th className="py-2 text-right">Selected</th><th className="py-2 text-right">Lead → walk-in</th><th className="py-2 text-right">Walk-in → selected</th><th className="py-2 pl-4">Note</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-slate-50 font-semibold"><td className="py-1.5">Team</td><td className="py-1.5 text-right tabular-nums">{num(data.team.attempts)}</td><td className="py-1.5 text-right tabular-nums">{num(data.team.uniqueLeads)}</td><td className="py-1.5 text-right tabular-nums">{num(data.team.walkins)}</td><td className="py-1.5 text-right tabular-nums">{num(data.team.selected)}</td><td className="py-1.5 text-right tabular-nums">{pct(data.team.walkinRate)}</td><td className="py-1.5 text-right tabular-nums">{pct(data.team.selectRate)}</td><td /></tr>
              {data.recruiters.map((r) => (
                <tr key={r.recruiter} className="transition-colors duration-150 hover:bg-slate-50">
                  <td className="py-1.5 font-medium text-slate-900">{r.recruiter}</td>
                  <td className="py-1.5 text-right tabular-nums">{num(r.attempts)}</td><td className="py-1.5 text-right tabular-nums">{num(r.uniqueLeads)}</td>
                  <td className="py-1.5 text-right tabular-nums">{num(r.walkins)}</td><td className="py-1.5 text-right tabular-nums">{num(r.selected)}</td>
                  <td className="py-1.5 text-right tabular-nums">{pct(r.walkinRate)}</td><td className="py-1.5 text-right tabular-nums">{pct(r.selectRate)}</td>
                  <td className="py-1.5 pl-4 text-xs text-amber-700">{r.flag ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
