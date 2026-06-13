/**
 * CompactDashboardLayout — HRMS v2 App Shell
 *
 * Visual redesign using design tokens from hrms-design-system.css.
 * Sidebar: Linear-inspired dark (#0a0f1e) with surface-ladder depth, flat nav groups,
 *          left-accent active indicator, compact 248px width.
 * Topbar:  Glassmorphism white with breadcrumb + ⌘K search + notification + avatar.
 * Mobile:  Slide-in drawer + bottom-nav bar (5 primary tabs).
 *
 * CONSTRAINTS HONOURED:
 * - Routes unchanged (uses navGroups from same data shape as before)
 * - pageCode / WorkforcePageGate hooks untouched
 * - Auth flow untouched
 * - No backend contracts changed
 */
import {
  type FormEvent,
  type ReactNode,
  useMemo,
  useState,
  useEffect,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Activity, BarChart3, Bell, Briefcase, Building2, Calendar,
  CalendarDays, ClipboardList, Clock, CreditCard, FileCheck,
  FileText, GraduationCap, Heart, Home, Landmark, Menu,
  Network, Package, Settings, Settings2, ShieldCheck, Sparkles,
  Target, TrendingUp, User, UserMinus, UserPlus, Users, Wallet,
  X, Zap,
} from "lucide-react";
import { PWAInstallBanner } from "@/components/layout/PWAInstallBanner";
import { TopBar } from "@/components/layout/TopBar";
import { SidebarNav, type NavGroup } from "@/components/layout/SidebarNav";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdminOrHR, useWorkforceAccess } from "@/hooks/useUserRole";
import { useVersionCheck } from "@/hooks/useVersionCheck";
import { cn } from "@/lib/utils";
import { APP_VERSION, isAutoUpdatingEnvironment } from "@/lib/version";

type Props = { children: ReactNode };

const companyLogo = "/mcn-logo.png?v=999";

