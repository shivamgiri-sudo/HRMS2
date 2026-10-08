/** The one-person view used inside the drill drawer and by the Risk board drawer. */
import { CalendarX2, CheckSquare, ExternalLink, Flag } from "lucide-react";
import { Link } from "react-router-dom";
import { pct } from "@/components/analytics/analytics-kit";
import { RaiseExitButton } from "@/components/exit/RaiseExitButton";
import { useHubEmployee } from "./api";
import { ErrorCard, GROUP_COLOR, MiniBar, ScoreGauge, Shimmer, TierChip, fmtAon, fmtDate } from "./charts";
import FollowupPanel from "./FollowupPanel";
import { FACTOR_GROUPS, type DrillRow } from "./types";

const H = "mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500";

/** Facts for someone who has already left (no risk score to show). */
export function ExitFacts({ row }: { row: DrillRow }) {
  const facts: [string, string][] = [
    ["Joined", fmtDate(row.joinDate)],
    ["Left on", fmtDate(row.exitDate)],
    ["Tenure", row.tenureDays != null ? fmtAon(row.tenureDays) : fmtAon(row.aonDays)],
    ["Exit type", row.exitType || "Not recorded"],
    ["Reason", row.reason || "Not recorded"],
    ["Branch", row.branch || "-"],
    ["Process", row.process || "-"],
    ["Manager", row.manager || "-"],
    ["Designation", row.designation || "-"],
  ];
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Exit facts">
        <h4 className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500"><CalendarX2 className="h-3.5 w-3.5" aria-hidden /> Exit facts</h4>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {facts.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 border-b border-slate-50 pb-1.5 text-xs">
              <dt className="text-slate-500">{k}</dt><dd className="min-w-0 truncate text-right font-semibold text-slate-900" title={v}>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <Link to={`/employees/${row.employeeId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[#2a78d6] hover:underline">
        Open employee profile <ExternalLink className="h-3 w-3" aria-hidden />
      </Link>
    </div>
  );
}

/** Risk detail for someone still employed + follow-up panel + raise-exit. `fallback` fills the header while loading. */
export function RiskDetail({ employeeId, fallback }: { employeeId: string; fallback?: DrillRow | null }) {
  const q = useHubEmployee(employeeId);
  const r = q.data?.row;
  const name = r?.name ?? fallback?.name ?? "Employee";
  return (
    <div className="space-y-6">
      {q.isLoading && <div className="space-y-3" aria-busy="true"><Shimmer className="mx-auto h-20 w-36" /><Shimmer className="h-24" /><Shimmer className="h-32" /></div>}
      {q.error && <ErrorCard what="this person's risk" error={q.error} onRetry={() => q.refetch()} />}
      {r && q.data && (
        <>
          <section className="flex flex-col items-center gap-2 text-center">
            <ScoreGauge score={r.score} tier={r.tier} />
            <div className="flex flex-wrap items-center justify-center gap-2">
              <TierChip tier={r.tier} />
              <span className="text-xs tabular-nums text-slate-600">
                {r.probability30 === null ? "30-day chance: n/a (too few past cases)" : `~${pct(r.probability30 * 100)} chance of leaving in 30 days`}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">{fmtAon(r.aonDays)} with the company{r.manager ? ` · reports to ${r.manager}` : ""}</p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link to={`/employees/${employeeId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[#2a78d6] hover:underline">
                Open employee profile <ExternalLink className="h-3 w-3" aria-hidden />
              </Link>
              <RaiseExitButton employee={{ id: employeeId, name, code: r.code, process: r.process, branch: r.branch, reportingManager: r.manager }} />
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-6">
              <section aria-label="Score by group">
                <h4 className={H}>Score by signal group</h4>
                <ul className="space-y-2.5">
                  {FACTOR_GROUPS.map(g => {
                    const v = r.factors[g.key] ?? 0;
                    return (
                      <li key={g.key}>
                        <div className="mb-1 flex items-baseline justify-between text-xs">
                          <span className="flex items-center gap-1.5 font-semibold text-slate-700"><span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: GROUP_COLOR[g.key] }} />{g.label}</span>
                          <span className="tabular-nums text-slate-500"><strong className="text-slate-900">{v.toFixed(0)}</strong> / {g.max}</span>
                        </div>
                        <MiniBar value={v} max={g.max} color={GROUP_COLOR[g.key]} height={8} label={`${g.label}: ${v.toFixed(0)} of ${g.max} points`} />
                      </li>
                    );
                  })}
                </ul>
              </section>
              <section aria-label="Reasons">
                <h4 className={H}>Why the score is what it is</h4>
                {r.reasons.length === 0 ? <p className="text-xs text-slate-500">No signals pushed this score up.</p> : (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {r.reasons.map(x => (
                      <li key={x.label} className="flex items-start gap-3 p-2.5">
                        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: GROUP_COLOR[x.group] }} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-slate-800">{x.label}</div>
                          <div className="text-[11px] leading-snug text-slate-500">{x.detail}</div>
                        </div>
                        <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-slate-700">+{x.points.toFixed(0)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
            <div className="space-y-6">
              <section aria-label="Signals">
                <h4 className={H}>Signals checked</h4>
                <ul className="space-y-1">
                  {q.data.signals.map(s => (
                    <li key={s.label} className={`flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-xs ${s.flag ? "border border-rose-200 bg-rose-50 text-rose-900" : "text-slate-600"}`}>
                      <span className="flex items-center gap-1.5">{s.flag && <Flag className="h-3 w-3 shrink-0 text-rose-600" aria-label="Flagged" />}{s.label}</span>
                      <span className={`text-right tabular-nums ${s.flag ? "font-bold" : "font-medium text-slate-800"}`}>{s.value}</span>
                    </li>
                  ))}
                </ul>
              </section>
              {r.actions.length > 0 && (
                <section aria-label="Suggested actions">
                  <h4 className={H}>Suggested next steps</h4>
                  <ul className="space-y-1.5">
                    {r.actions.map(a => (
                      <li key={a} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 text-xs text-slate-700">
                        <CheckSquare className="mt-px h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />{a}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        </>
      )}
      <FollowupPanel employeeId={employeeId} />
    </div>
  );
}
