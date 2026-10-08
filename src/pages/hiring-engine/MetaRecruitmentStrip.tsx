/**
 * "Recruited through Meta campaigns" - shown on every tab so nobody has to open another page to know whether the
 * campaign is actually producing hires. Numbers come from GET /api/he/meta-recruitment, counted from the REQUISITION's
 * records (selected / onboarding / joined) for candidates who came from Meta leads, matched by link or phone. The Meta
 * campaigns page reads a stage label instead and shows 0 selected, which is why this is not the same number.
 */
import { useEffect, useState } from "react";
import { BadgeCheck, ChevronDown, ChevronUp } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { num } from "@/components/analytics/analytics-kit";

export interface Rec { leads: number; qualified: number; invited: number; applied: number; walkedIn: number; selected: number; onboarding: number; joined: number }
export interface CampRec extends Rec { campaignId: string; campaignName: string; status: string; requisitionCode: string | null; branchName: string | null }
export interface MetaRecruitment { campaigns: CampRec[]; total: Rec }

export function useMetaRecruitment(): { data: MetaRecruitment | null; error: boolean } {
  const [data, setData] = useState<MetaRecruitment | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    hrmsApi.get<{ data: MetaRecruitment }>("/api/he/meta-recruitment").then((r) => alive && setData(r.data)).catch(() => alive && setError(true));
    return () => { alive = false; };
  }, []);
  return { data, error };
}

const Tile = ({ label, value, strong, hint }: { label: string; value: number; strong?: boolean; hint?: string }) => (
  <div className="min-w-[88px]" title={hint}>
    <div className={`tabular-nums leading-none ${strong ? "text-3xl font-bold text-emerald-700" : "text-xl font-semibold text-slate-900"}`}>{num(value)}</div>
    <div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
  </div>
);

export default function MetaRecruitmentStrip() {
  const { data, error } = useMetaRecruitment();
  const [open, setOpen] = useState(false);
  if (error) return null; // an indicator must never get in the way of the page
  if (!data) return <div className="h-[84px] animate-pulse rounded-xl border border-slate-200 bg-slate-50 motion-reduce:animate-none" aria-hidden />;
  const t = data.total;
  const rows = data.campaigns.filter((c) => c.leads > 0).sort((a, b) => b.joined - a.joined || b.selected - a.selected || b.leads - a.leads);
  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4" aria-label="Recruited through Meta campaigns">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><BadgeCheck className="h-5 w-5 text-emerald-600" aria-hidden /> Recruited through Meta campaigns</div>
        <Tile label="Joined" value={t.joined} strong hint="Became employees (onboarding bridge has an employee)" />
        <Tile label="Selected" value={t.selected} hint="Marked selected on the requisition (or at Selected/Offered stage)" />
        <Tile label="Onboarding" value={t.onboarding} hint="Onboarding started" />
        <Tile label="Walked in" value={t.walkedIn} hint="Registered at the branch (walk-in date or queue token)" />
        <Tile label="In ATS" value={t.applied} hint="Meta leads matched to an ATS candidate by link or phone" />
        <Tile label="Qualified leads" value={t.qualified} hint={`${num(t.leads)} form fills in total`} />
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
          By campaign {open ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      {open && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-emerald-100 bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-2">Campaign</th><th className="px-3 py-2 text-right">Leads</th><th className="px-3 py-2 text-right">Qualified</th><th className="px-3 py-2 text-right">In ATS</th><th className="px-3 py-2 text-right">Walked in</th><th className="px-3 py-2 text-right">Selected</th><th className="px-3 py-2 text-right">Onboarding</th><th className="px-3 py-2 text-right">Joined</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => (
                <tr key={c.campaignId}>
                  <td className="px-3 py-2"><div className="font-medium text-slate-900">{c.campaignName}</div><div className="text-xs text-slate-500">{c.requisitionCode ?? "no requisition"} · {c.branchName ?? "no branch"} · {c.status}</div></td>
                  {[c.leads, c.qualified, c.applied, c.walkedIn, c.selected, c.onboarding].map((v, i) => <td key={i} className="px-3 py-2 text-right tabular-nums text-slate-700">{num(v)}</td>)}
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-emerald-700">{num(c.joined)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">Counted from the requisition records, matching each Meta lead to its ATS candidate by link or phone. A person in two campaigns is counted once in the total.</p>
        </div>
      )}
    </section>
  );
}
