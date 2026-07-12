import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Clock, CheckCircle2, XCircle, AlertCircle, MinusCircle } from "lucide-react";

interface AttendanceRow {
  employee_id?: string;
  employee_code: string;
  employee_name: string;
  status: string;                 // aliased from attendance_status
  clock_in?: string;              // IST-converted
  clock_out?: string;
  clock_in_time?: string;
  clock_out_time?: string;
  total_hours?: number;
  late_minutes?: number;
  process_name?: string;
  department_name?: string;
  record_date?: string;
}

const STATUS_META: Record<string, { label: string; bg: string; text: string; icon: React.ReactNode }> = {
  present:  { label: "Present",   bg: "bg-emerald-100", text: "text-emerald-700", icon: <CheckCircle2 className="h-3 w-3" /> },
  absent:   { label: "Absent",    bg: "bg-rose-100",    text: "text-rose-700",    icon: <XCircle className="h-3 w-3" /> },
  late:     { label: "Late",      bg: "bg-amber-100",   text: "text-amber-700",   icon: <Clock className="h-3 w-3" /> },
  half_day: { label: "Half Day",  bg: "bg-blue-100",    text: "text-blue-700",    icon: <MinusCircle className="h-3 w-3" /> },
  week_off: { label: "Week Off",  bg: "bg-slate-100",   text: "text-slate-500",   icon: <MinusCircle className="h-3 w-3" /> },
  holiday:  { label: "Holiday",   bg: "bg-purple-100",  text: "text-purple-700",  icon: <CheckCircle2 className="h-3 w-3" /> },
  on_leave: { label: "On Leave",  bg: "bg-indigo-100",  text: "text-indigo-700",  icon: <AlertCircle className="h-3 w-3" /> },
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(t?: string) {
  if (!t) return "—";
  return String(t).slice(0, 5);
}

function exportCsv(rows: AttendanceRow[], date: string) {
  const header = ["Code", "Name", "Status", "In", "Out", "Hours", "Late(min)", "Process"];
  const lines = rows.map((r) => [
    r.employee_code, r.employee_name, r.status,
    formatTime(r.clock_in ?? r.clock_in_time),
    formatTime(r.clock_out ?? r.clock_out_time),
    r.total_hours ?? "",
    r.late_minutes ?? "",
    r.process_name ?? "",
  ].map(String).join(","));
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `team-attendance-${date}.csv`;
  a.click();
}

// ── Summary bar ──────────────────────────────────────────────
function SummaryBar({ rows }: { rows: AttendanceRow[] }) {
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  const items = [
    { key: "present",  label: "Present",  color: "bg-emerald-500" },
    { key: "absent",   label: "Absent",   color: "bg-rose-500" },
    { key: "late",     label: "Late",     color: "bg-amber-500" },
    { key: "half_day", label: "Half Day", color: "bg-blue-500" },
    { key: "on_leave", label: "On Leave", color: "bg-indigo-500" },
  ].filter((i) => counts[i.key]);

  if (!items.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((i) => (
        <div key={i.key} className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm">
          <span className={`h-2 w-2 rounded-full ${i.color}`} />
          {i.label}: <strong>{counts[i.key]}</strong>
        </div>
      ))}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────
export default function TeamAttendanceTab() {
  const [date, setDate] = useState(todayStr());

  const { data, isLoading } = useQuery({
    queryKey: ["team-attendance-daily", date],
    queryFn: () => hrmsApi.get<any>(`/api/attendance-daily/daily?date=${date}&limit=500`),
    staleTime: 30_000,
  });

  const rows: AttendanceRow[] = (data as any)?.data ?? [];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <Clock className="h-4 w-4 text-slate-400" />
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-7 w-36 border-0 bg-transparent p-0 text-sm font-medium focus-visible:ring-0"
          />
        </div>
        {rows.length > 0 && <SummaryBar rows={rows} />}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto rounded-xl shadow-sm"
          onClick={() => exportCsv(rows, date)}
          disabled={rows.length === 0}
        >
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Export CSV
        </Button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white py-16">
          <Clock className="h-8 w-8 text-slate-300 mb-2" />
          <p className="text-sm font-medium text-slate-500">No attendance records for {date}</p>
          <p className="text-xs text-slate-400 mt-1">Records appear once your team punches in</p>
        </div>
      ) : (
        <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableHead className="font-semibold text-slate-600">Employee</TableHead>
                <TableHead className="font-semibold text-slate-600">Status</TableHead>
                <TableHead className="font-semibold text-slate-600">In</TableHead>
                <TableHead className="font-semibold text-slate-600">Out</TableHead>
                <TableHead className="font-semibold text-slate-600">Hours</TableHead>
                <TableHead className="font-semibold text-slate-600">Late</TableHead>
                <TableHead className="font-semibold text-slate-600">Process</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, idx) => {
                const meta = STATUS_META[r.status] ?? { label: r.status, bg: "bg-slate-100", text: "text-slate-600", icon: null };
                return (
                  <TableRow key={r.employee_id ?? idx} className="hover:bg-slate-50/60 transition-colors">
                    <TableCell>
                      <div className="font-medium text-slate-900">{r.employee_name}</div>
                      <div className="text-xs text-slate-400">{r.employee_code}</div>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${meta.bg} ${meta.text}`}>
                        {meta.icon}
                        {meta.label}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-slate-600">
                      {formatTime(r.clock_in ?? r.clock_in_time)}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-slate-600">
                      {formatTime(r.clock_out ?? r.clock_out_time)}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-slate-700 font-medium">
                      {r.total_hours != null ? `${r.total_hours}h` : "—"}
                    </TableCell>
                    <TableCell>
                      {r.late_minutes != null && r.late_minutes > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          <Clock className="h-3 w-3" />{r.late_minutes}m
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{r.process_name ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
