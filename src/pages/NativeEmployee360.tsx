import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2, ArrowLeft, TrendingUp, TrendingDown, Minus,
  AlertTriangle, ShieldAlert, User, Clock, BarChart2,
  Phone, Activity, CheckCircle2, XCircle, ChevronRight
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

type Employee360 = {
  employee: {
    id: string; employee_code: string; first_name: string; last_name: string;
    date_of_joining: string; active_status: number; employment_status: string;
    aon_days: number; aon_bucket: string; tenure_months: number; experience_level: string;
    branch_name: string; process_name: string; cost_centre_name: string; designation_name: string;
    manager_name: string; manager_code: string; ctc?: number; source?: string;
  };
  attendanceMetrics: {
    total_days: number; present_days: number; half_days: number; absent_days: number;
    leave_days: number; missing_punch_days: number; late_marks: number; attendance_pct: number;
  } | null;
  wfmMetrics: {
    session_count: number; total_login_hours: number;
    break_compliance_pct: number | null; over_budget_sessions: number;
  } | null;
  qualityMetrics: {
    call_count: number; avg_quality: number; quality_volatility: number;
    recent_30d_quality: number; prior_30d_quality: number;
    quality_velocity: number; trend_pattern: string;
  } | null;
  kpiMetrics: Array<{
    metric_code: string; metric_name: string; unit: string;
    actual_value: number; target_value: number; achievement_pct: number;
  }>;
  dialerMetrics: {
    recent_avg_minutes: number; prior_avg_minutes: number;
    recent_total_hours: number; dialer_drop_pct: number;
  } | null;
  riskMetrics: {
    prediction_score: number; risk_tier: string; exit_probability_30d: number;
    factor_tenure: number; factor_attendance: number; factor_quality: number;
    factor_source: number; factor_ctc: number; factor_late: number;
    factor_pip: number; stability_bonus: number;
  } | null;
  pipStatus: {
    id: string; status: string; start_date: string; reason: string;
    latest_checkpoint_rating: string;
  } | null;
  openAlerts: Array<{ alert_type: string; severity: string; message: string; created_at: string }>;
  managerContext: {
    team_size: number; team_30d_attrition_pct: number;
  } | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v: any): number { return Number(v ?? 0); }

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function unwrap<T>(res: any): T {
  return (res?.data ?? res) as T;
}

function aonBadge(bucket: string) {
  const map: Record<string, string> = {
    "0-30":  "bg-red-100 text-red-700 border border-red-200",
    "31-60": "bg-amber-100 text-amber-700 border border-amber-200",
    "61-90": "bg-yellow-100 text-yellow-700 border border-yellow-200",
  };
  return map[bucket] ?? "bg-green-100 text-green-700 border border-green-200";
}

function riskBadge(tier: string) {
  if (tier === "CRITICAL") return "bg-red-100 text-red-700 border border-red-200";
  if (tier === "HIGH")     return "bg-orange-100 text-orange-700 border border-orange-200";
  if (tier === "MEDIUM")   return "bg-amber-100 text-amber-700 border border-amber-200";
  return "bg-green-100 text-green-700 border border-green-200";
}

function trendBadge(pattern: string) {
  if (pattern === "RAPID_DECLINE")    return "bg-red-100 text-red-700";
  if (pattern === "SUSTAINED_DECLINE") return "bg-orange-100 text-orange-700";
  if (pattern === "RECENT_DECLINE")   return "bg-amber-100 text-amber-700";
  return "bg-green-100 text-green-700";
}

function severityBadge(sev: string) {
  if (sev === "critical" || sev === "high") return "bg-red-100 text-red-700";
  if (sev === "medium")   return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

function breakComplianceColor(pct: number | null) {
  if (pct === null) return "text-slate-400";
  if (pct >= 90) return "text-green-600";
  if (pct >= 70) return "text-amber-600";
  return "text-red-600";
}

function dialerDropColor(pct: number) {
  if (pct > 25) return "text-red-600";
  if (pct >= 10) return "text-amber-600";
  return "text-green-600";
}

function achievementColor(pct: number) {
  if (pct >= 100) return "bg-green-500";
  if (pct >= 80)  return "bg-amber-500";
  return "bg-red-500";
}

function achievementTextColor(pct: number) {
  if (pct >= 100) return "text-green-600";
  if (pct >= 80)  return "text-amber-600";
  return "text-red-600";
}

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-100 bg-white p-5 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">{children}</h3>;
}

