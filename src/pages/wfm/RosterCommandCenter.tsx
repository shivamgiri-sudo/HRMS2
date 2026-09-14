/**
 * Roster Command Center — Real-Time Attendance Intelligence
 *
 * Design System: MAS HRMS Frozen Patterns
 * - GlassCard containers with backdrop-blur
 * - Gradient headers (teal for attendance domain)
 * - Tone color system for KPIs
 * - Bento grid layout (density 8/10)
 * - Real-time pulse indicators
 * - Responsive: mobile-first grid
 *
 * Features:
 * 1. Live attendance monitoring with pulse indicators
 * 2. Manager effectiveness scores with progress rings
 * 3. Intervention tracking for at-risk employees
 * 4. Real-time shrinkage meter
 */
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  CheckCircle2,
  Clock,
  Eye,
  MessageSquare,
  RefreshCw,
  Target,
  TrendingDown,
  TrendingUp,
  UserCheck,
  UserX,
  Users,
  Zap,
} from "lucide-react";

const ALL = "__all__";

// ── Types ────────────────────────────────────────────────────────────────────

interface LiveAttendanceData {
  total: number;
  alerts: Array<{
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    date: string;
    shiftTime: string;
    managerId: string | null;
    managerName: string | null;
    processName: string | null;
    branchName: string | null;
    minutesSinceShiftStart: number;
  }>;
  byManager: Record<string, typeof this.alerts>;
}

interface ManagerDigest {
  managerId: string;
  managerName: string;
  managerEmail: string | null;
  date: string;
  teamSize: number;
  planned: number;
  present: number;
  shrinkagePct: number;
  unplannedAbsences: Array<{ employeeId: string; employeeCode: string; employeeName: string }>;
  lateArrivals: Array<{ employeeId: string; employeeCode: string; employeeName: string; lateMinutes: number | null }>;
  incompleteShifts: Array<{ employeeId: string; employeeCode: string; employeeName: string; workedPct: number | null }>;
  onTime: Array<{ employeeId: string; employeeCode: string; employeeName: string }>;
  aprPending: number;
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

// ── Subcomponents ────────────────────────────────────────────────────────────

/** Pulsing live indicator */
function LivePulse({ active = true }: { active?: boolean }) {
  return (
    <span className="relative flex h-3 w-3">
      {active && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      )}
      <span className={`relative inline-flex h-3 w-3 rounded-full ${active ? "bg-emerald-500" : "bg-slate-300"}`} />
    </span>
  );
}

/** Glass card wrapper (MAS HRMS pattern) */
function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-all duration-200 ${className}`}>
      {children}
    </div>
  );
}

/** KPI Metric Tile with tone color */
function MetricTile({
  label,
  value,
  helper,
  tone = "slate",
  trend,
  icon: Icon,
  pulse,
}: {
  label: string;
  value: string | number;
  helper?: string;
  tone?: keyof typeof TONE;
  trend?: number;
  icon: React.ElementType;
  pulse?: boolean;
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
        {pulse && <LivePulse />}
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trend >= 0 ? "text-red-600" : "text-emerald-600"}`}>
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

/** Circular progress ring for scores */
function ScoreRing({ score, size = 80, strokeWidth = 8, label }: { score: number; size?: number; strokeWidth?: number; label?: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const color = score >= 80 ? "#15803d" : score >= 60 ? "#ea580c" : "#dc2626";

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <span className="text-xl font-bold" style={{ color }}>{score}</span>
      </div>
      {label && <span className="mt-1 text-xs font-medium text-slate-600">{label}</span>}
    </div>
  );
}

