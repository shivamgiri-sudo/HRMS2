/**
 * Employee Roster Profile — Phase 4
 *
 * Design System: MAS HRMS Frozen Patterns
 * - GlassCard containers with backdrop-blur
 * - Gradient headers (teal for attendance domain)
 * - Tone color system for adherence status
 * - Responsive: mobile-first grid
 *
 * Features:
 * 1. Individual employee roster adherence history
 * 2. 6-month trend visualization
 * 3. Pattern analysis (day-of-week, shift preference)
 * 4. Comparison to team/branch averages
 * 5. Intervention history (if any)
 */
import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  CheckCircle2,
  Clock,
  TrendingDown,
  TrendingUp,
  User,
  Users,
  Target,
  Activity,
  BarChart3,
  XCircle,
} from "lucide-react";
import { Link } from "react-router-dom";

// ── Types ────────────────────────────────────────────────────────────────────

interface EmployeeRosterProfile {
  employee: {
    id: string;
    employeeCode: string;
    fullName: string;
    designation: string | null;
    processName: string | null;
    branchName: string | null;
    managerId: string | null;
    managerName: string | null;
    dateOfJoining: string;
    aonDays: number;
  };
  currentPeriod: {
    month: string;
    planned: number;
    present: number;
    adherencePct: number;
    onTime: number;
    late: number;
    absent: number;
    incomplete: number;
  };
  trend: Array<{
    month: string;
    adherencePct: number;
    onTimePct: number;
    latePct: number;
    absentPct: number;
  }>;
  dayOfWeekPattern: Array<{
    day: string;
    totalRostered: number;
    adherencePct: number;
    isWeakDay: boolean;
  }>;
  shiftPattern: Array<{
    shiftName: string;
    totalRostered: number;
    adherencePct: number;
  }>;
  comparison: {
    teamAvg: number;
    branchAvg: number;
    employeePct: number;
    vsTeam: number;
    vsBranch: number;
  };
  riskSignals: {
    tier: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | null;
    score: number | null;
    signals: string[];
  };
  recentInterventions: Array<{
    id: string;
    date: string;
    action: string;
    outcome: string;
  }>;
}

// ── Design Tokens (MAS HRMS Frozen) ──────────────────────────────────────────

const TONE = {
  blue: { iconBg: "#edf4ff", value: "#0b63e5", border: "#dce8fb" },
  green: { iconBg: "#eaf8ef", value: "#15803d", border: "#d7f0df" },
  amber: { iconBg: "#fff4e8", value: "#ea580c", border: "#fee3c5" },
  red: { iconBg: "#fff0f1", value: "#dc2626", border: "#ffdadd" },
  violet: { iconBg: "#f3efff", value: "#6d28d9", border: "#e6ddff" },
  teal: { iconBg: "#f0fdfa", value: "#0f766e", border: "#99f6e4" },
  slate: { iconBg: "#f1f4f8", value: "#0b1f44", border: "#e3e9f2" },
};

const ADHERENCE_STATUS = {
  GREEN: { label: "On-Time", color: "#15803d", bg: "#eaf8ef" },
  AMBER: { label: "Late", color: "#ea580c", bg: "#fff4e8" },
  RED: { label: "Absent", color: "#dc2626", bg: "#fff0f1" },
  BROWN: { label: "Incomplete", color: "#92400e", bg: "#fef3c7" },
  GREY: { label: "Off", color: "#64748b", bg: "#f1f5f9" },
};

