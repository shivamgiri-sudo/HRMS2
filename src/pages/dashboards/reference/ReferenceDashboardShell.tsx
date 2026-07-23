import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ElementType,
  type ReactNode,
} from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Award,
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  Calendar,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Clock,
  CreditCard,
  FileCheck,
  FileText,
  Files,
  Fingerprint,
  GraduationCap,
  HelpCircle,
  Home,
  Mail,
  Menu,
  MessageCircle,
  Network,
  Receipt,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Target,
  User,
  UserPlus,
  Users,
  Wallet,
  X,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/AuthContext";
import { useEmployeeProfile } from "@/hooks/useEmployeeProfile";
import { normalizeMediaUrl } from "@/lib/mediaUrl";
import { cn } from "@/lib/utils";
import type { RoleDashboardVariant } from "../roleDashboardAccess";
import { useDashboardLinkAccess } from "../dashboardLinkAccess";
import "./reference-dashboard-shell.css";
import "./reference-dashboard-shell-fixes.css";

type NavigationItem = {
  label: string;
  href: string;
  icon: ElementType;
};

type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

type ReferenceShellContextValue = {
  productHeaderControls: ReactNode | null;
};

const ReferenceShellContext = createContext<ReferenceShellContextValue>({ productHeaderControls: null });

export function useReferenceDashboardShell(): ReferenceShellContextValue {
  return useContext(ReferenceShellContext);
}

const SUPPORT_ITEMS: NavigationItem[] = [
  { label: "Help Center", href: "/helpdesk", icon: HelpCircle },
  { label: "Feedback", href: "/support/grievance-command-center", icon: MessageCircle },
];

const ADMIN_ITEMS: NavigationItem[] = [
  { label: "Users & Roles", href: "/settings/access-control", icon: Users },
  { label: "Organization", href: "/org-masters", icon: Building2 },
  { label: "Templates", href: "/communication/templates", icon: Files },
  { label: "Integrations", href: "/integration-hub", icon: Network },
  { label: "System Settings", href: "/settings", icon: Settings },
];

