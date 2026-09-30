import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { HEAVY_QUERY_OPTIONS, HEAVY_QUERY_TIMEOUT_MS } from "../heavyQuery";

import { DetailDrawer, DrawerSection, FieldGrid } from "@/components/wfm/console/DetailDrawer";
import { StatusPill } from "@/components/wfm/console/StatusPill";
import { DataTable, type Column } from "./DataTable";
import { Caveat, NoneNote, QueryBody } from "./shared";
import { useTrends, withParam } from "./useTrendsQuery";
import { cycleTone, fmtDate, fmtDateTime, fmtNum, fmtPct, stageLabel, stageTone, titleCase } from "./trendsCalc";
import type { Funnel } from "./trendsTypes";

export type StageTarget = { status: string; week?: string; title?: string };

interface StageDetail {
  status: string; week: string | null; from: string; to: string; count: number; employees: number;
  byStage: Array<{ status: string; count: number }>;
  byProcess: Array<{ name: string; count: number }>;
  byWeek: Array<{ week: string; count: number }>;
  sampleTruncated: boolean;
  sample: Array<{
    date: string; stage: string; employeeCode: string; employeeName: string; processName: string | null; assignmentType: string | null;
    ackStatus: string | null; ackAt: string | null; rejectionReason: string | null;
    managerAction: string | null; managerActionBy: string | null; managerActionAt: string | null; managerActionReason: string | null;
  }>;
}

type Sample = StageDetail["sample"][number];
const sampleCols: Column<Sample>[] = [
  { key: "emp", header: "Employee", sortValue: (r) => r.employeeName, render: (r) => <span className="font-medium">{r.employeeName} <span className="font-normal text-slate-500">({r.employeeCode})</span></span> },
  { key: "date", header: "Roster date", sortValue: (r) => r.date, render: (r) => fmtDate(r.date) },
  { key: "proc", header: "Process", render: (r) => r.processName ?? "—" },
  { key: "ack", header: "Employee response", render: (r) => (r.stage === "generated" ? "Not published" : r.ackStatus ? `${titleCase(r.ackStatus)}${r.ackAt ? ` · ${fmtDateTime(r.ackAt)}` : ""}` : "—") },
  { key: "mgr", header: "Manager action", render: (r) => (r.managerAction ? `${titleCase(r.managerAction)}${r.managerActionBy ? ` · ${r.managerActionBy}` : ""}${r.managerActionAt ? ` · ${fmtDateTime(r.managerActionAt)}` : ""}` : "—") },
  { key: "why", header: "Reason", className: "max-w-[260px] whitespace-normal", render: (r) => r.managerActionReason ?? r.rejectionReason ?? "—" },
];

const simpleCols = (label: string): Column<{ name: string; count: number }>[] => [
  { key: "n", header: label, sortValue: (r) => r.name, render: (r) => r.name },
  { key: "c", header: "Assignments", align: "right", sortValue: (r) => r.count, render: (r) => fmtNum(r.count) },
];

export function StageDrawer({ target, qs, onClose }: { target: StageTarget | null; qs: string; onClose: () => void }) {
  let q2 = withParam(qs, "status", target?.status ?? "all");
  if (target?.week) q2 = withParam(q2, "week", target.week);
  const q = useTrends<StageDetail>("stage", "publish/stage", q2, !!target);
  const all = target?.status === "all";
  return (
    <DetailDrawer
      open={!!target} onOpenChange={(o) => !o && onClose()}
      title={target?.title ?? (all ? "All stages" : stageLabel(target?.status ?? ""))}
      subtitle="Roster assignments in the selected scope"
      badge={target && !all ? <StatusPill tone={stageTone(target.status)}>{stageLabel(target.status)}</StatusPill> : undefined}
    >
      {target && (
        <QueryBody query={q}>
          {(d) => (
            <>
              <DrawerSection label="Full record">
                <FieldGrid fields={[
                  ["Window", `${fmtDate(d.from)} to ${fmtDate(d.to)}`], ["Assignments", fmtNum(d.count)], ["Employees", fmtNum(d.employees)],
                  ["Stage", all ? "All stages" : stageLabel(d.status)],
                ]} />
              </DrawerSection>
              <DrawerSection label="Stage mix">
                {d.byStage.length ? (
                  <ul className="flex flex-wrap gap-2">{d.byStage.map((s) => <li key={s.status}><StatusPill tone={stageTone(s.status)}>{stageLabel(s.status)}: {fmtNum(s.count)}</StatusPill></li>)}</ul>
                ) : undefined}
              </DrawerSection>
              <DrawerSection label="By process">
                {d.byProcess.length ? <DataTable rows={d.byProcess} columns={simpleCols("Process")} rowKey={(r) => r.name} ariaLabel="Assignments by process" maxHeight={240} defaultSort={{ key: "c", dir: "desc" }} /> : undefined}
              </DrawerSection>
              <DrawerSection label="Trend by week">
                {d.byWeek.length ? <DataTable rows={d.byWeek} columns={[{ key: "w", header: "Week of", render: (r) => fmtDate(r.week) }, { key: "c", header: "Assignments", align: "right", render: (r) => fmtNum(r.count) }]} rowKey={(r) => r.week} ariaLabel="Assignments by week" maxHeight={200} /> : undefined}
              </DrawerSection>
              <DrawerSection label="Timeline — employee and manager decisions (with reasons)">
                {d.sample.length ? (
                  <>
                    <DataTable rows={d.sample} columns={sampleCols} rowKey={(r) => `${r.employeeCode}-${r.date}`} ariaLabel="Assignment decisions" maxHeight={340} />
                    {d.sampleTruncated && <Caveat>Showing the 50 most recently actioned of {fmtNum(d.count)} assignments.</Caveat>}
                  </>
                ) : undefined}
              </DrawerSection>
              <DrawerSection label="Audit trail"><NoneNote>None at stage level. Open a roster cycle below for its change log and audit entries.</NoneNote></DrawerSection>
            </>
          )}
        </QueryBody>
      )}
    </DetailDrawer>
  );
}

