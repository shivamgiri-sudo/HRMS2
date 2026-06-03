import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  Award,
  BarChart3,
  BookOpen,
  Bell,
  Briefcase,
  Building2,
  Calendar,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock,
  CreditCard,
  Database,
  FileCheck,
  FileText,
  FilePen,
  GitBranch,
  HelpCircle,
  Heart,
  Home,
  Landmark,
  LogOut,
  Menu,
  MessageSquare,
  Network,
  Package,
  ShieldCheck,
  Search,
  Settings,
  Settings2,
  Sparkles,
  Target,
  Trophy,
  User,
  UserCircle,
  UserMinus,
  UserPlus,
  Users,
  X,
  Zap,
} from "lucide-react";
import { PWAInstallBanner } from "@/components/layout/PWAInstallBanner";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdminOrHR, useWorkforceAccess } from "@/hooks/useUserRole";
import { useVersionCheck } from "@/hooks/useVersionCheck";
import { cn } from "@/lib/utils";
import { APP_VERSION, isAutoUpdatingEnvironment } from "@/lib/version";

interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
  badge?: number;
  adminOnly?: boolean;
  employeeOnly?: boolean;
  pageCode?: string;
  roles?: string[]; // Show if user has any of these roles
  description?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

interface DashboardLayoutProps {
  children: ReactNode;
}

const companyLogo = "/mcn-logo.png?v=999";

