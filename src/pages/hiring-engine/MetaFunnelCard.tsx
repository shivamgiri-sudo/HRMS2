/**
 * The Meta campaign walk-in funnel (Master tab): how far the leads who filled a Meta form get, from the form fill through the engine's outreach
 * (email, WhatsApp, bot call, reply, confirmation) to arriving, being selected and joining. Total on top, one row per campaign below.
 * Counts come from GET /api/he/meta-funnel (requisition records for the ends, Hiring Engine activity for the middle).
 */
import { useEffect, useState } from "react";
import { Filter } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { num } from "@/components/analytics/analytics-kit";

interface Counts { leads: number; qualified: number; inPool: number; emailed: number; whatsapped: number; called: number; replied: number; confirmed: number; arrived: number; walkedIn: number; selected: number; joined: number }
interface Row extends Counts { campaignId: string; campaignName: string; status: string; requisitionCode: string | null; branchName: string | null }
interface Funnel { campaigns: Row[]; total: Counts }

const STAGES: Array<{ key: keyof Counts; label: string; hint: string }> = [
  { key: "leads", label: "Form fills", hint: "Everyone who filled the Meta lead form" },
  { key: "qualified", label: "Qualified", hint: "Passed the campaign's screening" },
  { key: "inPool", label: "In the engine", hint: "Lead is in the Hiring Engine pool" },
  { key: "emailed", label: "Emailed", hint: "Walk-in invite email delivered or sent" },
  { key: "whatsapped", label: "WhatsApped", hint: "At least one WhatsApp template sent" },
  { key: "called", label: "Bot called", hint: "At least one confirmation call" },
  { key: "replied", label: "Replied", hint: "Answered on WhatsApp" },
  { key: "confirmed", label: "Confirmed", hint: "Confirmed a walk-in slot" },
  { key: "arrived", label: "Arrived", hint: "Reached the branch for a slot the engine booked" },
  { key: "walkedIn", label: "Walked in", hint: "Registered at a branch, counted from the requisition records" },
  { key: "selected", label: "Selected", hint: "Selected on the requisition" },
  { key: "joined", label: "Joined", hint: "Became an employee" },
];

export default function MetaFunnelCard() {
  const [data, setData] = useState<Funnel | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    hrmsApi.get<{ data: Funnel }>("/api/he/meta-funnel").then((r) => alive && setData(r.data)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);
  if (failed) return null;
  if (!data) return <div className="h-40 animate-pulse rounded-xl border border-slate-200 bg-slate-50 motion-reduce:animate-none" aria-hidden />;
  const top = Math.max(1, data.total.leads);
  const rows = data.campaigns.filter((c) => c.leads > 0).sort((a, b) => b.leads - a.leads);
  return (
    <section aria-label="Meta campaign funnel" className="rounded-xl border border-emerald-200 bg-white p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Filter className="h-4 w-4 text-emerald-600" aria-hidden /> Meta campaign walk-in funnel</h2>
      <p className="mt-1 text-xs text-slate-600">Only people who filled a Meta lead form. The bar is the share of all form fills; outreach stages are what the engine did for them.</p>
      <ol className="mt-3 space-y-1.5">
        {STAGES.map((s) => {
          const v = data.total[s.key]; const pct = Math.round((v / top) * 100);
          return (
            <li key={s.key} className="grid grid-cols-[110px_1fr_90px] items-center gap-2 text-sm" title={s.hint}>
              <span className="text-slate-700">{s.label}</span>
              <span className="h-3 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(v > 0 ? 1 : 0, pct)}%` }} /></span>
              <span className="text-right tabular-nums text-slate-900"><b>{num(v)}</b> <span className="text-xs text-slate-500">{pct}%</span></span>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <tr><th className="px-3 py-2">Campaign</th>{STAGES.map((s) => <th key={s.key} className="px-2 py-2 text-right" title={s.hint}>{s.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((c) => (
              <tr key={c.campaignId}>
                <td className="px-3 py-2"><div className="font-medium text-slate-900">{c.campaignName}</div><div className="text-xs text-slate-500">{c.requisitionCode ?? "no requisition"} · {c.branchName ?? "no branch"} · {c.status}</div></td>
                {STAGES.map((s) => <td key={s.key} className="px-2 py-2 text-right tabular-nums text-slate-700">{num(c[s.key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
