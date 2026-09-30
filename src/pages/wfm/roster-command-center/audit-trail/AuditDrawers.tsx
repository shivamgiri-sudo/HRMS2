import { useQuery } from "@tanstack/react-query";
import { keepPreviousData } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { DetailDrawer, DrawerSection, FieldGrid } from "@/components/wfm/console/DetailDrawer";
import { StatusPill } from "@/components/wfm/console/StatusPill";
import { Sparkline } from "@/components/wfm/console/Sparkline";
import { hrmsApi as api } from "@/lib/hrmsApi";
import {
  changeTypeTone, fmtDate, fmtDateTime, fmtDuration, fmtNum, fmtWeek, runStatusTone,
  type AuditTrail, type AuditTrailDetail, type DayPoint, type RunDetail, type TimelineEntry, type TrailsResponse,
} from "./auditModel";

const DRAWER_QUERY = { staleTime: 60_000, retry: false, refetchOnWindowFocus: false } as const;

function DrawerSkeleton({ label }: { label: string }) {
  return (
    <div className="animate-pulse space-y-3 motion-reduce:animate-none" role="status" aria-label={label}>
      {[70, 90, 55, 80].map((w, i) => <div key={i} className="h-5 rounded bg-slate-100" style={{ width: `${w}%` }} />)}
    </div>
  );
}

function DrawerError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
      <span className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4" aria-hidden />Could not load {what}.</span>
      <button type="button" onClick={onRetry} className="min-h-[44px] cursor-pointer rounded-md border border-amber-300 px-3 text-xs font-medium hover:bg-amber-100 sm:min-h-[32px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Retry</button>
    </div>
  );
}

function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (!entries.length) return null;
  return (
    <ol className="space-y-3 border-l-2 border-slate-200 pl-4">
      {entries.map((t, i) => (
        <li key={`${t.event}-${i}`} className="relative">
          <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-slate-400" aria-hidden />
          <p className="text-sm font-medium text-slate-900">{t.event}{t.decision ? <span className="font-normal text-slate-600"> - {t.decision}</span> : null}</p>
          <p className="text-xs tabular-nums text-slate-600">{fmtDateTime(t.at)} · {t.actor}</p>
          {t.remarks && <p className="mt-0.5 text-xs text-slate-700">{t.remarks}</p>}
        </li>
      ))}
    </ol>
  );
}

function Trend({ points, label }: { points: DayPoint[]; label: string }) {
  if (points.length < 2) return <p className="text-sm text-slate-500">None</p>;
  const total = points.reduce((s, p) => s + p.total, 0);
  return (
    <div className="flex items-center gap-4">
      <Sparkline values={points.map((p) => p.total)} width={280} height={56} ariaLabel={label} className="text-blue-800" />
      <p className="text-xs text-slate-600"><span className="font-semibold tabular-nums text-slate-900">{fmtNum(total)}</span> changes over {points.length} days<br />{fmtDate(points[0].date)} - {fmtDate(points[points.length - 1].date)}</p>
    </div>
  );
}

const json = (v: unknown) => (v === null || v === undefined ? null : <pre className="max-h-40 overflow-auto rounded-md bg-slate-50 p-2 text-[11px] text-slate-800">{typeof v === "string" ? v : JSON.stringify(v, null, 2)}</pre>);

