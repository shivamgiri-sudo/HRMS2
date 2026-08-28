import { useState } from "react";
import {
  FileCheck2,
  FileX2,
  Hourglass,
  ShieldCheck,
  TriangleAlert,
  UserCheck,
  UsersRound,
  CheckCircle2,
  Eye,
  MessageSquare,
  FileText,
  Mail,
  TrendingUp,
  TrendingDown,
  Calendar,
  Target,
  Zap,
  Download,
  Search,
  Sparkles,
  Clock,
  Bell,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  XCircle,
  RefreshCw,
  BarChart3,
  PieChart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { ReferenceDashboardData } from "../reference-dashboard-model";
import { asArray, asNumber, asRecord, metricDetail, metricUnavailableReason, metricValue } from "../reference-dashboard-model";
import { deriveAtsStageSnapshot } from "../dashboard-data-contracts";
import { ReferenceWorkInbox } from "./ReferenceOperationalPanels";
import {
  AnimNum,
  Sparkline,
  AreaChart,
  DonutChart,
  Gauge,
  HeatmapRow,
  FunnelBar,
  type AttendanceStatus,
  attendanceColors,
} from "@/components/dashboard/DashboardCharts";

// KPI Tile with Sparkline - UX Skill Demo Pattern #123
function KpiTile({
  icon: Icon,
  label,
  value,
  suffix = "",
  trend,
  change,
  color,
  bg,
  sparkData,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: number | null;
  suffix?: string;
  trend?: "up" | "down" | "neutral";
  change?: string;
  color: string;
  bg: string;
  sparkData?: number[];
  onClick?: () => void;
}) {
  const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : null;
  const tc = trend === "up" ? "text-emerald-600" : trend === "down" ? "text-rose-600" : "text-gray-400";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative bg-gradient-to-br rounded-2xl p-4 border border-white/60 shadow-lg shadow-black/5",
        "hover:shadow-xl hover:scale-[1.02] hover:-translate-y-0.5 transition-all duration-300 cursor-pointer overflow-hidden text-left w-full",
        bg
      )}
    >
      <div className="absolute inset-0 bg-white/40 backdrop-blur-sm" />
      <div className="relative">
        <div className="flex items-center justify-between mb-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/80 shadow-sm group-hover:scale-110 group-hover:rotate-3 transition-transform" style={{ color }}>
            <Icon className="h-5 w-5" />
          </div>
          {TrendIcon && change && (
            <span className={cn("flex items-center gap-0.5 text-xs font-bold px-2 py-0.5 rounded-full bg-white/80", tc)}>
              <TrendIcon className="h-3.5 w-3.5" />{change}
            </span>
          )}
        </div>
        <p className="text-2xl font-bold text-gray-900 mb-0.5">
          {value !== null ? <AnimNum value={value} suffix={suffix} /> : "—"}
        </p>
        <p className="text-xs text-gray-600 mb-2">{label}</p>
        {sparkData && sparkData.length > 0 && (
          <Sparkline data={sparkData} color={color} height={32} />
        )}
      </div>
    </button>
  );
}

// Quick Stat Card - UX Skill Demo Pattern
function QuickStat({ icon: Icon, label, value, sub, color, bg }: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub: string;
  color: string;
  bg: string;
}) {
  return (
    <div className={cn(
      "flex items-center gap-3 rounded-xl p-3 border border-white/60 bg-gradient-to-br",
      "hover:shadow-md transition-all cursor-pointer",
      bg
    )}>
      <div className="relative">
        <div className="absolute inset-0 rounded-xl blur-md" style={{ backgroundColor: `${color}20` }} />
        <div className="relative w-10 h-10 rounded-xl flex items-center justify-center bg-white/80 shadow-sm" style={{ color }}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div>
        <p className="text-lg font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </div>
  );
}

// Glass Panel - UX Skill Demo Pattern #3
function GlassPanel({ title, icon: Icon, iconColor, badge, action, children, className }: {
  title: string;
  icon?: React.ElementType;
  iconColor?: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bg-white/60 backdrop-blur-sm rounded-2xl p-4 border border-white/60 shadow-lg", className)}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4" style={{ color: iconColor }} />}
          {title}
        </h3>
        <div className="flex items-center gap-2">
          {badge}
          {action}
        </div>
      </div>
      {children}
    </div>
  );
}

