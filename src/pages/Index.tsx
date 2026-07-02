import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Calendar,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  FileText,
  Package,
  Sparkles,
  Target,
  UserPlus,
  Users,
  Wallet,
  Zap,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { PendingApprovalsWidget } from "@/components/dashboard/PendingApprovalsWidget";
import { TeamLeaveCalendar } from "@/components/dashboard/TeamLeaveCalendar";
import { NonEmployeeDashboard } from "@/components/dashboard/NonEmployeeDashboard";
import { UpdateNotification } from "@/components/dashboard/UpdateNotification";
import { WhosOut } from "@/components/dashboard/WhosOut";
import { UpcomingCelebrations } from "@/components/dashboard/UpcomingCelebrations";
import { UpcomingHolidays } from "@/components/dashboard/UpcomingHolidays";

import { useDashboardStats } from "@/hooks/useDashboardStats";
import { useEmployeeStatus } from "@/hooks/useEmployeeStatus";
import { useIsAdminOrHR, useWorkforceAccess } from "@/hooks/useUserRole";
import { useAuth } from "@/contexts/AuthContext";

import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type StatTone = "sky" | "emerald" | "indigo" | "amber" | "slate";

interface StatCardProps {
  title: string;
  value: string;
  description: string;
  icon: ReactNode;
  tone?: StatTone;
  onClick?: () => void;
}

interface SectionPanelProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}

interface QuickAction {
  title: string;
  description: string;
  path: string;
  icon: ReactNode;
}

const statToneMap: Record<
  StatTone,
  {
    card: string;
    icon: string;
    value: string;
  }
> = {
  sky: {
    card: "border-sky-100 bg-gradient-to-br from-white via-white to-sky-50",
    icon: "bg-sky-50 text-sky-700 ring-sky-100",
    value: "text-sky-950",
  },
  emerald: {
    card: "border-emerald-100 bg-gradient-to-br from-white via-white to-emerald-50",
    icon: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    value: "text-emerald-950",
  },
  indigo: {
    card: "border-indigo-100 bg-gradient-to-br from-white via-white to-indigo-50",
    icon: "bg-indigo-50 text-indigo-700 ring-indigo-100",
    value: "text-indigo-950",
  },
  amber: {
    card: "border-amber-100 bg-gradient-to-br from-white via-white to-amber-50",
    icon: "bg-amber-50 text-amber-700 ring-amber-100",
    value: "text-amber-950",
  },
  slate: {
    card: "border-slate-200 bg-white",
    icon: "bg-slate-100 text-slate-700 ring-slate-200",
    value: "text-slate-950",
  },
};

