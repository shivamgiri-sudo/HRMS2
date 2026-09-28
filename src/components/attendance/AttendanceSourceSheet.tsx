import { useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  downloadAttendanceSourceSheet,
  useAttendanceSourceSheet,
  type SourceSheetDay,
  type SourceSheetEmployee,
  type SourceSheetFilters,
} from "@/hooks/useAttendanceSourceSheet";

interface Props {
  filters: SourceSheetFilters;
  onPageChange: (page: number) => void;
  onSelectEmployee?: (employee: SourceSheetEmployee) => void;
}

const STATUS_CLASS: Record<string, string> = {
  P: "bg-green-300 text-green-950",
  HD: "bg-amber-300 text-amber-950",
  A: "bg-red-300 text-red-950",
  L: "bg-violet-300 text-violet-950",
  H: "bg-sky-300 text-sky-950",
  WO: "bg-slate-200 text-slate-800",
  WOW: "bg-teal-300 text-teal-950",
  MP: "bg-orange-300 text-orange-950",
  UR: "bg-yellow-200 text-yellow-900",
};

const LEGEND: ReadonlyArray<[string, string]> = [
  ["P", "Present"],
  ["HD", "Half day"],
  ["A", "Absent"],
  ["L", "Leave"],
  ["H", "Holiday"],
  ["WO", "Week off"],
  ["WOW", "Week off worked"],
  ["MP", "Missing punch"],
  ["UR", "Unreconciled"],
];

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function dayHeading(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}-${MONTH_NAMES[Number(m) - 1]}-${y.slice(2)}`;
}

function monthHeading(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1]}'${y.slice(2)}`;
}

function hours(minutes: number | null): string {
  if (minutes === null) return "-";
  const total = Math.max(0, Math.round(minutes));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")} Hrs`;
}

const HEAD =
  "border border-slate-200 bg-slate-100 px-2 py-1.5 text-center text-xs font-semibold text-slate-700";
const CELL =
  "border border-slate-200 px-2 py-1 text-xs text-slate-700 whitespace-nowrap";

function DurationCell({
  minutes,
  isPayrollSource,
}: {
  minutes: number | null;
  isPayrollSource: boolean;
}) {
  return (
    <td
      className={`${CELL} text-center ${isPayrollSource ? "bg-blue-50 font-bold text-slate-950" : "text-slate-500"}`}
      title={isPayrollSource ? "Payroll attendance source" : undefined}
    >
      {hours(minutes)}
    </td>
  );
}

function DayCells({ day }: { day: SourceSheetDay | undefined }) {
  if (!day) {
    return (
      <>
        <td className={CELL} />
        <td className={CELL} />
        <td className={CELL} />
      </>
    );
  }
  return (
    <>
      <td
        className={`${CELL} text-center font-bold ${STATUS_CLASS[day.code] ?? "bg-slate-100"}`}
      >
        {day.code}
      </td>
      <DurationCell
        minutes={day.cosecMinutes}
        isPayrollSource={day.payrollSource === "cosec"}
      />
      <DurationCell
        minutes={day.aprMinutes}
        isPayrollSource={day.payrollSource === "apr"}
      />
    </>
  );
}

export function AttendanceSourceSheet({
  filters,
  onPageChange,
  onSelectEmployee,
}: Props) {
  const { data, isLoading, isError, error, isFetching } =
    useAttendanceSourceSheet(filters);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadAttendanceSourceSheet(filters);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / filters.limit));
  const label = monthHeading(filters.month);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {LEGEND.map(([code, meaning]) => (
            <span
              key={code}
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_CLASS[code]}`}
            >
              {code} · {meaning}
            </span>
          ))}
          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-900">
            Bold blue = payroll source
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleExport}
          disabled={exporting || total === 0}
        >
          {exporting ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-1.5 h-4 w-4" />
          )}
          Download Excel
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : isError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error instanceof Error
            ? error.message
            : "Could not load the attendance source sheet."}
        </div>
      ) : !data || data.employees.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          No attendance records for {label} with these filters.
        </div>
      ) : (
        <div
          className={`max-h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-white ${isFetching ? "opacity-70" : ""}`}
        >
          <table className="border-collapse text-xs">
            <thead className="sticky top-0 z-20">
              <tr>
                {[
                  "Month",
                  "Employee name",
                  "Emp Code",
                  "Branch",
                  "Cost Center",
                  "Process Name",
                  "LOB",
                  "Attendance Source",
                ].map((h) => (
                  <th
                    key={h}
                    rowSpan={2}
                    className={`${HEAD} whitespace-nowrap`}
                  >
                    {h}
                  </th>
                ))}
                {data.days.map((date) => (
                  <th
                    key={date}
                    colSpan={3}
                    className={`${HEAD} whitespace-nowrap`}
                  >
                    {dayHeading(date)}
                  </th>
                ))}
              </tr>
              <tr>
                {data.days.map((date) => (
                  <HeaderTriplet key={date} />
                ))}
              </tr>
            </thead>
            <tbody>
              {data.employees.map((emp) => (
                <tr
                  key={emp.employeeId}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => onSelectEmployee?.(emp)}
                >
                  <td className={CELL}>{label}</td>
                  <td className={`${CELL} font-semibold text-slate-900`}>
                    {emp.employeeName}
                  </td>
                  <td className={`${CELL} font-mono`}>{emp.employeeCode}</td>
                  <td className={CELL}>{emp.branch ?? ""}</td>
                  <td className={CELL}>{emp.costCentre ?? ""}</td>
                  <td className={CELL}>{emp.process ?? ""}</td>
                  <td className={CELL}>{emp.lob ?? ""}</td>
                  <td className={`${CELL} font-semibold`}>
                    {emp.attendanceSource}
                  </td>
                  {data.days.map((date) => (
                    <DayCells key={date} day={emp.days[date]} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > filters.limit && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            {total.toLocaleString("en-IN")} employees · page {filters.page} of{" "}
            {pageCount}
          </span>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              disabled={filters.page <= 1}
              onClick={() => onPageChange(filters.page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={filters.page >= pageCount}
              onClick={() => onPageChange(filters.page + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function HeaderTriplet() {
  return (
    <>
      <th className={HEAD}>Status</th>
      <th className={HEAD}>Cosec</th>
      <th className={HEAD}>APR</th>
    </>
  );
}
