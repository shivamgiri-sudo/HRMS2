/**
 * What a payroll month still owes.
 *
 * Once a month can be paid in several runs, no single run answers "is this month done?". The panel
 * exists for the one question that matters before closing: is anybody still unpaid?
 *
 * The uncovered-employee list is the point of the panel, so it is never collapsed behind a toggle
 * and never truncated to a count. An employee silently omitted looks exactly like one correctly
 * excluded, and the difference is somebody not being paid. Each row carries its reason, because the
 * reasons need different fixes: "no cost centre assigned" is a posting to correct, "cost centre is
 * inactive" needs the cost centre reactivated, and only "not included in any run" means create a run.
 */

import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, Users } from "lucide-react";
import type { MonthCoverage } from "@/hooks/useMonthCoverage";
import { cn } from "@/lib/utils";

type Props = {
  coverage?: MonthCoverage;
  loading?: boolean;
  month: string;
};

/** Frozen tone system: green = done, blue = in flight, slate = untouched, red = needs attention. */
const TONES = {
  green: { iconBg: "#eaf8ef", value: "#15803d", border: "#d7f0df" },
  blue: { iconBg: "#edf4ff", value: "#0b63e5", border: "#dce8fb" },
  slate: { iconBg: "#f1f4f8", value: "#0b1f44", border: "#e3e9f2" },
  red: { iconBg: "#fff0f1", value: "#dc2626", border: "#ffdadd" },
} as const;

function Tile({
  label,
  value,
  helper,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  helper: string;
  icon: typeof Users;
  tone: keyof typeof TONES;
}) {
  const t = TONES[tone];
  return (
    <div
      className="rounded-2xl border bg-white/95 p-4 shadow-sm backdrop-blur-sm transition-all duration-200 hover:shadow-md"
      style={{ borderColor: t.border }}
    >
      <div className="flex items-center gap-2">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ backgroundColor: t.iconBg }}
        >
          <Icon className="h-4 w-4" style={{ color: t.value }} />
        </div>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums" style={{ color: t.value }}>
        {value}
      </p>
      <p className="mt-0.5 text-sm text-slate-500">{helper}</p>
    </div>
  );
}

export function MonthCoveragePanel({ coverage, loading = false, month }: Props) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-white/60 bg-white/95 p-6 text-sm text-slate-500 shadow-sm backdrop-blur-sm">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        Checking what {month} still owes…
      </div>
    );
  }

  if (!coverage) return null;

  const { totals, uncoveredEmployees, complete } = coverage;

  return (
    <div className="space-y-3">
      {/* Payroll is financial data, so blue per the frozen section-gradient map. */}
      <div className="overflow-hidden rounded-2xl border border-white/60 bg-white/95 shadow-sm backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold leading-tight">Month coverage</h3>
              <p className="text-xs text-blue-100">{month} · every employee must sit in exactly one run</p>
            </div>
          </div>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-bold",
              complete ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700",
            )}
          >
            {complete ? "Ready to close" : "Cannot close yet"}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4">
          <Tile label="Paid" value={totals.paid} helper="cost centres settled" icon={CheckCircle2} tone="green" />
          <Tile label="In a run" value={totals.inRun} helper="being processed" icon={Loader2} tone="blue" />
          <Tile label="Not started" value={totals.notStarted} helper="no run yet" icon={CircleDashed} tone="slate" />
          <Tile
            label="Uncovered"
            value={totals.uncovered}
            helper={totals.uncovered === 1 ? "employee unpaid" : "employees unpaid"}
            icon={AlertTriangle}
            tone={totals.uncovered > 0 ? "red" : "green"}
          />
        </div>
      </div>

      {uncoveredEmployees.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-red-200 bg-gradient-to-br from-red-50 to-orange-50 shadow-sm">
          <div className="flex items-center gap-2 border-b border-red-200/70 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <h4 className="text-sm font-bold text-gray-900">
              {uncoveredEmployees.length} {uncoveredEmployees.length === 1 ? "employee is" : "employees are"} in no run
            </h4>
          </div>
          <p className="px-4 pt-3 text-sm text-gray-700">
            {month} cannot be closed until every one of these is either included in a run or explicitly
            excluded. They are listed individually on purpose — a count alone cannot be acted on.
          </p>
          {/* Long lists scroll inside the card rather than pushing the page; never truncated away. */}
          <ul className="mt-3 max-h-64 divide-y divide-red-100 overflow-y-auto">
            {uncoveredEmployees.map((e) => (
              <li
                key={e.employeeId}
                className="flex min-h-[44px] flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <span className="text-sm font-bold text-gray-800">{e.employeeCode}</span>
                <span className="text-sm text-gray-700 sm:text-right">{e.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default MonthCoveragePanel;
