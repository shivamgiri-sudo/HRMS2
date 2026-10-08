/** Alerts-tab extras: the absconding watch list and the "do follow-ups work?" card. */
import { useState } from "react";
import { ArrowRight, CheckCircle2, Eye, MessageSquarePlus, PhoneCall } from "lucide-react";
import { ChartCard, num, pct, SERIES, STATUS } from "@/components/analytics/analytics-kit";
import { RaiseExitButton } from "@/components/exit/RaiseExitButton";
import { useHubDrillPage, useHubEffectiveness } from "./api";
import { DRILL_FOCUS, ErrorCard, MiniBar, Shimmer, drillable, fmtAon } from "./charts";
import { useDrill } from "./DrillContext";
import FollowupPanel, { KIND_LABEL } from "./FollowupPanel";
import type { DrillQuery } from "./types";

const WATCH: DrillQuery = { population: "active", minAbsentStreak: 3, followup: "none", sort: "score" };

export function AbscondingWatch() {
  const drill = useDrill();
  const q = useHubDrillPage(WATCH, 8);
  const [logId, setLogId] = useState<string | null>(null);
  const d = q.data;
  const openAll = () => drill({ ...WATCH, title: `Absconding watch - ${num(d?.total ?? 0)} absent, not yet contacted` });
  return (
    <section aria-label="Absconding watch" className="overflow-hidden rounded-xl border border-rose-200 bg-gradient-to-br from-rose-50/70 via-white to-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="rounded-lg bg-rose-100 p-2 text-rose-600"><Eye className="h-4 w-4" aria-hidden /></div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900">Absconding watch</h3>
            <p className="text-[11px] leading-snug text-slate-500">Absent 2+ days and nobody has logged a call yet, highest risk first. Reach out, then log what happened.</p>
          </div>
        </div>
        {d && d.total > 0 && (
          <button type="button" onClick={openAll} aria-label={`See all ${d.total} people on the absconding watch`}
            className={`inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 ${DRILL_FOCUS}`}>
            See all {num(d.total)} <ArrowRight className="h-3 w-3" aria-hidden />
          </button>
        )}
      </header>
      <div className="border-t border-rose-100 px-4 py-2">
        {q.isLoading ? <div className="space-y-2 py-1">{[0, 1, 2].map(i => <Shimmer key={i} className="h-10" />)}</div>
          : q.error ? <div className="py-2"><ErrorCard what="the watch list" error={q.error} onRetry={() => q.refetch()} /></div>
          : !d || d.rows.length === 0 ? (
            <div className="flex items-center gap-2 py-4 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden /> Nobody is on an absence streak without a follow-up. Nice.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.rows.map(r => (
                <li key={r.employeeId} className="py-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <div className="min-w-0 flex-1 basis-48 cursor-pointer" {...drillable(openAll, `Open the watch list, starting with ${r.name}`)}>
                      <div className="truncate text-sm font-semibold text-slate-900">{r.name}</div>
                      <div className="truncate text-[11px] text-slate-500">{[r.branch, r.process].filter(Boolean).join(" · ") || r.code}</div>
                    </div>
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold tabular-nums text-rose-700">{r.absentStreak ?? 0}d absent</span>
                    <span className="text-[11px] tabular-nums text-slate-500" title="Age on network">AON {fmtAon(r.aonDays)}</span>
                    <div className="ml-auto flex items-center gap-1.5">
                      <button type="button" aria-expanded={logId === r.employeeId} aria-label={`Log outcome for ${r.name}`} onClick={() => setLogId(logId === r.employeeId ? null : r.employeeId)}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">
                        <MessageSquarePlus className="h-3 w-3" aria-hidden /> Log outcome
                      </button>
                      <RaiseExitButton compact employee={{ id: r.employeeId, name: r.name, code: r.code, process: r.process, branch: r.branch, reportingManager: r.manager }} />
                    </div>
                  </div>
                  {logId === r.employeeId && <div className="mt-2 rounded-lg bg-slate-50 p-3"><FollowupPanel employeeId={r.employeeId} compact onLogged={() => setLogId(null)} /></div>}
                </li>
              ))}
            </ul>
          )}
      </div>
    </section>
  );
}

