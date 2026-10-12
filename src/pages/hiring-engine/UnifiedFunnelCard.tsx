/**
 * One funnel from one person list (GET /api/he/funnel/unified): the three drives add up, then the ATS funnel and what came from other
 * sources. Enrolled people are typed once; walked in is any ATS registration on or after enrolment, booked or not.
 */
import { useEffect, useState } from "react";
import { GitMerge } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { num } from "@/components/analytics/analytics-kit";

type Src = "meta_live" | "meta_old" | "he";
interface Counts { enrolled: number; emailed: number; whatsapped: number; called: number; confirmed: number; walkedIn: number; selected: number; joined: number }
interface Funnel {
  generatedAt: string; from: string; drives: Record<Src, Counts>; drivesTotal: Counts;
  ats: { registered: number; selected: number; joined: number; fromDrives: number; otherSources: { registered: number; selected: number; joined: number } };
}
const COLS: Array<{ key: keyof Counts; label: string }> = [
  { key: "enrolled", label: "Enrolled" }, { key: "emailed", label: "Emailed" }, { key: "whatsapped", label: "WhatsApped" }, { key: "called", label: "Bot called" },
  { key: "confirmed", label: "Confirmed" }, { key: "walkedIn", label: "Walked in" }, { key: "selected", label: "Selected" }, { key: "joined", label: "Joined" },
];
const ROWS: Array<{ key: Src; label: string }> = [{ key: "meta_live", label: "Live Meta" }, { key: "meta_old", label: "Old Meta data" }, { key: "he", label: "Hiring Engine" }];
const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((a / b) * 100)}%` : "–");

export default function UnifiedFunnelCard() {
  const [d, setD] = useState<Funnel | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    hrmsApi.get<{ data: Funnel }>("/api/he/funnel/unified").then((r) => alive && setD(r.data)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);
  if (failed) return null;
  if (!d) return <div className="h-40 animate-pulse rounded-xl border border-slate-200 bg-slate-50 motion-reduce:animate-none" aria-hidden />;
  const o = d.ats.otherSources;
  return (
    <section aria-label="Sourcing to joined" className="rounded-xl border border-violet-200 bg-white p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><GitMerge className="h-4 w-4 text-violet-600" aria-hidden /> Sourcing to joined, by drive</h2>
      <p className="mt-1 text-xs text-slate-600">One list of people, each counted in one drive, so the rows add up to the total. Since {d.from}. Walked in is any branch registration on or after enrolment, booked or not.</p>
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <tr><th className="px-3 py-2">Drive</th>{COLS.map((c) => <th key={c.key} className="px-2 py-2 text-right">{c.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100 tabular-nums">
            {ROWS.map((r) => (
              <tr key={r.key}><td className="px-3 py-2 font-medium text-slate-900">{r.label}</td>{COLS.map((c) => <td key={c.key} className="px-2 py-2 text-right text-slate-700">{num(d.drives[r.key][c.key])}</td>)}</tr>
            ))}
            <tr className="bg-slate-50 font-semibold text-slate-900"><td className="px-3 py-2">All drives</td>{COLS.map((c) => <td key={c.key} className="px-2 py-2 text-right">{num(d.drivesTotal[c.key])}</td>)}</tr>
            <tr className="text-xs text-slate-600"><td className="px-3 py-2">Of enrolled</td>{COLS.map((c) => <td key={c.key} className="px-2 py-2 text-right">{pct(d.drivesTotal[c.key], d.drivesTotal.enrolled)}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <h3 className="mt-4 text-sm font-semibold text-slate-900">ATS funnel, everyone registered at a branch</h3>
      <p className="mt-1 text-sm text-slate-700">
        <b>{num(d.ats.registered)}</b> registered, <b>{num(d.ats.selected)}</b> selected ({pct(d.ats.selected, d.ats.registered)}), <b>{num(d.ats.joined)}</b> joined ({pct(d.ats.joined, d.ats.selected)} of selected).
        {" "}{num(d.ats.fromDrives)} came through the drives; the other sources brought <b>{num(o.registered)}</b> registered, {num(o.selected)} selected, {num(o.joined)} joined.
      </p>
    </section>
  );
}
