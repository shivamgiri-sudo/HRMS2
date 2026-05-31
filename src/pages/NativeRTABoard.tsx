import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, RefreshCcw,
  TrendingDown, UserCheck, UserMinus, UserX, Users,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";

// ── Types ─────────────────────────────────────────────────────────────────────

type AttendanceStatus =
  | "present"
  | "absent"
  | "half_day"
  | "late"
  | "early_exit"
  | "leave_approved"
  | "holiday"
  | "week_off"
  | "unreconciled";

interface ReconRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  roster_date: string;
  process_name: string | null;
  branch_name: string | null;
  planned_shift_start: string | null;
  planned_shift_end: string | null;
  actual_login_time: string | null;
  actual_logout_time: string | null;
  actual_minutes: number;
  required_minutes: number;
  adherence_pct: number;
  attendance_status: AttendanceStatus;
  late_by_minutes: number;
  early_exit_minutes: number;
}

interface AdherenceAlert {
  id: string;
  alert_date: string;
  alert_type: string;
  severity: string;
  employee_id: string | null;
  actual_pct: number | null;
  breach_minutes: number | null;
  status: string;
  created_at: string;
}

interface ShrinkageSnapshot {
  id: string;
  snapshot_date: string;
  rostered_hc: number;
  present_hc: number;
  absent_hc: number;
  on_leave_hc: number;
  late_count: number;
  total_shrinkage_pct: number;
  avg_adherence_pct: number;
}

interface Process {
  id: string;
  process_name?: string;
  process_code?: string;
}

type UserRole = "admin" | "hr" | "wfm" | "operations" | "manager" | string;

// ── Helpers ───────────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);

