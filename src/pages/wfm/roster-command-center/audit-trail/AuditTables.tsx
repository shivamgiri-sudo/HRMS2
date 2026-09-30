import { useMemo, useState } from "react";
import { StatusPill } from "@/components/wfm/console/StatusPill";
import {
  changeTypeTone, fmtDate, fmtDateTime, fmtDuration, fmtNum, fmtWeek, runStatusTone, sortBy,
  type AuditTrail, type GenerationRun, type SortDir,
} from "./auditModel";
import { SortTh, StaticTh } from "./tableParts";

const rowCls = "cursor-pointer border-b border-border last:border-0 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const td = "px-3 py-2 align-middle text-sm text-slate-800";

const onKey = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } };

type TrailSort = "date" | "employee" | "type" | "changedBy" | "timestamp";

/** Audit trail rows (one server page). Sorting orders the rows on the current page. */
export function TrailsTable({ rows, onOpen }: { rows: AuditTrail[]; onOpen: (id: string) => void }) {
  const [sort, setSort] = useState<{ k: TrailSort; dir: SortDir }>({ k: "timestamp", dir: "desc" });
  const sorted = useMemo(() => {
    const get: Record<TrailSort, (r: AuditTrail) => string> = {
      date: (r) => r.date, employee: (r) => r.employee.name ?? "", type: (r) => r.changeType, changedBy: (r) => r.changedBy, timestamp: (r) => r.timestamp,
    };
    return sortBy(rows, get[sort.k], sort.dir);
  }, [rows, sort]);
  const onSort = (k: TrailSort) => setSort((s) => (s.k === k ? { k, dir: s.dir === "asc" ? "desc" : "asc" } : { k, dir: k === "timestamp" || k === "date" ? "desc" : "asc" }));
  return (
    <div className="max-h-[560px] overflow-auto">
      <table className="w-full min-w-[900px] border-collapse">
        <caption className="sr-only">Roster audit trail entries. Select a row to open its full record.</caption>
        <thead>
          <tr>
            <SortTh label="Roster date" k="date" sortKey={sort.k} dir={sort.dir} onSort={onSort} />
            <SortTh label="Employee" k="employee" sortKey={sort.k} dir={sort.dir} onSort={onSort} />
            <SortTh label="Change" k="type" sortKey={sort.k} dir={sort.dir} onSort={onSort} />
            <StaticTh label="Reason" />
            <StaticTh label="Process / branch" />
            <SortTh label="Changed by" k="changedBy" sortKey={sort.k} dir={sort.dir} onSort={onSort} />
            <SortTh label="Recorded" k="timestamp" sortKey={sort.k} dir={sort.dir} onSort={onSort} right />
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <tr key={t.id} tabIndex={0} className={rowCls} onClick={() => onOpen(t.id)} onKeyDown={onKey(() => onOpen(t.id))} aria-label={`${t.changeType} for ${t.employee.name ?? "unknown employee"} on ${fmtDate(t.date)}`}>
              <td className={`${td} whitespace-nowrap tabular-nums`}>{fmtDate(t.date)}</td>
              <td className={td}>
                <div className="font-medium text-slate-900">{t.employee.name ?? "—"}</div>
                <div className="text-xs tabular-nums text-slate-600">{t.employee.code ?? "—"}</div>
              </td>
              <td className={td}><StatusPill tone={changeTypeTone(t.changeTypeCode)}>{t.changeType}</StatusPill></td>
              <td className={`${td} max-w-[240px]`}><p className="truncate" title={t.reason}>{t.reason}</p></td>
              <td className={td}>
                <div className="truncate">{t.processName ?? "—"}</div>
                <div className="truncate text-xs text-slate-600">{t.branchName ?? "—"}</div>
              </td>
              <td className={td}>
                <span className="truncate">{t.changedBy}</span>
                {t.isOverride && <span className="ml-1 text-[11px] font-semibold text-violet-800">(manual)</span>}
              </td>
              <td className={`${td} whitespace-nowrap text-right tabular-nums text-slate-700`}>{fmtDateTime(t.timestamp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type RunSort = "startedAt" | "process" | "type" | "status" | "employees" | "assignments" | "weekoffs" | "conflicts" | "duration";

export function RunsTable({ rows, onOpen }: { rows: GenerationRun[]; onOpen: (id: string) => void }) {
  const [sort, setSort] = useState<{ k: RunSort; dir: SortDir }>({ k: "startedAt", dir: "desc" });
  const sorted = useMemo(() => {
    const get: Record<RunSort, (r: GenerationRun) => string | number | null> = {
      startedAt: (r) => r.startedAt, process: (r) => r.processName ?? "", type: (r) => r.runType, status: (r) => r.status,
      employees: (r) => r.stats.employeesProcessed, assignments: (r) => r.stats.assignmentsCreated, weekoffs: (r) => r.stats.weekoffsAllocated,
      conflicts: (r) => r.stats.conflictsFound, duration: (r) => r.duration,
    };
    return sortBy(rows, get[sort.k], sort.dir);
  }, [rows, sort]);
  const onSort = (k: RunSort) => setSort((s) => (s.k === k ? { k, dir: s.dir === "asc" ? "desc" : "asc" } : { k, dir: ["process", "type", "status"].includes(k) ? "asc" : "desc" }));
  return (
    <div className="max-h-[560px] overflow-auto">
      <table className="w-full min-w-[980px] border-collapse">
        <caption className="sr-only">Roster generation runs. Select a row to open the full run record.</caption>
        <thead>
          <tr>
            <SortTh label="Started" k="startedAt" sortKey={sort.k} dir={sort.dir} onSort={onSort} />
            <SortTh label="Process / branch" k="process" sortKey={sort.k} dir={sort.dir} onSort={onSort} />
            <StaticTh label="Roster week" />
            <SortTh label="Type" k="type" sortKey={sort.k} dir={sort.dir} onSort={onSort} />
            <SortTh label="Status" k="status" sortKey={sort.k} dir={sort.dir} onSort={onSort} />
            <SortTh label="Employees" k="employees" sortKey={sort.k} dir={sort.dir} onSort={onSort} right />
            <SortTh label="Assignments" k="assignments" sortKey={sort.k} dir={sort.dir} onSort={onSort} right />
            <SortTh label="Week-offs" k="weekoffs" sortKey={sort.k} dir={sort.dir} onSort={onSort} right />
            <SortTh label="Conflicts" k="conflicts" sortKey={sort.k} dir={sort.dir} onSort={onSort} right />
            <SortTh label="Duration" k="duration" sortKey={sort.k} dir={sort.dir} onSort={onSort} right />
            <StaticTh label="Triggered by" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} tabIndex={0} className={rowCls} onClick={() => onOpen(r.id)} onKeyDown={onKey(() => onOpen(r.id))} aria-label={`Generation run ${r.status}, ${r.processName ?? "all processes"}, started ${fmtDateTime(r.startedAt)}`}>
              <td className={`${td} whitespace-nowrap tabular-nums`}>{fmtDateTime(r.startedAt)}</td>
              <td className={td}>
                <div className="truncate font-medium text-slate-900">{r.processName ?? "All processes"}</div>
                <div className="truncate text-xs text-slate-600">{r.branchName ?? "All branches"}</div>
              </td>
              <td className={`${td} whitespace-nowrap text-xs tabular-nums`}>{fmtWeek(r.weekStart, r.weekEnd)}</td>
              <td className={td}><StatusPill tone={r.runType === "auto" ? "blue" : "violet"} dot={false}>{r.runType.replace(/_/g, " ")}</StatusPill></td>
              <td className={td}><StatusPill tone={runStatusTone(r.status)}>{r.status}</StatusPill></td>
              <td className={`${td} text-right tabular-nums`}>{fmtNum(r.stats.employeesProcessed)}</td>
              <td className={`${td} text-right tabular-nums`}>{fmtNum(r.stats.assignmentsCreated)}</td>
              <td className={`${td} text-right tabular-nums`}>{fmtNum(r.stats.weekoffsAllocated)}</td>
              <td className={`${td} text-right tabular-nums ${r.stats.conflictsFound > 0 ? "font-semibold text-red-800" : ""}`}>{fmtNum(r.stats.conflictsFound)}</td>
              <td className={`${td} text-right tabular-nums`}>{r.status === "running" && r.duration === null ? "Running" : fmtDuration(r.duration)}</td>
              <td className={td}><span className="truncate">{r.triggeredBy}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