const navGroups: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard",  href: "/dashboard",  icon: <Home className="h-[15px] w-[15px]" />,         description: "Workspace" },
      { label: "My Modules", href: "/modules",    icon: <Package className="h-[15px] w-[15px]" />,      description: "All allowed pages" },
      { label: "Work Inbox", href: "/work-inbox", icon: <ClipboardList className="h-[15px] w-[15px]" />, pageCode: "WORK_INBOX", description: "Pending actions" },
      { label: "Reports",    href: "/reports",    icon: <BarChart3 className="h-[15px] w-[15px]" />,    roles: ["admin","hr","manager","ceo","branch_head"], description: "Reports" },
    ],
  },
  {
    title: "My Space",
    items: [
      { label: "Profile",          href: "/profile",              icon: <User className="h-[15px] w-[15px]" />,         description: "Profile" },
      { label: "Attendance",       href: "/attendance",           icon: <Clock className="h-[15px] w-[15px]" />,         description: "Attendance" },
      { label: "Leaves",           href: "/leaves",               icon: <CalendarDays className="h-[15px] w-[15px]" />,  description: "Leave" },
      { label: "My Roster",        href: "/my-roster",            icon: <Calendar className="h-[15px] w-[15px]" />,      description: "Roster" },
      { label: "Payslips",         href: "/payroll/payslips",     icon: <CreditCard className="h-[15px] w-[15px]" />,    description: "Payslips" },
      { label: "Tax Declaration",  href: "/payroll/tax-declaration", icon: <Landmark className="h-[15px] w-[15px]" />,  description: "Tax" },
      { label: "Engagement",       href: "/engagement",           icon: <Sparkles className="h-[15px] w-[15px]" />,      description: "Engagement" },
    ],
  },
  {
    title: "People & Hiring",
    items: [
      { label: "Employees",             href: "/employees",                      icon: <Users className="h-[15px] w-[15px]" />,       roles: ["admin","hr","manager","branch_head","process_manager"], description: "Directory" },
      { label: "Departments",           href: "/departments",                    icon: <Building2 className="h-[15px] w-[15px]" />,    roles: ["admin","hr","manager","ceo","branch_head"], description: "Departments" },
      { label: "Onboarding",            href: "/onboarding",                     icon: <UserPlus className="h-[15px] w-[15px]" />,     roles: ["admin","hr"], description: "Onboarding" },
      { label: "Document Verification", href: "/document-verification",          icon: <FileCheck className="h-[15px] w-[15px]" />,    roles: ["admin","hr"], description: "Documents" },
      { label: "Employee Journey",      href: "/employee-stat-card",             icon: <Users className="h-[15px] w-[15px]" />,        description: "Journey" },
      { label: "ATS Command",           href: "/ats/command-center",             icon: <Briefcase className="h-[15px] w-[15px]" />,    pageCode: "ATS_DASHBOARD", description: "ATS" },
      { label: "Walk-in Queue",         href: "/ats/walkin-queue",               icon: <Users className="h-[15px] w-[15px]" />,        pageCode: "ATS_WAITING_QUEUE", description: "Queue" },
      { label: "My Candidates",         href: "/ats/recruiter/my-candidates",    icon: <ClipboardList className="h-[15px] w-[15px]" />, pageCode: "ATS_RECRUITER_QUEUE", description: "Candidates" },
      { label: "Jobs Portal",           href: "/jobs",                           icon: <Briefcase className="h-[15px] w-[15px]" />,    pageCode: "JOBS_PORTAL", description: "Jobs" },
    ],
  },
  {
    title: "Workforce",
    items: [
      { label: "My Learning",    href: "/lms/my-learning",    icon: <GraduationCap className="h-[15px] w-[15px]" />, pageCode: "LMS_MY_LEARNING", description: "LMS" },
      { label: "LMS Coordinator",href: "/lms/coordinator",   icon: <Users className="h-[15px] w-[15px]" />,         pageCode: "LMS_COORDINATOR", description: "Training" },
      { label: "LMS Admin",      href: "/lms/admin",          icon: <GraduationCap className="h-[15px] w-[15px]" />, pageCode: "LMS_ADMIN", description: "LMS admin" },
      { label: "Roster Planning",href: "/wfm/roster",         icon: <Clock className="h-[15px] w-[15px]" />,         pageCode: "WFM_ROSTER", description: "Roster" },
      { label: "Auto Roster",    href: "/wfm/auto-roster",    icon: <Calendar className="h-[15px] w-[15px]" />,      pageCode: "WFM_AUTO_ROSTER", description: "Auto roster" },
      { label: "RTA Board",      href: "/rta-board",          icon: <Activity className="h-[15px] w-[15px]" />,      pageCode: "RTA_BOARD", description: "RTA" },
      { label: "WFM Tracker",    href: "/wfm/live-tracker",   icon: <Clock className="h-[15px] w-[15px]" />,         pageCode: "WFM_LIVE_TRACKER", description: "Live" },
    ],
  },
  {
    title: "Operations",
    items: [
      { label: "Performance",      href: "/performance",             icon: <Target className="h-[15px] w-[15px]" />,      description: "Performance" },
      { label: "Goals & Appraisal",href: "/goals",                  icon: <Target className="h-[15px] w-[15px]" />,      description: "Goals" },
      { label: "Payroll",          href: "/payroll",                 icon: <CreditCard className="h-[15px] w-[15px]" />,  roles: ["admin","hr","finance","payroll"], description: "Payroll" },
      { label: "Full & Final",     href: "/payroll/full-final",      icon: <Zap className="h-[15px] w-[15px]" />,         roles: ["admin","hr","finance","payroll"], description: "F&F" },
      { label: "Payroll Masters",  href: "/payroll/masters",         icon: <Settings2 className="h-[15px] w-[15px]" />,   roles: ["admin","hr","finance","payroll"], description: "Slabs" },
      { label: "Salary Packages",  href: "/payroll/salary-packages", icon: <Wallet className="h-[15px] w-[15px]" />,      roles: ["admin","finance"], description: "Pay matrix" },
      { label: "Incentives",       href: "/payroll/incentives",      icon: <TrendingUp className="h-[15px] w-[15px]" />,  roles: ["admin","hr","finance","payroll"], description: "Incentives" },
      { label: "KPI Config",       href: "/kpi-config",              icon: <Target className="h-[15px] w-[15px]" />,      pageCode: "KPI_CONFIG", roles: ["admin","hr","manager","process_manager"], description: "KPI" },
      { label: "Operations KPI",   href: "/operations-kpi",          icon: <Target className="h-[15px] w-[15px]" />,      pageCode: "OPERATIONS_KPI", description: "Ops KPI" },
      { label: "KPI Master",       href: "/kpi-master",              icon: <Target className="h-[15px] w-[15px]" />,      roles: ["admin","hr","process_manager"], description: "Define KPIs" },
      { label: "My KPIs",          href: "/my-kpi",                  icon: <Activity className="h-[15px] w-[15px]" />,    description: "Live KPI" },
      { label: "Management",       href: "/management/dashboard",    icon: <BarChart3 className="h-[15px] w-[15px]" />,   pageCode: "MANAGEMENT_DASHBOARD", description: "Management" },
      { label: "Control Tower",    href: "/control-tower",           icon: <Activity className="h-[15px] w-[15px]" />,    pageCode: "CONTROL_TOWER", description: "Control tower" },
    ],
  },
  {
    title: "Engage & Support",
    items: [
      { label: "Kudos Wall",       href: "/engagement/kudos",              icon: <Heart className="h-[15px] w-[15px]" />,       description: "Kudos" },
      { label: "Badges",           href: "/engagement/badges",             icon: <ShieldCheck className="h-[15px] w-[15px]" />,  description: "Badges" },
      { label: "Surveys",          href: "/engagement/surveys",            icon: <ClipboardList className="h-[15px] w-[15px]" />, description: "Surveys" },
      { label: "Helpdesk",         href: "/helpdesk",                      icon: <ShieldCheck className="h-[15px] w-[15px]" />,  description: "Helpdesk" },
      { label: "Benefits & Claims",href: "/benefits",                      icon: <ShieldCheck className="h-[15px] w-[15px]" />,  description: "Benefits" },
      { label: "Feedback",         href: "/performance-feedback/my-reports", icon: <FileText className="h-[15px] w-[15px]" />,  description: "Feedback" },
    ],
  },
  {
    title: "Admin",
    items: [
      { label: "Access Control",   href: "/settings/access-control",      icon: <Settings className="h-[15px] w-[15px]" />,    pageCode: "ACCESS_CONTROL", roles: ["admin"], description: "Access" },
      { label: "Page Access",      href: "/super-admin/page-access",       icon: <ShieldCheck className="h-[15px] w-[15px]" />, roles: ["admin"], description: "Page access" },
      { label: "Comm. Config",     href: "/settings/communication-config", icon: <Settings2 className="h-[15px] w-[15px]" />,  roles: ["admin"], description: "Email/SMS" },
      { label: "Org Masters",      href: "/org-masters",                   icon: <Building2 className="h-[15px] w-[15px]" />,   roles: ["admin","hr"], description: "Masters" },
      { label: "Process Config",   href: "/process-config",                icon: <Network className="h-[15px] w-[15px]" />,     roles: ["admin","hr","process_manager"], description: "Process" },
      { label: "Leave Types",      href: "/leave-types",                   icon: <CalendarDays className="h-[15px] w-[15px]" />, roles: ["admin","hr"], description: "Leave types" },
      { label: "Statutory Config", href: "/payroll/statutory-config",      icon: <Landmark className="h-[15px] w-[15px]" />,    roles: ["admin","hr","finance"], description: "Statutory" },
      { label: "Compliance",       href: "/compliance/statutory",          icon: <Landmark className="h-[15px] w-[15px]" />,    roles: ["admin","hr","finance"], description: "Compliance" },
      { label: "DPDP / Privacy",   href: "/compliance/dpdp",               icon: <ShieldCheck className="h-[15px] w-[15px]" />, roles: ["admin","hr"], description: "DPDP" },
      { label: "Client Master",    href: "/client-master",                 icon: <Users className="h-[15px] w-[15px]" />,       roles: ["admin","hr"], description: "Clients" },
      { label: "Integration Hub",  href: "/integration-hub",               icon: <Network className="h-[15px] w-[15px]" />,     roles: ["admin"], description: "Integration" },
      { label: "Exit Management",  href: "/exit-management",               icon: <UserMinus className="h-[15px] w-[15px]" />,   roles: ["admin","hr"], description: "Exit" },
    ],
  },
];