function fmtTime(dt: string | null): string {
  if (!dt) return "–";
  const d = new Date(dt);
  if (isNaN(d.getTime())) return dt.slice(11, 16) || "–";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function fmtMins(mins: number): string {
  if (!mins) return "–";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function statusLabel(s: AttendanceStatus): string {
  const map: Record<AttendanceStatus, string> = {
    present: "On Time",
    late: "Late",
    early_exit: "Early Exit",
    absent: "Absent",
    half_day: "Half Day",
    leave_approved: "On Leave",
    holiday: "Holiday",
    week_off: "Week Off",
    unreconciled: "Unreconciled",
  };
  return map[s] ?? s;
}

function statusClass(s: AttendanceStatus): string {
  switch (s) {
    case "present":       return "bg-emerald-100 text-emerald-800";
    case "late":          return "bg-amber-100 text-amber-800";
    case "early_exit":    return "bg-orange-100 text-orange-800";
    case "absent":        return "bg-rose-100 text-rose-800";
    case "leave_approved":return "bg-blue-100 text-blue-800";
    case "half_day":      return "bg-yellow-100 text-yellow-800";
    case "unreconciled":  return "bg-slate-100 text-slate-600";
    default:              return "bg-slate-100 text-slate-600";
  }
}

function alertSeverityClass(sev: string): string {
  switch (sev) {
    case "critical": return "border-rose-300 bg-rose-50 text-rose-800";
    case "warning":  return "border-amber-300 bg-amber-50 text-amber-800";
    default:         return "border-blue-200 bg-blue-50 text-blue-800";
  }
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({
  title, value, sub, icon, tone,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
          {sub && <p className="mt-1 text-xs font-semibold text-slate-400">{sub}</p>}
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const AUTO_REFRESH_MS = 2 * 60 * 1000; // 2 minutes

const SHRINKAGE_ROLES: UserRole[] = ["admin", "hr", "wfm", "operations", "wfm_manager"];

export default function NativeRTABoard() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [date, setDate]           = useState<string>(today());
  const [processId, setProcessId] = useState<string>("");
  const [notice, setNotice]       = useState<string>("");

  // ── Processes ───────────────────────────────────────────────────────────────
  const processesQ = useQuery({
    queryKey: ["processes"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: Process[] }>("/api/processes");
      return res.data ?? [];
    },
  });
  const processes: Process[] = processesQ.data ?? [];

  // ── Query keys ──────────────────────────────────────────────────────────────
  const reconKey     = ["rta-reconciliation", date, processId];
  const alertsKey    = ["rta-alerts", date, processId];
  const shrinkageKey = ["rta-shrinkage", date, processId];

  // ── Reconciliation data ──────────────────────────────────────────────────────
  const reconQ = useQuery({
    queryKey: reconKey,
    queryFn: async () => {
      const params = new URLSearchParams({ fromDate: date, toDate: date, limit: "500", page: "1" });
      if (processId) params.set("processId", processId);
      const res = await hrmsApi.get<{ success: boolean; data: ReconRecord[]; total: number }>(
        `/api/rta/reconciliation?${params}`,
      );
      return res.data ?? [];
    },
  });

  const rows: ReconRecord[] = reconQ.data ?? [];

  // ── Alerts ───────────────────────────────────────────────────────────────────
  const alertsQ = useQuery({
    queryKey: alertsKey,
    queryFn: async () => {
      const params = new URLSearchParams({ fromDate: date, toDate: date, status: "open", limit: "50", page: "1" });
      if (processId) params.set("processId", processId);
      const res = await hrmsApi.get<{ success: boolean; data: AdherenceAlert[] }>(
        `/api/rta/alerts?${params}`,
      );
      return res.data ?? [];
    },
  });

  const alerts: AdherenceAlert[] = alertsQ.data ?? [];
  const criticalAlerts = alerts.filter((a) => a.severity === "critical");

  // ── Shrinkage snapshot ───────────────────────────────────────────────────────
  const shrinkageQ = useQuery({
    queryKey: shrinkageKey,
    queryFn: async () => {
      const params = new URLSearchParams({ fromDate: date, toDate: date });
      if (processId) params.set("processId", processId);
      const res = await hrmsApi.get<{ success: boolean; data: ShrinkageSnapshot[] }>(
        `/api/rta/shrinkage?${params}`,
      );
      return (res.data ?? [])[0] ?? null;
    },
  });

  const snapshot: ShrinkageSnapshot | null = shrinkageQ.data ?? null;

  // ── Log shrinkage snapshot mutation ──────────────────────────────────────────
  const snapshotMut = useMutation({
    mutationFn: () =>
      hrmsApi.post<{ success: boolean; data: ShrinkageSnapshot }>(
        "/api/rta/shrinkage/snapshot",
        { date, ...(processId ? { processId } : {}) },
      ),
    onSuccess: () => {
      setNotice("Shrinkage snapshot recorded.");
      void qc.invalidateQueries({ queryKey: shrinkageKey });
    },
    onError: (err: Error) => setNotice(err.message ?? "Snapshot failed."),
  });

  // ── Acknowledge alert mutation ────────────────────────────────────────────────
  const ackAlertMut = useMutation({
    mutationFn: (alertId: string) =>
      hrmsApi.patch<{ success: boolean }>(`/api/rta/alerts/${alertId}/acknowledge`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: alertsKey }),
    onError: (err: Error) => setNotice(err.message ?? "Acknowledge failed."),
  });

  // ── Summary cards ─────────────────────────────────────────────────────────────
  const rostered    = snapshot?.rostered_hc  ?? rows.length;
  const loggedIn    = snapshot?.present_hc   ?? rows.filter((r) => r.attendance_status === "present").length;
  const absent      = snapshot?.absent_hc    ?? rows.filter((r) => r.attendance_status === "absent").length;
  const lateLogins  = snapshot?.late_count   ?? rows.filter((r) => r.attendance_status === "late").length;
  const earlyExits  = rows.filter((r) => r.attendance_status === "early_exit").length;
  const adherencePct = snapshot?.avg_adherence_pct
    ?? (rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + r.adherence_pct, 0) / rows.length)
      : 0);

  // ── Auto-refresh every 2 minutes ─────────────────────────────────────────────
  const refreshAll = useCallback(() => {
    void qc.invalidateQueries({ queryKey: reconKey });
    void qc.invalidateQueries({ queryKey: alertsKey });
    void qc.invalidateQueries({ queryKey: shrinkageKey });
  }, [date, processId]); // eslint-disable-line react-hooks/exhaustive-deps

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(refreshAll, AUTO_REFRESH_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refreshAll]);

  const isLoading = reconQ.isFetching || shrinkageQ.isFetching;

  const canLogSnapshot = SHRINKAGE_ROLES.some((r) =>
    (user as { role?: string } | null)?.role === r,
  );

  // Determine whether adherence threshold is breached (< 85%)
  const adherenceBreached = adherencePct < 85 && rows.length > 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">

        {/* Header */}
        <header className="rounded-3xl bg-slate-950 p-6 text-white">
          <p className="text-xs font-black uppercase tracking-[.22em] text-blue-300">
            RTA · Real-Time Adherence
          </p>
          <h1 className="mt-2 text-3xl font-black">RTA Board</h1>
          <p className="mt-2 text-sm text-slate-300">
            Planned vs actual attendance reconciliation, shrinkage and adherence alerts.
            Auto-refreshes every 2 minutes.
          </p>
        </header>

        {/* Notice */}
        {notice && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm font-semibold text-blue-800">
            {notice}
          </div>
        )}

        {/* Adherence breach alert banner */}
        {adherenceBreached && (
          <div className="flex items-start gap-3 rounded-2xl border-2 border-rose-400 bg-rose-50 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <p className="font-bold text-rose-800">
              Adherence is below threshold ({adherencePct}% &lt; 85%) for the selected
              process/date. Review the table below and escalate if needed.
            </p>
          </div>
        )}

        {/* Critical alert banners */}
        {criticalAlerts.length > 0 && (
          <div className="space-y-2">
            {criticalAlerts.map((a) => (
              <div
                key={a.id}
                className="flex items-start justify-between gap-4 rounded-xl border-2 border-rose-300 bg-rose-50 p-3"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  <span className="text-sm font-bold text-rose-800">
                    CRITICAL · {a.alert_type.replace(/_/g, " ").toUpperCase()}
                    {a.actual_pct !== null ? ` — ${a.actual_pct}%` : ""}
                    {a.breach_minutes ? ` (${fmtMins(a.breach_minutes)} breach)` : ""}
                  </span>
                </div>
                <button
                  onClick={() => ackAlertMut.mutate(a.id)}
                  className="shrink-0 rounded-lg bg-rose-600 px-3 py-1 text-xs font-bold text-white hover:bg-rose-700"
                >
                  Ack
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="rounded-3xl border bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
            <label className="text-xs font-bold uppercase text-slate-500">
              Date
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 block w-full rounded-xl border px-4 py-3 text-sm"
              />
            </label>
            <label className="text-xs font-bold uppercase text-slate-500">
              Process
              <select
                value={processId}
                onChange={(e) => setProcessId(e.target.value)}
                className="mt-1 block w-full rounded-xl border px-4 py-3 text-sm"
              >
                <option value="">All Processes</option>
                {processes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.process_name ?? p.process_code ?? p.id}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={refreshAll}
              disabled={isLoading}
              className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:bg-slate-300"
            >
              <RefreshCcw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            {canLogSnapshot && (
              <button
                onClick={() => snapshotMut.mutate()}
                disabled={snapshotMut.isPending}
                className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50"
              >
                <Activity className="h-4 w-4" />
                {snapshotMut.isPending ? "Recording..." : "Log Shrinkage Snapshot"}
              </button>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          <StatCard
            title="Rostered HC"
            value={rostered}
            sub={snapshot ? "from snapshot" : "from records"}
            icon={<Users className="h-5 w-5" />}
            tone="bg-slate-100 text-slate-700"
          />
          <StatCard
            title="Logged In"
            value={loggedIn}
            sub="present / on time"
            icon={<UserCheck className="h-5 w-5" />}
            tone="bg-emerald-50 text-emerald-700"
          />
          <StatCard
            title="Absent"
            value={absent}
            sub="no show"
            icon={<UserX className="h-5 w-5" />}
            tone="bg-rose-50 text-rose-700"
          />
          <StatCard
            title="Late Logins"
            value={lateLogins}
            sub="after grace period"
            icon={<Clock className="h-5 w-5" />}
            tone="bg-amber-50 text-amber-700"
          />
          <StatCard
            title="Early Exits"
            value={earlyExits}
            sub="left before end"
            icon={<UserMinus className="h-5 w-5" />}
            tone="bg-orange-50 text-orange-700"
          />
          <StatCard
            title="Adherence %"
            value={`${adherencePct}%`}
            sub={adherenceBreached ? "BELOW THRESHOLD" : "avg for date"}
            icon={<TrendingDown className="h-5 w-5" />}
            tone={adherenceBreached ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"}
          />
        </div>

        {/* Alerts Section */}
        {alerts.length > 0 && (
          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-black text-slate-900">Open Alerts ({alerts.length})</h2>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {alerts.map((a) => (
                <div
                  key={a.id}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${alertSeverityClass(a.severity)}`}
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span className="text-sm font-semibold">
                      {a.alert_type.replace(/_/g, " ").toUpperCase()}
                      {a.actual_pct !== null ? ` · ${a.actual_pct}%` : ""}
                      {a.breach_minutes ? ` · ${fmtMins(a.breach_minutes)}` : ""}
                    </span>
                    <span className="text-xs opacity-70">{a.alert_date}</span>
                  </div>
                  <button
                    onClick={() => ackAlertMut.mutate(a.id)}
                    className="shrink-0 rounded-lg border px-3 py-1 text-xs font-bold hover:bg-white/50"
                  >
                    Ack
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Employee Reconciliation Table */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="font-black text-slate-950">Attendance Reconciliation</h2>
            <p className="text-sm text-slate-500">
              {rows.length} employee records · {date}
              {processId ? ` · ${processes.find((p) => p.id === processId)?.process_name ?? processId}` : " · All Processes"}
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-950" />
            </div>
          ) : rows.length === 0 ? (
            <div className="py-20 text-center text-sm text-slate-400">
              No reconciliation records for {date}.
              {" "}Run a reconcile from the WFM Live Tracker to populate data.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-4">Employee</th>
                    <th className="p-4">Process / Branch</th>
                    <th className="p-4">Planned Shift</th>
                    <th className="p-4">Actual In</th>
                    <th className="p-4">Actual Out</th>
                    <th className="p-4">Variance</th>
                    <th className="p-4">Adherence</th>
                    <th className="p-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const variance =
                      r.late_by_minutes > 0
                        ? `+${fmtMins(r.late_by_minutes)} late`
                        : r.early_exit_minutes > 0
                        ? `-${fmtMins(r.early_exit_minutes)} early`
                        : r.actual_minutes > 0
                        ? <span className="text-emerald-700 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />On time</span>
                        : "–";

                    return (
                      <tr key={r.id} className="border-t hover:bg-slate-50 transition-colors">
                        <td className="p-4">
                          <div className="font-bold text-slate-900">{r.employee_name}</div>
                          <div className="text-xs text-slate-500">{r.employee_code}</div>
                        </td>
                        <td className="p-4">
                          <div>{r.process_name || "–"}</div>
                          <div className="text-xs text-slate-400">{r.branch_name || ""}</div>
                        </td>
                        <td className="p-4">
                          {r.planned_shift_start && r.planned_shift_end ? (
                            <>
                              <div>{r.planned_shift_start.slice(0, 5)}</div>
                              <div className="text-xs text-slate-400">→ {r.planned_shift_end.slice(0, 5)}</div>
                            </>
                          ) : (
                            <span className="text-slate-400">–</span>
                          )}
                        </td>
                        <td className="p-4 font-mono">{fmtTime(r.actual_login_time)}</td>
                        <td className="p-4 font-mono">{fmtTime(r.actual_logout_time)}</td>
                        <td className="p-4">
                          <span
                            className={
                              r.late_by_minutes > 0
                                ? "font-bold text-amber-700"
                                : r.early_exit_minutes > 0
                                ? "font-bold text-orange-700"
                                : "text-slate-600"
                            }
                          >
                            {variance}
                          </span>
                        </td>
                        <td className="p-4">
                          <span
                            className={
                              r.adherence_pct >= 90
                                ? "font-black text-emerald-700"
                                : r.adherence_pct >= 70
                                ? "font-bold text-amber-600"
                                : "font-bold text-rose-600"
                            }
                          >
                            {r.adherence_pct}%
                          </span>
                        </td>
                        <td className="p-4">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(r.attendance_status)}`}
                          >
                            {statusLabel(r.attendance_status)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