// ── Subcomponents ────────────────────────────────────────────────────────────

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-all duration-200 ${className}`}>
      {children}
    </div>
  );
}

function MetricTile({
  label,
  value,
  helper,
  tone = "slate",
  trend,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  helper?: string;
  tone?: keyof typeof TONE;
  trend?: number;
  icon: React.ElementType;
}) {
  const colors = TONE[tone];
  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: colors.iconBg }}
        >
          <Icon className="h-5 w-5" style={{ color: colors.value }} />
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trend >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {trend >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div className="mt-3">
        <p className="text-2xl font-bold" style={{ color: colors.value }}>{value}</p>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        {helper && <p className="text-xs text-slate-500 mt-0.5">{helper}</p>}
      </div>
    </GlassCard>
  );
}

function TrendChart({ data }: { data: EmployeeRosterProfile["trend"] }) {
  const maxVal = 100;
  const height = 120;
  const width = data.length * 60;

  return (
    <div className="overflow-x-auto">
      <svg width={Math.max(width, 360)} height={height + 40} className="min-w-full">
        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line
              x1={40}
              y1={height - (v / maxVal) * height + 10}
              x2={width + 40}
              y2={height - (v / maxVal) * height + 10}
              stroke="#e2e8f0"
              strokeDasharray="4"
            />
            <text x={35} y={height - (v / maxVal) * height + 14} fontSize={10} fill="#94a3b8" textAnchor="end">
              {v}
            </text>
          </g>
        ))}

        {/* Line chart */}
        <polyline
          fill="none"
          stroke="#0f766e"
          strokeWidth={2}
          points={data.map((d, i) => `${i * 60 + 60},${height - (d.adherencePct / maxVal) * height + 10}`).join(" ")}
        />

        {/* Data points */}
        {data.map((d, i) => (
          <g key={d.month}>
            <circle
              cx={i * 60 + 60}
              cy={height - (d.adherencePct / maxVal) * height + 10}
              r={5}
              fill="#0f766e"
              stroke="white"
              strokeWidth={2}
            />
            <text
              x={i * 60 + 60}
              y={height + 30}
              fontSize={10}
              fill="#64748b"
              textAnchor="middle"
            >
              {d.month.slice(5)}
            </text>
            <text
              x={i * 60 + 60}
              y={height - (d.adherencePct / maxVal) * height - 5}
              fontSize={10}
              fill="#0f766e"
              fontWeight="bold"
              textAnchor="middle"
            >
              {d.adherencePct}%
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function DayPatternChart({ data }: { data: EmployeeRosterProfile["dayOfWeekPattern"] }) {
  return (
    <div className="flex items-end justify-between h-32 gap-2">
      {data.map((d) => (
        <div key={d.day} className="flex-1 flex flex-col items-center">
          <div
            className={`w-full rounded-t-lg transition-all ${
              d.isWeakDay
                ? "bg-gradient-to-t from-red-500 to-red-300"
                : "bg-gradient-to-t from-teal-600 to-teal-400"
            }`}
            style={{ height: `${Math.max(d.adherencePct * 0.8, 8)}px` }}
          />
          <span className="text-xs mt-2 text-slate-600 font-medium">{d.day.slice(0, 3)}</span>
          <span className={`text-xs font-bold ${d.isWeakDay ? "text-red-600" : "text-teal-700"}`}>
            {d.adherencePct}%
          </span>
        </div>
      ))}
    </div>
  );
}

function ComparisonBar({
  label,
  value,
  avg,
  maxVal = 100,
}: {
  label: string;
  value: number;
  avg: number;
  maxVal?: number;
}) {
  const diff = value - avg;
  const isAbove = diff >= 0;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className={`font-bold ${isAbove ? "text-emerald-600" : "text-red-600"}`}>
          {isAbove ? "+" : ""}{diff.toFixed(1)}%
        </span>
      </div>
      <div className="relative h-6 bg-slate-100 rounded-full overflow-hidden">
        {/* Average marker */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-slate-400 z-10"
          style={{ left: `${(avg / maxVal) * 100}%` }}
        />
        {/* Employee bar */}
        <div
          className={`absolute top-1 bottom-1 rounded-full ${isAbove ? "bg-emerald-500" : "bg-red-500"}`}
          style={{
            left: isAbove ? `${(avg / maxVal) * 100}%` : `${(value / maxVal) * 100}%`,
            width: `${Math.abs(diff)}%`,
          }}
        />
        {/* Labels */}
        <div className="absolute inset-0 flex items-center justify-between px-3 text-xs">
          <span className="text-slate-500">{value}%</span>
          <span className="text-slate-400">(avg: {avg}%)</span>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function EmployeeRosterProfile() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const [searchParams] = useSearchParams();
  const period = searchParams.get("period") || undefined;

  const { data: profileData, isLoading } = useQuery({
    queryKey: ["employee-roster-profile", employeeId, period],
    queryFn: () => {
      const params = new URLSearchParams();
      if (period) params.set("period", period);
      return hrmsApi.get<EmployeeRosterProfile>(
        `/api/roster-analytics/employee-profile/${employeeId}?${params}`
      );
    },
    enabled: !!employeeId,
  });

  if (!employeeId) {
    return (
      <DashboardLayout>
        <div className="p-6 text-center text-slate-500">
          Employee ID is required
        </div>
      </DashboardLayout>
    );
  }

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-teal-50/30 to-cyan-50/20 p-4 sm:p-6">
          <GlassCard className="py-12 text-center">
            <div className="animate-pulse">Loading employee roster profile...</div>
          </GlassCard>
        </div>
      </DashboardLayout>
    );
  }

  if (!profileData) {
    return (
      <DashboardLayout>
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-teal-50/30 to-cyan-50/20 p-4 sm:p-6">
          <GlassCard className="py-12 text-center">
            <XCircle className="h-12 w-12 mx-auto mb-3 text-red-400" />
            <p className="font-medium text-slate-700">Profile not found</p>
          </GlassCard>
        </div>
      </DashboardLayout>
    );
  }

  const { employee, currentPeriod, trend, dayOfWeekPattern, shiftPattern, comparison, riskSignals, recentInterventions } = profileData;

  const adherenceTone: keyof typeof TONE =
    currentPeriod.adherencePct >= 90 ? "green" : currentPeriod.adherencePct >= 75 ? "amber" : "red";

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-teal-50/30 to-cyan-50/20 p-4 sm:p-6">
        {/* Back link */}
        <Link to="/wfm/roster-view" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-800 mb-4">
          <ArrowLeft className="h-4 w-4" />
          Back to Roster View
        </Link>

        {/* Header with gradient (teal for attendance domain) */}
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-teal-600 via-cyan-600 to-blue-600 p-6 text-white shadow-lg shadow-teal-500/20">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
                <User className="h-8 w-8" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">{employee.fullName}</h1>
                <p className="text-teal-100 text-sm">{employee.employeeCode}</p>
                <div className="flex items-center gap-2 text-xs text-teal-200 mt-1">
                  <span>{employee.designation || "—"}</span>
                  <span>•</span>
                  <span>{employee.processName || "—"}</span>
                  <span>•</span>
                  <span>{employee.branchName || "—"}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-xs text-teal-200">Age on Network</p>
                <p className="text-xl font-bold">{employee.aonDays} days</p>
              </div>
              {riskSignals.tier && (
                <Badge
                  className="text-sm px-3 py-1"
                  style={{
                    backgroundColor: TONE[riskSignals.tier === "CRITICAL" ? "red" : riskSignals.tier === "HIGH" ? "amber" : "blue"].iconBg,
                    color: TONE[riskSignals.tier === "CRITICAL" ? "red" : riskSignals.tier === "HIGH" ? "amber" : "blue"].value,
                  }}
                >
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {riskSignals.tier} Risk
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* KPI Tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6">
          <MetricTile
            label="Adherence"
            value={`${currentPeriod.adherencePct}%`}
            helper={currentPeriod.month}
            tone={adherenceTone}
            icon={Target}
          />
          <MetricTile
            label="On-Time"
            value={currentPeriod.onTime}
            helper={`of ${currentPeriod.planned} planned`}
            tone="green"
            icon={CheckCircle2}
          />
          <MetricTile
            label="Late"
            value={currentPeriod.late}
            helper={`${((currentPeriod.late / currentPeriod.planned) * 100).toFixed(0)}%`}
            tone="amber"
            icon={Clock}
          />
          <MetricTile
            label="Absent"
            value={currentPeriod.absent}
            helper="Unplanned"
            tone="red"
            icon={XCircle}
          />
          <MetricTile
            label="vs Team"
            value={`${comparison.vsTeam > 0 ? "+" : ""}${comparison.vsTeam}%`}
            helper={`Team avg: ${comparison.teamAvg}%`}
            tone={comparison.vsTeam >= 0 ? "green" : "red"}
            icon={Users}
          />
          <MetricTile
            label="vs Branch"
            value={`${comparison.vsBranch > 0 ? "+" : ""}${comparison.vsBranch}%`}
            helper={`Branch avg: ${comparison.branchAvg}%`}
            tone={comparison.vsBranch >= 0 ? "green" : "red"}
            icon={Activity}
          />
        </div>

        {/* Main content grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Left column — 2 cols on lg */}
          <div className="lg:col-span-2 space-y-4">
            {/* 6-Month Trend */}
            <GlassCard>
              <div className="p-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-100">
                    <TrendingUp className="h-5 w-5 text-teal-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-800">6-Month Adherence Trend</h3>
                    <p className="text-xs text-slate-500">Monthly roster adherence percentage</p>
                  </div>
                </div>
              </div>
              <div className="p-4">
                {trend.length > 0 ? (
                  <TrendChart data={trend} />
                ) : (
                  <p className="text-center text-slate-400 py-8">No historical data available</p>
                )}
              </div>
            </GlassCard>

            {/* Day-of-Week Pattern */}
            <GlassCard>
              <div className="p-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100">
                    <Calendar className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-800">Day-of-Week Pattern</h3>
                    <p className="text-xs text-slate-500">Adherence by day (red = weak day)</p>
                  </div>
                </div>
              </div>
              <div className="p-4">
                {dayOfWeekPattern.length > 0 ? (
                  <DayPatternChart data={dayOfWeekPattern} />
                ) : (
                  <p className="text-center text-slate-400 py-8">No pattern data available</p>
                )}
              </div>
            </GlassCard>

            {/* Comparison */}
            <GlassCard>
              <div className="p-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100">
                    <BarChart3 className="h-5 w-5 text-violet-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-800">Comparison</h3>
                    <p className="text-xs text-slate-500">How this employee compares to averages</p>
                  </div>
                </div>
              </div>
              <div className="p-4 space-y-4">
                <ComparisonBar
                  label="vs Team Average"
                  value={comparison.employeePct}
                  avg={comparison.teamAvg}
                />
                <ComparisonBar
                  label="vs Branch Average"
                  value={comparison.employeePct}
                  avg={comparison.branchAvg}
                />
              </div>
            </GlassCard>
          </div>

          {/* Right column */}
          <div className="space-y-4">
            {/* Risk Signals */}
            {riskSignals.tier && (
              <GlassCard className={`border-${riskSignals.tier === "CRITICAL" ? "red" : riskSignals.tier === "HIGH" ? "amber" : "blue"}-200`}>
                <div className="p-4 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-xl"
                      style={{
                        backgroundColor: TONE[riskSignals.tier === "CRITICAL" ? "red" : riskSignals.tier === "HIGH" ? "amber" : "blue"].iconBg,
                      }}
                    >
                      <AlertTriangle
                        className="h-5 w-5"
                        style={{
                          color: TONE[riskSignals.tier === "CRITICAL" ? "red" : riskSignals.tier === "HIGH" ? "amber" : "blue"].value,
                        }}
                      />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-800">Risk Signals</h3>
                      <p className="text-xs text-slate-500">Attrition risk: {riskSignals.score}</p>
                    </div>
                  </div>
                </div>
                <div className="p-4">
                  <ul className="space-y-2">
                    {riskSignals.signals.map((signal, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                        <span className="text-amber-500 mt-0.5">•</span>
                        {signal}
                      </li>
                    ))}
                  </ul>
                </div>
              </GlassCard>
            )}

            {/* Shift Pattern */}
            <GlassCard>
              <div className="p-4 border-b border-slate-100">
                <h3 className="font-semibold text-slate-800">Shift Performance</h3>
              </div>
              <div className="p-4 space-y-3">
                {shiftPattern.length > 0 ? (
                  shiftPattern.map((shift) => (
                    <div key={shift.shiftName} className="flex items-center justify-between p-3 rounded-xl bg-slate-50">
                      <div>
                        <p className="font-medium text-slate-800">{shift.shiftName}</p>
                        <p className="text-xs text-slate-500">{shift.totalRostered} shifts</p>
                      </div>
                      <Badge
                        variant={shift.adherencePct >= 90 ? "default" : shift.adherencePct >= 75 ? "secondary" : "destructive"}
                      >
                        {shift.adherencePct}%
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-center text-slate-400 py-4">No shift data</p>
                )}
              </div>
            </GlassCard>

            {/* Recent Interventions */}
            <GlassCard>
              <div className="p-4 border-b border-slate-100">
                <h3 className="font-semibold text-slate-800">Recent Interventions</h3>
              </div>
              <div className="p-4">
                {recentInterventions.length > 0 ? (
                  <div className="space-y-3">
                    {recentInterventions.map((intervention) => (
                      <div key={intervention.id} className="p-3 rounded-xl bg-violet-50 border border-violet-200">
                        <p className="text-sm font-medium text-violet-800">{intervention.action}</p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                          <span>{new Date(intervention.date).toLocaleDateString()}</span>
                          <span>•</span>
                          <Badge variant={intervention.outcome === "retained" ? "default" : "secondary"} className="text-xs">
                            {intervention.outcome}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-slate-400 py-4">No interventions recorded</p>
                )}
              </div>
            </GlassCard>

            {/* Manager */}
            {employee.managerName && (
              <GlassCard>
                <div className="p-4 border-b border-slate-100">
                  <h3 className="font-semibold text-slate-800">Reporting Manager</h3>
                </div>
                <div className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                      <User className="h-5 w-5 text-slate-600" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-800">{employee.managerName}</p>
                      <p className="text-xs text-slate-500">Direct Manager</p>
                    </div>
                  </div>
                </div>
              </GlassCard>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