export function HrReferenceLayout({ data, filters }: { data: ReferenceDashboardData; filters?: React.ReactNode }) {
  const m = data.metrics;
  // Typed fallback. `(() => ({}))` infers `{}`, which widens the union and made every
  // `drill(...).onDrilldown` a type error even though the runtime behaviour was fine.
  const drill: NonNullable<ReferenceDashboardData["drilldownFor"]> = data.drilldownFor ?? (() => ({}));

  // Extract real data from APIs
  const selected = asNumber(data.ats.selected_candidates ?? data.ats.selectedCandidates ?? data.ats.total_selected);
  const submitted = metricDetail(m, "onb", "submitted");
  const pending = metricDetail(m, "onb", "pending") ?? metricValue(m, "onb");
  const stuck = metricDetail(m, "onb", "stuck");
  const bgv = metricDetail(m, "bgv", "pending") ?? metricValue(m, "bgv");
  const bgvCleared = metricDetail(m, "bgv", "cleared");
  const headcount = metricDetail(m, "hc", "active") ?? metricValue(m, "hc");
  const attendanceRate = metricDetail(m, "att", "attendanceRate") ?? metricValue(m, "att");
  const appointmentEsign = metricDetail(m, "appointmentEsign", "pending") ?? metricValue(m, "appointmentEsign");
  const joiningDocs = metricDetail(m, "joiningDocEsign", "pending") ?? metricValue(m, "joiningDocEsign");
  const resignation = metricDetail(m, "resign", "pendingDiscussion") ?? metricValue(m, "resign");

  const previousSelected = asNumber(data.ats.previous_selected ?? data.ats.last_30_selected);
  const previousSubmitted = asNumber(data.ats.previous_submitted ?? data.ats.last_30_submitted);

  // Workforce summary data from /api/management/workforce-dashboard
  /**
   * While the workforce and ATS feeds are still resolving, the values below are genuinely
   * unknown. Rendering `?? 0` for them printed a confident "0 New Joins / 0 Exits" under a
   * "Live" badge before correcting to 150 / 1 — so a reader who glanced during that window was
   * told the wrong number with no signal that it was provisional. Unknown now renders as an
   * em dash, which is honest and visibly not a value.
   */
  const settling = data.secondaryLoading === true;
  const wfSummary = data.workforce.summary as Record<string, unknown> | undefined;
  const newJoiners30d = asNumber(wfSummary?.new_joiners_30d ?? wfSummary?.newJoiners30d ?? data.workforce.new_joiners_30d);
  const exits30d = asNumber(wfSummary?.exits_30d ?? wfSummary?.exits30d ?? data.workforce.exits_30d);
  const attritionRate = asNumber(wfSummary?.attrition_rate_30d ?? wfSummary?.attritionRate30d ?? data.workforce.attrition_rate_30d);
  const workforceAttendancePct = asNumber(wfSummary?.attendance_pct ?? wfSummary?.attendancePct ?? data.workforce.attendance_pct);

  /**
   * Metrics the summary endpoint returns that had no home on this page. `docCompliance` is the
   * one that matters: 1,100 employees with no document against 1,120 active is 98.2%, and it was
   * being fetched every load and thrown away.
   */
  const docsMissing = metricValue(m, "docCompliance");
  const docGapLabel = docsMissing !== null && headcount
    ? `${docsMissing.toLocaleString()} (${Math.round((docsMissing / headcount) * 100)}%)`
    : docsMissing !== null ? docsMissing.toLocaleString() : "—";
  const trainingPct = metricValue(m, "training");
  const shrinkagePct = asNumber(wfSummary?.shrinkage_pct ?? wfSummary?.shrinkagePct);
  const expectedToWork = asNumber(wfSummary?.expected_to_work ?? wfSummary?.expectedToWork)
    ?? metricDetail(m, "att", "expectedToWork");


  const variance = (current: number | null, previous: number | null): { trend: "up" | "down" | "neutral"; change: string } | null => {
    if (current === null || previous === null || previous === 0) return null;
    const pct = Math.round(((current - previous) / previous) * 1000) / 10;
    return { trend: pct >= 0 ? "up" : "down", change: `${pct >= 0 ? "+" : ""}${pct}%` };
  };



  // Recent team members from workforce data - REAL DATA ONLY, no dummy fallback
  // API returns `recent_joiners` with fields: employee_name, designation_name, joining_date
  const recentJoiners = data.workforce.recent_joiners ?? data.workforce.recentJoiners ?? data.workforce.recent_joins ?? data.workforce.recentJoins ?? data.workforce.new_employees ?? data.workforce.newEmployees;
  const teamMembers = Array.isArray(recentJoiners) && recentJoiners.length > 0
    ? recentJoiners.slice(0, 6).map((emp: unknown, i: number) => {
        const e = emp as Record<string, unknown>;
        const colors = ['from-blue-500 to-indigo-600', 'from-purple-500 to-pink-600', 'from-emerald-500 to-teal-600', 'from-amber-500 to-orange-600', 'from-cyan-500 to-blue-600', 'from-rose-500 to-pink-600'];
        return {
          name: String(e.employee_name ?? e.employeeName ?? e.name ?? e.full_name ?? 'Unknown'),
          role: String(e.designation_name ?? e.designationName ?? e.designation ?? e.role ?? e.job_title ?? ''),
          dept: String(e.branch_name ?? e.branchName ?? e.department ?? e.process_name ?? e.processName ?? ''),
          color: colors[i % colors.length],
          status: 'online' as const,
        };
      })
    : []; // NO DUMMY DATA - empty array if no real data

  // Attendance summary from workforce API - NO FAKE HEATMAP DATA
  // The API returns today's attendance status, not weekly historical data
  const teamMembersRaw = data.workforce.team_members ?? data.workforce.teamMembers;
  /**
   * Today's attendance, from the organisation-wide aggregate.
   *
   * This used to be derived by counting statuses across `team_members` — a 20-row sample the
   * API returns for the roster strip, not an attendance dataset. So the panel reported
   * "Present 0 · Absent 8 · Missing Punch 4 · Total tracked: 20" on a day when 457 of 724
   * employees were present. That is worse than the empty state it replaced: it was confidently
   * wrong rather than blank.
   *
   * `workforce.attendance` is the real figure and carries `record_date`, so the panel can also
   * say which day it is describing — the source is processed attendance and runs a day behind.
   */
  const attendanceSummary = (() => {
    const agg = asRecord(data.workforce.attendance);
    const statuses = asArray(agg.statuses);
    if (statuses.length > 0) {
      const pick = (name: string) => {
        const hit = statuses.find((s) => String(asRecord(s).label ?? '').toLowerCase() === name);
        return hit ? (asNumber(asRecord(hit).value) ?? 0) : 0;
      };
      return {
        total: asNumber(agg.total) ?? 0,
        present: pick('present'),
        halfDay: pick('half_day'),
        absent: pick('absent'),
        missing_punch: pick('missing_punch'),
        on_leave: pick('on_leave'),
        not_marked: pick('not_marked'),
        recordDate: String(agg.record_date ?? ''),
        dataAgeDays: asNumber(agg.data_age_days),
      };
    }
    return null;
  })();
  // Empty array - we don't have weekly historical data from the API
  const attendanceData: { day: string; data: AttendanceStatus[] }[] = [];

  // Leave balance - REAL DATA ONLY
  /**
   * Leave summary. The API returns an ARRAY of `{status, count}`, not an object.
   *
   * `typeof [] === 'object'`, so the old guard passed, and the three donuts then read
   * `.on_leave_today`, `.pending_approval` and `.approved_today` off an array — properties that
   * cannot exist on one. All three rendered 0 against a real 1,033 approved and 14 pending,
   * with a separate `pending_leave_requests: 170` sitting beside them in the same payload.
   * Both figures are shown now: they count different things (14 is today's queue, 170 is the
   * open backlog) and showing one while the metric tile shows the other is how they got
   * mistaken for a contradiction.
   */
  const leaveByStatus = (() => {
    const rows = asArray(data.workforce.leave_summary ?? data.workforce.leaveSummary);
    const out: Record<string, number> = {};
    for (const row of rows) {
      const r = asRecord(row);
      const key = String(r.status ?? '').toLowerCase();
      if (key) out[key] = asNumber(r.count) ?? 0;
    }
    return out;
  })();
  const pendingLeaveBacklog = asNumber(data.workforce.pending_leave_requests) ?? metricValue(m, 'leaveApprovals');
  /**
   * Requests the db_bill migration left as 'pending' that the legacy system had already
   * decided. 547 of the 586 rows this database calls pending were 'Not Approved' in
   * db_bill.leave_management (548 of those 718 source rows carry an explicit
   * DisApprovedReason, so the value means rejected, not "awaiting a decision"), and every
   * one of the 586 has a to_date in the past.
   *
   * The server now keeps them out of `pending_leave_requests` so the tile is an approval
   * queue again rather than an eight-year archive. Reported here as its own line: the
   * rows are still wrong in the database and hiding them entirely would just move the
   * surprise to whoever next queries the table. Renders nothing once the backlog is
   * repaired (backend/scripts/repair-legacy-leave-status.mjs) and the count reaches zero.
   */
  const legacyLeaveBacklog = asNumber(data.workforce.legacy_leave_backlog)
    ?? metricDetail(m, 'leaveApprovals', 'legacyBacklog');
  const hasLeaveData = Object.keys(leaveByStatus).length > 0 || pendingLeaveBacklog !== null;

  // Department/Branch breakdown - REAL DATA ONLY
  // API returns `branches` with branch_name/employee_count, or `process_breakdown` with process_name/headcount
  const deptBreakdown = data.workforce.branches ?? data.workforce.process_breakdown ?? data.workforce.processBreakdown ?? data.workforce.department_breakdown ?? data.workforce.departmentBreakdown;
  const hasDeptData = Array.isArray(deptBreakdown) && deptBreakdown.length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 relative overflow-hidden -m-4 p-4">
      {/* Decorative Background Orbs - Pattern #98 */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-indigo-500/15 via-purple-500/10 to-transparent rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-emerald-500/15 via-teal-500/10 to-transparent rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 right-1/4 w-32 h-32 bg-gradient-to-br from-pink-500/10 via-rose-500/5 to-transparent rounded-full blur-2xl pointer-events-none" />

      {/* Announcement Banner */}
      <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 text-white px-4 py-2.5 text-xs flex items-center justify-center gap-2 rounded-xl mb-4 relative overflow-hidden shadow-lg">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse" />
        <Sparkles className="h-3.5 w-3.5 text-amber-300" />
        <span className="font-medium">New: AI-powered workforce insights now available</span>
        <span className="text-white/60">•</span>
        <span className="underline cursor-pointer hover:text-amber-200 transition-colors">Explore now →</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <BarChart3 className="h-6 w-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">HR Dashboard</h1>
              <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200">HR View</Badge>
            </div>
            <p className="text-sm text-gray-500">Real-time workforce analytics</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {filters}
          {/* Says "Loading" while feeds are still resolving. A green pulsing "Live" over
              half-arrived data is the part that made the wrong first paint believable. */}
          <Badge
            variant="outline"
            className={cn(
              "gap-1.5 bg-white/80",
              settling ? "border-amber-200 text-amber-700" : "border-emerald-200 text-emerald-700",
            )}
          >
            <span className={cn("w-2 h-2 rounded-full animate-pulse", settling ? "bg-amber-500" : "bg-emerald-500")} />
            {settling ? "Loading" : "Live"}
          </Badge>
          <Button size="sm" className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white shadow-lg shadow-indigo-500/25">
            <Download className="h-4 w-4 mr-1.5" />
            Export
          </Button>
        </div>
      </div>

      {/* KPI Tiles Row - Pattern #123 - REAL DATA ONLY */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiTile
          icon={UsersRound}
          label="Total Employees"
          value={headcount}
          trend={newJoiners30d && newJoiners30d > 0 ? "up" : undefined}
          change={newJoiners30d ? `+${newJoiners30d}` : undefined}
          color="#6366F1"
          bg="from-indigo-500/10 to-violet-500/5"
          onClick={drill("hc").onDrilldown}
        />
        <KpiTile
          icon={TrendingDown}
          label="Attrition Rate"
          value={attritionRate !== null ? Math.round(attritionRate * 100) / 100 : null}
          suffix="%"
          trend={attritionRate && attritionRate > 2 ? "down" : attritionRate !== null ? "up" : undefined}
          change={attritionRate && attritionRate > 2 ? "High" : attritionRate !== null ? "Low" : undefined}
          color="#EC4899"
          bg="from-pink-500/10 to-rose-500/5"
        />
        <KpiTile
          icon={Target}
          label="Onboarding Pending"
          value={pending}
          color="#8B5CF6"
          bg="from-purple-500/10 to-violet-500/5"
          onClick={drill("onb").onDrilldown}
        />
        <KpiTile
          icon={ShieldCheck}
          label="BGV Pending"
          value={bgv}
          trend={bgv && bgv > 100 ? "down" : bgv !== null ? "up" : undefined}
          change={bgv && bgv > 100 ? "High" : bgv !== null ? "OK" : undefined}
          color="#F59E0B"
          bg="from-amber-500/10 to-orange-500/5"
          onClick={drill("bgv").onDrilldown}
        />
      </div>

      {/* Quick Stats Row - REAL workforce data from API */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <QuickStat icon={UserCheck} label="New Joins (30d)" value={settling || newJoiners30d === null ? "—" : newJoiners30d.toLocaleString()} sub="last 30 days" color="#10B981" bg="from-emerald-500/10 to-teal-500/5" />
        <QuickStat icon={XCircle} label="Exits (30d)" value={settling || exits30d === null ? "—" : exits30d.toLocaleString()} sub="last 30 days" color="#EF4444" bg="from-red-500/10 to-rose-500/5" />
        <QuickStat icon={TrendingUp} label="Attendance" value={settling || (workforceAttendancePct ?? attendanceRate) === null ? "—" : `${Math.round(workforceAttendancePct ?? attendanceRate ?? 0)}%`} sub="processed attendance" color="#8B5CF6" bg="from-purple-500/10 to-violet-500/5" />
        {/* Was a second "Attrition" tile duplicating the KPI above it, to one more decimal place —
            the same measure twice on one screen, disagreeing on rounding. Replaced with the
            roster figure, which the payload already carried and nothing displayed. */}
        <QuickStat icon={UsersRound} label="Rostered Today" value={settling || expectedToWork === null ? "—" : expectedToWork.toLocaleString()} sub="expected to work" color="#F59E0B" bg="from-amber-500/10 to-orange-500/5" />
      </div>

      {/*
        Compliance and engagement figures the summary endpoint has always returned and this page
        has never rendered. The first is the largest exposure on the dashboard: 1,100 of 1,120
        active employees hold no document at all. It was being fetched on every load and dropped.
      */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <QuickStat
          icon={FileX2}
          label="No Documents on File"
          value={settling ? "—" : docGapLabel}
          sub="employees with no document"
          color="#DC2626"
          bg="from-red-500/10 to-rose-500/5"
        />
        <QuickStat
          icon={Hourglass}
          label="Pending Leave"
          value={settling || pendingLeaveBacklog === null ? "—" : pendingLeaveBacklog.toLocaleString()}
          sub={legacyLeaveBacklog ? `awaiting approval · ${legacyLeaveBacklog.toLocaleString()} legacy` : "awaiting approval"}
          color="#F59E0B"
          bg="from-amber-500/10 to-orange-500/5"
        />
        <QuickStat
          icon={FileCheck2}
          label="Training Complete"
          value={settling || trainingPct === null ? "—" : `${trainingPct}%`}
          sub="LMS completion rate"
          color="#0EA5E9"
          bg="from-sky-500/10 to-cyan-500/5"
        />
        <QuickStat
          icon={TriangleAlert}
          label="Shrinkage"
          value={settling || shrinkagePct === null ? "—" : `${shrinkagePct}%`}
          sub="workforce shrinkage"
          color="#8B5CF6"
          bg="from-purple-500/10 to-violet-500/5"
        />
      </div>

      {/* Main Bento Grid - Pattern #39 */}
      <div className="grid grid-cols-12 gap-4 mb-4">
        {/* Employee Growth + Hiring Funnel */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          <GlassPanel
            title="Employee Growth"
            icon={TrendingUp}
            iconColor="#6366F1"
            badge={newJoiners30d ? <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">+{newJoiners30d} joins (30d)</Badge> : undefined}
          >
            {headcount !== null ? (
              <div className="py-4">
                <div className="text-center mb-3">
                  <p className="text-4xl font-bold text-indigo-600">{headcount.toLocaleString()}</p>
                  <p className="text-xs text-gray-500">Active Employees</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="bg-emerald-50 rounded-lg p-2">
                    <p className="text-lg font-bold text-emerald-600">{settling || newJoiners30d === null ? "—" : newJoiners30d.toLocaleString()}</p>
                    <p className="text-[10px] text-gray-500">New Joins (30d)</p>
                  </div>
                  <div className="bg-rose-50 rounded-lg p-2">
                    <p className="text-lg font-bold text-rose-600">{settling || exits30d === null ? "—" : exits30d.toLocaleString()}</p>
                    <p className="text-[10px] text-gray-500">Exits (30d)</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <TrendingUp className="h-8 w-8 text-gray-300 mb-2" />
                <p className="text-xs text-gray-400">Growth data not available</p>
              </div>
            )}
          </GlassPanel>

          {/* "Pipeline by Stage", not "Hiring Funnel" — by_stage is disjoint current-stage
              counts, not sequential pass-through counts. Offered can legitimately exceed
              Interviewed (more candidates sitting at Offered right now than sitting at
              Interview right now), so this must not imply monotonic drop-off. Shared with
              the Recruiter Dashboard's own panel via deriveAtsStageSnapshot, so both read
              the same numbers off the same data instead of two independently-hand-rolled
              (and previously differently wrong) stage classifiers. */}
          <GlassPanel title="Pipeline by Stage" icon={Target} iconColor="#F59E0B">
            {(() => {
              const totalCandidates = asNumber(data.ats.total_candidates ?? data.ats.total_applications);
              const { applications, screened, interviewed, offered, joined } =
                deriveAtsStageSnapshot(data.ats.by_stage, totalCandidates);
              const hasAtsData = applications !== null || screened !== null || interviewed !== null || offered !== null || joined !== null;
              const maxVal = Math.max(applications ?? 0, screened ?? 0, interviewed ?? 0, offered ?? 0, joined ?? 0, 1);

              return hasAtsData ? (
                <div className="space-y-3">
                  <FunnelBar label="Applications" value={applications ?? 0} max={maxVal} color="#6366F1" icon={FileText} />
                  <FunnelBar label="Screened" value={screened ?? 0} max={maxVal} color="#8B5CF6" icon={Eye} />
                  <FunnelBar label="Interviewed" value={interviewed ?? 0} max={maxVal} color="#EC4899" icon={MessageSquare} />
                  <FunnelBar label="Offered" value={offered ?? 0} max={maxVal} color="#F59E0B" icon={Mail} />
                  <FunnelBar label="Joined" value={joined ?? 0} max={maxVal} color="#10B981" icon={CheckCircle2} />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <Target className="h-8 w-8 text-gray-300 mb-2" />
                  <p className="text-xs text-gray-400">ATS pipeline data not available</p>
                </div>
              );
            })()}
          </GlassPanel>
        </div>

        {/* Team Members + Attendance Heatmap */}
        <div className="col-span-12 lg:col-span-5 space-y-4">
          <GlassPanel
            title="Recent Team Members"
            icon={UsersRound}
            iconColor="#6366F1"
            action={teamMembers.length > 0 ? <span className="text-xs text-indigo-600 hover:underline cursor-pointer flex items-center gap-1">View all <ChevronRight className="h-3 w-3" /></span> : undefined}
          >
            {teamMembers.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {teamMembers.map((emp, i) => (
                  <div key={i} className="group flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/80 transition-all cursor-pointer">
                    <div className="relative">
                      <div className={cn("w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white text-sm font-semibold shadow-md", emp.color)}>
                        {emp.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <span className={cn(
                        "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white",
                        emp.status === 'online' ? 'bg-emerald-500' : emp.status === 'away' ? 'bg-amber-500' : 'bg-gray-400'
                      )} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-gray-900 truncate">{emp.name}</p>
                      <p className="text-[10px] text-gray-500 truncate">{emp.role}</p>
                      {emp.dept && <Badge variant="outline" className="mt-1 text-[9px] px-1.5 py-0">{emp.dept}</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <UsersRound className="h-8 w-8 text-gray-300 mb-2" />
                <p className="text-xs text-gray-400">No recent joins data available</p>
              </div>
            )}
          </GlassPanel>

          <GlassPanel title="Today's Attendance" icon={Calendar} iconColor="#10B981">
            {attendanceSummary ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-emerald-50 rounded-lg p-2 text-center">
                    <p className="text-xl font-bold text-emerald-600">{attendanceSummary.present}</p>
                    <p className="text-[10px] text-gray-500">Present</p>
                  </div>
                  <div className="bg-red-50 rounded-lg p-2 text-center">
                    <p className="text-xl font-bold text-red-600">{attendanceSummary.absent}</p>
                    <p className="text-[10px] text-gray-500">Absent</p>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-2 text-center">
                    <p className="text-xl font-bold text-amber-600">{attendanceSummary.halfDay.toLocaleString()}</p>
                    <p className="text-[10px] text-gray-500">Half Day</p>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-2 text-center">
                    <p className="text-xl font-bold text-purple-600">{attendanceSummary.missing_punch.toLocaleString()}</p>
                    <p className="text-[10px] text-gray-500">Missing Punch</p>
                  </div>
                </div>
                <div className="text-center text-[10px] text-gray-400">
                  {attendanceSummary.total.toLocaleString()} employees expected
                  {attendanceSummary.recordDate ? ` · ${new Date(attendanceSummary.recordDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''}
                  {attendanceSummary.dataAgeDays ? ` (${attendanceSummary.dataAgeDays}d behind)` : ''}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Calendar className="h-8 w-8 text-gray-300 mb-2" />
                <p className="text-xs text-gray-400">Attendance data not available</p>
                <p className="text-[10px] text-gray-300 mt-1">Check WFM Attendance for details</p>
              </div>
            )}
          </GlassPanel>
        </div>

        {/* Performance + Leave + Department */}
        <div className="col-span-12 lg:col-span-3 space-y-4">
          <GlassPanel title="Performance" icon={Zap} iconColor="#F59E0B">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">Onboarding Rate</span>
                {/* No invented fallbacks. These read `: 85`, `: 77` and `: 81` when the real value
                    was missing, so an unavailable metric rendered as a plausible-looking number
                    — the one thing a dashboard must never do. */}
                <Gauge value={submitted !== null && pending !== null && (submitted + pending) > 0 ? Math.round((submitted / (submitted + pending)) * 100) : 0} color="#10B981" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">Attendance</span>
                <Gauge value={attendanceRate !== null ? Math.round(attendanceRate) : 0} color="#6366F1" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">BGV Clear Rate</span>
                {/* cleared / (cleared + pending) — both from the BGV metric itself.
                    This read `100 - (bgv / headcount) * 100`, dividing pending background
                    checks by employees on the payroll: two unrelated populations, one of
                    candidates and one of staff. With 84 pending against 441 employees it
                    rendered 81%, while the real clear rate sitting in the same payload
                    (87 cleared, 84 pending) was 51% — a 30-point overstatement. It went
                    unnoticed because 81% happened to match the Attendance gauge directly
                    above it, so the two looked corroborating. */}
                <Gauge
                  value={
                    bgvCleared !== null && bgv !== null && (bgvCleared + bgv) > 0
                      ? Math.round((bgvCleared / (bgvCleared + bgv)) * 100)
                      : 0
                  }
                  color="#F59E0B"
                />
              </div>
            </div>
          </GlassPanel>

          <GlassPanel title="Leave Summary" icon={Calendar} iconColor="#8B5CF6">
            {hasLeaveData ? (
              <div className="space-y-3">
                {[
                  { type: 'Pending Approval', value: leaveByStatus.pending ?? 0, color: '#F59E0B' },
                  { type: 'Open Backlog', value: pendingLeaveBacklog ?? 0, color: '#8B5CF6' },
                  { type: 'Approved', value: leaveByStatus.approved ?? 0, color: '#10B981' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="relative">
                      <DonutChart value={item.value} max={Math.max(item.value, 10)} color={item.color} size={44} />
                      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-700">{item.value}</span>
                    </div>
                    <div className="flex-1">
                      <span className="text-xs font-medium text-gray-700">{item.type}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <Calendar className="h-8 w-8 text-gray-300 mb-2" />
                <p className="text-xs text-gray-400">Leave data not available</p>
              </div>
            )}
          </GlassPanel>

          <GlassPanel title="By Branch" icon={PieChart} iconColor="#6366F1">
            {hasDeptData ? (() => {
              const colors = ['#6366F1', '#10B981', '#F59E0B', '#EC4899', '#0EA5E9', '#8B5CF6'];
              // API returns branches with employee_count, or process_breakdown with headcount
              const total = deptBreakdown.reduce((sum: number, d: Record<string, unknown>) => sum + (asNumber(d.employee_count ?? d.headcount ?? d.count ?? d.total) ?? 0), 0);
              let offset = 0;
              return (
                <div className="flex items-center gap-4">
                  <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                    {deptBreakdown.slice(0, 6).map((dept: Record<string, unknown>, i: number) => {
                      const count = asNumber(dept.employee_count ?? dept.headcount ?? dept.count ?? dept.total) ?? 0;
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      const stroke = colors[i % colors.length];
                      const dash = `${pct} ${100 - pct}`;
                      const dashOffset = -offset;
                      offset += pct;
                      return <circle key={i} cx="18" cy="18" r="14" fill="none" stroke={stroke} strokeWidth="5" strokeDasharray={dash} strokeDashoffset={dashOffset} className="drop-shadow-sm" />;
                    })}
                  </svg>
                  <div className="space-y-1 text-xs">
                    {deptBreakdown.slice(0, 4).map((dept: Record<string, unknown>, i: number) => {
                      // API returns branch_name or process_name
                      const name = String(dept.branch_name ?? dept.branchName ?? dept.process_name ?? dept.processName ?? dept.department ?? dept.name ?? 'Unknown');
                      const count = asNumber(dept.employee_count ?? dept.headcount ?? dept.count ?? dept.total) ?? 0;
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      const colorClass = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-pink-500'][i];
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <span className={cn("w-2.5 h-2.5 rounded-full", colorClass)} />
                          {name} {pct}%
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })() : (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <PieChart className="h-8 w-8 text-gray-300 mb-2" />
                <p className="text-xs text-gray-400">Department breakdown not available</p>
              </div>
            )}
          </GlassPanel>
        </div>
      </div>

      {/* Work Inbox - Full Width */}
      <div className="mb-4">
        <ReferenceWorkInbox maxItems={5} />
      </div>

      {/* Approval Workflow Card - Pattern #120 */}
      <GlassPanel title="" icon={FileText} iconColor="#6366F1" className="mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <FileText className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Pending Approvals Summary</h3>
              {/* Names the four stages actually shown. It read "Onboarding • BGV • eSign • Exit",
                  promising Exit — which is not one of them — and omitting Joining Docs, which is. */}
              <p className="text-xs text-gray-500">Onboarding • BGV • eSign • Joining Docs</p>
            </div>
          </div>
          {/* Totals all four stages it displays. The sum omitted Joining Docs, so the card showed
              "781 Total" above four numbers adding to 992 — a total that excluded one of its own. */}
          <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200">
            {((pending ?? 0) + (bgv ?? 0) + (appointmentEsign ?? 0) + (joiningDocs ?? 0)).toLocaleString()} Total
          </Badge>
        </div>

        {/* Timeline */}
        <div className="relative flex items-center justify-between py-4">
          <div className="absolute top-1/2 left-6 right-6 h-1 bg-gray-200 -translate-y-1/2 rounded-full" />
          <div className="absolute top-1/2 left-6 h-1 bg-gradient-to-r from-emerald-500 to-indigo-500 -translate-y-1/2 rounded-full w-1/4" />
          {[
            { name: 'Onboarding', count: pending ?? 0, status: 'current' },
            { name: 'BGV Verify', count: bgv ?? 0, status: 'pending' },
            { name: 'eSign', count: appointmentEsign ?? 0, status: 'pending' },
            { name: 'Joining Docs', count: joiningDocs ?? 0, status: 'pending' },
          ].map((stage, i) => (
            <div key={i} className="relative flex flex-col items-center z-10">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold border-2 shadow-lg transition-all",
                stage.status === 'done' && "bg-gradient-to-br from-emerald-400 to-emerald-600 border-emerald-400 text-white shadow-emerald-500/30",
                stage.status === 'current' && "bg-gradient-to-br from-indigo-400 to-purple-600 border-indigo-400 text-white shadow-indigo-500/30",
                stage.status === 'pending' && "bg-white border-gray-200 text-gray-400"
              )}>
                {stage.count}
              </div>
              <p className="text-xs font-semibold text-gray-700 mt-2">{stage.name}</p>
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