const navGroups: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: <Home className="h-4 w-4" />, description: "Workspace overview" },
      { label: "My Modules", href: "/modules", icon: <Package className="h-4 w-4" />, description: "Role-wise ATS, LMS, WFM and performance modules" },
      { label: "Reports", href: "/reports", icon: <BarChart3 className="h-4 w-4" />, roles: ["admin", "hr", "manager", "ceo", "branch_head"], description: "Reports and insights" },
    ],
  },
  {
    title: "People",
    items: [
      { label: "Employees", href: "/employees", icon: <Users className="h-4 w-4" />, roles: ["admin", "hr", "manager", "branch_head", "process_manager"], description: "Employee directory" },
      { label: "Team Directory", href: "/employees", icon: <Users className="h-4 w-4" />, employeeOnly: true, description: "Team directory" },
      { label: "Departments", href: "/departments", icon: <Building2 className="h-4 w-4" />, roles: ["admin", "hr", "manager", "ceo", "branch_head"], description: "Department structure" },
      { label: "Onboarding", href: "/onboarding", icon: <UserPlus className="h-4 w-4" />, roles: ["admin", "hr"], description: "New employee onboarding" },
      { label: "Document Verification", href: "/document-verification", icon: <FileCheck className="h-4 w-4" />, roles: ["admin", "hr"], description: "Verify employee documents and track expiry" },
      { label: "Employee Journey", href: "/employee-stat-card", icon: <UserCircle className="h-4 w-4" />, description: "Full profile, stats and timeline for any employee" },
    ],
  },
  {
    title: "Time",
    items: [
      { label: "Attendance", href: "/attendance", icon: <Clock className="h-4 w-4" />, description: "Attendance records" },
      { label: "Attendance Regularization", href: "/attendance-regularization", icon: <ClipboardList className="h-4 w-4" />, description: "Attendance correction workflow" },
      { label: "Calendar", href: "/calendar", icon: <Calendar className="h-4 w-4" />, description: "Company calendar" },
      { label: "Leaves", href: "/leaves", icon: <CalendarDays className="h-4 w-4" />, description: "Leave requests" },
    ],
  },
  {
    title: "Operations",
    items: [
      { label: "Performance", href: "/performance", icon: <Target className="h-4 w-4" />, description: "Goals and performance" },
      { label: "Goals & Appraisal", href: "/goals", icon: <Target className="h-4 w-4" />, description: "Goals, appraisal cycles and skills" },
      { label: "Reviews", href: "/reviews-management", icon: <ClipboardList className="h-4 w-4" />, roles: ["admin", "hr", "manager", "branch_head", "process_manager"], description: "Performance reviews" },
      { label: "Work Inbox", href: "/work-inbox", icon: <ClipboardList className="h-4 w-4" />, pageCode: "WORK_INBOX", description: "Pending actions and approvals" },
      { label: "Helpdesk", href: "/helpdesk", icon: <HelpCircle className="h-4 w-4" />, description: "Support tickets and grievances" },
      { label: "Benefits & Claims", href: "/benefits", icon: <ShieldCheck className="h-4 w-4" />, description: "Benefit plans, enrollment and reimbursements" },
      { label: "Bulk Upload Hub", href: "/bulk-upload", icon: <Package className="h-4 w-4" />, roles: ["admin", "hr"], description: "Bulk upload templates and staging" },
      { label: "Assets", href: "/assets-manager", icon: <Briefcase className="h-4 w-4" />, roles: ["admin", "hr"], description: "Asset inventory and assignments" },
      { label: "Letters", href: "/letters", icon: <FileText className="h-4 w-4" />, roles: ["admin", "hr"], description: "HR letter generation" },
      { label: "Offer Letters", href: "/offer-letter", icon: <FilePen className="h-4 w-4" />, roles: ["admin", "hr"], description: "Generate and track offer & HR letters" },
      { label: "ERP", href: "/erp", icon: <Landmark className="h-4 w-4" />, roles: ["admin", "hr", "finance"], description: "Expenses, vendors, contracts, procurement" },
      { label: "Advanced Reports", href: "/advanced-reports", icon: <BarChart3 className="h-4 w-4" />, roles: ["admin", "hr", "manager", "ceo"], description: "Headcount, attendance, leave and payroll reports" },
      { label: "Master Reports", href: "/master-reports", icon: <BarChart3 className="h-4 w-4" />, roles: ["admin", "hr", "ceo"], description: "Branch, user, process and employee master reports" },
      { label: "Payroll", href: "/payroll", icon: <CreditCard className="h-4 w-4" />, roles: ["admin", "hr", "finance", "payroll"], description: "Payroll workspace" },
      { label: "Payslips", href: "/payroll/payslips", icon: <CreditCard className="h-4 w-4" />, roles: ["admin", "hr", "finance", "payroll"], description: "Payslip generation and acknowledgement" },
      { label: "Tax Declaration", href: "/payroll/tax-declaration", icon: <Landmark className="h-4 w-4" />, description: "Investment declaration" },
      { label: "Full & Final", href: "/payroll/full-final", icon: <Zap className="h-4 w-4" />, roles: ["admin", "hr", "finance", "payroll"], description: "F&F settlement for exits" },
    ],
  },
  {
    title: "Performance Feedback",
    items: [
      { label: "My Feedback", href: "/performance-feedback/my-reports", icon: <FileText className="h-4 w-4" />, description: "View and manage feedback received" },
      { label: "My Assignments", href: "/performance-feedback/assignments", icon: <ClipboardCheck className="h-4 w-4" />, roles: ["admin", "hr", "manager", "branch_head", "process_manager"], description: "Pending feedback assignments" },
      { label: "Team Feedback", href: "/performance-feedback/team-reports", icon: <Users className="h-4 w-4" />, roles: ["admin", "hr", "manager", "branch_head", "process_manager", "qa"], description: "Team feedback reports and analytics" },
      { label: "Development Plans", href: "/performance-feedback/development-plan", icon: <Target className="h-4 w-4" />, description: "Personal development plans and goals" },
    ],
  },
  {
    title: "Engagement",
    items: [
      { label: "My Engagement", href: "/engagement", icon: <Sparkles className="h-4 w-4" />, description: "Points, tier progress and recent appreciation" },
      { label: "Badges", href: "/engagement/badges", icon: <Award className="h-4 w-4" />, description: "Recognition badges and milestones" },
      { label: "Kudos Wall", href: "/engagement/kudos", icon: <Heart className="h-4 w-4" />, description: "Celebrate contributions from colleagues" },
      { label: "Surveys & Pulse", href: "/engagement/surveys", icon: <ClipboardList className="h-4 w-4" />, description: "Employee feedback and weekly pulse" },
      { label: "Leaderboard", href: "/engagement/leaderboard", icon: <Trophy className="h-4 w-4" />, description: "Top engagement points and tiers" },
    ],
  },
  {
    title: "Workforce OS",
    items: [
      { label: "ATS Dashboard", href: "/ats/dashboard", icon: <UserPlus className="h-4 w-4" />, pageCode: "ATS_DASHBOARD", description: "Recruitment command center" },
      { label: "ATS Extensions", href: "/ats/extensions", icon: <GitBranch className="h-4 w-4" />, pageCode: "ATS_EXTENSIONS", description: "Requisitions, BGV, offers and analytics" },
      { label: 'Form Config', href: '/ats/form-config', icon: <Settings className="h-4 w-4" />, roles: ["admin", "hr"], description: "Configure ATS form fields" },
      { label: "Jobs Portal", href: "/jobs", icon: <Briefcase className="h-4 w-4" />, pageCode: "JOBS_PORTAL", description: "Job postings, walk-in queue and vacancy analytics" },
      { label: "Walk-in Queue", href: "/ats/walkin-queue", icon: <Users className="h-4 w-4" />, pageCode: "ATS_WAITING_QUEUE", description: "Real-time walk-in candidate queue" },
      { label: "My Candidate Queue", href: "/ats/recruiter/my-candidates", icon: <ClipboardList className="h-4 w-4" />, pageCode: "ATS_RECRUITER_QUEUE", description: "Assigned recruitment queue" },
      { label: "My Learning", href: "/lms/my-learning", icon: <BookOpen className="h-4 w-4" />, pageCode: "LMS_MY_LEARNING", description: "Learning path and assigned modules" },
      { label: "LMS Coordinator", href: "/lms/coordinator", icon: <Users className="h-4 w-4" />, pageCode: "LMS_COORDINATOR", description: "Training batch and trainee coordination" },
      { label: "LMS Admin", href: "/lms/admin", icon: <BookOpen className="h-4 w-4" />, pageCode: "LMS_ADMIN", description: "Curriculum, content and rules" },
      { label: "LMS Management", href: "/lms/management-dashboard", icon: <BarChart3 className="h-4 w-4" />, pageCode: "LMS_MANAGEMENT_DASHBOARD", description: "Training management dashboard" },
      { label: "LMS Integration", href: "/lms/integration", icon: <Network className="h-4 w-4" />, pageCode: "LMS_INTEGRATION", description: "LMS bridge, mappings and sync" },
      { label: "My Roster", href: "/my-roster", icon: <Calendar className="h-4 w-4" />, description: "View and acknowledge your weekly roster" },
      { label: "Roster Preferences", href: "/roster-preference", icon: <CalendarClock className="h-4 w-4" />, description: "Submit and review shift and week-off preferences" },
      { label: "Roster Planning", href: "/wfm/roster", icon: <Clock className="h-4 w-4" />, pageCode: "WFM_ROSTER", description: "WFM roster and shift planning" },
      { label: "Auto Roster", href: "/wfm/auto-roster", icon: <Calendar className="h-4 w-4" />, pageCode: "WFM_AUTO_ROSTER", description: "Automated roster generation and PM approval" },
      { label: "WFM Live Tracker", href: "/wfm/live-tracker", icon: <Clock className="h-4 w-4" />, pageCode: "WFM_LIVE_TRACKER", description: "Live shift and break tracker" },
      { label: "RTA Board", href: "/rta-board", icon: <Activity className="h-4 w-4" />, pageCode: "RTA_BOARD", description: "Real-time adherence, shrinkage and reconciliation" },
      { label: "WFM Extensions", href: "/wfm/extensions", icon: <Activity className="h-4 w-4" />, pageCode: "WFM_EXTENSIONS", description: "Swaps, conflicts, coverage, attrition" },
      { label: "Quality Dashboard", href: "/quality/dashboard", icon: <ShieldCheck className="h-4 w-4" />, pageCode: "QUALITY_DASHBOARD", description: "Quality, defects and coaching" },
      { label: "Operations Dashboard", href: "/operations/dashboard", icon: <Activity className="h-4 w-4" />, pageCode: "OPERATIONS_DASHBOARD", description: "Process productivity and SLA" },
      { label: "Operations KPI", href: "/operations-kpi", icon: <Target className="h-4 w-4" />, pageCode: "OPERATIONS_KPI", description: "AHT, adherence, FCR and ops metrics per process" },
      { label: "Management Dashboard", href: "/management/dashboard", icon: <BarChart3 className="h-4 w-4" />, pageCode: "MANAGEMENT_DASHBOARD", description: "Team KPI, coaching and alerts" },
      { label: "Career Planning", href: "/career-planning", icon: <Target className="h-4 w-4" />, pageCode: "CAREER_PLANNING", description: "Career paths and succession readiness" },
      { label: "PIP Management", href: "/pip-management", icon: <ClipboardList className="h-4 w-4" />, pageCode: "PIP_MANAGEMENT", description: "Performance improvement plans" },
      { label: "Mobility", href: "/mobility", icon: <GitBranch className="h-4 w-4" />, pageCode: "MOBILITY", description: "Transfers and promotions" },
      { label: "Performance Command Center", href: "/performance/command-center", icon: <BarChart3 className="h-4 w-4" />, pageCode: "WORKFORCE_COMMAND_CENTER", description: "Unified workforce intelligence" },
      { label: "Access Control", href: "/settings/access-control", icon: <Settings className="h-4 w-4" />, pageCode: "ACCESS_CONTROL", roles: ["admin"], description: "Role and page access management" },
      { label: "Super Admin Page Access", href: "/super-admin/page-access", icon: <ShieldCheck className="h-4 w-4" />, roles: ["admin"], description: "Assign specific pages to users" },
      { label: "KPI Configuration", href: "/kpi-config", icon: <Target className="h-4 w-4" />, pageCode: "KPI_CONFIG", roles: ["admin", "hr", "manager", "process_manager"], description: "Per-process KPI targets and rating thresholds" },
    ],
  },
  {
    title: "Communication",
    items: [
      { label: "Templates",         href: "/communication/templates", icon: <MessageSquare className="h-4 w-4" />, roles: ["admin", "hr"],  description: "Manage email, SMS and WhatsApp templates" },
      { label: "Dispatch Center",   href: "/communication/dispatch",  icon: <MessageSquare className="h-4 w-4" />,                   description: "Send messages to employees" },
      { label: "Dispatch History",  href: "/communication/history",   icon: <MessageSquare className="h-4 w-4" />, roles: ["admin", "hr"],  description: "View and retry dispatch logs" },
      { label: "Notification Prefs", href: "/communication/preferences", icon: <Bell className="h-4 w-4" />,                      description: "Manage notification preferences" },
      { label: "Comm. Config",       href: "/settings/communication-config", icon: <Settings2 className="h-4 w-4" />, roles: ["admin"], description: "Configure email, SMS, WhatsApp providers" },
    ],
  },
  {
    title: "System",
    items: [
      { label: "Settings", href: "/settings", icon: <Settings className="h-4 w-4" />, roles: ["admin"], description: "System settings" },
      { label: "Org Masters", href: "/org-masters", icon: <Building2 className="h-4 w-4" />, roles: ["admin", "hr"], description: "Branches, departments, LOBs, designations" },
      { label: "CC Code Config", href: "/settings/call-centre-config", icon: <Building2 className="h-4 w-4" />, roles: ["admin", "hr"], description: "Manage call centre master codes for reports and integrations" },
      { label: "Locations & Policies", href: "/org-masters/locations-policies", icon: <Landmark className="h-4 w-4" />, roles: ["admin", "hr"], description: "Location and policy master data" },
      { label: "Client Master", href: "/client-master", icon: <Users className="h-4 w-4" />, roles: ["admin", "hr"], description: "Portal clients and user management" },
      { label: "Portal Data Manager", href: "/portal-data-manager", icon: <ShieldCheck className="h-4 w-4" />, roles: ["admin", "hr", "process_manager"], description: "Approve and publish data for client portal view" },
      { label: "Workflow Admin", href: "/workflow-admin", icon: <GitBranch className="h-4 w-4" />, roles: ["admin", "hr"], description: "Approval workflows and pending inbox" },
      { label: "Employee Lifecycle", href: "/employee-lifecycle-v2", icon: <User className="h-4 w-4" />, roles: ["admin", "hr"], description: "Probation tracker, transfers, promotions and lifecycle events" },
      { label: "Statutory Config", href: "/payroll/statutory-config", icon: <Landmark className="h-4 w-4" />, roles: ["admin", "hr", "finance"], description: "PF, ESIC, PT and gratuity configuration" },
      { label: "Process Configuration", href: "/process-config", icon: <Network className="h-4 w-4" />, roles: ["admin", "hr", "process_manager"], description: "Per-process KPI targets, payroll rules, roster settings" },
      { label: "Leave Types", href: "/leave-types", icon: <CalendarDays className="h-4 w-4" />, roles: ["admin", "hr"], description: "Leave type master — PL, SL, CL, LWP rules" },
      { label: "Attendance Rules", href: "/attendance-rules-master", icon: <Clock className="h-4 w-4" />, roles: ["admin", "hr", "wfm"], description: "Configure attendance thresholds by designation, process or branch" },
      { label: "Notifications", href: "/notification-preferences", icon: <Bell className="h-4 w-4" />, description: "Notification preferences" },
      { label: "Statutory Compliance", href: "/compliance/statutory", icon: <Landmark className="h-4 w-4" />, roles: ["admin", "hr", "finance"], description: "PF/UAN, ECR, ESIC challan, PT slabs, min wages" },
      { label: "Labour Compliance", href: "/compliance/labour", icon: <ShieldCheck className="h-4 w-4" />, roles: ["admin", "hr"], description: "Bonus Act, POSH register, Maternity benefits" },
      { label: "DPDP / Privacy", href: "/compliance/dpdp", icon: <ShieldCheck className="h-4 w-4" />, roles: ["admin", "hr"], description: "Consent, data rights, breach log, retention policy" },
      { label: "Integration Hub", href: "/integration-hub", icon: <Network className="h-4 w-4" />, roles: ["admin"], description: "Data connectors, mappings and sync runs" },
      { label: "Migration Console", href: "/migration-console", icon: <Database className="h-4 w-4" />, roles: ["admin"], description: "Supabase → MySQL migration status" },
      { label: "Exit Management", href: "/exit-management", icon: <UserMinus className="h-4 w-4" />, roles: ["admin", "hr"], description: "Resignations, terminations and clearance workflow" },
    ],
  },
];

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [logoError, setLogoError] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();

  const { user, signOut, isSigningOut } = useAuth();
  const { isAdminOrHR } = useIsAdminOrHR();
  const { canViewPage, visiblePageCodes, hasAnyRole } = useWorkforceAccess();
  const { data: versionData } = useVersionCheck();

  const displayVersion = isAutoUpdatingEnvironment()
    ? versionData?.currentVersion ?? APP_VERSION
    : versionData?.hasUpdate
      ? APP_VERSION
      : versionData?.currentVersion ?? APP_VERSION;

  const filteredNavGroups = useMemo(() => {
    const visibleSet = new Set(visiblePageCodes);
    return navGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (item.pageCode) {
            return visibleSet.has(item.pageCode) || canViewPage(item.pageCode);
          }
          if (item.roles && item.roles.length > 0) {
            return hasAnyRole(...item.roles);
          }
          if (item.adminOnly && !isAdminOrHR) return false;
          if (item.employeeOnly && isAdminOrHR) return false;
          return true;
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [isAdminOrHR, canViewPage, visiblePageCodes, hasAnyRole]);

  const searchableItems = useMemo(() => {
    return filteredNavGroups.flatMap((group) =>
      group.items.map((item) => ({ ...item, groupTitle: group.title }))
    );
  }, [filteredNavGroups]);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];

    return searchableItems.filter((item) =>
      item.label.toLowerCase().includes(query) ||
      item.description?.toLowerCase().includes(query) ||
      item.groupTitle.toLowerCase().includes(query)
    );
  }, [searchQuery, searchableItems]);

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (searchResults[0]) {
      navigate(searchResults[0].href);
      setSearchQuery("");
      setSidebarOpen(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const userInitials = user?.email?.slice(0, 2).toUpperCase() || "MC";

  const SidebarContent = () => (
    <div className="flex h-full flex-col bg-[#0f172a] text-slate-100">
      <div className="relative border-b border-white/10 px-4 py-4">
        <div className="absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.26),transparent_48%)]" />
        <div className="relative rounded-2xl border border-white/10 bg-white/[0.05] p-3 shadow-xl shadow-slate-950/20">
          <Link to="/dashboard">
            <div className="flex h-[104px] items-center justify-center rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-200 px-4 py-3 shadow-lg">
              {logoError ? (
                <div className="flex h-full w-full items-center justify-center rounded-xl bg-slate-950 text-xl font-bold tracking-wide text-white">MCN</div>
              ) : (
                <img src={companyLogo} alt="MAS Callnet" className="block h-20 w-full max-w-[220px] object-contain drop-shadow-md" onError={() => setLogoError(true)} />
              )}
            </div>
            <div className="mt-3 min-w-0 text-center">
              <p className="truncate text-[14px] font-semibold tracking-tight text-white">MAS Callnet HRMS</p>
              <p className="truncate text-[12px] text-slate-400">Employee Portal</p>
            </div>
          </Link>
        </div>
      </div>

      <nav className="mcn-sidebar-scroll flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-5">
          {filteredNavGroups.map((group) => (
            <div key={group.title}>
              <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{group.title}</p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  // Exact match for dashboard to avoid matching all routes starting with '/'
                  const isActive = item.href === "/dashboard"
                    ? location.pathname === "/dashboard"
                    : location.pathname === item.href || location.pathname.startsWith(item.href + "/");
                  return (
                    <Link
                      key={`${group.title}-${item.label}`}
                      to={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className={cn(
                        "group flex items-center justify-between rounded-xl px-3 py-2.5 text-[13.5px] font-semibold transition",
                        isActive
                          ? "bg-blue-600 text-white shadow-lg shadow-blue-900/40"
                          : "text-slate-300 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition", isActive ? "bg-blue-500 text-white" : "bg-white/5 text-slate-400 group-hover:bg-white/10 group-hover:text-white")}>
                          {item.icon}
                        </span>
                        <span className="truncate">{item.label}</span>
                      </span>
                      {item.badge ? (
                        <Badge className="ml-2 h-5 rounded-full bg-cyan-100 px-2 text-[10px] font-semibold text-cyan-700 hover:bg-cyan-100">{item.badge}</Badge>
                      ) : isActive ? (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-blue-200" />
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <div className="border-t border-white/10 p-3">
        <Link to="/changelog" onClick={() => setSidebarOpen(false)} className="flex items-center justify-center rounded-xl px-3 py-2 text-[11px] text-slate-500 transition hover:bg-white/5 hover:text-slate-300">
          v{displayVersion}
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f3f6fb] text-slate-900">
      <PWAInstallBanner />
      {sidebarOpen && (
        <button type="button" aria-label="Close sidebar" className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[260px] border-r border-slate-900 bg-[#0f172a] shadow-2xl lg:block"><SidebarContent /></aside>
      <aside className={cn("fixed inset-y-0 left-0 z-50 w-[280px] bg-[#0f172a] shadow-2xl transition-transform duration-300 lg:hidden", sidebarOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className="absolute right-3 top-3 z-10">
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => setSidebarOpen(false)}><X className="h-4 w-4" /></Button>
        </div>
        <SidebarContent />
      </aside>
      <div className="min-h-screen lg:pl-[260px]">
        <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 shadow-sm shadow-slate-200/50 backdrop-blur">
          <div className="flex min-h-[68px] items-center gap-4 px-4 sm:px-5 lg:px-6">
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-xl text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setSidebarOpen(true)}><Menu className="h-5 w-5" /></Button>
            <form onSubmit={handleSearchSubmit} className="relative max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search modules, people, reports..." className="pl-10" />
              {searchQuery.trim() && searchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-12 z-50 rounded-2xl border bg-popover p-2 shadow-lg">
                  {searchResults.slice(0, 6).map((item) => (
                    <button key={item.href} type="button" onClick={() => { navigate(item.href); setSearchQuery(""); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-accent">
                      {item.icon}
                      <div><p className="font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{item.description}</p></div>
                    </button>
                  ))}
                </div>
              )}
            </form>
            <div className="ml-auto flex shrink-0 items-center gap-2">
            <NotificationBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-10 w-10 rounded-full"><Avatar className="h-10 w-10"><AvatarImage src="" /><AvatarFallback className="bg-primary text-primary-foreground">{userInitials}</AvatarFallback></Avatar></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel><div className="flex flex-col space-y-1"><p className="text-sm font-medium">My Account</p><p className="text-xs text-muted-foreground">{user?.email}</p></div></DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild><Link to="/profile"><User className="mr-2 h-4 w-4" />Profile</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link to="/settings"><Settings className="mr-2 h-4 w-4" />Settings</Link></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} disabled={isSigningOut}><LogOut className="mr-2 h-4 w-4" />{isSigningOut ? "Signing out..." : "Sign out"}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </div>
          </div>
        </header>
        <main className="px-4 py-5 sm:px-5 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
