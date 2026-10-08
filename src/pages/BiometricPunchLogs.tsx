import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Download, Fingerprint, LogIn, LogOut, RefreshCcw, Timer } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useBiometricLogs } from "@/hooks/useBiometricLogs";
import { hrmsApi } from "@/lib/hrmsApi";

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getInitialRange(prefilledDate: string | null) {
  if (prefilledDate && /^\d{4}-\d{2}-\d{2}$/.test(prefilledDate)) {
    return { fromDate: prefilledDate, toDate: prefilledDate };
  }
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 6);
  return { fromDate: formatDateInput(from), toDate: formatDateInput(to) };
}

function formatStamp(value: string | null | undefined): string {
  if (!value) return "-";
  return value.replace("T", " ");
}

function formatMinutes(value: number | null | undefined): string {
  if (value == null) return "-";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatClock(value: string | null | undefined): string {
  if (!value) return "--:--";
  const m = value.replace("T", " ").match(/(\d{2}):(\d{2})/);
  if (!m) return value;
  const h = Number(m[1]);
  return `${String(h % 12 || 12).padStart(2, "0")}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}

function formatDayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function punchDirection(label: string | null | undefined): "in" | "out" | "other" {
  const l = (label ?? "").toLowerCase();
  if (l.includes("out")) return "out";
  if (l.includes("in")) return "in";
  return "other";
}

function statusTone(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("present")) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (s.includes("absent")) return "border-rose-200 bg-rose-50 text-rose-700";
  if (s.includes("half") || s.includes("late")) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function csvCell(value: string | number | null | undefined): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export default function BiometricPunchLogs() {
  const { employeeId: routeEmployeeId } = useParams();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const initial = getInitialRange(searchParams.get("date"));
  const [fromDate, setFromDate] = useState(initial.fromDate);
  const [toDate, setToDate] = useState(initial.toDate);
  const [appliedRange, setAppliedRange] = useState(initial);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { data: selfEmployee, isLoading: selfEmployeeLoading } = useQuery<{ id: string } | null>({
    queryKey: ["biometric-logs-self-employee", user?.id],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: { id: string } | null }>("/api/employees/me");
      return res.data ?? null;
    },
    enabled: !routeEmployeeId && Boolean(user?.id),
  });

  const employeeId = routeEmployeeId ?? selfEmployee?.id ?? "";
  const { data, isLoading, isError, error, refetch, isFetching } = useBiometricLogs(
    employeeId,
    appliedRange.fromDate,
    appliedRange.toDate,
  );

  const isResolvingEmployee = !routeEmployeeId && selfEmployeeLoading;

  /*
   * One row of the CSV export.
   *
   * Stated explicitly because the flatMap below returns from two branches — a placeholder row for
   * a day with no punches, and one row per punch otherwise. The keys are identical, but the
   * inferred value types are not (cosecIndex, deviceId and rawMinutes are numbers on the punch
   * path and "" on the placeholder path), so TypeScript could not unify the branches and gave up,
   * degrading exportRows to unknown[] and taking 17 property reads down with it.
   */
  type BiometricExportRow = {
    date: string;
    employeeCode: string;
    employeeName: string;
    biometricCode: string;
    cosecUserId: string;
    firstPunchIn: string;
    lastPunchOut: string;
    totalPunches: number;
    rawMinutes: number | string;
    attendanceStatus: string;
    attendanceIn: string;
    attendanceOut: string;
    rawPunchTime: string;
    ioLabel: string;
    deviceId: number | string;
    cosecIndex: number | string;
    syncedAt: string;
  };

  const exportRows = useMemo<BiometricExportRow[]>(() => {
    if (!data) return [];

    return data.days.flatMap((day): BiometricExportRow[] => {
      if (day.rawPunches.length === 0) {
        return [{
          date: day.date,
          employeeCode: data.employee.employeeCode,
          employeeName: data.employee.employeeName,
          biometricCode: data.employee.biometricCode ?? "",
          cosecUserId: data.employee.cosecUserId ?? "",
          firstPunchIn: day.biometricSummary?.firstPunchIn ?? "",
          lastPunchOut: day.biometricSummary?.lastPunchOut ?? "",
          totalPunches: day.biometricSummary?.totalPunches ?? 0,
          rawMinutes: day.biometricSummary?.rawMinutes ?? "",
          attendanceStatus: day.attendanceSummary?.attendanceStatus ?? "",
          attendanceIn: day.attendanceSummary?.clockInTime ?? "",
          attendanceOut: day.attendanceSummary?.clockOutTime ?? "",
          rawPunchTime: "",
          ioLabel: "",
          deviceId: "",
          cosecIndex: "",
          syncedAt: "",
        }];
      }

      return day.rawPunches.map((punch) => ({
        date: day.date,
        employeeCode: data.employee.employeeCode,
        employeeName: data.employee.employeeName,
        biometricCode: data.employee.biometricCode ?? "",
        cosecUserId: data.employee.cosecUserId ?? "",
        firstPunchIn: day.biometricSummary?.firstPunchIn ?? "",
        lastPunchOut: day.biometricSummary?.lastPunchOut ?? "",
        totalPunches: day.biometricSummary?.totalPunches ?? day.rawPunches.length,
        rawMinutes: day.biometricSummary?.rawMinutes ?? "",
        attendanceStatus: day.attendanceSummary?.attendanceStatus ?? "",
        attendanceIn: day.attendanceSummary?.clockInTime ?? "",
        attendanceOut: day.attendanceSummary?.clockOutTime ?? "",
        rawPunchTime: punch.punchTime,
        ioLabel: punch.ioLabel,
        deviceId: punch.deviceId ?? "",
        cosecIndex: punch.cosecIndex,
        syncedAt: punch.syncedAt,
      }));
    });
  }, [data]);

  function exportCsv() {
    if (!data || exportRows.length === 0) {
      toast.error("No biometric log data to export");
      return;
    }

    const headers = [
      "Date",
      "Employee Code",
      "Employee Name",
      "Biometric Code",
      "COSEC User",
      "First Punch In",
      "Last Punch Out",
      "Total Punches",
      "Raw Minutes",
      "Attendance Status",
      "Attendance In",
      "Attendance Out",
      "Raw Punch Time",
      "Direction",
      "Device",
      "COSEC Index",
      "Synced At",
    ];

    const lines = exportRows.map((row) => [
      row.date,
      row.employeeCode,
      row.employeeName,
      row.biometricCode,
      row.cosecUserId,
      row.firstPunchIn,
      row.lastPunchOut,
      row.totalPunches,
      row.rawMinutes,
      row.attendanceStatus,
      row.attendanceIn,
      row.attendanceOut,
      row.rawPunchTime,
      row.ioLabel,
      row.deviceId,
      row.cosecIndex,
      row.syncedAt,
    ].map(csvCell).join(","));

    const csv = [headers.map(csvCell).join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `biometric-punch-logs-${data.employee.employeeCode}-${data.fromDate}-to-${data.toDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("CSV downloaded");
  }

  useEffect(() => {
    const next = getInitialRange(searchParams.get("date"));
    setFromDate(next.fromDate);
    setToDate(next.toDate);
    setAppliedRange(next);
  }, [searchParams]);

  const applyPreset = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - (days - 1));
    const next = { fromDate: formatDateInput(from), toDate: formatDateInput(to) };
    setFromDate(next.fromDate);
    setToDate(next.toDate);
    setAppliedRange(next);
  };

  const toggleDay = (date: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });

  const totalPunchesInRange = data
    ? data.days.reduce((sum, d) => sum + (d.biometricSummary?.totalPunches ?? d.rawPunches.length), 0)
    : 0;
  const initials = data
    ? data.employee.employeeName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase())
        .join("")
    : "";

  return (
    <DashboardLayout>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 pb-12">
        <section className="relative overflow-hidden rounded-3xl bg-[#073f78] text-white shadow-lg">
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-[#1B6AB5]/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-10 left-1/4 h-48 w-48 rounded-full bg-[#3BAD49]/10 blur-3xl" />
          <div className="relative flex flex-col gap-5 p-6 sm:p-7 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-green-200">
                <Fingerprint className="h-3.5 w-3.5" />
                Attendance
              </p>
              <h1 className="mt-2 text-2xl font-black tracking-tight">Biometric Punch Logs</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                Read-only biometric evidence from COSEC sync, grouped by day.
              </p>
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.08] p-4">
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Today", days: 1 },
                  { label: "7 days", days: 7 },
                  { label: "30 days", days: 30 },
                ].map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => applyPreset(p.days)}
                    disabled={!employeeId}
                    className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white transition hover:bg-white/15 disabled:opacity-50"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="flex flex-col gap-1 text-xs text-slate-300">
                  <span>From</span>
                  <Input
                    type="date"
                    value={fromDate}
                    max={toDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="h-9 border-white/20 bg-white/10 text-white [color-scheme:dark]"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-300">
                  <span>To</span>
                  <Input
                    type="date"
                    value={toDate}
                    min={fromDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="h-9 border-white/20 bg-white/10 text-white [color-scheme:dark]"
                  />
                </label>
                <Button
                  className="h-9 bg-[#3BAD49] text-white hover:bg-[#329a3f]"
                  onClick={() => setAppliedRange({ fromDate, toDate })}
                  disabled={!employeeId || !fromDate || !toDate || fromDate > toDate}
                >
                  Apply
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 border-white/20 bg-transparent text-white hover:bg-white/15 hover:text-white"
                  onClick={() => void refetch()}
                  disabled={isFetching || !employeeId}
                  aria-label="Refresh"
                >
                  <RefreshCcw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                </Button>
                <Button
                  variant="outline"
                  className="h-9 border-white/20 bg-transparent text-white hover:bg-white/15 hover:text-white"
                  onClick={exportCsv}
                  disabled={!data || isFetching}
                >
                  <Download className="mr-2 h-4 w-4" />
                  CSV
                </Button>
              </div>
            </div>
          </div>
        </section>

        {isResolvingEmployee || isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-28 w-full rounded-3xl" />
            <Skeleton className="h-56 w-full rounded-3xl" />
          </div>
        ) : !employeeId ? (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="p-6 text-sm text-amber-800">
              We could not resolve the employee profile for this punch log view.
            </CardContent>
          </Card>
        ) : isError ? (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="flex items-center justify-between gap-3 p-6 text-sm text-red-700">
              <span>{(error as Error)?.message ?? "Failed to load biometric logs."}</span>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : !data ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600">No biometric log data found.</CardContent>
          </Card>
        ) : (
          <>
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#073f78] text-sm font-black text-white">
                    {initials || "?"}
                  </div>
                  <div>
                    <p className="text-lg font-semibold leading-tight text-slate-900">{data.employee.employeeName}</p>
                    <p className="text-xs text-slate-500">
                      {data.employee.employeeCode} · {data.fromDate} to {data.toDate}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 lg:ml-auto">
                  {[
                    { label: "Biometric", value: data.employee.biometricCode },
                    { label: "COSEC", value: data.employee.cosecUserId },
                    { label: "Branch", value: data.employee.branchName },
                    { label: "Process", value: data.employee.processName },
                  ].map((chip) => (
                    <span
                      key={chip.label}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs"
                    >
                      <span className="text-slate-500">{chip.label}: </span>
                      <span className="font-semibold text-slate-900">{chip.value ?? "-"}</span>
                    </span>
                  ))}
                  <span className="rounded-xl border border-[#c9def3] bg-[#eef6ff] px-3 py-1.5 text-xs font-semibold text-[#073f78]">
                    {data.days.length} day{data.days.length === 1 ? "" : "s"} · {totalPunchesInRange} punches
                  </span>
                </div>
              </CardContent>
            </Card>

            {data.days.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 p-10 text-center text-sm text-slate-600">
                  <Fingerprint className="h-8 w-8 text-slate-300" />
                  No biometric punches found for this employee in the selected date range.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {data.days.map((day) => {
                  const isOpen = !collapsed.has(day.date);
                  const punchCount = day.biometricSummary?.totalPunches ?? day.rawPunches.length;
                  return (
                    <Card key={day.date} className="overflow-hidden border-slate-200 shadow-sm">
                      <button
                        type="button"
                        onClick={() => toggleDay(day.date)}
                        aria-expanded={isOpen}
                        className="flex w-full flex-col gap-3 border-b border-slate-100 bg-white px-5 py-4 text-left transition hover:bg-slate-50 md:flex-row md:items-center md:justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <ChevronDown
                            className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? "" : "-rotate-90"}`}
                          />
                          <div>
                            <p className="text-base font-semibold text-slate-900">{formatDayLabel(day.date)}</p>
                            <p className="text-xs text-slate-500">
                              {punchCount} punch{punchCount === 1 ? "" : "es"} · {formatMinutes(day.biometricSummary?.rawMinutes ?? null)} worked
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {day.attendanceSummary?.attendanceStatus ? (
                            <Badge className={`border hover:bg-transparent ${statusTone(day.attendanceSummary.attendanceStatus)}`}>
                              {day.attendanceSummary.attendanceStatus}
                            </Badge>
                          ) : null}
                          {day.biometricSummary?.sourceSystem ? (
                            <Badge variant="outline">{day.biometricSummary.sourceSystem}</Badge>
                          ) : null}
                        </div>
                      </button>

                      {isOpen && (
                        <CardContent className="space-y-4 p-5">
                          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                            {[
                              { label: "First In", value: formatClock(day.biometricSummary?.firstPunchIn), icon: LogIn, tone: "text-emerald-700" },
                              { label: "Last Out", value: formatClock(day.biometricSummary?.lastPunchOut), icon: LogOut, tone: "text-sky-700" },
                              { label: "Worked", value: formatMinutes(day.biometricSummary?.rawMinutes ?? null), icon: Timer, tone: "text-indigo-700" },
                              { label: "Punches", value: String(punchCount), icon: Fingerprint, tone: "text-slate-700" },
                            ].map((tile) => (
                              <div key={tile.label} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                  <tile.icon className={`h-3.5 w-3.5 ${tile.tone}`} />
                                  {tile.label}
                                </p>
                                <p className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">{tile.value}</p>
                              </div>
                            ))}
                          </div>

                          <p className="text-xs text-slate-500">
                            Attendance record:{" "}
                            <span className="font-semibold text-slate-700">{formatClock(day.attendanceSummary?.clockInTime)}</span>
                            {" → "}
                            <span className="font-semibold text-slate-700">{formatClock(day.attendanceSummary?.clockOutTime)}</span>
                          </p>

                          {day.rawPunches.length === 0 ? (
                            <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
                              No raw punch rows found for this date.
                            </p>
                          ) : (
                            <ol className="relative ml-2 space-y-3 border-l-2 border-slate-100 pl-5">
                              {day.rawPunches.map((punch) => {
                                const dir = punchDirection(punch.ioLabel);
                                return (
                                  <li key={`${punch.cosecIndex}-${punch.punchTime}`} className="relative">
                                    <span
                                      className={`absolute -left-[27px] top-1.5 h-3 w-3 rounded-full ring-4 ring-white ${
                                        dir === "in" ? "bg-emerald-500" : dir === "out" ? "bg-sky-500" : "bg-slate-400"
                                      }`}
                                    />
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-100 bg-white px-3 py-2">
                                      <span className="w-20 text-sm font-semibold tabular-nums text-slate-900">
                                        {formatClock(punch.punchTime)}
                                      </span>
                                      <span
                                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                                          dir === "in"
                                            ? "bg-emerald-50 text-emerald-700"
                                            : dir === "out"
                                              ? "bg-sky-50 text-sky-700"
                                              : "bg-slate-100 text-slate-600"
                                        }`}
                                      >
                                        {punch.ioLabel || "Punch"}
                                      </span>
                                      <span className="text-xs text-slate-500">Device {punch.deviceId ?? "-"}</span>
                                      <span className="text-xs text-slate-400 md:ml-auto">
                                        #{punch.cosecIndex} · synced {formatStamp(punch.syncedAt)}
                                      </span>
                                    </div>
                                  </li>
                                );
                              })}
                            </ol>
                          )}
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