/* Bottom nav items (mobile only — 5 tabs max) */
const BOTTOM_NAV = [
  { label: "Home",    href: "/dashboard",  icon: <Home className="h-5 w-5" /> },
  { label: "People",  href: "/employees",  icon: <Users className="h-5 w-5" /> },
  { label: "Inbox",   href: "/work-inbox", icon: <Bell className="h-5 w-5" /> },
  { label: "Attend",  href: "/attendance", icon: <Clock className="h-5 w-5" /> },
  { label: "Me",      href: "/profile",    icon: <User className="h-5 w-5" /> },
];

export function DashboardLayout({ children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [logoError, setLogoError] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { isAdminOrHR } = useIsAdminOrHR();
  const { canViewPage, visiblePageCodes, hasAnyRole } = useWorkforceAccess();
  const { data: versionData } = useVersionCheck();

  const displayVersion = isAutoUpdatingEnvironment()
    ? (versionData?.currentVersion ?? APP_VERSION)
    : versionData?.hasUpdate
    ? APP_VERSION
    : (versionData?.currentVersion ?? APP_VERSION);

  /* Filter nav items by access */
  const filteredGroups = useMemo(() => {
    const visibleSet = new Set(visiblePageCodes);
    return navGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (item.pageCode) return visibleSet.has(item.pageCode) || canViewPage(item.pageCode);
          if (item.roles?.length) return hasAnyRole(...item.roles);
          if (item.adminOnly && !isAdminOrHR) return false;
          return true;
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [visiblePageCodes, canViewPage, hasAnyRole, isAdminOrHR]);

  const searchableItems = filteredGroups.flatMap((g) =>
    g.items.map((item) => ({ ...item, groupTitle: g.title }))
  );
  const searchResults = searchQuery.trim()
    ? searchableItems.filter((item) =>
        `${item.label} ${item.description ?? ""} ${item.groupTitle}`
          .toLowerCase()
          .includes(searchQuery.toLowerCase())
      )
    : [];

  const handleSearchSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (searchResults[0]) {
      navigate(searchResults[0].href);
      setSearchQuery("");
      setSidebarOpen(false);
    }
  };

  /* ⌘K shortcut */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>(
          'input[aria-label="Search modules"]'
        );
        input?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  /* Close sidebar on route change */
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const isActive = (href: string) =>
    href === "/dashboard"
      ? location.pathname === "/dashboard"
      : location.pathname === href || location.pathname.startsWith(`${href}/`);

  const userInitials = (user?.email ?? "MC").slice(0, 2).toUpperCase();

  /* ─── Sidebar content (shared between desktop fixed + mobile drawer) ─── */
  const SidebarContent = () => (
    <div
      className="flex h-full flex-col"
      style={{ background: "var(--sidebar-canvas)" }}
    >
      {/* Logo */}
      <div
        className="flex-shrink-0 px-4 py-4"
        style={{ borderBottom: "1px solid var(--sidebar-hairline)" }}
      >
        <Link
          to="/dashboard"
          onClick={() => setSidebarOpen(false)}
          className="block"
        >
          <div
            className="flex items-center gap-3 rounded-xl px-3 py-2.5"
            style={{ background: "var(--sidebar-surface-1)" }}
          >
            {logoError ? (
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white"
                style={{ background: "var(--brand-600)" }}
              >
                MCN
              </div>
            ) : (
              <img
                src={companyLogo}
                alt="MAS Callnet"
                className="h-8 w-8 rounded-lg object-contain"
                onError={() => setLogoError(true)}
              />
            )}
            <div className="min-w-0">
              <p
                className="truncate text-[13px] font-semibold leading-tight"
                style={{ color: "var(--sidebar-ink)" }}
              >
                MAS Callnet HRMS
              </p>
              <p
                className="text-[11px]"
                style={{ color: "var(--sidebar-ink-subtle)" }}
              >
                Employee Portal
              </p>
            </div>
          </div>
        </Link>
      </div>

      {/* Nav */}
      <SidebarNav
        groups={filteredGroups}
        onNavigate={() => setSidebarOpen(false)}
      />

      {/* Footer */}
      <div
        className="flex-shrink-0 px-3 pb-4 pt-3"
        style={{ borderTop: "1px solid var(--sidebar-hairline)" }}
      >
        {/* User chip */}
        <Link
          to="/profile"
          onClick={() => setSidebarOpen(false)}
          className="mb-2 flex items-center gap-2.5 rounded-xl px-3 py-2 transition"
          style={{ background: "var(--sidebar-surface-1)" }}
        >
          <Avatar className="h-7 w-7 flex-shrink-0">
            <AvatarImage src="" />
            <AvatarFallback
              className="text-xs font-bold"
              style={{ background: "var(--brand-600)", color: "#fff" }}
            >
              {userInitials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-[12px] font-medium"
              style={{ color: "var(--sidebar-ink)" }}
            >
              {user?.email ?? "My Account"}
            </p>
          </div>
        </Link>

        {/* Version */}
        <Link
          to="/changelog"
          className="flex items-center justify-center rounded-lg py-1 text-[10px] transition"
          style={{ color: "var(--sidebar-ink-subtle)" }}
        >
          v{displayVersion}
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: "var(--surface-page)" }}>
      <PWAInstallBanner />

      {/* Mobile overlay */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Desktop fixed sidebar */}
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden lg:block"
        style={{
          width: "var(--sidebar-width)",
          borderRight: "1px solid var(--sidebar-hairline)",
        }}
      >
        <SidebarContent />
      </aside>

      {/* Mobile slide-in sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 lg:hidden",
          "transition-transform duration-300 ease-out",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{ width: 272, borderRight: "1px solid var(--sidebar-hairline)" }}
      >
        <div className="absolute right-3 top-3 z-10">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg"
            style={{ color: "var(--sidebar-ink-muted)" }}
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <SidebarContent />
      </aside>

      {/* Main content area */}
      <div
        className="flex min-h-screen flex-col pb-16 lg:pb-0"
        style={{ paddingLeft: "var(--sidebar-width)" }}
      >
        {/* Only applies on desktop (mobile has no pl) */}
        <div className="lg:hidden" style={{ paddingLeft: 0 }} />

        {/* Topbar */}
        <TopBar
          onMenuClick={() => setSidebarOpen(true)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSearchSubmit={handleSearchSubmit}
          searchResults={searchResults}
          onSearchResultClick={(href) => {
            navigate(href);
            setSearchQuery("");
          }}
        />

        {/* Page content */}
        <main className="flex-1 px-4 py-5 sm:px-5 lg:px-6 lg:py-6">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t bg-white px-2 pb-safe lg:hidden"
        style={{ borderColor: "var(--border-hairline)", height: 58 }}
        aria-label="Primary navigation"
      >
        {BOTTOM_NAV.map((tab) => {
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.href}
              to={tab.href}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10px] font-semibold transition",
                active
                  ? "text-blue-600"
                  : "text-slate-400"
              )}
              aria-current={active ? "page" : undefined}
            >
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-xl transition",
                  active ? "bg-blue-50" : ""
                )}
              >
                {tab.icon}
              </span>
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