export function TrailDrawer({ id, onClose, onOpenRun }: { id: string | null; onClose: () => void; onOpenRun: (runId: string) => void }) {
  const q = useQuery({
    queryKey: ["roster-audit-trail-detail", id],
    queryFn: async () => (await api.get(`/api/roster-audit/trails/${id}`)) as AuditTrailDetail,
    enabled: !!id,
    ...DRAWER_QUERY,
  });
  const d = q.data;
  return (
    <DetailDrawer
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      title="Audit entry"
      subtitle={d ? <>#{d.id} · Recorded {fmtDateTime(d.timestamp)}</> : id ? `#${id}` : undefined}
      badge={d ? <StatusPill tone={changeTypeTone(d.changeTypeCode)}>{d.changeType}</StatusPill> : undefined}
    >
      {q.isLoading ? <DrawerSkeleton label="Loading audit entry" /> : q.isError ? <DrawerError what="this audit entry" onRetry={() => q.refetch()} /> : d ? (
        <>
          <DrawerSection label="Change">
            <FieldGrid fields={[
              ["Roster date", fmtDate(d.date)], ["Decision", d.changeType], ["Reason", d.reason], ["Rule applied", d.ruleApplied],
              ["Override reason", d.overrideReason], ["Override at", d.overrideAt ? fmtDateTime(d.overrideAt) : null],
              ["Acted by role", d.actedByRole], ["Shift", d.shift ? `${d.shift.name} (${d.shift.startTime.slice(0, 5)}-${d.shift.endTime.slice(0, 5)})` : null],
            ]} />
          </DrawerSection>
          <DrawerSection label="Employee">
            <FieldGrid fields={[["Name", d.employee.name], ["Code", d.employee.code], ["Process", d.processName], ["Branch", d.branchName]]} />
          </DrawerSection>
          <DrawerSection label="Roster engine details">
            <FieldGrid fields={[
              ["Week-off day", d.engine.isWeekOff ? "Yes" : "No"], ["Preferred day", d.engine.preferredDay], ["Allocated day", d.engine.allocatedDay],
              ["Allocation sequence", d.engine.allocationSequence], ["FCFS rank", d.engine.fcfsRank], ["Fairness score", d.engine.fairnessScore],
              ["Skill check", d.engine.skillCheckResult],
            ]} />
            {(d.oldValue !== null || d.newValue !== null) && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div><p className="text-[11px] font-medium text-slate-500">Old value</p>{json(d.oldValue) ?? <p className="text-sm text-slate-500">None</p>}</div>
                <div><p className="text-[11px] font-medium text-slate-500">New value</p>{json(d.newValue) ?? <p className="text-sm text-slate-500">None</p>}</div>
              </div>
            )}
          </DrawerSection>
          <DrawerSection label="Changed by">
            <FieldGrid fields={[["Name", d.changedBy + (d.changedByCode ? ` (${d.changedByCode})` : "")]]} />
          </DrawerSection>
          <DrawerSection label="Timeline"><Timeline entries={d.timeline} /></DrawerSection>
          <DrawerSection label="Cycle and generation run">
            {d.cycle || d.run ? (
              <>
                <FieldGrid fields={[
                  ["Roster week", d.cycle ? fmtWeek(d.cycle.weekStart, d.cycle.weekEnd) : null], ["Cycle status", d.cycle?.status ?? null],
                  ["Run type", d.run?.runType ?? null], ["Run status", d.run?.status ?? null],
                ]} />
                {d.run && (
                  <button type="button" onClick={() => onOpenRun(d.run!.id)} className="mt-2 min-h-[44px] cursor-pointer rounded-md border border-border px-3 text-xs font-medium hover:bg-muted sm:min-h-[32px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Open generation run</button>
                )}
              </>
            ) : undefined}
          </DrawerSection>
          <DrawerSection label="Employee change trend (30 days before this date)"><Trend points={d.employeeTrend} label="Employee audit changes per day" /></DrawerSection>
          <DrawerSection label="Amendments for this employee in this cycle">
            {d.amendments.length ? (
              <ul className="space-y-2">
                {d.amendments.map((a) => (
                  <li key={a.id} className="rounded-md border border-border p-2 text-sm">
                    <p className="font-medium text-slate-900">{a.newAssignmentType ?? a.changeType} on {fmtDate(a.changeDate)}{a.isLateChange && <span className="ml-2"><StatusPill tone="amber">Late change{a.leadTimeHours !== null ? ` (${a.leadTimeHours}h notice)` : ""}</StatusPill></span>}</p>
                    <p className="text-xs text-slate-700">{a.reason}</p>
                    <p className="text-xs tabular-nums text-slate-600">{fmtDateTime(a.timestamp)} · {a.changedBy}</p>
                  </li>
                ))}
              </ul>
            ) : undefined}
          </DrawerSection>
          <DrawerSection label="Related changes (within 7 days, same employee)">
            {d.relatedChanges.length ? (
              <ul className="space-y-2">
                {d.relatedChanges.map((rc) => (
                  <li key={rc.id} className="border-l-2 border-slate-200 pl-3 text-sm">
                    <p className="flex justify-between gap-2"><span className="font-medium text-slate-900">{rc.changeType}</span><span className="text-xs tabular-nums text-slate-600">{fmtDate(rc.date)}</span></p>
                    <p className="text-xs text-slate-700">{rc.reason} · {rc.changedBy}</p>
                  </li>
                ))}
              </ul>
            ) : undefined}
          </DrawerSection>
        </>
      ) : null}
    </DetailDrawer>
  );
}