/* ── Cycle drawer ──────────────────────────────────────────────────────────── */

interface CycleDetail {
  id: string; status: string; processName: string | null; branchName: string | null; weekStart: string; weekEnd: string;
  createdAt: string | null; createdBy: string | null; publishedAt: string | null; publishedBy: string | null;
  ackDeadline: string | null; lockedAt: string | null; payrollReadyAt: string | null;
  funnel: Funnel; byStage: Array<{ status: string; count: number }>;
  changes: Array<{ type: string; reason: string | null; changeDate: string | null; at: string | null; actor: string }>;
  audit: Array<{ action: string; module: string; at: string | null; actor: string }>;
}

export function CycleDrawer({ cycleId, onClose }: { cycleId: string | null; onClose: () => void }) {
  const q = useQueryCycle(cycleId);
  return (
    <DetailDrawer open={!!cycleId} onOpenChange={(o) => !o && onClose()}
      title={q.data ? `${q.data.processName ?? "Roster cycle"} — week of ${fmtDate(q.data.weekStart)}` : "Roster cycle"}
      subtitle={cycleId ?? undefined} badge={q.data ? <StatusPill tone={cycleTone(q.data.status)}>{titleCase(q.data.status)}</StatusPill> : undefined}>
      {cycleId && (
        <QueryBody query={q}>
          {(d) => (
            <>
              <DrawerSection label="Full record">
                <FieldGrid fields={[
                  ["Process", d.processName], ["Branch", d.branchName], ["Week", `${fmtDate(d.weekStart)} to ${fmtDate(d.weekEnd)}`], ["Status", titleCase(d.status)],
                  ["Created", `${fmtDateTime(d.createdAt)}${d.createdBy ? ` by ${d.createdBy}` : ""}`],
                  ["Published", d.publishedAt ? `${fmtDateTime(d.publishedAt)}${d.publishedBy ? ` by ${d.publishedBy}` : ""}` : "Not published"],
                  ["Acknowledgement deadline", fmtDateTime(d.ackDeadline)], ["Attendance locked", fmtDateTime(d.lockedAt)], ["Payroll input ready", fmtDateTime(d.payrollReadyAt)],
                ]} />
              </DrawerSection>
              <DrawerSection label="Assignments by stage">
                {d.byStage.length ? (
                  <>
                    <FieldGrid fields={[["Published", fmtPct(d.funnel.publishedPct)], ["Acknowledged of published", fmtPct(d.funnel.ackPctOfPublished)], ["Awaiting acknowledgement", fmtNum(d.funnel.awaitingAck)], ["Disputed", fmtNum(d.funnel.disputed)]]} />
                    <ul className="mt-2 flex flex-wrap gap-2">{d.byStage.map((s) => <li key={s.status}><StatusPill tone={stageTone(s.status)}>{stageLabel(s.status)}: {fmtNum(s.count)}</StatusPill></li>)}</ul>
                  </>
                ) : <NoneNote>No assignments linked to this cycle</NoneNote>}
              </DrawerSection>
              <DrawerSection label="Change log — post-publication changes need a reason">
                {d.changes.length ? (
                  <DataTable rows={d.changes} rowKey={(r) => `${r.at}-${r.type}-${r.actor}`} ariaLabel="Roster change log" maxHeight={260}
                    columns={[
                      { key: "at", header: "When", render: (r) => fmtDateTime(r.at) }, { key: "who", header: "Actor", render: (r) => r.actor },
                      { key: "type", header: "Change", render: (r) => titleCase(r.type) },
                      { key: "why", header: "Reason", className: "max-w-[260px] whitespace-normal", render: (r) => r.reason ?? "No reason recorded" },
                    ]} />
                ) : undefined}
              </DrawerSection>
              <DrawerSection label="Audit trail">
                {d.audit.length ? (
                  <DataTable rows={d.audit} rowKey={(r) => `${r.at}-${r.action}`} ariaLabel="Audit entries" maxHeight={220}
                    columns={[{ key: "at", header: "When", render: (r) => fmtDateTime(r.at) }, { key: "who", header: "Actor", render: (r) => r.actor }, { key: "a", header: "Action", render: (r) => r.action }, { key: "m", header: "Module", render: (r) => r.module }]} />
                ) : undefined}
              </DrawerSection>
            </>
          )}
        </QueryBody>
      )}
    </DetailDrawer>
  );
}

function useQueryCycle(cycleId: string | null) {
  return useQuery<CycleDetail>({
    queryKey: ["rcc-trends", "cycle", cycleId],
    queryFn: ({ signal }) => hrmsApi.get<CycleDetail>(`/api/roster-analytics/trends/publish/cycle/${cycleId}`, HEAVY_QUERY_TIMEOUT_MS, signal),
    enabled: !!cycleId,
    ...HEAVY_QUERY_OPTIONS,
  });
}