const NAV_BY_VARIANT: Record<RoleDashboardVariant, NavigationItem[]> = {
  employee: [
    { label: "Dashboard", href: "/dashboard", icon: Home },
    { label: "Attendance", href: "/attendance", icon: Clock },
    { label: "Leave", href: "/leaves", icon: CalendarDays },
    { label: "Payroll", href: "/payroll/payslips", icon: CreditCard },
    { label: "Performance", href: "/performance", icon: BarChart3 },
    { label: "Learning", href: "/lms", icon: GraduationCap },
    { label: "Documents", href: "/profile", icon: Files },
  ],
  wfm: [
    { label: "Dashboard", href: "/wfm/dashboard", icon: Home },
    { label: "WFM / Attendance", href: "/wfm/dashboard?view=attendance", icon: Fingerprint },
    { label: "Team", href: "/my-team", icon: Users },
    { label: "Attendance", href: "/attendance", icon: Clock },
    { label: "Shift & Roster", href: "/wfm/roster", icon: CalendarDays },
    { label: "Reports", href: "/reports", icon: BarChart3 },
    { label: "Devices", href: "/wfm/cosec-monitoring", icon: Server },
  ],
  wfm_attendance: [
    { label: "Dashboard", href: "/wfm/dashboard", icon: Home },
    { label: "WFM / Attendance", href: "/wfm/dashboard?view=attendance", icon: Fingerprint },
    { label: "Team", href: "/my-team", icon: Users },
    { label: "Attendance", href: "/attendance", icon: Clock },
    { label: "Shift & Roster", href: "/wfm/roster", icon: CalendarDays },
    { label: "Reports", href: "/reports", icon: BarChart3 },
    { label: "Devices", href: "/wfm/cosec-monitoring", icon: Server },
  ],
  hr: [
    { label: "Dashboard", href: "/dashboard", icon: Home },
    { label: "Employees", href: "/employees", icon: Users },
    { label: "Onboarding", href: "/onboarding", icon: UserPlus },
    { label: "Attendance", href: "/attendance", icon: Clock },
    { label: "Leave", href: "/leaves", icon: CalendarDays },
    { label: "Recruitment", href: "/ats/dashboard", icon: Briefcase },
    { label: "Payroll", href: "/payroll", icon: CreditCard },
    { label: "Performance", href: "/performance", icon: Target },
    { label: "Reports", href: "/reports", icon: FileText },
    { label: "Compliance", href: "/compliance/statutory", icon: ShieldCheck },
  ],
  ceo: [
    { label: "Dashboard", href: "/dashboard", icon: Home },
    { label: "Employees", href: "/employees", icon: Users },
    { label: "Attendance", href: "/attendance", icon: Clock },
    { label: "Payroll", href: "/payroll", icon: CreditCard },
    { label: "Performance", href: "/performance", icon: Target },
    { label: "Quality", href: "/quality", icon: ShieldCheck },
    { label: "Reports", href: "/reports", icon: BarChart3 },
  ],
  payroll: [
    { label: "Dashboard", href: "/payroll-hr/dashboard", icon: Home },
    { label: "Employees", href: "/employees", icon: User },
    { label: "Attendance", href: "/attendance", icon: Clock },
    { label: "Payroll", href: "/payroll", icon: CreditCard },
    { label: "Loans & Advances", href: "/payroll/loans", icon: Wallet },
    { label: "Reimbursements", href: "/payroll/reimbursements", icon: Receipt },
    { label: "Incentives", href: "/payroll/incentives", icon: Award },
    { label: "Reports", href: "/reports", icon: FileText },
    { label: "Compliance", href: "/payroll/statutory-filing", icon: ShieldCheck },
  ],
  manager: [
    { label: "Dashboard", href: "/manager/dashboard", icon: Home },
    { label: "Team", href: "/my-team", icon: Users },
    { label: "Attendance", href: "/attendance", icon: Clock },
    { label: "Leave", href: "/leaves", icon: Calendar },
    { label: "Performance", href: "/performance", icon: Target },
    { label: "Tasks", href: "/tasks", icon: ClipboardList },
    { label: "Approvals", href: "/work-inbox", icon: FileCheck },
    { label: "Recruitment", href: "/ats/dashboard", icon: Briefcase },
    { label: "Reports", href: "/reports", icon: BarChart3 },
    { label: "Documents", href: "/employee-docs", icon: Files },
  ],
  super_admin: [
    { label: "Dashboard", href: "/super-admin/dashboard", icon: Home },
    { label: "User Management", href: "/settings/access-control", icon: Users },
    { label: "Organization", href: "/org-masters", icon: Building2 },
    { label: "Employees", href: "/employees", icon: User },
    { label: "Attendance", href: "/attendance", icon: Clock },
    { label: "Leave", href: "/leaves", icon: Calendar },
    { label: "Payroll", href: "/payroll", icon: CreditCard },
    { label: "Recruitment", href: "/ats/dashboard", icon: Briefcase },
    { label: "Performance", href: "/performance", icon: Target },
    { label: "Training", href: "/lms", icon: GraduationCap },
    { label: "Reports", href: "/reports", icon: BarChart3 },
    { label: "Compliance", href: "/compliance/statutory", icon: ShieldCheck },
    { label: "System Logs", href: "/audit-log", icon: Server },
  ],
};

const ROLE_LABEL: Record<RoleDashboardVariant, string> = {
  employee: "Employee",
  wfm: "WFM",
  wfm_attendance: "WFM",
  hr: "HR Manager",
  ceo: "CEO",
  payroll: "Finance Team",
  manager: "Manager",
  super_admin: "System Administrator",
};

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "HR";
}

function isActiveLocation(pathname: string, search: string, href: string): boolean {
  const [path, query = ""] = href.split("?");
  if (query) {
    const expected = new URLSearchParams(query).get("view");
    return pathname === path && new URLSearchParams(search).get("view") === expected;
  }
  if (path === "/dashboard") return pathname === "/dashboard";
  return pathname === path || pathname.startsWith(`${path}/`);
}

function SidebarLink({ item, active, onNavigate }: { item: NavigationItem; active: boolean; onNavigate: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.href}
      onClick={onNavigate}
      className={cn("reference-shell-nav-link", active && "is-active")}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {!active ? <ChevronDown className="h-3.5 w-3.5 shrink-0 -rotate-90 opacity-70" aria-hidden="true" /> : null}
    </Link>
  );
}

