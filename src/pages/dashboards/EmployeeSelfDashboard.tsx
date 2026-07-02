import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  CalendarDays,
  FileText,
  HelpCircle,
  FolderOpen,
  CheckCircle2,
  Clock,
  TrendingUp,
} from "lucide-react";
import { RoleDashboardShell } from "@/components/dashboard";
import { WorkInboxPanel } from "@/components/dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/contexts/AuthContext";
import { AIInsightPanel } from "@/components/ai";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AttendanceSummary {
  presentDays?: number;
  absentDays?: number;
  lateDays?: number;
  totalWorkingDays?: number;
  attendancePct?: number;
}

interface LeaveBalance {
  leaveType: string;
  balance: number;
  used: number;
  total: number;
}

interface OnboardingStatus {
  isCandidate?: boolean;
  stage?: string;
  completedSteps?: number;
  totalSteps?: number;
  percentComplete?: number;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  unit,
  icon: Icon,
  loading,
  colorClass = "text-slate-900",
}: {
  label: string;
  value: number | string | null | undefined;
  unit?: string;
  icon: React.ElementType;
  loading: boolean;
  colorClass?: string;
}) {
  if (loading) {
    return <Skeleton className="h-24 rounded-xl" />;
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-start gap-3">
      <div className="rounded-lg bg-slate-100 p-2 shrink-0">
        <Icon className="h-5 w-5 text-slate-600" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
        <p className={`text-2xl font-bold leading-none mt-1 ${colorClass}`}>
          {value !== null && value !== undefined ? value : "—"}
          {unit && <span className="text-sm font-normal text-slate-500 ml-1">{unit}</span>}
        </p>
      </div>
    </div>
  );
}

