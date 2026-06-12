import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Activity, BarChart3, Bell, Briefcase, Building2, Calendar, CalendarDays, ChevronDown, ChevronRight, ClipboardList, Clock, CreditCard, FileCheck, FileText, GraduationCap, Heart, Home, Landmark, LogOut, Menu, Network, Package, Search, Settings, Settings2, ShieldCheck, Sparkles, Target, TrendingUp, User, UserMinus, UserPlus, Users, Wallet, X, Zap } from "lucide-react";
import { PWAInstallBanner } from "@/components/layout/PWAInstallBanner";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdminOrHR, useWorkforceAccess } from "@/hooks/useUserRole";
import { useVersionCheck } from "@/hooks/useVersionCheck";
import { cn } from "@/lib/utils";
import { APP_VERSION, isAutoUpdatingEnvironment } from "@/lib/version";

type NavItem = { label: string; href: string; icon: ReactNode; badge?: number; adminOnly?: boolean; pageCode?: string; roles?: string[]; description?: string };
type NavGroup = { title: string; items: NavItem[] };
type Props = { children: ReactNode };

const companyLogo = "/mcn-logo.png?v=999";

const navGroups: NavGroup[] = [
  { title: "Overview", items: [
    { label: "Dashboard", href: "/dashboard", icon: <Home className="h-4 w-4" />, description: "Workspace" },
    { label: "My Modules", href: "/modules", icon: <Package className="h-4 w-4" />, description: "All allowed pages" },
    { label: "Work Inbox", href: "/work-inbox", icon: <ClipboardList className="h-4 w-4" />, pageCode: "WORK_INBOX", description: "Pending actions" },
    { label: "Reports", href: "/reports", icon: <BarChart3 className="h-4 w-4" />, roles: ["admin", "hr", "manager", "ceo", "branch_head"], description: "Reports" },
  ]},
  { title: "My Space", items: [
    { label: "Profile", href: "/profile", icon: <User className="h-4 w-4" />, description: "Profile" },
    { label: "Attendance", href: "/attendance", icon: <Clock className="h-4 w-4" />, description: "Attendance" },
    { label: "Leaves", href: "/leaves", icon: <CalendarDays className="h-4 w-4" />, description: "Leave" },
    { label: "My Roster", href: "/my-roster", icon: <Calendar className="h-4 w-4" />, description: "Roster" },
    { label: "Payslips", href: "/payroll/payslips", icon: <CreditCard className="h-4 w-4" />, description: "Payslips" },
    { label: "Tax Declaration", href: "/payroll/tax-declaration", icon: <Landmark className="h-4 w-4" />, description: "Tax" },
    { label: "Engagement", href: "/engagement", icon: <Sparkles className="h-4 w-4" />, description: "Engagement" },
  ]},
  { title: "People & Hiring", items: [
    { label: "Employees", href: "/employees", icon: <Users className="h-4 w-4" />, roles: ["admin", "hr", "manager", "branch_head", "process_manager"], description: "Directory" },
    { label: "Departments", href: "/departments", icon: <Building2 className="h-4 w-4" />, roles: ["admin", "hr", "manager", "ceo", "branch_head"], description: "Departments" },
    { label: "Onboarding", href: "/onboarding", icon: <UserPlus className="h-4 w-4" />, roles: ["admin", "hr"], description: "Onboarding" },
    { label: "Document Verification", href: "/document-verification", icon: <FileCheck className="h-4 w-4" />, roles: ["admin", "hr"], description: "Documents" },
    { label: "Employee Journey", href: "/employee-stat-card", icon: <Users className="h-4 w-4" />, description: "Journey" },
    { label: "ATS Command", href: "/ats/command-center", icon: <Briefcase className="h-4 w-4" />, pageCode: "ATS_DASHBOARD", description: "ATS" },
    { label: "Walk-in Queue", href: "/ats/walkin-queue", icon: <Users className="h-4 w-4" />, pageCode: "ATS_WAITING_QUEUE", description: "Queue" },
    { label: "My Candidates", href: "/ats/recruiter/my-candidates", icon: <ClipboardList className="h-4 w-4" />, pageCode: "ATS_RECRUITER_QUEUE", description: "Candidates" },
    { label: "Jobs Portal", href: "/jobs", icon: <Briefcase className="h-4 w-4" />, pageCode: "JOBS_PORTAL", description: "Jobs" },
  ]},
  { title: "Workforce", items: [
    { label: "My Learning", href: "/lms/my-learning", icon: <GraduationCap className="h-4 w-4" />, pageCode: "LMS_MY_LEARNING", description: "LMS" },
    { label: "LMS Coordinator", href: "/lms/coordinator", icon: <Users className="h-4 w-4" />, pageCode: "LMS_COORDINATOR", description: "Training" },
    { label: "LMS Admin", href: "/lms/admin", icon: <GraduationCap className="h-4 w-4" />, pageCode: "LMS_ADMIN", description: "LMS admin" },
    { label: "Roster Planning", href: "/wfm/roster", icon: <Clock className="h-4 w-4" />, pageCode: "WFM_ROSTER", description: "Roster" },
    { label: "Auto Roster", href: "/wfm/auto-roster", icon: <Calendar className="h-4 w-4" />, pageCode: "WFM_AUTO_ROSTER", description: "Auto roster" },
    { label: "RTA Board", href: "/rta-board", icon: <Activity className="h-4 w-4" />, pageCode: "RTA_BOARD", description: "RTA" },
    { label: "WFM Tracker", href: "/wfm/live-tracker", icon: <Clock className="h-4 w-4" />, pageCode: "WFM_LIVE_TRACKER", description: "Live" },
  ]},
  { title: "Operations", items: [
    { label: "Performance", href: "/performance", icon: <Target className="h-4 w-4" />, description: "Performance" },
    { label: "Goals & Appraisal", href: "/goals", icon: <Target className="h-4 w-4" />, description: "Goals" },
    { label: "Payroll", href: "/payroll", icon: <CreditCard className="h-4 w-4" />, roles: ["admin", "hr", "finance", "payroll"], description: "Payroll" },
    { label: "Full & Final", href: "/payroll/full-final", icon: <Zap className="h-4 w-4" />, roles: ["admin", "hr", "finance", "payroll"], description: "F&F" },
    { label: "Payroll Masters", href: "/payroll/masters", icon: <Settings2 className="h-4 w-4" />, roles: ["admin", "hr", "finance", "payroll"], description: "Slabs, matrix, min wages" },
    { label: "Salary Packages", href: "/payroll/salary-packages", icon: <Wallet className="h-4 w-4" />, roles: ["admin", "finance"], description: "Band+slab pay matrix" },
    { label: "Incentives", href: "/payroll/incentives", icon: <TrendingUp className="h-4 w-4" />, roles: ["admin", "hr", "finance", "payroll"], description: "Upload & approve incentives" },
    { label: "KPI Config", href: "/kpi-config", icon: <Target className="h-4 w-4" />, pageCode: "KPI_CONFIG", roles: ["admin", "hr", "manager", "process_manager"], description: "KPI" },
    { label: "Operations KPI", href: "/operations-kpi", icon: <Target className="h-4 w-4" />, pageCode: "OPERATIONS_KPI", description: "Ops KPI" },
    { label: "Management", href: "/management/dashboard", icon: <BarChart3 className="h-4 w-4" />, pageCode: "MANAGEMENT_DASHBOARD", description: "Management" },
    { label: "Control Tower", href: "/control-tower", icon: <Activity className="h-4 w-4" />, pageCode: "CONTROL_TOWER", description: "Control tower" },
  ]},
  { title: "Engage & Support", items: [
    { label: "Kudos Wall", href: "/engagement/kudos", icon: <Heart className="h-4 w-4" />, description: "Kudos" },
    { label: "Badges", href: "/engagement/badges", icon: <ShieldCheck className="h-4 w-4" />, description: "Badges" },
    { label: "Surveys", href: "/engagement/surveys", icon: <ClipboardList className="h-4 w-4" />, description: "Surveys" },
    { label: "Helpdesk", href: "/helpdesk", icon: <ShieldCheck className="h-4 w-4" />, description: "Helpdesk" },
    { label: "Benefits & Claims", href: "/benefits", icon: <ShieldCheck className="h-4 w-4" />, description: "Benefits" },
    { label: "Feedback", href: "/performance-feedback/my-reports", icon: <FileText className="h-4 w-4" />, description: "Feedback" },
  ]},
  { title: "Admin", items: [
    { label: "Access Control", href: "/settings/access-control", icon: <Settings className="h-4 w-4" />, pageCode: "ACCESS_CONTROL", roles: ["admin"], description: "Access" },
    { label: "Page Access", href: "/super-admin/page-access", icon: <ShieldCheck className="h-4 w-4" />, roles: ["admin"], description: "Page access" },
    { label: "Comm. Config", href: "/settings/communication-config", icon: <Settings2 className="h-4 w-4" />, roles: ["admin"], description: "Email/SMS" },
    { label: "Org Masters", href: "/org-masters", icon: <Building2 className="h-4 w-4" />, roles: ["admin", "hr"], description: "Masters" },
    { label: "Process Config", href: "/process-config", icon: <Network className="h-4 w-4" />, roles: ["admin", "hr", "process_manager"], description: "Process" },
    { label: "Leave Types", href: "/leave-types", icon: <CalendarDays className="h-4 w-4" />, roles: ["admin", "hr"], description: "Leave types" },
    { label: "Statutory Config", href: "/payroll/statutory-config", icon: <Landmark className="h-4 w-4" />, roles: ["admin", "hr", "finance"], description: "Statutory" },
    { label: "Compliance", href: "/compliance/statutory", icon: <Landmark className="h-4 w-4" />, roles: ["admin", "hr", "finance"], description: "Compliance" },
    { label: "DPDP / Privacy", href: "/compliance/dpdp", icon: <ShieldCheck className="h-4 w-4" />, roles: ["admin", "hr"], description: "DPDP" },
    { label: "Client Master", href: "/client-master", icon: <Users className="h-4 w-4" />, roles: ["admin", "hr"], description: "Clients" },
    { label: "Integration Hub", href: "/integration-hub", icon: <Network className="h-4 w-4" />, roles: ["admin"], description: "Integration" },
    { label: "Exit Management", href: "/exit-management", icon: <UserMinus className="h-4 w-4" />, roles: ["admin", "hr"], description: "Exit" },
  ]},
];