/** Manager effectiveness card */
function ManagerEffectivenessCard({ digest }: { digest: ManagerDigest }) {
  // Calculate effectiveness score: (present/planned)*40 + (onTime/present)*30 + (100-shrinkage)*20 + (aprPending<3?10:0)
  const presentScore = digest.planned > 0 ? (digest.present / digest.planned) * 40 : 40;
  const onTimeScore = digest.present > 0 ? (digest.onTime.length / digest.present) * 30 : 30;
  const shrinkageScore = Math.max(0, (100 - digest.shrinkagePct) / 100 * 20);
  const aprScore = digest.aprPending < 3 ? 10 : digest.aprPending < 5 ? 5 : 0;
  const totalScore = Math.round(presentScore + onTimeScore + shrinkageScore + aprScore);

  const tone = totalScore >= 80 ? "green" : totalScore >= 60 ? "amber" : "red";

  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-4">
        <div className="relative">
          <ScoreRing score={totalScore} size={64} strokeWidth={6} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-slate-800 truncate">{digest.managerName}</h4>
          <p className="text-xs text-slate-500">{digest.teamSize} team members</p>
        </div>
        <Badge variant={tone === "green" ? "default" : tone === "amber" ? "secondary" : "destructive"}>
          {digest.shrinkagePct}% shrinkage
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <div>
          <p className="text-lg font-bold text-emerald-600">{digest.onTime.length}</p>
          <p className="text-[10px] text-slate-500 uppercase">On-time</p>
        </div>
        <div>
          <p className="text-lg font-bold text-amber-600">{digest.lateArrivals.length}</p>
          <p className="text-[10px] text-slate-500 uppercase">Late</p>
        </div>
        <div>
          <p className="text-lg font-bold text-red-600">{digest.unplannedAbsences.length}</p>
          <p className="text-[10px] text-slate-500 uppercase">Absent</p>
        </div>
        <div>
          <p className="text-lg font-bold text-violet-600">{digest.aprPending}</p>
          <p className="text-[10px] text-slate-500 uppercase">APR</p>
        </div>
      </div>
    </GlassCard>
  );
}