export function RunDrawer({ id, onClose, onOpenTrail }: { id: string | null; onClose: () => void; onOpenTrail: (trailId: string) => void }) {
  const q = useQuery({
    queryKey: ["roster-audit-run-detail", id],
    queryFn: async () => (await api.get(`/api/roster-audit/generation-runs/${id}`)) as RunDetail,
    enabled: !!id,
    ...DRAWER_QUERY,
  });
  const d = q.data;
  const errors = Array.isArray(d?.errorDetails) ? (d!.errorDetails as unknown[]).map(String) : d?.errorDetails ? [typeof d.errorDetails === "string" ? d.errorDetails : JSON.stringify(d.errorDetails)] : [];
  return (
    <DetailDrawer
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      title="Generation run"
      subtitle={d ? <>#{d.id} · Started {fmtDateTime(d.startedAt)}</> : id ? `#${id}` : undefined}
      badge={d ? <StatusPill tone={runStatusTone(d.status)}>{d.status}</StatusPill> : undefined}
    >
      {q.isLoading ? <DrawerSkeleton label="Loading generation run" /> : q.isError ? <DrawerError what="this generation run" onRetry={() => q.refetch()} /> : d ? (
        <>
          <DrawerSection label="Run">
            <FieldGrid fields={[
              ["Process", d.processName ?? "All processes"], ["Branch", d.branchName ?? "All branches"], ["Type", d.runType.replace(/_/g, " ")],
              ["Roster week", fmtWeek(d.cycle.weekStart, d.cycle.weekEnd)], ["Cycle status", d.cycle.status],
              ["Triggered by", d.triggeredBy.name + (d.triggeredBy.code ? ` (${d.triggeredBy.code})` : "")],
              ["Started", fmtDateTime(d.startedAt)], ["Completed", d.completedAt ? fmtDateTime(d.completedAt) : "Still running"], ["Duration", fmtDuration(d.duration)],
            ]} />
          </DrawerSection>
          <DrawerSection label="Stats">
            <FieldGrid fields={[
              ["Employees processed", fmtNum(d.stats.employeesProcessed)], ["Assignments created", fmtNum(d.stats.assignmentsCreated)],
              ["Week-offs allocated", fmtNum(d.stats.weekoffsAllocated)], ["Conflicts found", fmtNum(d.stats.conflictsFound)],
            ]} />
          </DrawerSection>
          <DrawerSection label="Errors and warnings">
            {errors.length ? <ul className="max-h-48 space-y-1 overflow-auto text-xs text-red-900">{errors.map((e, i) => <li key={i} className="rounded bg-red-50 px-2 py-1">{e}</li>)}</ul> : undefined}
          </DrawerSection>
          <DrawerSection label="Timeline"><Timeline entries={d.timeline} /></DrawerSection>
          <DrawerSection label="Decision breakdown (all decisions in this run)">
            {d.decisionSummary.length ? (
              <ul className="grid gap-1 sm:grid-cols-2">
                {d.decisionSummary.map((s) => (
                  <li key={s.code} className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1 text-sm">
                    <span className="text-slate-800">{s.label}</span><span className="font-semibold tabular-nums text-slate-900">{fmtNum(s.count)}</span>
                  </li>
                ))}
              </ul>
            ) : undefined}
          </DrawerSection>
          <DrawerSection label="Decisions per roster day"><Trend points={d.decisionsByDate} label="Run decisions per day" /></DrawerSection>
          <DrawerSection label={`Audit entries (latest ${d.decisions.length} of ${fmtNum(d.decisionTotal)})`}>
            {d.decisions.length ? (
              <ul className="max-h-72 space-y-1 overflow-auto">
                {d.decisions.map((x) => (
                  <li key={x.id}>
                    <button type="button" onClick={() => onOpenTrail(x.id)} className="w-full min-h-[44px] cursor-pointer rounded-md border-l-2 border-slate-200 px-3 py-1 text-left hover:bg-muted sm:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="flex justify-between gap-2 text-sm"><span className="font-medium text-slate-900">{x.changeType}</span><span className="text-xs tabular-nums text-slate-600">{fmtDate(x.date)}</span></span>
                      <span className="block text-xs text-slate-700">{x.employee.name ?? "—"} ({x.employee.code ?? "—"}) · {x.reason}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : undefined}
          </DrawerSection>
          <DrawerSection label="Other runs for this cycle">
            {d.siblingRuns.length ? (
              <ul className="space-y-1">
                {d.siblingRuns.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="tabular-nums text-slate-800">{fmtDateTime(s.startedAt)} · {s.runType.replace(/_/g, " ")}</span>
                    <span className="flex items-center gap-2"><span className="text-xs tabular-nums text-slate-600">{fmtNum(s.assignmentsCreated)} assigned · {fmtNum(s.conflictsFound)} conflicts</span><StatusPill tone={runStatusTone(s.status)}>{s.status}</StatusPill></span>
                  </li>
                ))}
              </ul>
            ) : undefined}
          </DrawerSection>
        </>
      ) : null}
    </DetailDrawer>
  );
}

export interface SegmentSpec { title: string; params: Record<string, string> }

/** Drawer opened from a KPI tile or chart segment: the latest matching audit entries, each opening the full record. */
export function SegmentDrawer({ spec, scope, onClose, onOpenTrail, onViewAll }: {
  spec: SegmentSpec | null; scope: URLSearchParams; onClose: () => void; onOpenTrail: (id: string) => void; onViewAll?: () => void;
}) {
  const q = useQuery({
    queryKey: ["roster-audit-segment", spec?.params, scope.toString()],
    queryFn: async () => {
      const p = new URLSearchParams(scope);
      Object.entries(spec!.params).forEach(([k, v]) => p.set(k, v));
      p.set("limit", "25");
      return (await api.get(`/api/roster-audit/trails?${p}`)) as TrailsResponse;
    },
    enabled: !!spec,
    placeholderData: keepPreviousData,
    ...DRAWER_QUERY,
  });
  const rows: AuditTrail[] = q.data?.trails ?? [];
  return (
    <DetailDrawer open={!!spec} onOpenChange={(o) => !o && onClose()} title={spec?.title ?? "Audit entries"} subtitle={q.data ? `${fmtNum(q.data.total)} matching entries${q.data.total > rows.length ? ` (latest ${rows.length} shown)` : ""}` : undefined}>
      {q.isLoading ? <DrawerSkeleton label="Loading audit entries" /> : q.isError ? <DrawerError what="audit entries" onRetry={() => q.refetch()} /> : (
        <>
          <DrawerSection label="Entries">
            {rows.length ? (
              <ul className="space-y-1">
                {rows.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => onOpenTrail(t.id)} className="w-full min-h-[44px] cursor-pointer rounded-md border border-border px-3 py-2 text-left hover:bg-muted sm:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-slate-900">{t.employee.name ?? "—"} <span className="text-xs font-normal tabular-nums text-slate-600">{t.employee.code}</span></span><StatusPill tone={changeTypeTone(t.changeTypeCode)}>{t.changeType}</StatusPill></span>
                      <span className="block text-xs tabular-nums text-slate-600">{fmtDate(t.date)} · {t.changedBy} · {fmtDateTime(t.timestamp)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : undefined}
          </DrawerSection>
          {onViewAll && <button type="button" onClick={onViewAll} className="min-h-[44px] cursor-pointer rounded-md border border-border px-3 text-sm font-medium hover:bg-muted sm:min-h-[32px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Show all in table</button>}
        </>
      )}
    </DetailDrawer>
  );
}