export function DashboardLayout({ children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [logoError, setLogoError] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<string[]>(["Overview", "My Space"]);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut, isSigningOut } = useAuth();
  const { isAdminOrHR } = useIsAdminOrHR();
  const { canViewPage, visiblePageCodes, hasAnyRole } = useWorkforceAccess();
  const { data: versionData } = useVersionCheck();

  const displayVersion = isAutoUpdatingEnvironment() ? versionData?.currentVersion ?? APP_VERSION : versionData?.hasUpdate ? APP_VERSION : versionData?.currentVersion ?? APP_VERSION;
  const isActive = (href: string) => href === "/dashboard" ? location.pathname === "/dashboard" : location.pathname === href || location.pathname.startsWith(`${href}/`);

  const filteredNavGroups = useMemo(() => {
    const visibleSet = new Set(visiblePageCodes);
    return navGroups.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.pageCode) return visibleSet.has(item.pageCode) || canViewPage(item.pageCode);
        if (item.roles?.length) return hasAnyRole(...item.roles);
        if (item.adminOnly && !isAdminOrHR) return false;
        return true;
      }),
    })).filter((group) => group.items.length > 0);
  }, [visiblePageCodes, canViewPage, hasAnyRole, isAdminOrHR]);

  const activeGroup = filteredNavGroups.find((group) => group.items.some((item) => isActive(item.href)))?.title;
  const searchableItems = filteredNavGroups.flatMap((group) => group.items.map((item) => ({ ...item, groupTitle: group.title })));
  const searchResults = searchQuery.trim()
    ? searchableItems.filter((item) => `${item.label} ${item.description ?? ""} ${item.groupTitle}`.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : [];

  const toggleGroup = (title: string) => setExpandedGroups((prev) => prev.includes(title) ? prev.filter((item) => item !== title) : [...prev, title]);
  const collapseAll = () => setExpandedGroups(activeGroup ? ["Overview", activeGroup] : ["Overview", "My Space"]);
  const expandAll = () => setExpandedGroups(filteredNavGroups.map((group) => group.title));

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
      <div className="relative border-b border-white/10 px-3 py-3">
        <div className="relative rounded-2xl border border-white/10 bg-white/[0.05] p-2 shadow-xl shadow-slate-950/20">
          <Link to="/dashboard" onClick={() => setSidebarOpen(false)}>
            <div className="flex h-[78px] items-center justify-center rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-200 px-3 py-2 shadow-lg">
              {logoError ? <div className="flex h-full w-full items-center justify-center rounded-xl bg-slate-950 text-xl font-bold tracking-wide text-white">MCN</div> : <img src={companyLogo} alt="MAS Callnet" className="block h-14 w-full max-w-[190px] object-contain drop-shadow-md" onError={() => setLogoError(true)} />}
            </div>
            <div className="mt-2 min-w-0 text-center">
              <p className="truncate text-[13px] font-semibold tracking-tight text-white">MAS Callnet HRMS</p>
              <p className="truncate text-[11px] text-slate-400">Employee Portal</p>
            </div>
          </Link>
        </div>
      </div>

      <div className="border-b border-white/10 px-3 py-2">
        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400">
          <span>{filteredNavGroups.length} sections</span>
          <div className="flex gap-1">
            <button type="button" onClick={collapseAll} className="rounded-lg px-2 py-1 hover:bg-white/10 hover:text-white">Collapse</button>
            <button type="button" onClick={expandAll} className="rounded-lg px-2 py-1 hover:bg-white/10 hover:text-white">Expand</button>
          </div>
        </div>
      </div>

      <nav className="mcn-sidebar-scroll flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-2">
          {filteredNavGroups.map((group) => {
            const isExpanded = expandedGroups.includes(group.title) || group.title === activeGroup;
            const groupHasActive = group.items.some((item) => isActive(item.href));
            return (
              <div key={group.title} className="rounded-2xl border border-white/5 bg-white/[0.025]">
                <button type="button" onClick={() => toggleGroup(group.title)} className={cn("flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left transition", groupHasActive ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white")}>
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em]">{group.title}</span>
                  <ChevronDown className={cn("h-3.5 w-3.5 transition", isExpanded ? "rotate-180" : "")} />
                </button>
                {isExpanded && (
                  <div className="space-y-1 px-2 pb-2">
                    {group.items.map((item) => {
                      const active = isActive(item.href);
                      return (
                        <Link key={`${group.title}-${item.label}`} to={item.href} onClick={() => setSidebarOpen(false)} className={cn("group flex items-center justify-between rounded-xl px-2.5 py-2 text-[13px] font-semibold transition", active ? "bg-blue-600 text-white shadow-lg shadow-blue-900/40" : "text-slate-300 hover:bg-white/10 hover:text-white")}>
                          <span className="flex min-w-0 items-center gap-2.5"><span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition", active ? "bg-blue-500 text-white" : "bg-white/5 text-slate-400 group-hover:bg-white/10 group-hover:text-white")}>{item.icon}</span><span className="truncate">{item.label}</span></span>
                          {item.badge ? <Badge className="ml-2 h-5 rounded-full bg-cyan-100 px-2 text-[10px] font-semibold text-cyan-700 hover:bg-cyan-100">{item.badge}</Badge> : active ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-blue-200" /> : null}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </nav>

      <div className="border-t border-white/10 p-3">
        <Link to="/modules" onClick={() => setSidebarOpen(false)} className="mb-2 flex items-center justify-center rounded-xl bg-white/10 px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-white/15">View all modules</Link>
        <Link to="/changelog" onClick={() => setSidebarOpen(false)} className="flex items-center justify-center rounded-xl px-3 py-2 text-[11px] text-slate-500 transition hover:bg-white/5 hover:text-slate-300">v{displayVersion}</Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f3f6fb] text-slate-900">
      <PWAInstallBanner />
      {sidebarOpen && <button type="button" aria-label="Close sidebar" className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[260px] border-r border-slate-900 bg-[#0f172a] shadow-2xl lg:block"><SidebarContent /></aside>
      <aside className={cn("fixed inset-y-0 left-0 z-50 w-[280px] bg-[#0f172a] shadow-2xl transition-transform duration-300 lg:hidden", sidebarOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className="absolute right-3 top-3 z-10"><Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => setSidebarOpen(false)}><X className="h-4 w-4" /></Button></div>
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
                  {searchResults.slice(0, 6).map((item) => <button key={item.href} type="button" onClick={() => { navigate(item.href); setSearchQuery(""); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-accent">{item.icon}<div><p className="font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{item.description}</p></div></button>)}
                </div>
              )}
            </form>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <NotificationBell />
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" className="relative h-10 w-10 rounded-full"><Avatar className="h-10 w-10"><AvatarImage src="" /><AvatarFallback className="bg-primary text-primary-foreground">{userInitials}</AvatarFallback></Avatar></Button></DropdownMenuTrigger>
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
