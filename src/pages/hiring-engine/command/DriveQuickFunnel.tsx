/**
 * The drive's funnel from the engine's own person list (GET /api/he/funnel/unified, cached and warmed on the server, so it answers in about
 * a second even when the detailed analytics time out). Shown at the top of the Live Meta, Old Meta data and Hiring Engine sections: stage
 * tiles with the share kept from the stage before, the step that loses the most people, and for the Meta drives the day by campaign rows.
 */
import { useEffect, useState } from "react";
import { ArrowDown, RefreshCw, TrendingDown } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import type { Filters } from "./driveCommandModel";
import type { SourceType } from "./driveCommandTypes";

interface Counts { enrolled: number; emailed: number; whatsapped: number; called: number; confirmed: number; walkedIn: number; selected: number; joined: number }
interface CampaignDay extends Counts { date: string; campaignId: string; campaignName: string; drive: SourceType }
interface Funnel { generatedAt: string; from: string; to: string; drives: Record<SourceType, Counts>; campaignDays?: CampaignDay[] }

const STAGES: Array<{ key: keyof Counts; label: string }> = [
  { key: "enrolled", label: "Contacted" }, { key: "emailed", label: "Emailed" }, { key: "whatsapped", label: "WhatsApped" }, { key: "called", label: "Bot called" },
  { key: "confirmed", label: "Confirmed" }, { key: "walkedIn", label: "Walked in" }, { key: "selected", label: "Selected" }, { key: "joined", label: "Joined" },
];
const MAIN: Array<keyof Counts> = ["enrolled", "confirmed", "walkedIn", "selected", "joined"];
const LABEL: Record<SourceType, string> = { meta_live: "Live Meta", meta_old: "Old Meta data", he: "Hiring Engine" };
const n = (v: number): string => v.toLocaleString("en-IN");
const pct = (a: number, b: number): string => (b > 0 ? `${a / b < 0.1 && a > 0 ? (a / b * 100).toFixed(1) : Math.round((a / b) * 100)}%` : "–");
const name = (k: keyof Counts): string => STAGES.find((s) => s.key === k)!.label.toLowerCase();

export default function DriveQuickFunnel({ type, filters, analyticsPartial }: { type: SourceType; filters: Filters; analyticsPartial?: boolean }) {
  const [data, setData] = useState<Funnel | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState("loading");
    hrmsApi.get<{ data: Funnel }>(`/api/he/funnel/unified?from=${filters.from}&to=${filters.to}`)
      .then((r) => { if (alive) { setData(r.data); setState("ok"); } }).catch(() => alive && setState("failed"));
    return () => { alive = false; };
  }, [filters.from, filters.to, tick]);
  const label = LABEL[type];
  if (state === "loading" && !data) {
    return <div className="h-32 animate-pulse rounded-xl border border-slate-200 bg-slate-100 motion-reduce:animate-none dark:border-slate-700 dark:bg-slate-800" aria-busy="true" aria-label={`Loading the ${label} funnel`} />;
  }
  if (state === "failed" || !data) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200">
        The {label} funnel could not be loaded.
        <button type="button" onClick={() => setTick((t) => t + 1)} className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-md border border-rose-300 px-3 hover:bg-rose-100 dark:border-rose-700"><RefreshCw className="h-4 w-4" aria-hidden />Try again</button>
      </div>
    );
  }
  const c = data.drives[type];
  // the step that loses the biggest share of people, among the main stages
  let worst: { from: keyof Counts; to: keyof Counts; kept: number } | null = null;
  for (let i = 1; i < MAIN.length; i++) {
    const a = c[MAIN[i - 1]], b = c[MAIN[i]];
    if (a >= 10) { const kept = b / a; if (!worst || kept < worst.kept) worst = { from: MAIN[i - 1], to: MAIN[i], kept }; }
  }
  const days = (data.campaignDays ?? []).filter((r) => r.drive === type).slice(0, 14);
  return (
    <section aria-label={`${label} funnel`} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{label}: people first contacted {data.from} to {data.to}</h3>
        <span className="text-xs text-slate-600 dark:text-slate-300">From the engine's own records · updated {new Date(data.generatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      {analyticsPartial && (
        <p className="mt-1 text-xs text-slate-700 dark:text-slate-200">The detailed charts below are still being computed; these counts are complete and safe to report.</p>
      )}
      <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {STAGES.map((s, i) => {
          const prev = i === 0 ? null : c[STAGES[i - 1].key];
          return (
            <li key={s.key} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">{s.label}</div>
              <div className="text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{n(c[s.key])}</div>
              <div className="text-xs tabular-nums text-slate-600 dark:text-slate-300">{prev === null ? "start" : <><ArrowDown className="mr-0.5 inline h-3 w-3" aria-hidden />{pct(c[s.key], prev)} of previous</>}</div>
            </li>
          );
        })}
      </ol>
      {c.enrolled === 0 ? (
        <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">Nobody was first contacted for {label} in this range. Widen the dates above to look further back.</p>
      ) : worst && (
        <p className="mt-3 flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
          <TrendingDown className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Biggest loss: from {name(worst.from)} to {name(worst.to)}, only {pct(c[worst.to], c[worst.from])} move on ({n(c[worst.to])} of {n(c[worst.from])}).
        </p>
      )}
      {type !== "he" && days.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[720px] text-left text-sm">
            <caption className="sr-only">{label} by day and campaign</caption>
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr><th scope="col" className="px-3 py-2">Day</th><th scope="col" className="px-2 py-2">Campaign</th>{MAIN.map((k) => <th key={k} scope="col" className="px-2 py-2 text-right">{STAGES.find((s) => s.key === k)!.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums dark:divide-slate-700">
              {days.map((r) => (
                <tr key={`${r.date}|${r.campaignId}`}>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-900 dark:text-slate-100">{r.date}</td>
                  <td className="max-w-[16rem] truncate px-2 py-2 text-slate-700 dark:text-slate-200" title={r.campaignName}>{r.campaignName}</td>
                  {MAIN.map((k) => <td key={k} className="px-2 py-2 text-right text-slate-700 dark:text-slate-200">{n(r[k])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
