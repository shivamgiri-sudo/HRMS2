import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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

  const exportRows = useMemo(() => {
    if (!data) return [];

    return data.days.flatMap((day) => {
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

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Attendance</p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Biometric Punch Logs</h1>
            <p className="mt-1 text-sm text-slate-600">
              Read-only biometric evidence for one employee using existing COSEC sync tables.
            </p>
          </div>

          <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:flex-wrap md:items-end">
            <label className="flex flex-col gap-1 text-sm text-slate-600">
              <span>From</span>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-600">
              <span>To</span>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </label>
            <Button
              className="md:min-w-28"
              onClick={() => setAppliedRange({ fromDate, toDate })}
              disabled={!employeeId || !fromDate || !toDate}
            >
              Apply
            </Button>
            <Button variant="outline" onClick={() => void refetch()} disabled={isFetching || !employeeId}>
              Refresh
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={!data || isFetching}>
              {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Export CSV
            </Button>
          </div>
        </div>

        {isResolvingEmployee || isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-36 w-full rounded-3xl" />
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
            <CardContent className="p-6 text-sm text-red-700">
              {(error as Error)?.message ?? "Failed to load biometric logs."}
            </CardContent>
          </Card>
        ) : !data ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600">No biometric log data found.</CardContent>
          </Card>
        ) : (
          <>
            <Card className="border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-xl text-slate-900">{data.employee.employeeName}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Employee Code</p>
                  <p className="mt-1 font-medium text-slate-900">{data.employee.employeeCode}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Biometric Code</p>
                  <p className="mt-1 font-medium text-slate-900">{data.employee.biometricCode ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">COSEC User</p>
                  <p className="mt-1 font-medium text-slate-900">{data.employee.cosecUserId ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Branch</p>
                  <p className="mt-1 font-medium text-slate-900">{data.employee.branchName ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Process</p>
                  <p className="mt-1 font-medium text-slate-900">{data.employee.processName ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Range</p>
                  <p className="mt-1 font-medium text-slate-900">{data.fromDate} to {data.toDate}</p>
                </div>
              </CardContent>
            </Card>

            {data.days.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-sm text-slate-600">
                  No biometric punches found for this employee in the selected date range.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {data.days.map((day) => (
                  <Card key={day.date} className="overflow-hidden border-slate-200 shadow-sm">
                    <CardHeader className="border-b border-slate-100 bg-white/90">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <CardTitle className="text-lg text-slate-900">{day.date}</CardTitle>
                          <p className="mt-1 text-sm text-slate-500">
                            {day.rawPunches.length} raw punch{day.rawPunches.length === 1 ? "" : "es"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {day.attendanceSummary?.attendanceStatus ? (
                            <Badge variant="secondary">{day.attendanceSummary.attendanceStatus}</Badge>
                          ) : null}
                          {day.biometricSummary?.sourceSystem ? (
                            <Badge variant="outline">{day.biometricSummary.sourceSystem}</Badge>
                          ) : null}
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-4 p-4">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                          <p className="text-xs uppercase tracking-wide text-slate-500">First Punch</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">
                            {formatStamp(day.biometricSummary?.firstPunchIn)}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                          <p className="text-xs uppercase tracking-wide text-slate-500">Last Punch</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">
                            {formatStamp(day.biometricSummary?.lastPunchOut)}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                          <p className="text-xs uppercase tracking-wide text-slate-500">Total Punches</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">
                            {day.biometricSummary?.totalPunches ?? day.rawPunches.length}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                          <p className="text-xs uppercase tracking-wide text-slate-500">Raw Minutes</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">
                            {formatMinutes(day.biometricSummary?.rawMinutes ?? null)}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                          <p className="text-xs uppercase tracking-wide text-slate-500">Attendance In</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">
                            {formatStamp(day.attendanceSummary?.clockInTime)}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                          <p className="text-xs uppercase tracking-wide text-slate-500">Attendance Out</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">
                            {formatStamp(day.attendanceSummary?.clockOutTime)}
                          </p>
                        </div>
                      </div>

                      <div className="overflow-x-auto rounded-2xl border border-slate-200">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                          <thead className="bg-slate-50">
                            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                              <th className="px-4 py-3">Punch Time</th>
                              <th className="px-4 py-3">Direction</th>
                              <th className="px-4 py-3">Device</th>
                              <th className="px-4 py-3">COSEC Index</th>
                              <th className="px-4 py-3">Synced At</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {day.rawPunches.length === 0 ? (
                              <tr>
                                <td className="px-4 py-4 text-slate-500" colSpan={5}>
                                  No raw punch rows found for this date.
                                </td>
                              </tr>
                            ) : (
                              day.rawPunches.map((punch) => (
                                <tr key={`${punch.cosecIndex}-${punch.punchTime}`}>
                                  <td className="px-4 py-3 font-medium text-slate-900">{formatStamp(punch.punchTime)}</td>
                                  <td className="px-4 py-3 text-slate-700">{punch.ioLabel}</td>
                                  <td className="px-4 py-3 text-slate-700">{punch.deviceId ?? "-"}</td>
                                  <td className="px-4 py-3 text-slate-700">{punch.cosecIndex}</td>
                                  <td className="px-4 py-3 text-slate-700">{formatStamp(punch.syncedAt)}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
