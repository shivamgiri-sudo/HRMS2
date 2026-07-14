import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, Download, Filter, Loader2, Moon, Sun, Users } from "lucide-react";
import { toast } from "sonner";
import { apiUrl } from "@/lib/apiBase";
import { cn } from "@/lib/utils";

type DailySummaryRow = {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  process_name: string | null;
  branch_name: string | null;
  department_name: string | null;
  shift_date: string;
  shift_name: string | null;
  shift_start_time: string | null;
  shift_end_time: string | null;
  shift_type: "Day" | "Night";
  punch_in: string | null;
  punch_out: string | null;
  worked_hours: number | null;
  attendance_status: string;
  total_break_minutes: number;
  mini_break_count: number;
  long_break_count: number;
  total_break_count: number;
  exceeded_break_count: number;
  roster_status: string | null;
  final_status: string | null;
};

type SummaryStats = {
  total_rows: number;
  total_employees: number;
  total_break_minutes: number;
  total_break_sessions: number;
  avg_break_minutes_per_day: number;
  exceeded_count: number;
  present_count: number;
  absent_count: number;
  half_day_count: number;
};

function formatDateTime(val: string | null) {
  if (!val) return "-";
  const d = new Date(String(val).replace(" ", "T") + (String(val).includes("+") ? "" : "+05:30"));
  if (Number.isNaN(d.getTime())) return String(val);
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function getToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function getWeekAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export default function BreakReports() {
  const [dateFrom, setDateFrom] = useState(getWeekAgo);
  const [dateTo, setDateTo] = useState(getToday);
  const [branchId, setBranchId] = useState("");
  const [processId, setProcessId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<DailySummaryRow[]>([]);
  const [summary, setSummary] = useState<SummaryStats | null>(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      if (branchId) params.set("branch_id", branchId);
      if (processId) params.set("process_id", processId);
      if (employeeId) params.set("employee_id", employeeId);

      const token = localStorage.getItem("auth_token") || "";
      const res = await fetch(apiUrl(`/api/break-management/reports/daily-summary?${params.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) throw new Error(payload.message || "Failed to load report");
      setRows(payload.data.rows);
      setSummary(payload.data.summary);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, branchId, processId, employeeId]);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  const exportCSV = useCallback(() => {
    if (rows.length === 0) { toast.error("No data to export"); return; }
    const headers = ["Employee Code", "Employee Name", "Process", "Branch", "Shift Date", "Shift Name", "Shift Type", "Punch In", "Punch Out", "Worked Hours", "Attendance", "Total Breaks", "Mini", "Long", "Break Minutes", "Exceeded"];
    const csvRows = rows.map((r) => [
      r.employee_code,
      r.employee_name,
      r.process_name ?? "",
      r.branch_name ?? "",
      r.shift_date,
      r.shift_name ?? "",
      r.shift_type,
      r.punch_in ? formatDateTime(r.punch_in) : "",
      r.punch_out ? formatDateTime(r.punch_out) : "",
      r.worked_hours != null ? r.worked_hours.toFixed(2) : "",
      r.attendance_status,
      String(r.total_break_count),
      String(r.mini_break_count),
      String(r.long_break_count),
      String(r.total_break_minutes),
      String(r.exceeded_break_count),
    ]);
    const csv = [headers, ...csvRows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `break-report-${dateFrom}-to-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV downloaded");
  }, [rows, dateFrom, dateTo]);

  const attendanceBadge = (status: string) => {
    switch (status) {
      case "Present": return "bg-emerald-100 text-emerald-800 border-emerald-200";
      case "Absent": return "bg-rose-100 text-rose-800 border-rose-200";
      case "Half Day": return "bg-amber-100 text-amber-800 border-amber-200";
      case "W/O": return "bg-slate-100 text-slate-700 border-slate-300";
      case "Leave": return "bg-purple-100 text-purple-800 border-purple-200";
      case "Punch Missing": return "bg-orange-100 text-orange-800 border-orange-200";
      default: return "bg-slate-100 text-slate-600 border-slate-200";
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <div className="mx-auto max-w-[1800px] space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Break Reports</h1>
            <p className="text-sm text-slate-500">Daily break & attendance summary per employee</p>
          </div>
          <button
            onClick={exportCSV}
            disabled={rows.length === 0}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Process ID</label>
            <input value={processId} onChange={(e) => setProcessId(e.target.value)} placeholder="Optional" className="h-9 w-28 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Branch ID</label>
            <input value={branchId} onChange={(e) => setBranchId(e.target.value)} placeholder="Optional" className="h-9 w-28 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Employee ID</label>
            <input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="Optional" className="h-9 w-36 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-blue-400" />
          </div>
          <button onClick={fetchReport} disabled={loading} className="flex h-9 items-center gap-2 rounded-xl bg-[#145da0] px-4 text-sm font-semibold text-white transition hover:bg-[#1b6ab5] disabled:opacity-60">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Filter className="h-4 w-4" />}
            Load Report
          </button>
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <SummaryCard label="Employees" value={String(summary.total_employees)} color="blue" />
            <SummaryCard label="Total Sessions" value={String(summary.total_break_sessions)} color="violet" />
            <SummaryCard label="Total Break Min" value={String(summary.total_break_minutes)} color="amber" />
            <SummaryCard label="Avg/Day" value={`${summary.avg_break_minutes_per_day}m`} color="cyan" />
            <SummaryCard label="Exceeded" value={String(summary.exceeded_count)} color="rose" />
            <SummaryCard label="Present" value={String(summary.present_count)} color="emerald" />
            <SummaryCard label="Absent" value={String(summary.absent_count)} color="red" />
            <SummaryCard label="Half Day" value={String(summary.half_day_count)} color="orange" />
          </div>
        )}

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="max-h-[calc(100vh-320px)] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-2 py-2.5">Emp Code</th>
                  <th className="px-2 py-2.5">Employee</th>
                  <th className="px-2 py-2.5">Process</th>
                  <th className="px-2 py-2.5">Shift Date</th>
                  <th className="px-2 py-2.5">Shift</th>
                  <th className="px-2 py-2.5">Punch In</th>
                  <th className="px-2 py-2.5">Punch Out</th>
                  <th className="px-2 py-2.5 text-center">Worked</th>
                  <th className="px-2 py-2.5 text-center">Attendance</th>
                  <th className="px-2 py-2.5 text-center">Breaks</th>
                  <th className="px-2 py-2.5 text-center">Mini</th>
                  <th className="px-2 py-2.5 text-center">Long</th>
                  <th className="px-2 py-2.5 text-center">Brk Min</th>
                  <th className="px-2 py-2.5 text-center">Exceeded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, idx) => (
                  <tr key={`${row.employee_id}-${row.shift_date}-${idx}`} className="align-middle hover:bg-slate-50/70">
                    <td className="px-2 py-2 font-semibold text-slate-800">{row.employee_code}</td>
                    <td className="px-2 py-2">
                      <span className="font-medium text-slate-800">{row.employee_name}</span>
                    </td>
                    <td className="px-2 py-2 font-medium text-slate-700">{row.process_name ?? "-"}</td>
                    <td className="px-2 py-2 whitespace-nowrap text-slate-700">{row.shift_date}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        {row.shift_type === "Night" ? <Moon className="h-3 w-3 text-indigo-500" /> : <Sun className="h-3 w-3 text-amber-500" />}
                        <span className="text-slate-700">{row.shift_name ?? "-"}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-slate-600">{formatDateTime(row.punch_in)}</td>
                    <td className="px-2 py-2 whitespace-nowrap text-slate-600">{formatDateTime(row.punch_out)}</td>
                    <td className="px-2 py-2 text-center font-semibold text-slate-800">
                      {row.worked_hours != null ? `${row.worked_hours.toFixed(1)}h` : "-"}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold", attendanceBadge(row.attendance_status))}>
                        {row.attendance_status}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center font-semibold text-slate-800">{row.total_break_count}</td>
                    <td className="px-2 py-2 text-center text-sky-700">{row.mini_break_count}</td>
                    <td className="px-2 py-2 text-center text-violet-700">{row.long_break_count}</td>
                    <td className="px-2 py-2 text-center font-semibold text-slate-800">{row.total_break_minutes}</td>
                    <td className="px-2 py-2 text-center">
                      {row.exceeded_break_count > 0
                        ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">{row.exceeded_break_count}</span>
                        : <span className="text-slate-400">0</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && rows.length === 0 && (
            <div className="px-4 py-12 text-center">
              <Users className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-400">No data for selected date range</p>
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    blue: "border-l-blue-500 bg-blue-50/50",
    violet: "border-l-violet-500 bg-violet-50/50",
    amber: "border-l-amber-500 bg-amber-50/50",
    cyan: "border-l-cyan-500 bg-cyan-50/50",
    rose: "border-l-rose-500 bg-rose-50/50",
    emerald: "border-l-emerald-500 bg-emerald-50/50",
    red: "border-l-red-500 bg-red-50/50",
    orange: "border-l-orange-500 bg-orange-50/50",
  };
  return (
    <div className={cn("rounded-lg border border-slate-200 border-l-[3px] px-3 py-2.5", colorMap[color] ?? "")}>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 text-xl font-extrabold text-slate-900" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{value}</div>
    </div>
  );
}
