/**
 * What the walk-in engine costs per branch and drive type (Live Meta, Old Meta data, Hiring Engine): Meta ad spend, WhatsApp, bot calling
 * minutes and e-mail, at the owner's rates. Counts come from GET /api/he/cost/by-branch (estimates, see the note on the card).
 */
import { useEffect, useState } from "react";
import { IndianRupee } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { num } from "@/components/analytics/analytics-kit";

type Src = "meta_live" | "meta_old" | "he";
interface Usage { adSpend: number; waConversations: number; calls: number; callMinutes: number; emails: number }
interface TypeCost { total: number; adSpend: number; messaging: number; usage: Usage }
interface Row { branch: string; requisitions: number; byType: Record<Src, TypeCost>; total: number }
interface Report { from: string; to: string; rates: Record<string, number>; failedSections: string[]; note: string; rows: Row[]; totals: Record<Src, TypeCost> & { all: number } }

const COLS: Array<{ key: Src; label: string }> = [{ key: "meta_live", label: "Live Meta" }, { key: "meta_old", label: "Old Meta data" }, { key: "he", label: "Hiring Engine" }];
const rs = (v: number): string => `₹${num(Math.round(v))}`;
const mins = (u: Usage): string => `${num(u.callMinutes)} min`;

function Cell({ c }: { c: TypeCost }) {
  if (c.total === 0 && c.usage.calls === 0 && c.usage.waConversations === 0 && c.usage.emails === 0) return <span className="text-slate-400">–</span>;
  return (
    <div>
      <div className="font-semibold tabular-nums text-slate-900">{rs(c.total)}</div>
      <div className="text-[11px] text-slate-500">
        {c.adSpend > 0 ? `ads ${rs(c.adSpend)} · ` : ""}{num(c.usage.waConversations)} WA · {mins(c.usage)} ({num(c.usage.calls)} calls) · {num(c.usage.emails)} mail
      </div>
    </div>
  );
}

export default function CostByBranchCard() {
  const [data, setData] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    hrmsApi.get<{ data: Report }>("/api/he/cost/by-branch").then((r) => alive && setData(r.data)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);
  if (failed) return null;
  if (!data) return <div className="h-40 animate-pulse rounded-xl border border-slate-200 bg-slate-50 motion-reduce:animate-none" aria-hidden />;
  const perMin = data.rates["cost.call_per_minute"] ?? 0;
  return (
    <section aria-label="Cost per branch" className="rounded-xl border border-amber-200 bg-white p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><IndianRupee className="h-4 w-4 text-amber-600" aria-hidden /> Cost of the walk-in engine by branch and drive</h2>
      <p className="mt-1 text-xs text-slate-600">
        {data.from} to {data.to}. Bot calling {perMin > 0 ? `₹${perMin.toFixed(2)} per minute` : "rate not set"}. Total <b>{rs(data.totals.all)}</b>.
        {data.rows.every((r) => COLS.every((c) => r.byType[c.key].adSpend === 0)) ? " Meta ad spend is not synced yet, so ads show nothing." : ""}
      </p>
      <div className="mt-3 rounded-lg border border-slate-200 md:overflow-x-auto">
        <table className="block w-full text-left text-sm md:table">
          <thead className="hidden bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 md:table-header-group">
            <tr><th className="px-3 py-2">Branch</th>{COLS.map((c) => <th key={c.key} className="px-3 py-2">{c.label}</th>)}<th className="px-3 py-2 text-right">Total</th></tr>
          </thead>
          <tbody className="block divide-y divide-slate-100 md:table-row-group">
            {data.rows.map((r) => (
              <tr key={r.branch} className="block px-1 py-2 md:table-row md:p-0">
                <td className="block px-3 py-1 md:table-cell md:py-2"><div className="font-medium text-slate-900">{r.branch}</div><div className="text-xs text-slate-500">{r.requisitions} requisitions</div></td>
                {COLS.map((c) => <td key={c.key} className="block px-3 py-1 md:table-cell md:py-2"><span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 md:hidden">{c.label}</span><Cell c={r.byType[c.key]} /></td>)}
                <td className="block px-3 py-1 font-bold tabular-nums text-slate-900 md:table-cell md:py-2 md:text-right"><span className="mr-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 md:hidden">Total</span>{rs(r.total)}</td>
              </tr>
            ))}
            <tr className="block bg-slate-50 px-1 py-2 md:table-row md:p-0">
              <td className="block px-3 py-1 font-semibold text-slate-900 md:table-cell md:py-2">All branches</td>
              {COLS.map((c) => <td key={c.key} className="block px-3 py-1 md:table-cell md:py-2"><span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 md:hidden">{c.label}</span><Cell c={data.totals[c.key]} /></td>)}
              <td className="block px-3 py-1 font-bold tabular-nums text-slate-900 md:table-cell md:py-2 md:text-right"><span className="mr-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 md:hidden">Total</span>{rs(data.totals.all)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-600">{data.note}</p>
      {data.failedSections.length > 0 && <p className="mt-1 text-xs text-amber-700">Some figures could not be read ({data.failedSections.join(", ")}); they count as 0.</p>}
    </section>
  );
}
