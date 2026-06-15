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
  GitBranch,
  Package,
  Sparkles,
  Target,
  UserCircle,
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
import { AdminWorkforceDashboard } from "@/components/dashboard/AdminWorkforceDashboard";
import { useEmployeeProfile } from "@/hooks/useEmployeeProfile";

import { useDashboardStats } from "@/hooks/useDashboardStats";
import { useEmployeeStatus } from "@/hooks/useEmployeeStatus";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { useAuth } from "@/contexts/AuthContext";

import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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

// SmartHR-inspired stat card colors with primary blue (#4361ee)
const statToneMap: Record<
  StatTone,
  {
    card: string;
    icon: string;
    value: string;
  }
> = {
  sky: {
    card: "border-blue-100 bg-gradient-to-br from-white via-white to-blue-50",
    icon: "bg-[#4361ee]/10 text-[#4361ee] ring-blue-100",
    value: "text-[#4361ee]",
  },
  emerald: {
    card: "border-green-100 bg-gradient-to-br from-white via-white to-green-50",
    icon: "bg-[#10b981]/10 text-[#10b981] ring-green-100",
    value: "text-[#10b981]",
  },
  indigo: {
    card: "border-purple-100 bg-gradient-to-br from-white via-white to-purple-50",
    icon: "bg-[#8b5cf6]/10 text-[#8b5cf6] ring-purple-100",
    value: "text-[#8b5cf6]",
  },
  amber: {
    card: "border-orange-100 bg-gradient-to-br from-white via-white to-orange-50",
    icon: "bg-[#f59e0b]/10 text-[#f59e0b] ring-orange-100",
    value: "text-[#f59e0b]",
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
      className={`smarthr-stat-card h-full rounded-xl border p-5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${styles.card} ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="smarthr-stat-label text-slate-500">
            {title}
          </p>

          <h3
            className={`mt-3 truncate text-3xl font-bold tracking-tight ${styles.value}`}
            style={{ fontFamily: "'Fira Code', monospace" }}
          >
            {value}
          </h3>
        </div>

        <div className={`rounded-xl p-3 ring-1 ${styles.icon}`}>{icon}</div>
      </div>

      <p className="mt-3 text-xs font-medium leading-5 text-slate-600">{description}</p>
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
  const { isAdminOrHR, isLoading: isRoleLoading, roleKeys } = useIsAdminOrHR();
  const { user } = useAuth();
  const { data: employeeProfile } = useEmployeeProfile();
  const navigate = useNavigate();

  const hasPendingApprovals = (stats?.pendingApprovals ?? 0) > 0;

  const getGreeting = () => {
    const hour = new Date().getHours();

    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";

    return "Good evening";
  };

  const getUserFirstName = () => {
    // Use employee profile first_name if available
    if (employeeProfile?.first_name) {
      return employeeProfile.first_name;
    }
    // Fallback to full_name
    if (employeeProfile?.full_name) {
      return employeeProfile.full_name.split(" ")[0];
    }
    // Fallback to email username
    const email = user?.email || "User";
    return email.split("@")[0].replace(/[._]/g, " ").split(" ")[0];
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
      {
        title: "Employee Journey",
        description: "Review lifecycle milestones",
        path: "/employee-stat-card",
        icon: <GitBranch className="h-4 w-4" />,
      },
      {
        title: "Employee Directory",
        description: "Open detailed employee profiles",
        path: "/employees",
        icon: <Users className="h-4 w-4" />,
      },
      {
        title: "Work Inbox",
        description: "Complete pending HR actions",
        path: "/work-inbox",
        icon: <ClipboardCheck className="h-4 w-4" />,
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
        {
          title: "My Profile",
          description: "Update details and photo",
          path: "/profile",
          icon: <UserCircle className="h-4 w-4" />,
        },
        {
          title: "My Payslips",
          description: "Review salary statements",
          path: "/profile?tab=payslips",
          icon: <Wallet className="h-4 w-4" />,
        },
        {
          title: "My Journey",
          description: "See milestones and recognition",
          path: "/profile?tab=journey",
          icon: <GitBranch className="h-4 w-4" />,
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

  if (roleKeys.includes("admin")) {
    return (
      <DashboardLayout>
        <AdminWorkforceDashboard />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <UpdateNotification />

        {/* Hero */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-0 lg:grid-cols-[1fr_340px]">
            <div className="relative p-5 sm:p-6">
              <div className="absolute inset-y-0 left-0 w-1.5 bg-[#1B6AB5]" />

              <div className="flex flex-col gap-5 pl-2 sm:flex-row sm:items-center">
                <Link to="/profile" aria-label="Open my profile" className="shrink-0">
                  <Avatar className="h-24 w-24 border-4 border-white shadow-lg ring-2 ring-[#1B6AB5]/20">
                    <AvatarImage src={employeeProfile?.avatar_url ?? undefined} alt="My profile photo" />
                    <AvatarFallback className="bg-[#1B6AB5] text-2xl font-black text-white">
                      {getUserFirstName().slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </Link>

                <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1.5 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-100">
                  <Sparkles className="h-3.5 w-3.5" />
                  Employee Workspace
                </div>

                <h1 className="mt-3 text-balance text-3xl font-bold tracking-tight text-slate-950">
                  {getGreeting()}, {getUserFirstName()}
                </h1>

                <p className="mt-2 max-w-2xl text-pretty text-sm leading-6 text-slate-500">
                  {employeeProfile?.designation || "Employee"}
                  {employeeProfile?.department_name ? ` · ${employeeProfile.department_name}` : ""}
                  {employeeProfile?.employee_code ? ` · ${employeeProfile.employee_code}` : ""}
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
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="h-9 rounded-xl border-slate-200 bg-white px-3 text-xs font-semibold"
                  >
                    <Link to="/profile?tab=payslips">
                      <Wallet className="mr-2 h-3.5 w-3.5" />
                      Open Payslips
                    </Link>
                  </Button>
                </div>
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

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {quickActions.map((action) => (
            <QuickActionCard key={action.title} action={action} />
          ))}
        </section>

        {/* Summary Strip */}
        <section className="grid gap-4 lg:grid-cols-3">
          <Link to="/profile" className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-[#1B6AB5]/40 hover:shadow-md">
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
            <ArrowRight className="mt-4 h-4 w-4 text-slate-300 group-hover:text-[#1B6AB5]" />
          </Link>

          <Link to={isAdminOrHR ? "/payroll" : "/profile?tab=payslips"} className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-[#3BAD49]/40 hover:shadow-md">
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
            <ArrowRight className="mt-4 h-4 w-4 text-slate-300 group-hover:text-[#3BAD49]" />
          </Link>

          <Link to="/work-inbox" className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-indigo-300 hover:shadow-md">
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
            <ArrowRight className="mt-4 h-4 w-4 text-slate-300 group-hover:text-indigo-600" />
          </Link>
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