/** Alert row for unplanned absences */
function AbsenceAlertRow({
  alert,
  onAction,
}: {
  alert: LiveAttendanceData["alerts"][0];
  onAction: () => void;
}) {
  const urgency = alert.minutesSinceShiftStart > 60 ? "critical" : alert.minutesSinceShiftStart > 30 ? "warning" : "info";

  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border ${
      urgency === "critical" ? "bg-red-50 border-red-200" :
      urgency === "warning" ? "bg-amber-50 border-amber-200" :
      "bg-slate-50 border-slate-200"
    }`}>
      <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
        urgency === "critical" ? "bg-red-100" :
        urgency === "warning" ? "bg-amber-100" :
        "bg-slate-100"
      }`}>
        <UserX className={`h-5 w-5 ${
          urgency === "critical" ? "text-red-600" :
          urgency === "warning" ? "text-amber-600" :
          "text-slate-600"
        }`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-800 truncate">{alert.employeeName}</span>
          <span className="text-xs text-slate-500">{alert.employeeCode}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>{alert.shiftTime}</span>
          <span>•</span>
          <span>{alert.processName || "—"}</span>
          <span>•</span>
          <span className={urgency === "critical" ? "text-red-600 font-medium" : ""}>{alert.minutesSinceShiftStart}m late</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Send reminder">
          <Bell className="h-4 w-4 text-slate-500" />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="View details" onClick={onAction}>
          <Eye className="h-4 w-4 text-slate-500" />
        </Button>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function RosterCommandCenter() {
  const [branchId, setBranchId] = useState(ALL);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedManager, setSelectedManager] = useState<ManagerDigest | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  // Auto-refresh every 2 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshKey((k) => k + 1);
      setLastRefresh(new Date());
    }, 120000);
    return () => clearInterval(interval);
  }, []);

  const { data: branchData } = useQuery({
    queryKey: ["command-center", "branches"],
    queryFn: () => hrmsApi.get<{ data: Array<{ id: string; branch_name: string }> }>("/api/org/branches"),
  });

  // Live unplanned absences
  const { data: liveData, isLoading: liveLoading, refetch: refetchLive } = useQuery({
    queryKey: ["command-center", "live", refreshKey],
    queryFn: () => hrmsApi.get<LiveAttendanceData>("/api/roster-intelligence/unplanned-absences?gracePeriod=15"),
    refetchInterval: 60000,
  });

  // Manager digests for today
  const { data: digestsData, isLoading: digestsLoading } = useQuery({
    queryKey: ["command-center", "digests", refreshKey],
    queryFn: () => hrmsApi.get<{ digests: ManagerDigest[]; count: number }>("/api/roster-intelligence/manager-digests"),
  });

  const alerts = liveData?.alerts ?? [];
  const digests = digestsData?.digests ?? [];

  // Filter by branch if selected
  const filteredAlerts = branchId === ALL ? alerts : alerts.filter((a) => a.branchName?.toLowerCase().includes(branchId.toLowerCase()));
  const filteredDigests = branchId === ALL ? digests : digests.filter((d) => {
    // Match digests by checking if any team member is in the branch
    return true; // Would need branch info in digest
  });

  // Calculate summary metrics
  const totalAbsent = filteredAlerts.length;
  const criticalAbsent = filteredAlerts.filter((a) => a.minutesSinceShiftStart > 60).length;
  const totalManagers = filteredDigests.length;
  const avgShrinkage = filteredDigests.length > 0
    ? Math.round(filteredDigests.reduce((s, d) => s + d.shrinkagePct, 0) / filteredDigests.length)
    : 0;
  const totalPresent = filteredDigests.reduce((s, d) => s + d.present, 0);
  const totalPlanned = filteredDigests.reduce((s, d) => s + d.planned, 0);

  // Sort digests by effectiveness (worst first for intervention)
  const sortedDigests = [...filteredDigests].sort((a, b) => b.shrinkagePct - a.shrinkagePct);

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
    setLastRefresh(new Date());
    refetchLive();
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-teal-50/30 to-cyan-50/20 p-4 sm:p-6">
        {/* Header with gradient (teal for attendance domain) */}
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-teal-600 via-cyan-600 to-blue-600 p-6 text-white shadow-lg shadow-teal-500/20">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
                  <Activity className="h-6 w-6" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">Roster Command Center</h1>
                  <p className="text-teal-100 text-sm">Real-time attendance intelligence</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2">
                <LivePulse />
                <span className="text-sm font-medium">LIVE</span>
              </div>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className="w-48 bg-white/10 border-white/20 text-white">
                  <SelectValue placeholder="All Branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All Branches</SelectItem>
                  {(branchData?.data ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRefresh}
                className="bg-white/20 hover:bg-white/30 text-white border-0"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </div>
          <p className="mt-3 text-xs text-teal-200">
            Last updated: {lastRefresh.toLocaleTimeString()} • Auto-refresh every 2 minutes
          </p>
        </div>

        {/* KPI Tiles — Bento grid layout */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6">
          <MetricTile
            label="Present Now"
            value={totalPresent}
            helper={`of ${totalPlanned} planned`}
            tone="green"
            icon={UserCheck}
            pulse
          />
          <MetricTile
            label="Unplanned Absent"
            value={totalAbsent}
            helper={`${criticalAbsent} critical (>1hr)`}
            tone="red"
            icon={UserX}
            pulse={totalAbsent > 0}
          />
          <MetricTile
            label="Avg Shrinkage"
            value={`${avgShrinkage}%`}
            helper="Today so far"
            tone={avgShrinkage > 10 ? "red" : avgShrinkage > 5 ? "amber" : "green"}
            icon={TrendingDown}
          />
          <MetricTile
            label="Managers"
            value={totalManagers}
            helper="With active teams"
            tone="blue"
            icon={Users}
          />
          <MetricTile
            label="Coverage"
            value={totalPlanned > 0 ? `${Math.round((totalPresent / totalPlanned) * 100)}%` : "—"}
            helper="Present / Planned"
            tone={totalPlanned > 0 && totalPresent / totalPlanned >= 0.9 ? "green" : "amber"}
            icon={Target}
          />
          <MetricTile
            label="Alerts Pending"
            value={criticalAbsent}
            helper="Need immediate action"
            tone={criticalAbsent > 5 ? "red" : criticalAbsent > 0 ? "amber" : "green"}
            icon={AlertTriangle}
          />
        </div>

        {/* Main content — two columns on desktop */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6">
          {/* Left: Live Alerts (2 cols on xl) */}
          <div className="xl:col-span-2 space-y-4">
            <GlassCard>
              <div className="p-4 border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100">
                      <Zap className="h-5 w-5 text-red-600" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-slate-800">Live Absence Alerts</h2>
                      <p className="text-xs text-slate-500">Employees rostered but not punched in</p>
                    </div>
                  </div>
                  <Badge variant={totalAbsent > 10 ? "destructive" : totalAbsent > 0 ? "secondary" : "default"}>
                    {totalAbsent} alerts
                  </Badge>
                </div>
              </div>
              <div className="p-4 max-h-[400px] overflow-y-auto space-y-2">
                {liveLoading ? (
                  <div className="py-8 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
                    Loading live data...
                  </div>
                ) : filteredAlerts.length === 0 ? (
                  <div className="py-8 text-center">
                    <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto mb-3" />
                    <p className="font-medium text-emerald-700">All Clear</p>
                    <p className="text-sm text-slate-500">No unplanned absences detected</p>
                  </div>
                ) : (
                  filteredAlerts.slice(0, 15).map((alert) => (
                    <AbsenceAlertRow key={`${alert.employeeId}-${alert.date}`} alert={alert} onAction={() => {}} />
                  ))
                )}
                {filteredAlerts.length > 15 && (
                  <p className="text-center text-sm text-slate-500 pt-2">
                    +{filteredAlerts.length - 15} more alerts
                  </p>
                )}
              </div>
            </GlassCard>

            {/* Shrinkage Gauge */}
            <GlassCard className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100">
                  <TrendingUp className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <h2 className="font-semibold text-slate-800">Real-Time Shrinkage</h2>
                  <p className="text-xs text-slate-500">Today's workforce coverage vs planned</p>
                </div>
              </div>
              <div className="flex items-center gap-8">
                <div className="flex-1">
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className={`text-4xl font-bold ${avgShrinkage > 10 ? "text-red-600" : avgShrinkage > 5 ? "text-amber-600" : "text-emerald-600"}`}>
                      {avgShrinkage}%
                    </span>
                    <span className="text-slate-500">shrinkage</span>
                  </div>
                  <Progress
                    value={avgShrinkage}
                    className={`h-3 ${avgShrinkage > 10 ? "[&>div]:bg-red-500" : avgShrinkage > 5 ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-500"}`}
                  />
                  <div className="flex justify-between text-xs text-slate-500 mt-1">
                    <span>0%</span>
                    <span className="text-amber-600">Target: 8%</span>
                    <span>20%</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold text-emerald-600">{totalPresent}</p>
                    <p className="text-xs text-slate-500">Present</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-slate-400">{totalPlanned}</p>
                    <p className="text-xs text-slate-500">Planned</p>
                  </div>
                </div>
              </div>
            </GlassCard>
          </div>

          {/* Right: Manager Effectiveness */}
          <div className="space-y-4">
            <GlassCard>
              <div className="p-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100">
                    <Target className="h-5 w-5 text-violet-600" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-slate-800">Manager Effectiveness</h2>
                    <p className="text-xs text-slate-500">Today's team performance</p>
                  </div>
                </div>
              </div>
              <div className="p-4 max-h-[500px] overflow-y-auto space-y-3">
                {digestsLoading ? (
                  <div className="py-8 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
                    Loading...
                  </div>
                ) : sortedDigests.length === 0 ? (
                  <div className="py-8 text-center text-slate-400">
                    No manager data available
                  </div>
                ) : (
                  sortedDigests.slice(0, 8).map((digest) => (
                    <div
                      key={digest.managerId}
                      className="cursor-pointer"
                      onClick={() => setSelectedManager(digest)}
                    >
                      <ManagerEffectivenessCard digest={digest} />
                    </div>
                  ))
                )}
              </div>
            </GlassCard>

            {/* Quick Actions */}
            <GlassCard className="p-4">
              <h3 className="font-semibold text-slate-800 mb-3">Quick Actions</h3>
              <div className="space-y-2">
                <Button variant="outline" className="w-full justify-start gap-2" onClick={handleRefresh}>
                  <RefreshCw className="h-4 w-4" />
                  Refresh All Data
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2">
                  <Bell className="h-4 w-4" />
                  Send Mass Alert
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Notify All Managers
                </Button>
              </div>
            </GlassCard>
          </div>
        </div>
      </div>

      {/* Manager Detail Sheet */}
      <Sheet open={!!selectedManager} onOpenChange={(open) => !open && setSelectedManager(null)}>
        <SheetContent className="w-[400px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-violet-600" />
              {selectedManager?.managerName}'s Team
            </SheetTitle>
          </SheetHeader>
          {selectedManager && (
            <div className="mt-6 space-y-6">
              {/* Score ring */}
              <div className="flex justify-center">
                <div className="relative">
                  <ScoreRing
                    score={Math.round(
                      (selectedManager.planned > 0 ? (selectedManager.present / selectedManager.planned) * 40 : 40) +
                      (selectedManager.present > 0 ? (selectedManager.onTime.length / selectedManager.present) * 30 : 30) +
                      Math.max(0, (100 - selectedManager.shrinkagePct) / 100 * 20) +
                      (selectedManager.aprPending < 3 ? 10 : selectedManager.aprPending < 5 ? 5 : 0)
                    )}
                    size={120}
                    strokeWidth={10}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xs text-slate-500 mt-8">Score</span>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-600">{selectedManager.onTime.length}</p>
                  <p className="text-xs text-emerald-700">On-Time</p>
                </div>
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-center">
                  <p className="text-2xl font-bold text-amber-600">{selectedManager.lateArrivals.length}</p>
                  <p className="text-xs text-amber-700">Late</p>
                </div>
                <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-center">
                  <p className="text-2xl font-bold text-red-600">{selectedManager.unplannedAbsences.length}</p>
                  <p className="text-xs text-red-700">Absent</p>
                </div>
                <div className="rounded-xl bg-violet-50 border border-violet-200 p-3 text-center">
                  <p className="text-2xl font-bold text-violet-600">{selectedManager.aprPending}</p>
                  <p className="text-xs text-violet-700">APR Pending</p>
                </div>
              </div>

              {/* Lists */}
              {selectedManager.unplannedAbsences.length > 0 && (
                <div>
                  <h4 className="font-semibold text-red-700 mb-2">Unplanned Absences</h4>
                  <div className="space-y-1">
                    {selectedManager.unplannedAbsences.map((e) => (
                      <div key={e.employeeId} className="flex items-center gap-2 text-sm bg-red-50 rounded-lg px-3 py-2">
                        <UserX className="h-4 w-4 text-red-500" />
                        <span className="font-medium">{e.employeeName}</span>
                        <span className="text-slate-500 text-xs">{e.employeeCode}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedManager.lateArrivals.length > 0 && (
                <div>
                  <h4 className="font-semibold text-amber-700 mb-2">Late Arrivals</h4>
                  <div className="space-y-1">
                    {selectedManager.lateArrivals.map((e) => (
                      <div key={e.employeeId} className="flex items-center justify-between text-sm bg-amber-50 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-amber-500" />
                          <span className="font-medium">{e.employeeName}</span>
                        </div>
                        <span className="text-amber-600 font-medium">{e.lateMinutes}m</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}
