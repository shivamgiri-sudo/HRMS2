/**
 * Walk-in hiring funnel for the CEO and Super Admin dashboards and the Hiring Engine Master tab: one person list, so the three drives add up,
 * with a date range, a daily trend, step conversions, the ATS funnel beside it and written insights. GET /api/he/funnel/unified?from&to.
 * Cohort view: people first contacted in the range; walked in is any branch registration on or after first contact.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, GitMerge, Info } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

type Src = "meta_live" | "meta_old" | "he";
interface Counts { enrolled: number; emailed: number; whatsapped: number; called: number; confirmed: number; walkedIn: number; selected: number; joined: number }
interface Data {
  generatedAt: string; from: string; to: string; daily: Array<{ date: string; enrolled: number; walkedIn: number }>; insights: Array<{ level: "info" | "warn"; text: string }>;
  drives: Record<Src, Counts>; drivesTotal: Counts;
  ats: { registered: number; selected: number; joined: number; fromDrives: number; beforeEnrolment: number; otherSources: { registered: number; selected: number; joined: number } };
}
const COLS: Array<{ key: keyof Counts; label: string }> = [
  { key: "enrolled", label: "Contacted" }, { key: "emailed", label: "Emailed" }, { key: "whatsapped", label: "WhatsApped" }, { key: "called", label: "Bot called" },
  { key: "confirmed", label: "Confirmed" }, { key: "walkedIn", label: "Walked in" }, { key: "selected", label: "Selected" }, { key: "joined", label: "Joined" },
];
const ROWS: Array<{ key: Src; label: string; color: string }> = [
  { key: "meta_live", label: "Live Meta", color: "bg-emerald-500" }, { key: "meta_old", label: "Old Meta data", color: "bg-amber-500" }, { key: "he", label: "Hiring Engine", color: "bg-blue-500" },
];
const STEPS: Array<[keyof Counts, keyof Counts, string]> = [["enrolled", "confirmed", "Contacted to confirmed"], ["confirmed", "walkedIn", "Confirmed to walked in"], ["walkedIn", "selected", "Walked in to selected"], ["selected", "joined", "Selected to joined"]];
const n = (v: number): string => v.toLocaleString("en-IN");
const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((a / b) * 100)}%` : "–");
const istDay = (offset = 0): string => new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10);
const PRESETS = [{ id: "7", label: "7 days", days: 7 }, { id: "30", label: "30 days", days: 30 }, { id: "90", label: "90 days", days: 90 }] as const;

export default function WalkinFunnelPanel({ className = "" }: { className?: string }) {
  const [from, setFrom] = useState(istDay(-29));
  const [to, setTo] = useState(istDay());
  const [preset, setPreset] = useState<string>("30");
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  useEffect(() => {
    let alive = true;
    setState("loading");
    hrmsApi.get<{ data: Data }>(`/api/he/funnel/unified?from=${from}&to=${to}`).then((r) => { if (alive) { setData(r.data); setState("ok"); } }).catch(() => alive && setState("failed"));
    return () => { alive = false; };
  }, [from, to]);
  const pick = (id: string, days: number) => { setPreset(id); setFrom(istDay(-(days - 1))); setTo(istDay()); };
  const maxDay = useMemo(() => Math.max(1, ...(data?.daily ?? []).map((d) => d.enrolled)), [data]);
  const t = data?.drivesTotal;
  return (
    <section aria-label="Walk-in hiring funnel" className={`rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100"><GitMerge className="h-4 w-4 text-violet-600" aria-hidden /> Walk-in hiring funnel</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" onClick={() => pick(p.id, p.days)} aria-pressed={preset === p.id}
              className={`min-h-9 cursor-pointer rounded-md border px-3 ${preset === p.id ? "border-violet-600 bg-violet-600 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200"}`}>{p.label}</button>
          ))}
          <label className="flex items-center gap-1 text-slate-700 dark:text-slate-200">From
            <input type="date" value={from} max={to} onChange={(e) => { if (e.target.value) { setFrom(e.target.value); setPreset("custom"); } }} className="rounded-md border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800" /></label>
          <label className="flex items-center gap-1 text-slate-700 dark:text-slate-200">To
            <input type="date" value={to} min={from} max={istDay()} onChange={(e) => { if (e.target.value) { setTo(e.target.value); setPreset("custom"); } }} className="rounded-md border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800" /></label>
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">People first contacted between {from} and {to}, each counted in one drive so the rows add up. Walked in is any branch registration on or after first contact, booked or not.</p>
      {state === "loading" && <div className="mt-3 h-40 animate-pulse rounded-lg bg-slate-50 motion-reduce:animate-none dark:bg-slate-800" aria-busy />}
      {state === "failed" && <p role="alert" className="mt-3 text-sm text-rose-700">The funnel could not be loaded. Try another range or refresh.</p>}
      {state === "ok" && data && t && (
        <>
          <ul className="mt-3 space-y-1">
            {data.insights.map((i, k) => (
              <li key={k} className={`flex items-start gap-2 text-sm ${i.level === "warn" ? "text-amber-800 dark:text-amber-300" : "text-slate-700 dark:text-slate-200"}`}>
                {i.level === "warn" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />}{i.text}
              </li>
            ))}
          </ul>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([a, b, label]) => (
              <div key={label} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                <div className="text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{pct(t[b], t[a])}</div>
                <div className="text-xs text-slate-600 dark:text-slate-300">{n(t[b])} of {n(t[a])}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-800"><tr><th className="px-3 py-2">Drive</th>{COLS.map((c) => <th key={c.key} className="px-2 py-2 text-right">{c.label}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100 tabular-nums dark:divide-slate-700">
                {ROWS.map((r) => (
                  <tr key={r.key}><td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100"><span className={`mr-2 inline-block h-2 w-2 rounded-full ${r.color}`} aria-hidden />{r.label}</td>
                    {COLS.map((c) => <td key={c.key} className="px-2 py-2 text-right text-slate-700 dark:text-slate-200">{n(data.drives[r.key][c.key])}</td>)}</tr>
                ))}
                <tr className="bg-slate-50 font-semibold text-slate-900 dark:bg-slate-800 dark:text-slate-100"><td className="px-3 py-2">All drives</td>{COLS.map((c) => <td key={c.key} className="px-2 py-2 text-right">{n(t[c.key])}</td>)}</tr>
                <tr className="text-xs text-slate-600 dark:text-slate-300"><td className="px-3 py-2">Of contacted</td>{COLS.map((c) => <td key={c.key} className="px-2 py-2 text-right">{pct(t[c.key], t.enrolled)}</td>)}</tr>
              </tbody>
            </table>
          </div>
          <h3 className="mt-4 text-sm font-semibold text-slate-900 dark:text-slate-100">People first contacted, per day</h3>
          <div className="mt-1 flex h-24 items-end gap-px" role="img" aria-label={`Daily first contacts from ${from} to ${to}`}>
            {data.daily.map((d) => (
              <div key={d.date} className="flex-1 min-w-px bg-violet-400/80 dark:bg-violet-500" style={{ height: `${Math.max(d.enrolled ? 3 : 0, Math.round((d.enrolled / maxDay) * 100))}%` }} title={`${d.date}: ${d.enrolled} contacted, ${d.walkedIn} walked in`} />
            ))}
          </div>
          <h3 className="mt-4 text-sm font-semibold text-slate-900 dark:text-slate-100">ATS funnel: everyone registered at a branch in the range</h3>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
            <b>{n(data.ats.registered)}</b> registered, <b>{n(data.ats.selected)}</b> selected ({pct(data.ats.selected, data.ats.registered)}), <b>{n(data.ats.joined)}</b> joined ({pct(data.ats.joined, data.ats.selected)} of selected).
            {" "}{n(data.ats.fromDrives)} came after the engine contacted them, {n(data.ats.beforeEnrolment)} are known to the engine but registered before first contact or a second time, and <b>{n(data.ats.otherSources.registered)}</b> came from other sources ({n(data.ats.otherSources.selected)} selected, {n(data.ats.otherSources.joined)} joined).
          </p>
        </>
      )}
    </section>
  );
}