function AttendanceCard({
  data,
  loading,
  error,
}: {
  data: AttendanceSummary | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="font-semibold text-slate-800 text-sm">My Attendance This Month</h3>
      </div>
      {loading && (
        <div className="p-4 space-y-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      )}
      {!loading && error && (
        <div className="flex items-center gap-2 m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {!loading && !error && data && (
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            label="Present"
            value={data.presentDays}
            unit="days"
            icon={CheckCircle2}
            loading={false}
            colorClass="text-emerald-700"
          />
          <StatCard
            label="Absent"
            value={data.absentDays}
            unit="days"
            icon={AlertCircle}
            loading={false}
            colorClass={data.absentDays && data.absentDays > 0 ? "text-red-600" : "text-slate-700"}
          />
          <StatCard
            label="Late"
            value={data.lateDays}
            unit="days"
            icon={Clock}
            loading={false}
            colorClass={data.lateDays && data.lateDays > 3 ? "text-amber-600" : "text-slate-700"}
          />
          <StatCard
            label="Attendance"
            value={data.attendancePct != null ? `${data.attendancePct}` : null}
            unit="%"
            icon={TrendingUp}
            loading={false}
            colorClass={
              data.attendancePct != null
                ? data.attendancePct >= 90
                  ? "text-emerald-700"
                  : data.attendancePct >= 75
                  ? "text-amber-600"
                  : "text-red-600"
                : "text-slate-700"
            }
          />
        </div>
      )}
    </div>
  );
}

function LeaveBalanceCard({
  balances,
  loading,
  error,
}: {
  balances: LeaveBalance[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h3 className="font-semibold text-slate-800 text-sm">My Leave Balance</h3>
        <Button asChild size="sm" variant="outline" className="h-7 text-xs">
          <Link to="/leaves/apply">Apply Leave</Link>
        </Button>
      </div>
      {loading && (
        <div className="p-4 space-y-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      )}
      {!loading && error && (
        <div className="flex items-center gap-2 m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {!loading && !error && balances.length === 0 && (
        <p className="text-sm text-slate-400 py-6 text-center">No leave balance data.</p>
      )}
      {!loading && !error && balances.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {balances.map((lb, i) => {
            const usedPct = lb.total > 0 ? Math.round((lb.used / lb.total) * 100) : 0;
            return (
              <li key={i} className="px-4 py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-slate-700">{lb.leaveType}</span>
                  <span className="text-xs text-slate-500">
                    <span className="font-semibold text-slate-900">{lb.balance}</span> / {lb.total} remaining
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-1.5 rounded-full transition-all"
                    style={{
                      width: `${usedPct}%`,
                      backgroundColor: usedPct > 80 ? "#dc2626" : usedPct > 50 ? "#d97706" : "#16a34a",
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function OnboardingStatusCard({
  status,
  loading,
}: {
  status: OnboardingStatus | null;
  loading: boolean;
}) {
  if (!loading && (!status || !status.isCandidate)) return null;

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 shadow-sm">
      <div className="px-4 py-3 border-b border-blue-100">
        <h3 className="font-semibold text-blue-800 text-sm">My Onboarding Status</h3>
      </div>
      {loading ? (
        <div className="p-4 space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : (
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-blue-700">
              Stage: <span className="font-bold">{status?.stage ?? "—"}</span>
            </span>
            <span className="text-sm text-blue-600 font-semibold">
              {status?.percentComplete ?? 0}% complete
            </span>
          </div>
          <div className="w-full bg-blue-100 rounded-full h-2 overflow-hidden">
            <div
              className="h-2 rounded-full bg-blue-500 transition-all"
              style={{ width: `${status?.percentComplete ?? 0}%` }}
            />
          </div>
          <p className="text-xs text-blue-600 mt-2">
            {status?.completedSteps ?? 0} of {status?.totalSteps ?? 0} steps completed
          </p>
        </div>
      )}
    </div>
  );
}

function QuickLinks() {
  const links = [
    { label: "Apply Leave", to: "/leaves/apply", icon: CalendarDays },
    { label: "View Payslip", to: "/payroll/my-payslips", icon: FileText },
    { label: "Raise Helpdesk", to: "/helpdesk/new", icon: HelpCircle },
    { label: "View Documents", to: "/my-documents", icon: FolderOpen },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="font-semibold text-slate-800 text-sm">Quick Links</h3>
      </div>
      <div className="grid grid-cols-2 gap-2 p-4">
        {links.map(({ label, to, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
          >
            <Icon className="h-4 w-4 text-slate-500 shrink-0" />
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EmployeeSelfDashboard() {
  const { user } = useAuth();
  const { data: roleData, isLoading: roleLoading } = useUserRole();

  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);

  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [leaveLoading, setLeaveLoading] = useState(true);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [onboardingLoading, setOnboardingLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    // Attendance
    setAttendanceLoading(true);
    fetch("/api/wfm/my-attendance")
      .then((res) => {
        if (!res.ok) throw new Error(`Attendance fetch failed: ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setAttendance(json?.data ?? json);
      })
      .catch((err) => {
        if (!cancelled) setAttendanceError(err.message ?? "Failed to load attendance.");
      })
      .finally(() => {
        if (!cancelled) setAttendanceLoading(false);
      });

    // Leave balances
    setLeaveLoading(true);
    fetch("/api/leaves/my-balance")
      .then((res) => {
        if (!res.ok) throw new Error(`Leave balance fetch failed: ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) {
          const list: LeaveBalance[] = Array.isArray(json)
            ? json
            : json.balances ?? json.data ?? [];
          setLeaveBalances(list);
        }
      })
      .catch((err) => {
        if (!cancelled) setLeaveError(err.message ?? "Failed to load leave balance.");
      })
      .finally(() => {
        if (!cancelled) setLeaveLoading(false);
      });

    // Onboarding status (non-critical)
    setOnboardingLoading(true);
    fetch("/api/ats/my-onboarding-status")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled) setOnboarding(json?.data ?? json ?? null);
      })
      .catch(() => {
        if (!cancelled) setOnboarding(null);
      })
      .finally(() => {
        if (!cancelled) setOnboardingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const employeeName = roleData?.employeeName ?? user?.email ?? "Employee";
  const loading = roleLoading;

  return (
    <RoleDashboardShell
      title={`Welcome, ${employeeName}`}
      subtitle="Your personal dashboard"
      scopeLabel="Self Service"
      loading={loading}
    >
      <div className="space-y-6">
        {/* Attendance */}
        <AttendanceCard
          data={attendance}
          loading={attendanceLoading}
          error={attendanceError}
        />

        {/* AI Self Dashboard Brief */}
        <AIInsightPanel
          contextType="employee_self"
          role="employee"
          title="Your Attendance & Leave AI Brief"
          enabled={!attendanceLoading && attendance !== null}
          data={{
            present_days: attendance?.presentDays,
            absent_days: attendance?.absentDays,
            late_days: attendance?.lateDays,
            total_working_days: attendance?.totalWorkingDays,
            attendance_pct: attendance?.attendancePct,
            leave_balances: leaveBalances.map((b) => ({ type: b.leaveType, balance: b.balance })),
          }}
        />

        {/* Onboarding (only shown if candidate) */}
        <OnboardingStatusCard
          status={onboarding}
          loading={onboardingLoading}
        />

        {/* Leave Balance + Work Inbox side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LeaveBalanceCard
            balances={leaveBalances}
            loading={leaveLoading}
            error={leaveError}
          />
          <WorkInboxPanel maxItems={6} />
        </div>

        {/* Quick Links */}
        <QuickLinks />
      </div>
    </RoleDashboardShell>
  );
}