function UnifiedSidebar({
  variant,
  pathname,
  search,
  onNavigate,
  name,
  role,
  avatarUrl,
}: {
  variant: RoleDashboardVariant;
  pathname: string;
  search: string;
  onNavigate: () => void;
  name: string;
  role: string;
  avatarUrl?: string;
}) {
  const canOpen = useDashboardLinkAccess();
  const groups = useMemo<NavigationGroup[]>(() => {
    const result: NavigationGroup[] = [{ label: "MAIN", items: NAV_BY_VARIANT[variant].filter((item) => canOpen(item.href)) }];
    if (["hr", "ceo", "payroll", "super_admin"].includes(variant)) {
      result.push({ label: "ADMIN", items: ADMIN_ITEMS.filter((item) => canOpen(item.href)) });
    }
    result.push({ label: "SUPPORT", items: SUPPORT_ITEMS.filter((item) => canOpen(item.href)) });
    return result.filter((group) => group.items.length > 0);
  }, [canOpen, variant]);

  return (
    <div className="reference-corporate-sidebar-inner">
      <div className="reference-corporate-brand">
        <img src="/mcn-logo.png?v=999" alt="Mas Callnet India Pvt Ltd" />
        <div><strong>Mas Callnet</strong><span>India Pvt Ltd</span></div>
      </div>

      <nav className="reference-shell-nav" aria-label="Primary navigation">
        {groups.map((group) => (
          <div key={group.label} className="reference-shell-nav-group">
            <p className="reference-shell-nav-heading">{group.label}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <SidebarLink
                  key={`${group.label}-${item.label}`}
                  item={item}
                  active={isActiveLocation(pathname, search, item.href)}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="reference-corporate-profile-wrap">
        <Link to="/profile" onClick={onNavigate} className="reference-corporate-profile">
          <Avatar className="h-9 w-9 border border-white/70">
            <AvatarImage src={normalizeMediaUrl(avatarUrl)} alt={name} />
            <AvatarFallback className="bg-white text-xs font-bold text-[#0b3a75]">{initials(name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-bold text-white">{name}</p>
            <p className="truncate text-xs text-[#a8c0df]">{role}</p>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-[#a8c0df]" />
        </Link>
        <div className="reference-corporate-version"><span>HRMS2</span><span>v2.6.1</span><i /></div>
      </div>
    </div>
  );
}

function UnifiedTopbar({ onMenu, name, role, avatarUrl }: { onMenu: () => void; name: string; role: string; avatarUrl?: string }) {
  return (
    <header className="reference-corporate-topbar">
      <button type="button" onClick={onMenu} className="reference-shell-icon-button lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
      <label className="reference-corporate-search">
        <Search className="h-4 w-4 shrink-0 text-[#71809a]" />
        <input aria-label="Search employees, tickets and reports" placeholder="Search employees, tickets, reports..." />
        <kbd>⌘ K</kbd>
      </label>
      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        <button className="reference-topbar-alert" type="button" aria-label="Notifications"><Bell className="h-[19px] w-[19px]" /><span>9</span></button>
        <button className="reference-topbar-alert" type="button" aria-label="Messages"><Mail className="h-[19px] w-[19px]" /><span>5</span></button>
        <div className="reference-topbar-profile">
          <Avatar className="h-8 w-8">
            <AvatarImage src={normalizeMediaUrl(avatarUrl)} alt={name} />
            <AvatarFallback className="bg-[#eaf1fb] text-xs font-bold text-[#0b3a75]">{initials(name)}</AvatarFallback>
          </Avatar>
          <div className="hidden min-w-0 sm:block">
            <p className="max-w-[130px] truncate text-xs font-bold text-[#13213b]">{name}</p>
            <p className="text-xs text-[#71809a]">{role}</p>
          </div>
          <ChevronDown className="hidden h-4 w-4 text-[#61708a] sm:block" />
        </div>
      </div>
    </header>
  );
}

export function ReferenceDashboardShell({ variant, children }: { variant: RoleDashboardVariant; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { user } = useAuth();
  const { data: profile } = useEmployeeProfile();
  const name = profile?.full_name || profile?.first_name || user?.email?.split("@")[0] || "HRMS User";
  const role = profile?.designation || ROLE_LABEL[variant];
  const avatarUrl = profile?.avatar_url;

  const sidebar = (
    <UnifiedSidebar
      variant={variant}
      pathname={location.pathname}
      search={location.search}
      onNavigate={() => setMobileOpen(false)}
      name={name}
      role={role}
      avatarUrl={avatarUrl}
    />
  );

  return (
    <ReferenceShellContext.Provider value={{ productHeaderControls: null }}>
      <div className="reference-app-shell reference-app-shell--unified">
        {mobileOpen ? <button type="button" className="reference-shell-mobile-overlay" onClick={() => setMobileOpen(false)} aria-label="Close navigation" /> : null}

        <aside className="reference-shell-sidebar reference-shell-sidebar--unified hidden lg:block">{sidebar}</aside>
        <aside className={cn("reference-shell-mobile-drawer lg:hidden", mobileOpen && "is-open")}>
          <button type="button" className="reference-shell-mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X className="h-5 w-5" /></button>
          {sidebar}
        </aside>

        <div className="reference-shell-main">
          <UnifiedTopbar onMenu={() => setMobileOpen(true)} name={name} role={role} avatarUrl={avatarUrl} />
          <div className="reference-shell-content">{children}</div>
        </div>
      </div>
    </ReferenceShellContext.Provider>
  );
}
