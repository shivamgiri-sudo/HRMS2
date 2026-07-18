import { useState, useMemo } from "react";
import { format, startOfMonth, addMonths, subMonths } from "date-fns";
import { Calendar, Table, ChevronLeft, ChevronRight, Radio, Fingerprint } from "lucide-react";
import { AttendanceCalendar } from "@/components/attendance/AttendanceCalendar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAttendanceDailyRecords, useAttendanceSummary } from "@/hooks/useAttendanceHub";

const STATUS_COLORS: Record<string, string> = {
  present:        "bg-emerald-100 text-emerald-800",
  half_day:       "bg-amber-100 text-amber-800",
  absent:         "bg-rose-100 text-rose-800",
  missing_punch:  "bg-orange-100 text-orange-800",
  week_off:       "bg-slate-100 text-slate-600",
  holiday:        "bg-blue-100 text-blue-800",
  leave_approved: "bg-purple-100 text-purple-800",
  late:           "bg-yellow-100 text-yellow-800",
};

// 'dialler' = APR/dialler-based; 'biometric' = COSEC biometric
const SOURCE_LABELS: Record<string, { label: string; cls: string }> = {
  biometric: { label: "Biometric", cls: "bg-slate-100 text-slate-600" },
  dialler:   { label: "APR",       cls: "bg-indigo-100 text-indigo-700" },
};

function fmtTime(t: string | null) {
  if (!t) return "—";
  return t.slice(0, 5);
}

