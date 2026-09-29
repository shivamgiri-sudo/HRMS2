import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useOpsAgentDays, useOpsEmployee, type AgentDay } from "./useOpsCommand";
import { fmtDate, formatMetric, type OpsQuery } from "./opsTypes";

const STATUS_BG: Record<string, string> = {
  present: "bg-emerald-500", week_off_worked: "bg-emerald-400", half_day: "bg-amber-400", absent: "bg-rose-500",
  leave_approved: "bg-sky-500", holiday: "bg-violet-400", week_off: "bg-slate-300 dark:bg-slate-600",
  missing_punch: "bg-orange-500", unreconciled: "bg-slate-400",
};

const SECTION = "text-xs font-bold uppercase tracking-wide text-slate-400";

function Section({ title, children, empty }: { title: string; children?: React.ReactNode; empty?: boolean }) {
  return (
    <section className="mt-6">
      <h3 className={SECTION}>{title}</h3>
      <div className="mt-2">{empty ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">None</p> : children}</div>
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function statusLabel(s: string) { return s.replace(/_/g, " "); }

function DayStrip({ days }: { days: AgentDay[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {days.map((d) => {
        const st = d.attendance?.status ?? (d.roster?.type === "WEEK_OFF" ? "week_off" : null);
        return (
          <Tooltip key={d.date}>
            <TooltipTrigger asChild>
              <span className={cn("relative h-6 w-6 rounded-sm text-center text-[9px] leading-6 text-white", st ? STATUS_BG[st] ?? "bg-slate-400" : "bg-muted text-muted-foreground")}>
                {d.date.slice(8)}
                {d.attendance?.late && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-300 ring-1 ring-white" />}
              </span>
            </TooltipTrigger>
            <TooltipContent className="text-xs">{fmtDate(d.date)} {d.weekday} · {st ? statusLabel(st) : "no record"}{d.flags.length ? ` · ${d.flags.join(", ")}` : ""}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

interface Props { query: OpsQuery; employeeId: string | null; onClose: () => void }

/** Agent 360: profile, day-by-day roster-vs-actual timeline, calls/KPIs/audits, conduct, exit and learning. */
export function OpsEmployeeSheet({ query, employeeId, onClose }: Props) {
  const detail = useOpsEmployee(query, employeeId);
  const days = useOpsAgentDays(query, employeeId);
  const p = detail.data?.profile;
  const d = days.data;
  const kpiCols = (d?.kpiMetrics ?? []).slice(0, 3);

  return (
    <Sheet open={!!employeeId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl lg:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {p ? String(p.full_name ?? "").trim() || String(p.employee_code) : "Loading…"}
            {p && <Badge variant={p.active_status === 1 ? "default" : "secondary"}>{String(p.employment_status ?? (p.active_status === 1 ? "active" : "inactive"))}</Badge>}
          </SheetTitle>
          <SheetDescription>
            {p ? `${p.employee_code} · ${p.process_name ?? "No process"} · ${p.branch_name ?? "No branch"} · Reports to ${p.manager_name ?? "—"}` : ""}
          </SheetDescription>
        </SheetHeader>

        {(detail.isLoading || days.isLoading) && <div className="mt-6 h-40 animate-pulse rounded bg-muted" />}
        {(detail.isError || days.isError) && <p className="mt-6 text-sm text-rose-600">Could not load this employee. They may be outside your scope.</p>}

        {p && (
          <Section title="Profile">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              {([
                ["Designation", p.designation], ["Type", p.employment_type], ["LOB", p.lob_name],
                ["Joined", fmtDate(p.date_of_joining as string)], ["Exit date", p.exit_date ? fmtDate(p.exit_date as string) : "—"], ["Manager code", p.manager_code],
              ] as Array<[string, unknown]>).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium">{(v as string) || "—"}</dd></div>
              ))}
            </dl>
          </Section>
        )}

        {d && (
          <>
            <Section title={`Period summary · ${fmtDate(d.from)} – ${fmtDate(d.to)}`}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Tile label="Rostered days" value={String(d.summary.rosteredDays)} />
                <Tile label="Days worked" value={String(d.summary.workedDays)} />
                <Tile label="Rostered no-shows" value={String(d.summary.noShows)} />
                <Tile label="Late days" value={String(d.summary.lateDays)} />
                <Tile label="Avg login" value={formatMetric(d.summary.avgLoginHours, "hours")} />
                <Tile label="Avg break" value={formatMetric(d.summary.avgBreakMinutes, "minutes")} />
                <Tile label="Calls" value={d.sources.calls ? formatMetric(d.summary.totalCalls, "count") : "n/a"} />
                <Tile label="Avg audit score" value={formatMetric(d.summary.avgAudit, "pct")} />
              </div>
            </Section>

            <Section title="Attendance calendar" empty={!d.days.length}>
              <DayStrip days={d.days} />
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                {["present", "half_day", "absent", "leave_approved", "missing_punch", "week_off"].map((s) => (
                  <span key={s} className="inline-flex items-center gap-1"><span className={cn("h-2.5 w-2.5 rounded-sm", STATUS_BG[s])} />{statusLabel(s)}</span>
                ))}
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-300" />late</span>
              </div>
            </Section>

            <Section title="Day by day — roster vs actual" empty={!d.days.length}>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[720px] text-xs">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-2">Date</th><th className="px-2 py-2">Roster</th><th className="px-2 py-2">Attendance</th>
                      <th className="px-2 py-2 text-right">Login</th><th className="px-2 py-2 text-right">Break</th>
                      {d.sources.calls && <th className="px-2 py-2 text-right">Calls</th>}
                      {kpiCols.map((k) => <th key={k.code} className="px-2 py-2 text-right" title={k.name}>{k.name.slice(0, 14)}</th>)}
                      <th className="px-2 py-2 text-right">Audit</th><th className="px-2 py-2">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...d.days].reverse().map((r) => {
                      const audit = r.callAudit?.avg ?? r.audit?.avg ?? null;
                      return (
                        <tr key={r.date} className={cn("border-b", r.flags.length && "bg-rose-500/5")}>
                          <td className="whitespace-nowrap px-2 py-1.5 font-medium">{fmtDate(r.date)} <span className="text-muted-foreground">{r.weekday}</span></td>
                          <td className="whitespace-nowrap px-2 py-1.5">{r.roster ? (r.roster.start ? `${r.roster.start}–${r.roster.end}` : statusLabel(r.roster.type.toLowerCase())) : "—"}</td>
                          <td className="whitespace-nowrap px-2 py-1.5">
                            {r.attendance ? <><span className={cn("mr-1 inline-block h-2 w-2 rounded-full", STATUS_BG[r.attendance.status] ?? "bg-slate-400")} />{statusLabel(r.attendance.status)}{r.attendance.clockIn ? ` · ${r.attendance.clockIn}${r.attendance.clockOut ? `–${r.attendance.clockOut}` : ""}` : ""}</> : "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{r.attendance?.minutes ? `${Math.round((r.attendance.minutes / 60) * 10) / 10} h` : "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{r.breakMinutes ? `${Math.round(r.breakMinutes)}m` : "—"}</td>
                          {d.sources.calls && <td className="px-2 py-1.5 text-right tabular-nums">{r.calls ?? "—"}</td>}
                          {kpiCols.map((k) => <td key={k.code} className="px-2 py-1.5 text-right tabular-nums">{formatMetric(r.kpis[k.code] ?? null, "count")}</td>)}
                          <td className="px-2 py-1.5 text-right tabular-nums">{audit === null ? "—" : `${Math.round(audit * 10) / 10}%`}</td>
                          <td className="px-2 py-1.5 text-rose-600">{r.flags.join(" · ")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {(!d.sources.calls || !d.sources.callAudit) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {!d.sources.calls && "Call volumes unavailable right now. "}{!d.sources.callAudit && "External call-quality feed unavailable right now."}
                </p>
              )}
            </Section>
          </>
        )}

        {detail.data && (
          <>
            <Section title="Exit / resignation" empty={!detail.data.exits.length}>
              {detail.data.exits.map((x, i) => (
                <p key={i} className="text-sm">{String(x.status)} · {String(x.exit_type ?? "")}{x.exit_reason_category ? ` · ${x.exit_reason_category}` : ""} · LWD {fmtDate(x.lwd as string)} · notice {String(x.notice_period_days ?? 0)}d</p>
              ))}
            </Section>
            <Section title="Warnings" empty={!detail.data.warnings.length}>
              {detail.data.warnings.map((w, i) => <p key={i} className="text-sm">{fmtDate(w.date as string)} · {String(w.category)} · {String(w.severity)} · {String(w.status)}</p>)}
            </Section>
            <Section title="Performance improvement plans" empty={!detail.data.pips.length}>
              {detail.data.pips.map((w, i) => <p key={i} className="text-sm">{String(w.status)} · {fmtDate(w.start_date as string)} → {fmtDate(w.end_date as string)} · {String(w.reason ?? "")}</p>)}
            </Section>
            <Section title="Training (LMS)" empty={!detail.data.learning.length}>
              {detail.data.learning.map((w, i) => <p key={i} className="text-sm">{String(w.batch_name ?? "Batch")} · MCQ {formatMetric(w.mcq_best_score === null ? null : Number(w.mcq_best_score), "pct")} · readiness {formatMetric(w.readiness_score === null ? null : Number(w.readiness_score), "pct")} · risk {String(w.attrition_risk_signal ?? "—")}</p>)}
            </Section>
            <Section title="Recent manual audits" empty={!detail.data.audits.length}>
              {detail.data.audits.map((w, i) => <p key={i} className="text-sm">{fmtDate(w.date as string)} · {formatMetric(Number(w.quality_percentage), "pct")}{w.fatal_triggered ? " · FATAL" : ""} · {String(w.status)}</p>)}
            </Section>
            <Section title="KPI averages (last 30 days)" empty={!detail.data.kpis.length}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {detail.data.kpis.map((k, i) => <Tile key={i} label={String(k.metric_name)} value={formatMetric(Number(k.avg_value), "count")} />)}
              </div>
            </Section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