function Bar({ label, value, color, sub }: { label: string; value: number | null; color: string; sub?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-semibold text-slate-700">{label}</span>
        <span className="tabular-nums"><strong className="text-base text-slate-900">{value === null ? "n/a" : pct(value, 0)}</strong>{sub && <span className="ml-1 text-[11px] text-slate-500">{sub}</span>}</span>
      </div>
      <MiniBar value={value ?? 0} max={100} color={color} height={14} label={`${label}: ${value === null ? "not available" : pct(value, 0)}`} />
    </div>
  );
}

export function FollowupEffect() {
  const q = useHubEffectiveness();
  const e = q.data;
  const diff = e && e.stillActivePct !== null && e.baselinePct !== null ? e.stillActivePct - e.baselinePct : null;
  return (
    <ChartCard title="Do follow-ups work?" subtitle="Of people we followed up with 30+ days ago, how many are still here, versus comparable people (same risk tier today) nobody followed up with.">
      {q.isLoading ? <Shimmer className="h-40" /> : q.error || !e ? <ErrorCard what="follow-up results" error={q.error} onRetry={() => q.refetch()} /> : e.actioned === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-6 text-center">
          <PhoneCall className="h-6 w-6 text-slate-300" aria-hidden />
          <p className="text-sm font-semibold text-slate-700">Log outcomes from the watch list - results appear after 30 days</p>
          <p className="text-[11px] text-slate-500">{e.logged30 > 0 ? `${num(e.logged30)} follow-up${e.logged30 === 1 ? "" : "s"} logged in the last 30 days so far.` : "Nothing logged yet."}</p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <Bar label="Followed up" value={e.stillActivePct} color={SERIES[2]} sub={`${num(e.stillActive)} of ${num(e.actioned)} still active`} />
            <Bar label="Not followed up (comparable)" value={e.baselinePct} color="#94a3b8" />
            {diff !== null && (
              <p className={`rounded-lg px-3 py-2 text-xs font-semibold ${diff > 0 ? "bg-emerald-50 text-emerald-800" : diff < 0 ? "bg-rose-50 text-rose-800" : "bg-slate-50 text-slate-700"}`}>
                {diff > 0 ? `${diff.toFixed(0)} points more of the followed-up people stayed.` : diff < 0 ? `${Math.abs(diff).toFixed(0)} points fewer stayed than without a follow-up.` : "No difference yet."}
              </p>
            )}
            <p className="text-[11px] text-slate-500">{num(e.logged30)} follow-up{e.logged30 === 1 ? "" : "s"} logged in the last 30 days. Indicative only: people were not picked at random.</p>
          </div>
          <div>
            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">By type of follow-up</h4>
            <ul className="space-y-2.5">
              {e.byKind.length === 0 && <li className="text-xs text-slate-500">No breakdown yet.</li>}
              {e.byKind.map(k => (
                <li key={k.kind}>
                  <div className="mb-1 flex items-baseline justify-between text-xs"><span className="font-semibold text-slate-700">{KIND_LABEL[k.kind] ?? k.kind}</span><span className="tabular-nums text-slate-500"><strong className="text-slate-900">{k.stillActivePct === null ? "n/a" : pct(k.stillActivePct, 0)}</strong> · n={num(k.n)}</span></div>
                  <MiniBar value={k.stillActivePct ?? 0} max={100} color={k.n < 10 ? "#cbd5e1" : (k.stillActivePct ?? 0) >= (e.baselinePct ?? 0) ? SERIES[2] : STATUS.serious} height={8} label={`${KIND_LABEL[k.kind]}: ${k.stillActivePct ?? "n/a"} percent still active`} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </ChartCard>
  );
}