const StatCard = ({
  title,
  value,
  description,
  icon,
  tone = "slate",
  onClick,
}: StatCardProps) => {
  const styles = statToneMap[tone];

  const content = (
    <div
      className={`h-full rounded-2xl border p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${styles.card}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            {title}
          </p>

          <h3
            className={`mt-2 truncate text-2xl font-semibold tracking-tight ${styles.value}`}
          >
            {value}
          </h3>
        </div>

        <div className={`rounded-xl p-2.5 ring-1 ${styles.icon}`}>{icon}</div>
      </div>

      <p className="mt-3 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );

  if (!onClick) return content;

  return (
    <button type="button" onClick={onClick} className="h-full w-full text-left">
      {content}
    </button>
  );
};

const SectionPanel = ({
  title,
  description,
  action,
  children,
}: SectionPanelProps) => {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-slate-950">
            {title}
          </h2>

          {description && (
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {description}
            </p>
          )}
        </div>

        {action}
      </div>

      {children}
    </section>
  );
};

const QuickActionCard = ({ action }: { action: QuickAction }) => {
  return (
    <Link
      to={action.path}
      className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 transition group-hover:bg-slate-950 group-hover:text-white">
          {action.icon}
        </div>

        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950">
            {action.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {action.description}
          </p>
        </div>
      </div>

      <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-slate-700" />
    </Link>
  );
};

const Index = () => {
  const { data: stats, isLoading } = useDashboardStats();
  const { data: employeeStatus, isLoading: isEmployeeStatusLoading } =
    useEmployeeStatus();
  const { isAdminOrHR, isLoading: isRoleLoading } = useIsAdminOrHR();
  const { employeeName } = useWorkforceAccess();
  const { user } = useAuth();
  const navigate = useNavigate();

  const hasPendingApprovals = (stats?.pendingApprovals ?? 0) > 0;

  const getGreeting = () => {
    const hour = new Date().getHours();

    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";

    return "Good evening";
  };

  const getUserFirstName = () => {
    if (employeeName) {
      // Use first name from employee record
      return employeeName.split(" ")[0];
    }
    // Fallback to email if no employee name
    return user?.email?.split("@")[0] || "User";
  };

  const quickActions: QuickAction[] = isAdminOrHR
    ? [
        {
          title: "Add Employee",
          description: "Create onboarding entry",
          path: "/onboarding",
          icon: <UserPlus className="h-4 w-4" />,
        },
        {
          title: "Manage Assets",
          description: "Assign and track assets",
          path: "/assets",
          icon: <Package className="h-4 w-4" />,
        },
        {
          title: "View Payroll",
          description: "Open payroll workspace",
          path: "/payroll",
          icon: <FileText className="h-4 w-4" />,
        },
      ]
    : [
        {
          title: "Request Leave",
          description: "Apply for time off",
          path: "/leaves",
          icon: <Calendar className="h-4 w-4" />,
        },
        {
          title: "My KPIs",
          description: "View performance metrics",
          path: "/performance",
          icon: <Target className="h-4 w-4" />,
        },
        {
          title: "View Attendance",
          description: "Check attendance status",
          path: "/attendance",
          icon: <ClipboardList className="h-4 w-4" />,
        },
      ];

  if (isEmployeeStatusLoading || isRoleLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <Skeleton className="h-5 w-48 rounded-lg" />
            <Skeleton className="mt-3 h-4 w-80 rounded-lg" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[1, 2, 3, 4].map((item) => (
              <Skeleton key={item} className="h-32 rounded-2xl" />
            ))}
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
            <Skeleton className="h-96 rounded-2xl" />
            <Skeleton className="h-96 rounded-2xl" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!employeeStatus?.isEmployee && !isAdminOrHR) {
    return (
      <DashboardLayout>
        <NonEmployeeDashboard />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <UpdateNotification />

        {/* Hero */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-0 lg:grid-cols-[1fr_320px]">
            <div className="relative p-5 sm:p-6">
              <div className="absolute inset-y-0 left-0 w-1 bg-slate-950" />

              <div className="pl-2">
                <div className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1.5 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-100">
                  <Sparkles className="h-3.5 w-3.5" />
                  HRMS Workspace
                </div>

                <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">
                  {getGreeting()}, {getUserFirstName()}
                </h1>

                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                  Clean summary of your attendance, leaves, approvals, assets
                  and team updates.
                </p>

                <div className="mt-5 flex flex-wrap gap-2">
                  <Button
                    asChild
                    size="sm"
                    className="h-9 rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    <Link to="/attendance">
                      <Clock3 className="mr-2 h-3.5 w-3.5" />
                      View Attendance
                    </Link>
                  </Button>

                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="h-9 rounded-xl border-slate-200 bg-white px-3 text-xs font-semibold"
                  >
                    <Link to="/leaves">
                      <CalendarDays className="mr-2 h-3.5 w-3.5" />
                      Manage Leaves
                    </Link>
                  </Button>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 p-5 lg:border-l lg:border-t-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                Today&apos;s Snapshot
              </p>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] text-slate-500">Leaves</p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">
                    {stats?.availableLeaves || 0}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] text-slate-500">Assets</p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">
                    {stats?.assetsAssigned || 0}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] text-slate-500">Approvals</p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">
                    {stats?.pendingApprovals || 0}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                {stats?.onLeaveToday
                  ? "You are on leave today"
                  : "You are marked active today"}
              </div>
            </div>
          </div>
        </section>

        {/* KPI Cards */}
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {isLoading ? (
            <>
              {[1, 2, 3, 4].map((item) => (
                <Skeleton key={item} className="h-32 rounded-2xl" />
              ))}
            </>
          ) : (
            <>
              <StatCard
                title="Leave Balance"
                value={`${stats?.availableLeaves || 0} / ${
                  stats?.totalLeaves || 0
                }`}
                description="Available balance for the current leave cycle."
                icon={<CalendarDays className="h-5 w-5" />}
                tone="sky"
              />

              <StatCard
                title="Status Today"
                value={stats?.onLeaveToday ? "On Leave" : "Working"}
                description={
                  stats?.onLeaveToday
                    ? "You are marked on leave today."
                    : "You are currently marked active today."
                }
                icon={<CheckCircle2 className="h-5 w-5" />}
                tone={stats?.onLeaveToday ? "amber" : "emerald"}
              />

              <StatCard
                title="My Assets"
                value={String(stats?.assetsAssigned || 0)}
                description="Assets currently assigned to your profile."
                icon={<Package className="h-5 w-5" />}
                tone="indigo"
              />

              <StatCard
                title="Pending Approvals"
                value={String(stats?.pendingApprovals || 0)}
                description={
                  hasPendingApprovals
                    ? "Click to review approval queue."
                    : "No pending approval action right now."
                }
                icon={<ClipboardCheck className="h-5 w-5" />}
                tone={hasPendingApprovals ? "amber" : "slate"}
                onClick={
                  hasPendingApprovals ? () => navigate("/leave-approvals") : undefined
                }
              />
            </>
          )}
        </section>

        {/* Quick Actions */}
        <section className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-slate-950">
              Quick Actions
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Frequently used actions based on your access level.
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-2 rounded-xl border-slate-200 bg-white text-xs shadow-sm"
              >
                <Zap className="h-3.5 w-3.5 text-sky-700" />
                More Actions
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="z-50 w-56 bg-popover">
              {quickActions.map((action) => (
                <DropdownMenuItem key={action.title} asChild>
                  <Link
                    to={action.path}
                    className="flex cursor-pointer items-center gap-2 text-xs"
                  >
                    {action.icon}
                    {action.title}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {quickActions.map((action) => (
            <QuickActionCard key={action.title} action={action} />
          ))}
        </section>

        {/* Summary Strip */}
        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-sky-50 p-2.5 text-sky-700 ring-1 ring-sky-100">
                <Users className="h-4 w-4" />
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-950">
                  Employee Workspace
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Self-service actions in one place.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700 ring-1 ring-emerald-100">
                <Wallet className="h-4 w-4" />
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-950">
                  HR Operations
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Payroll, assets, approvals and reports.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-700 ring-1 ring-indigo-100">
                <ClipboardCheck className="h-4 w-4" />
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-950">
                  Approval Flow
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Track and close pending actions faster.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Team Availability */}
        <SectionPanel
          title="Team Availability"
          description="Current leave and availability snapshot."
          action={
            <Link
              to="/calendar"
              className="hidden text-xs font-semibold text-sky-700 hover:text-slate-950 sm:inline-flex"
            >
              Open Calendar
            </Link>
          }
        >
          <WhosOut />
        </SectionPanel>

        {/* Dashboard Grid */}
        <section className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="space-y-5">
            <SectionPanel
              title="Recent Activity"
              description="Latest HRMS actions and employee updates."
              action={
                <Link
                  to="/reports"
                  className="hidden text-xs font-semibold text-sky-700 hover:text-slate-950 sm:inline-flex"
                >
                  View Reports
                </Link>
              }
            >
              <RecentActivity />
            </SectionPanel>
          </div>

          <aside className="space-y-5">
            <SectionPanel title="Upcoming Holidays">
              <UpcomingHolidays />
            </SectionPanel>

            <SectionPanel title="Celebrations">
              <UpcomingCelebrations />
            </SectionPanel>

            <SectionPanel title="Pending Approvals">
              <PendingApprovalsWidget />
            </SectionPanel>

            <SectionPanel title="Team Leave Calendar">
              <TeamLeaveCalendar />
            </SectionPanel>
          </aside>
        </section>
      </div>
    </DashboardLayout>
  );
};

export default Index;