function StatRow({ label, value, valueClass = "text-slate-800" }: { label: string; value: React.ReactNode; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className={`text-sm font-medium ${valueClass}`}>{value}</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NativeEmployee360() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<string>(currentPeriod);

  const { data: raw, isLoading, isError, error } = useQuery({
    queryKey: ["employee-360", id, period],
    queryFn: () => hrmsApi.get(`/api/analytics/employee-360/${id}?period=${period}`),
    enabled: !!id,
  });

  const data: Employee360 | undefined = raw ? unwrap<Employee360>(raw) : undefined;

  // ── Loading ──
  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex h-64 items-center justify-center gap-2 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading employee profile…</span>
        </div>
      </DashboardLayout>
    );
  }

  // ── Error ──
  if (isError || !data) {
    return (
      <DashboardLayout>
        <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-500">
          <XCircle className="h-8 w-8 text-red-400" />
          <p className="text-sm">Failed to load employee 360 data.</p>
          <p className="text-xs text-red-500">{(error as any)?.message ?? "Unknown error"}</p>
          <button
            onClick={() => navigate(-1)}
            className="mt-2 flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
        </div>
      </DashboardLayout>
    );
  }

  const { employee, attendanceMetrics, wfmMetrics, qualityMetrics, kpiMetrics,
    dialerMetrics, riskMetrics, pipStatus, openAlerts, managerContext } = data;

  // ── Stat cards row ──
  const attPct = n(attendanceMetrics?.attendance_pct);
  const lateMarks = n(attendanceMetrics?.late_marks);
  const aonDays = n(employee.aon_days);

  return (
    <DashboardLayout>
      <div className="space-y-5 pb-10">

        {/* Nav bar */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          {/* Period selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">Period:</span>
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
        </div>

        {/* ── HEADER CARD ── */}
        <div className="rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 p-6 text-white shadow-lg">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            {/* Left: identity */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-mono font-medium">
                  {employee.employee_code}
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  employee.active_status ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"
                }`}>
                  {employee.employment_status ?? (employee.active_status ? "Active" : "Inactive")}
                </span>
              </div>
              <h1 className="text-2xl font-bold">
                {employee.first_name} {employee.last_name}
              </h1>
              <p className="text-indigo-200 text-sm">{employee.designation_name}</p>
              <div className="flex flex-wrap gap-3 mt-2 text-sm text-indigo-100">
                <span>{employee.branch_name}</span>
                <span className="opacity-50">·</span>
                <span>{employee.process_name}</span>
                {employee.cost_centre_name && (
                  <>
                    <span className="opacity-50">·</span>
                    <span>{employee.cost_centre_name}</span>
                  </>
                )}
              </div>
              <p className="text-xs text-indigo-200 mt-1">
                DOJ: {fmtDate(employee.date_of_joining)} · Tenure: {n(employee.tenure_months)} months · {employee.experience_level}
              </p>
            </div>

            {/* Right: risk + aon badges */}
            <div className="flex flex-row sm:flex-col gap-2 items-start sm:items-end flex-wrap">
              {riskMetrics && (
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${riskBadge(riskMetrics.risk_tier)}`}>
                  Risk: {riskMetrics.risk_tier}
                </span>
              )}
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${aonBadge(employee.aon_bucket)}`}>
                AoN {employee.aon_bucket}d
              </span>
              {employee.source && (
                <span className="rounded-full bg-white/20 px-3 py-1 text-xs text-white">
                  Source: {employee.source}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── ROW 1: 3 stat tiles ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Attendance % */}
          <Card>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Attendance</p>
            <p className={`mt-1 text-3xl font-bold ${attPct >= 90 ? "text-green-600" : attPct >= 75 ? "text-amber-600" : "text-red-600"}`}>
              {attPct.toFixed(1)}%
            </p>
            <p className="text-xs text-slate-400 mt-0.5">This period</p>
          </Card>

          {/* Late marks */}
          <Card>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Late Marks (30d)</p>
            <p className={`mt-1 text-3xl font-bold ${lateMarks === 0 ? "text-green-600" : lateMarks <= 3 ? "text-amber-600" : "text-red-600"}`}>
              {lateMarks}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">Instances</p>
          </Card>

          {/* AoN days */}
          <Card>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Age on Network</p>
            <p className={`mt-1 text-3xl font-bold ${aonDays >= 90 ? "text-green-600" : aonDays >= 61 ? "text-yellow-600" : aonDays >= 31 ? "text-amber-600" : "text-red-600"}`}>
              {aonDays}d
            </p>
            <p className="text-xs text-slate-400 mt-0.5">{employee.aon_bucket} bucket</p>
          </Card>
        </div>

        {/* ── ROW 2: Attendance + Quality ── */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">

          {/* Attendance card */}
          <Card>
            <SectionTitle>Attendance</SectionTitle>
            {!attendanceMetrics ? (
              <p className="text-sm text-slate-400">No attendance data for this period.</p>
            ) : (
              <>
                <StatRow label="Present days" value={`${n(attendanceMetrics.present_days)} / ${n(attendanceMetrics.total_days)}`} />
                <StatRow label="Absent days" value={n(attendanceMetrics.absent_days)} valueClass={n(attendanceMetrics.absent_days) > 0 ? "text-red-600" : "text-slate-800"} />
                <StatRow label="Half days" value={n(attendanceMetrics.half_days)} />
                <StatRow label="Leave days" value={n(attendanceMetrics.leave_days)} />
                <StatRow label="Missing punch" value={n(attendanceMetrics.missing_punch_days)} valueClass={n(attendanceMetrics.missing_punch_days) > 0 ? "text-amber-600" : "text-slate-800"} />
                <StatRow label="Late marks" value={n(attendanceMetrics.late_marks)} valueClass={n(attendanceMetrics.late_marks) > 0 ? "text-amber-600" : "text-slate-800"} />

                {/* Attendance % progress bar */}
                <div className="mt-3">
                  <div className="flex justify-between mb-1">
                    <span className="text-xs text-slate-500">Attendance %</span>
                    <span className={`text-xs font-semibold ${attPct >= 90 ? "text-green-600" : attPct >= 75 ? "text-amber-600" : "text-red-600"}`}>
                      {attPct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100">
                    <div
                      className={`h-2 rounded-full ${attPct >= 90 ? "bg-green-500" : attPct >= 75 ? "bg-amber-500" : "bg-red-500"}`}
                      style={{ width: `${Math.min(attPct, 100)}%` }}
                    />
                  </div>
                </div>
              </>
            )}
          </Card>

          {/* Quality card */}
          <Card>
            <SectionTitle>Quality</SectionTitle>
            {!qualityMetrics ? (
              <p className="text-sm text-slate-400">No quality data available.</p>
            ) : (
              <>
                <div className="flex items-end gap-3 mb-4">
                  <span className="text-4xl font-bold text-slate-800">
                    {n(qualityMetrics.avg_quality).toFixed(1)}
                  </span>
                  <div className="mb-1 flex flex-col gap-1">
                    <span className="text-xs text-slate-400">Avg score</span>
                    {/* Velocity */}
                    <span className={`flex items-center gap-1 text-sm font-semibold ${n(qualityMetrics.quality_velocity) > 0 ? "text-green-600" : n(qualityMetrics.quality_velocity) < 0 ? "text-red-600" : "text-slate-500"}`}>
                      {n(qualityMetrics.quality_velocity) > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : n(qualityMetrics.quality_velocity) < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                      {Math.abs(n(qualityMetrics.quality_velocity)).toFixed(1)} velocity
                    </span>
                  </div>
                  {/* Trend badge */}
                  <span className={`ml-auto self-start rounded-full px-2.5 py-0.5 text-xs font-medium ${trendBadge(qualityMetrics.trend_pattern)}`}>
                    {qualityMetrics.trend_pattern.replace(/_/g, " ")}
                  </span>
                </div>

                <StatRow label="Recent 30d score" value={n(qualityMetrics.recent_30d_quality).toFixed(1)} />
                <StatRow label="Prior 30d score" value={n(qualityMetrics.prior_30d_quality).toFixed(1)} />
                <StatRow label="Call count" value={n(qualityMetrics.call_count).toLocaleString()} />
                <StatRow label="Volatility" value={n(qualityMetrics.quality_volatility).toFixed(2)} />
              </>
            )}
          </Card>
        </div>

        {/* ── ROW 3: WFM + Dialer ── */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">

          {/* WFM card */}
          <Card>
            <SectionTitle>WFM / Login</SectionTitle>
            {!wfmMetrics ? (
              <p className="text-sm text-slate-400">No WFM data for this period.</p>
            ) : (
              <>
                <StatRow label="Total login hours" value={`${n(wfmMetrics.total_login_hours).toFixed(1)} h`} />
                <StatRow label="Session count" value={n(wfmMetrics.session_count)} />
                <StatRow
                  label="Break compliance"
                  value={wfmMetrics.break_compliance_pct !== null ? `${n(wfmMetrics.break_compliance_pct).toFixed(1)}%` : "—"}
                  valueClass={breakComplianceColor(wfmMetrics.break_compliance_pct)}
                />
                <StatRow
                  label="Over-budget sessions"
                  value={n(wfmMetrics.over_budget_sessions)}
                  valueClass={n(wfmMetrics.over_budget_sessions) > 0 ? "text-amber-600" : "text-slate-800"}
                />
              </>
            )}
          </Card>

          {/* Dialer card */}
          <Card>
            <SectionTitle>Dialer Performance</SectionTitle>
            {!dialerMetrics ? (
              <p className="text-sm text-slate-400">No dialer data for this period.</p>
            ) : (
              <>
                <StatRow label="Recent avg minutes" value={`${n(dialerMetrics.recent_avg_minutes).toFixed(1)} min`} />
                <StatRow label="Prior avg minutes" value={`${n(dialerMetrics.prior_avg_minutes).toFixed(1)} min`} />
                <StatRow label="Total hours" value={`${n(dialerMetrics.recent_total_hours).toFixed(1)} h`} />
                <StatRow
                  label="Dialer drop %"
                  value={`${n(dialerMetrics.dialer_drop_pct).toFixed(1)}%`}
                  valueClass={dialerDropColor(n(dialerMetrics.dialer_drop_pct))}
                />
              </>
            )}
          </Card>
        </div>

        {/* ── Risk Breakdown ── */}
        {riskMetrics && (
          <Card>
            <SectionTitle>Attrition Risk Breakdown</SectionTitle>
            <div className="flex flex-col sm:flex-row sm:items-start gap-5">
              {/* Big score */}
              <div className="flex flex-col items-center gap-1 min-w-[120px]">
                <span className="text-5xl font-bold text-slate-800">{n(riskMetrics.prediction_score).toFixed(0)}</span>
                <span className="text-xs text-slate-400">Prediction score</span>
                <span className={`mt-1 rounded-full px-3 py-0.5 text-xs font-semibold ${riskBadge(riskMetrics.risk_tier)}`}>
                  {riskMetrics.risk_tier}
                </span>
                <span className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-center text-sm font-semibold text-red-700">
                  {(n(riskMetrics.exit_probability_30d) * 100).toFixed(0)}% exit chance in 30d
                </span>
              </div>

              {/* Factors */}
              <div className="flex-1 space-y-0">
                {[
                  { label: "Tenure", value: riskMetrics.factor_tenure, isBonus: false },
                  { label: "Attendance", value: riskMetrics.factor_attendance, isBonus: false },
                  { label: "Quality", value: riskMetrics.factor_quality, isBonus: false },
                  { label: "Source", value: riskMetrics.factor_source, isBonus: false },
                  { label: "CTC", value: riskMetrics.factor_ctc, isBonus: false },
                  { label: "Late marks", value: riskMetrics.factor_late, isBonus: false },
                  { label: "PIP", value: riskMetrics.factor_pip, isBonus: false },
                  { label: "Stability bonus", value: riskMetrics.stability_bonus, isBonus: true },
                ].map(({ label, value, isBonus }) => (
                  <div key={label} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                    <span className="text-sm text-slate-500">{label}</span>
                    <span className={`flex items-center gap-1.5 text-sm font-medium ${
                      isBonus ? "text-green-600" : n(value) > 0 ? "text-red-600" : "text-slate-400"
                    }`}>
                      <span className={`h-2 w-2 rounded-full ${
                        isBonus ? "bg-green-400" : n(value) > 0 ? "bg-red-400" : "bg-slate-300"
                      }`} />
                      {isBonus ? `−${Math.abs(n(value)).toFixed(2)}` : `+${n(value).toFixed(2)}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

        {/* ── KPI card ── */}
        {kpiMetrics && kpiMetrics.length > 0 && (
          <Card>
            <SectionTitle>KPI Performance</SectionTitle>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs text-slate-400 uppercase tracking-wider">
                    <th className="pb-2 text-left font-medium">Metric</th>
                    <th className="pb-2 text-right font-medium">Actual</th>
                    <th className="pb-2 text-right font-medium">Target</th>
                    <th className="pb-2 text-right font-medium">Achievement</th>
                    <th className="pb-2 text-left pl-4 font-medium w-32">Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {kpiMetrics.map((k) => (
                    <tr key={k.metric_code} className="border-b border-slate-50 last:border-0">
                      <td className="py-2.5 pr-4">
                        <span className="font-medium text-slate-700">{k.metric_name}</span>
                        <span className="ml-1.5 text-xs text-slate-400">({k.unit})</span>
                      </td>
                      <td className="py-2.5 text-right text-slate-800">{n(k.actual_value).toFixed(1)}</td>
                      <td className="py-2.5 text-right text-slate-500">{n(k.target_value).toFixed(1)}</td>
                      <td className={`py-2.5 text-right font-semibold ${achievementTextColor(n(k.achievement_pct))}`}>
                        {n(k.achievement_pct).toFixed(1)}%
                      </td>
                      <td className="py-2.5 pl-4">
                        <div className="h-2 w-full rounded-full bg-slate-100">
                          <div
                            className={`h-2 rounded-full ${achievementColor(n(k.achievement_pct))}`}
                            style={{ width: `${Math.min(n(k.achievement_pct), 100)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* ── Manager & Team context ── */}
        <Card>
          <SectionTitle>Manager &amp; Team Context</SectionTitle>
          <StatRow label="Manager" value={`${employee.manager_name ?? "—"} (${employee.manager_code ?? "—"})`} />
          {managerContext ? (
            <>
              <StatRow label="Team size" value={n(managerContext.team_size)} />
              <StatRow
                label="Team 30d attrition"
                value={`${n(managerContext.team_30d_attrition_pct).toFixed(1)}%`}
                valueClass={n(managerContext.team_30d_attrition_pct) > 10 ? "text-red-600" : n(managerContext.team_30d_attrition_pct) > 5 ? "text-amber-600" : "text-green-600"}
              />
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-400">No team context data.</p>
          )}
        </Card>

        {/* ── PIP & Alerts ── */}
        <Card>
          <SectionTitle>PIP &amp; Open Alerts</SectionTitle>

          {/* PIP status */}
          {pipStatus ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                  <span className="text-sm font-semibold text-amber-800">Active PIP</span>
                </div>
                <span className="rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                  {pipStatus.status}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-amber-700">
                Started: {fmtDate(pipStatus.start_date)}
              </p>
              <p className="text-sm text-amber-700">Reason: {pipStatus.reason}</p>
              {pipStatus.latest_checkpoint_rating && (
                <p className="text-sm text-amber-700">
                  Latest checkpoint: <span className="font-medium">{pipStatus.latest_checkpoint_rating}</span>
                </p>
              )}
            </div>
          ) : (
            <p className="mb-3 text-sm text-slate-400">No active PIP.</p>
          )}

          {/* Alerts */}
          {openAlerts && openAlerts.length > 0 ? (
            <div className="space-y-2">
              {openAlerts.map((alert, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3"
                >
                  <ShieldAlert className={`h-4 w-4 mt-0.5 flex-shrink-0 ${alert.severity === "critical" || alert.severity === "high" ? "text-red-500" : alert.severity === "medium" ? "text-amber-500" : "text-slate-400"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-700">{alert.alert_type.replace(/_/g, " ")}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityBadge(alert.severity)}`}>
                        {alert.severity}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-slate-500">{alert.message}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{fmtDate(alert.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No open alerts.</p>
          )}
        </Card>

      </div>
    </DashboardLayout>
  );
}