function fmtMins(m: number | null) {
  if (!m) return "—";
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h}h ${String(min).padStart(2, "0")}m`;
}

type SourceFilter = "all" | "biometric" | "dialler";

interface Props { employeeId: string; }

export function AttendanceTab({ employeeId }: Props) {
  const [viewMode, setViewMode] = useState<"calendar" | "table">("calendar");
  const [currentMonth, setCurrentMonth] = useState<Date>(startOfMonth(new Date()));
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  const { monthStr, monthStart, monthEnd, monthLabel } = useMemo(() => ({
    monthStr:   format(currentMonth, "yyyy-MM"),
    monthStart: format(currentMonth, "yyyy-MM-01"),
    monthEnd:   format(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0), "yyyy-MM-dd"),
    monthLabel: format(currentMonth, "MMMM yyyy"),
  }), [currentMonth]);

  const { data: summary, isLoading: summaryLoading } = useAttendanceSummary(employeeId, monthStr);
  const { data: allDailyRecords = [], isLoading: dailyLoading } = useAttendanceDailyRecords(employeeId, monthStart, monthEnd);

  const dailyRecords = useMemo(
    () => sourceFilter === "all"
      ? allDailyRecords
      : allDailyRecords.filter(r => (r.source ?? "biometric") === sourceFilter),
    [allDailyRecords, sourceFilter]
  );

  const { hasAPR, hasBiometric, hasMixedSources } = useMemo(() => {
    const sourcesPresent = new Set(allDailyRecords.map(r => r.source ?? "biometric"));
    return {
      hasAPR: sourcesPresent.has("dialler"),
      hasBiometric: sourcesPresent.has("biometric"),
      hasMixedSources: sourcesPresent.has("dialler") && sourcesPresent.has("biometric"),
    };
  }, [allDailyRecords]);

  return (
    <div className="space-y-4">
      {/* Month navigator + view toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCurrentMonth(m => subMonths(m, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50"
          >
            <ChevronLeft className="h-4 w-4 text-slate-600" />
          </button>
          <span className="text-sm font-semibold text-slate-800 min-w-[130px] text-center">{monthLabel}</span>
          <button
            type="button"
            onClick={() => setCurrentMonth(m => addMonths(m, 1))}
            disabled={format(addMonths(currentMonth, 1), "yyyy-MM") > format(new Date(), "yyyy-MM")}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4 text-slate-600" />
          </button>
          <button
            type="button"
            onClick={() => setCurrentMonth(startOfMonth(new Date()))}
            className="text-xs text-indigo-600 hover:underline"
          >
            Today
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Source toggle — show only when there's actual data */}
          {(hasAPR || hasBiometric) && (
            <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden">
              <button
                type="button"
                onClick={() => setSourceFilter("all")}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition-colors ${sourceFilter === "all" ? "bg-slate-100 text-slate-800" : "text-slate-500 hover:bg-slate-50"}`}
              >
                All
              </button>
              {hasBiometric && (
                <button
                  type="button"
                  onClick={() => setSourceFilter("biometric")}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition-colors border-l border-slate-200 ${sourceFilter === "biometric" ? "bg-slate-100 text-slate-800" : "text-slate-500 hover:bg-slate-50"}`}
                >
                  <Fingerprint className="h-3 w-3" />
                  Biometric
                </button>
              )}
              {hasAPR && (
                <button
                  type="button"
                  onClick={() => setSourceFilter("dialler")}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition-colors border-l border-slate-200 ${sourceFilter === "dialler" ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50"}`}
                >
                  <Radio className="h-3 w-3" />
                  APR
                </button>
              )}
            </div>
          )}

          {/* Mixed source warning */}
          {hasMixedSources && sourceFilter === "all" && (
            <span className="text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              Mixed sources this month
            </span>
          )}

          {/* View toggle */}
          <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode("calendar")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "calendar" ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50"}`}
            >
              <Calendar className="h-3.5 w-3.5" />
              Calendar
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-l border-slate-200 ${viewMode === "table" ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50"}`}
            >
              <Table className="h-3.5 w-3.5" />
              Tabular
            </button>
          </div>
        </div>
      </div>

      {/* Summary strip */}
      {summaryLoading ? (
        <div className="flex gap-3">
          {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-16 flex-1 rounded-xl" />)}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {[
            { label: "Present", value: summary.presentDays, cls: "bg-emerald-50 text-emerald-800 border-emerald-100" },
            { label: "Half Day", value: summary.halfDays, cls: "bg-amber-50 text-amber-800 border-amber-100" },
            { label: "Absent", value: summary.absentDays, cls: "bg-rose-50 text-rose-800 border-rose-100" },
            { label: "LWP", value: Number(summary.totalLwp).toFixed(1), cls: "bg-orange-50 text-orange-800 border-orange-100" },
            { label: "Leave", value: summary.leaveDays, cls: "bg-purple-50 text-purple-800 border-purple-100" },
            { label: "Holiday", value: summary.holidayDays, cls: "bg-blue-50 text-blue-800 border-blue-100" },
            { label: "Late Marks", value: summary.lateMarks, cls: "bg-yellow-50 text-yellow-800 border-yellow-100" },
          ].map(item => (
            <div key={item.label} className={`rounded-xl border p-3 text-center ${item.cls}`}>
              <p className="text-lg font-bold">{item.value}</p>
              <p className="text-[10px] font-medium mt-0.5 opacity-80">{item.label}</p>
            </div>
          ))}
        </div>
      ) : null}

      {/* Calendar or tabular view */}
      {viewMode === "calendar" ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <AttendanceCalendar
            employeeId={employeeId}
            initialMonth={currentMonth.getMonth()}
            initialYear={currentMonth.getFullYear()}
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          {dailyLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
            </div>
          ) : dailyRecords.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              No attendance records
              {sourceFilter !== "all" ? ` from ${sourceFilter === "dialler" ? "APR" : "Biometric"} source` : ""} for {monthLabel}.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Day</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Login</th>
                  <th className="px-4 py-3 text-left">Logout</th>
                  <th className="px-4 py-3 text-left">Hours</th>
                  <th className="px-4 py-3 text-left">Source</th>
                </tr>
              </thead>
              <tbody>
                {dailyRecords.map(r => {
                  const d = new Date(r.date);
                  const dayName = d.toLocaleString("en-IN", { weekday: "short" });
                  const statusKey = r.status ?? "unknown";
                  const statusCls = STATUS_COLORS[statusKey] ?? "bg-slate-100 text-slate-600";
                  const src = (r.source ?? "biometric") as string;
                  const srcMeta = SOURCE_LABELS[src] ?? { label: src, cls: "bg-slate-100 text-slate-500" };
                  return (
                    <tr key={r.date} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{r.date?.slice(0, 10)}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">{dayName}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusCls}`}>
                          {statusKey.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{fmtTime(r.clock_in)}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{fmtTime(r.clock_out)}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{fmtMins(r.raw_minutes)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${srcMeta.cls}`}>
                          {srcMeta.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
