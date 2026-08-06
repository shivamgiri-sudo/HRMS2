import { useMemo } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AttendanceCell } from "./AttendanceCell";
import type { TeamMonthDay, TeamMonthEmployee } from "@/hooks/useTeamAttendanceMonth";
import { cn } from "@/lib/utils";

/**
 * Employees down, days across.
 *
 * Frozen left columns with the date columns scrolling under them — the same technique
 * as RosterWorkspace's 7-day roster and the P&L planner grid, which are the only two
 * places in this product that do it. Fixed pixel widths on the sticky cells are not
 * cosmetic: `left` offsets must add up exactly or the frozen columns drift apart from
 * their headers when scrolled.
 *
 * A single TooltipProvider wraps the whole table. One per cell would mount thousands
 * of context providers for a normal month.
 */

const COL = { name: 200, code: 96, meta: 150, salary: 78 };
const LEFT = {
  name: 0,
  code: COL.name,
  meta: COL.name + COL.code,
  salary: COL.name + COL.code + COL.meta,
};
const FROZEN_WIDTH = LEFT.salary + COL.salary;

export function MonthGrid({
  month,
  days,
  employees,
  onCellClick,
  selectedKeys,
}: {
  month: string;
  days: number;
  employees: TeamMonthEmployee[];
  onCellClick?: (employee: TeamMonthEmployee, day: TeamMonthDay) => void;
  selectedKeys?: Set<string>;
}) {
  const [year, monthNum] = month.split("-").map(Number);
  const todayIst = useMemo(
    () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()),
    [],
  );

  const dayMeta = useMemo(
    () =>
      Array.from({ length: days }, (_, i) => {
        const dayNum = i + 1;
        const date = `${year}-${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
        const dow = new Date(date + "T00:00:00").getDay();
        return {
          dayNum,
          date,
          weekend: dow === 0,
          dowLabel: ["S", "M", "T", "W", "T", "F", "S"][dow],
          isToday: date === todayIst,
        };
      }),
    [days, year, monthNum, todayIst],
  );

  if (employees.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
        <p className="text-sm font-medium text-slate-700">No team members to show.</p>
        <p className="mt-1 text-xs text-slate-500">
          This page shows your direct reports. If you expect people here, their reporting
          manager may not be set on their employee record.
        </p>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={80} skipDelayDuration={200}>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th
                style={{ left: LEFT.name, minWidth: COL.name, width: COL.name }}
                className="sticky top-0 z-30 border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-left font-semibold text-slate-700"
              >
                Employee
              </th>
              <th
                style={{ left: LEFT.code, minWidth: COL.code, width: COL.code }}
                className="sticky top-0 z-30 border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-left font-semibold text-slate-700"
              >
                Code
              </th>
              <th
                style={{ left: LEFT.meta, minWidth: COL.meta, width: COL.meta }}
                className="sticky top-0 z-30 border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-left font-semibold text-slate-700"
              >
                Dept / Process
              </th>
              <th
                style={{ left: LEFT.salary, minWidth: COL.salary, width: COL.salary }}
                className="sticky top-0 z-30 border-b border-r-2 border-slate-300 bg-slate-50 px-2 py-1.5 text-right font-semibold text-slate-700"
                title="Payable days as payroll will calculate them"
              >
                Sal. days
              </th>
              {dayMeta.map((d) => (
                <th
                  key={d.date}
                  className={cn(
                    "sticky top-0 z-20 h-9 w-7 border-b border-slate-200 px-0 text-center font-semibold",
                    d.weekend ? "bg-slate-100 text-slate-500" : "bg-slate-50 text-slate-700",
                    d.isToday && "bg-sky-100 text-sky-800",
                  )}
                >
                  <div className="leading-none">{d.dayNum}</div>
                  <div className="text-[9px] font-normal text-slate-400">{d.dowLabel}</div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {employees.map((emp) => (
              <tr key={emp.employeeId} className="group">
                <td
                  style={{ left: LEFT.name, minWidth: COL.name, width: COL.name }}
                  className="sticky z-10 truncate border-b border-r border-slate-200 bg-white px-2 py-1 font-medium text-slate-900 group-hover:bg-slate-50"
                  title={emp.employeeName}
                >
                  {emp.employeeName}
                </td>
                <td
                  style={{ left: LEFT.code, minWidth: COL.code, width: COL.code }}
                  className="sticky z-10 border-b border-r border-slate-200 bg-white px-2 py-1 font-mono text-[11px] text-slate-600 group-hover:bg-slate-50"
                >
                  {emp.employeeCode}
                </td>
                <td
                  style={{ left: LEFT.meta, minWidth: COL.meta, width: COL.meta }}
                  className="sticky z-10 truncate border-b border-r border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 group-hover:bg-slate-50"
                  title={`${emp.department ?? "—"} / ${emp.process ?? "—"}`}
                >
                  {emp.department ?? "—"} / {emp.process ?? "—"}
                </td>
                <td
                  style={{ left: LEFT.salary, minWidth: COL.salary, width: COL.salary }}
                  className="sticky z-10 border-b border-r-2 border-slate-300 bg-white px-2 py-1 text-right tabular-nums group-hover:bg-slate-50"
                >
                  {/* Blank, never zero, when payroll could not answer — a fabricated
                      0.0 next to a real 22.5 is indistinguishable from a real answer. */}
                  {emp.salaryDays === undefined ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    <span className="font-semibold text-slate-900">{emp.salaryDays.toFixed(1)}</span>
                  )}
                  {emp.counts.needsAttention > 0 && (
                    <span
                      className="ml-1 text-orange-600"
                      title={`${emp.counts.needsAttention} day(s) unresolved — this figure will move once they are closed`}
                    >
                      ⚠
                    </span>
                  )}
                </td>

                {emp.days.map((day) => {
                  const meta = dayMeta.find((m) => m.date === day.d);
                  return (
                    <AttendanceCell
                      key={`${emp.employeeId}:${day.d}`}
                      day={day}
                      weekend={meta?.weekend ?? false}
                      isToday={meta?.isToday ?? false}
                      selected={selectedKeys?.has(`${emp.employeeId}:${day.d}`)}
                      onSelect={(d) => onCellClick?.(emp, d)}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[10px] text-slate-400" style={{ paddingLeft: FROZEN_WIDTH }}>
        Scroll sideways for the rest of the month.
      </p>
    </TooltipProvider>
  );
}
