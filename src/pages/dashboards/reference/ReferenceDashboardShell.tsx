import { useMemo, useState, type ElementType, type ReactNode } from "react";
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
  GraduationCap,
  HelpCircle,
  Home,
  Landmark,
  Mail,
  Menu,
  MessageCircle,
  Network,
  Package,
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

type ShellMode = "corporate" | "product";

type NavigationItem = {
  label: string;
  href: string;
  icon: ElementType;
};

type NavigationGroup = {
  label?: string;
  items: NavigationItem[];
};

const CORPORATE_MAIN: NavigationItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: Home },
  { label: "Employees", href: "/employees", icon: Users },
  { label: "Onboarding", href: "/onboarding", icon: UserPlus },
  { label: "Attendance", href: "/attendance", icon: Clock },
  { label: "Leave", href: "/leaves", icon: CalendarDays },
  { label: "Payroll", href: "/payroll", icon: CreditCard },
  { label: "Performance", href: "/performance", icon: BarChart3 },
  { label: "Quality", href: "/quality", icon: ShieldCheck },
  { label: "Learning", href: "/learning", icon: GraduationCap },
  { label: "Incentives", href: "/payroll/incentives", icon: Award },
  { label: "Reports", href: "/reports", icon: FileText },
];

const CORPORATE_ADMIN: NavigationItem[] = [
  { label: "Users & Roles", href: "/settings/access-control", icon: Users },
  { label: "Organization", href: "/organization", icon: Building2 },
  { label: "Templates", href: "/templates", icon: Files },
  { label: "Integrations", href: "/integrations", icon: Network },
  { label: "System Settings", href: "/settings", icon: Settings },
];

const CORPORATE_SUPPORT: NavigationItem[] = [
  { label: "Help Center", href: "/helpdesk", icon: HelpCircle },
  { label: "Feedback", href: "/feedback", icon: MessageCircle },
];

const PRODUCT_NAV: Record<"payroll" | "manager" | "super_admin", NavigationGroup[]> = {
  payroll: [
    {
      items: [
        { label: "Dashboard", href: "/dashboards/payroll", icon: Home },
        { label: "Team", href: "/my-team", icon: Users },
        { label: "Employees", href: "/employees", icon: User },
        { label: "Attendance", href: "/attendance", icon: Clock },
        { label: "Payroll", href: "/payroll", icon: CreditCard },
        { label: "Loans & Advances", href: "/payroll/loans", icon: Wallet },
        { label: "Reimbursements", href: "/payroll/reimbursements", icon: Receipt },
        { label: "Reports", href: "/reports", icon: FileText },
        { label: "Compliance", href: "/payroll/statutory-filing", icon: ShieldCheck },
        { label: "Settings", href: "/settings", icon: Settings },
      ],
    },
  ],
  manager: [
    {
      items: [
        { label: "Dashboard", href: "/dashboards/manager", icon: Home },
        { label: "Team", href: "/my-team", icon: Users },
        { label: "Attendance", href: "/attendance", icon: Clock },
        { label: "Leave", href: "/leaves", icon: Calendar },
        { label: "Performance", href: "/performance", icon: Target },
        { label: "Tasks", href: "/tasks", icon: ClipboardList },
        { label: "Approvals", href: "/work-inbox", icon: FileCheck },
        { label: "Recruitment", href: "/recruitment", icon: Briefcase },
        { label: "Reports", href: "/reports", icon: BarChart3 },
        { label: "Documents", href: "/employee-docs", icon: Files },
        { label: "Settings", href: "/settings", icon: Settings },
      ],
    },
    {
      items: [{ label: "System Logs", href: "/audit-log", icon: Server }],
    },
  ],
  super_admin: [
    {
      items: [
        { label: "Dashboard", href: "/dashboards/super-admin", icon: Home },
        { label: "User Management", href: "/settings/access-control", icon: Users },
        { label: "Organization", href: "/organization", icon: Building2 },
        { label: "Employees", href: "/employees", icon: User },
        { label: "Attendance", href: "/attendance", icon: Clock },
        { label: "Leave", href: "/leaves", icon: Calendar },
        { label: "Payroll", href: "/payroll", icon: CreditCard },
        { label: "Recruitment", href: "/recruitment", icon: Briefcase },
        { label: "Performance", href: "/performance", icon: Target },
        { label: "Training", href: "/learning", icon: GraduationCap },
        { label: "Reports", href: "/reports", icon: BarChart3 },
        { label: "Compliance", href: "/compliance", icon: ShieldCheck },
        { label: "Settings", href: "/settings", icon: Settings },
        { label: "System Logs", href: "/audit-log", icon: Server },
      ],
    },
  ],
};

const ROLE_LABEL: Record<RoleDashboardVariant, string> = {
  employee: "Employee",
  wfm: "WFM",
  hr: "HR Manager",
  ceo: "CEO",
  payroll: "Finance Team",
  manager: "Manager",
  super_admin: "System Administrator",
};

function shellMode(variant: RoleDashboardVariant): ShellMode {
  return ["employee", "wfm", "hr", "ceo"].includes(variant) ? "corporate" : "product";
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "HR";
}

function SidebarLink({ item, active, compact = false, onNavigate }: { item: NavigationItem; active: boolean; compact?: boolean; onNavigate: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.href}
      onClick={onNavigate}
      className={cn(
        "reference-shell-nav-link",
        compact && "reference-shell-nav-link--compact",
        active && "is-active",
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon className={compact ? "h-[17px] w-[17px]" : "h-[18px] w-[18px]"} aria-hidden="true" />
      <span>{item.label}</span>
      {!compact && !active && ["Onboarding", "Attendance", "Leave", "Payroll", "Performance", "Quality", "Learning", "Incentives", "Reports"].includes(item.label) ? (
        <ChevronDown className="ml-auto h-3.5 w-3.5 -rotate-90 opacity-80" aria-hidden="true" />
      ) : null}
    </Link>
  );
}

function CorporateSidebar({ pathname, onNavigate, name, role, avatarUrl }: { pathname: string; onNavigate: () => void; name: string; role: string; avatarUrl?: string }) {
  const active = (href: string) => href === "/dashboard" ? pathname === "/dashboard" : pathname === href || pathname.startsWith(`${href}/`);
  const groups: NavigationGroup[] = [
    { label: "MAIN", items: CORPORATE_MAIN },
    { label: "ADMIN", items: CORPORATE_ADMIN },
    { label: "SUPPORT", items: CORPORATE_SUPPORT },
  ];

  return (
    <div className="reference-corporate-sidebar-inner">
      <div className="reference-corporate-brand">
        <img src="/mcn-logo.png?v=999" alt="Mas Callnet India Pvt Ltd" />
        <div>
          <strong>Mas Callnet</strong>
          <span>India Pvt Ltd</span>
        </div>
      </div>

      <nav className="reference-shell-nav" aria-label="Primary navigation">
        {groups.map((group) => (
          <div key={group.label} className="reference-shell-nav-group">
            {group.label ? <p className="reference-shell-nav-heading">{group.label}</p> : null}
            <div className="space-y-0.5">
              {group.items.map((item) => <SidebarLink key={item.label} item={item} active={active(item.href)} onNavigate={onNavigate} />)}
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
            <p className="truncate text-[10px] text-[#a8c0df]">{role}</p>
          </div>
          <ChevronDown className="h-4 w-4 text-[#a8c0df]" />
        </Link>
        <div className="reference-corporate-version"><span>HRMS2</span><span>v2.6.1</span><i /></div>
      </div>
    </div>
  );
}

function ProductSidebar({ variant, pathname, onNavigate }: { variant: "payroll" | "manager" | "super_admin"; pathname: string; onNavigate: () => void }) {
  const groups = PRODUCT_NAV[variant];
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`) || (href.includes("dashboard") && pathname === "/dashboard");
  return (
    <div className="reference-product-sidebar-inner">
      <Link to="/dashboard" onClick={onNavigate} className="reference-product-brand">
        <span className="reference-product-logo-mark">H</span>
        <strong>HRMS2</strong>
      </Link>
      <nav className="reference-shell-nav reference-shell-nav--product" aria-label="Primary navigation">
        {groups.map((group, groupIndex) => (
          <div key={groupIndex} className={cn("reference-shell-nav-group", groupIndex > 0 && "reference-product-nav-divider")}>
            {group.items.map((item) => <SidebarLink key={item.label} item={item} active={active(item.href)} compact onNavigate={onNavigate} />)}
          </div>
        ))}
      </nav>
      <div className="reference-product-footer">
        <Link to="/helpdesk" onClick={onNavigate} className="reference-product-help"><HelpCircle className="h-4 w-4" />Help & Support</Link>
      </div>
    </div>
  );
}

function CorporateTopbar({ onMenu, name, role, avatarUrl }: { onMenu: () => void; name: string; role: string; avatarUrl?: string }) {
  return (
    <header className="reference-corporate-topbar">
      <button type="button" onClick={onMenu} className="reference-shell-icon-button lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
      <button type="button" className="reference-shell-icon-button hidden lg:inline-flex" aria-label="Collapse navigation"><Menu className="h-5 w-5" /></button>
      <label className="reference-corporate-search">
        <Search className="h-4 w-4 text-[#71809a]" />
        <input aria-label="Search employees, tickets and reports" placeholder="Search employees, tickets, reports..." />
        <kbd>⌘ K</kbd>
      </label>
      <div className="ml-auto flex items-center gap-2.5">
        <button className="reference-topbar-alert" type="button" aria-label="Notifications"><Bell className="h-[19px] w-[19px]" /><span>9</span></button>
        <button className="reference-topbar-alert" type="button" aria-label="Messages"><Mail className="h-[19px] w-[19px]" /><span>5</span></button>
        <div className="reference-topbar-profile">
          <Avatar className="h-8 w-8">
            <AvatarImage src={normalizeMediaUrl(avatarUrl)} alt={name} />
            <AvatarFallback className="bg-[#eaf1fb] text-[10px] font-bold text-[#0b3a75]">{initials(name)}</AvatarFallback>
          </Avatar>
          <div className="hidden min-w-0 sm:block">
            <p className="max-w-[130px] truncate text-[11px] font-bold text-[#13213b]">{name}</p>
            <p className="text-[9px] text-[#71809a]">{role}</p>
          </div>
          <ChevronDown className="hidden h-4 w-4 text-[#61708a] sm:block" />
        </div>
      </div>
    </header>
  );
}

function ProductFloatingHeader({ onMenu, name, role, avatarUrl }: { onMenu: () => void; name: string; role: string; avatarUrl?: string }) {
  const now = new Date();
  return (
    <div className="reference-product-header-controls">
      <button type="button" onClick={onMenu} className="reference-shell-icon-button lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
      <div className="reference-product-date-card">
        <CalendarDays className="h-4 w-4" />
        <div><strong>{now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</strong><span>{now.toLocaleDateString("en-GB", { weekday: "long" })}</span></div>
      </div>
      <button className="reference-product-bell" type="button" aria-label="Notifications"><Bell className="h-5 w-5" /><span>8</span></button>
      <div className="reference-product-profile">
        <Avatar className="h-9 w-9">
          <AvatarImage src={normalizeMediaUrl(avatarUrl)} alt={name} />
          <AvatarFallback className="bg-[#eaf1fb] text-[10px] font-bold text-[#0b3a75]">{initials(name)}</AvatarFallback>
        </Avatar>
        <div className="hidden sm:block"><p>{name}</p><span>{role}</span></div>
        <ChevronDown className="h-4 w-4 text-[#61708a]" />
      </div>
    </div>
  );
}

export function ReferenceDashboardShell({ variant, children }: { variant: RoleDashboardVariant; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { user } = useAuth();
  const { data: profile } = useEmployeeProfile();
  const mode = shellMode(variant);
  const name = profile?.full_name || profile?.first_name || user?.email?.split("@")[0] || "HRMS User";
  const role = profile?.designation || ROLE_LABEL[variant];
  const avatarUrl = profile?.avatar_url;

  const sidebar = useMemo(() => {
    if (mode === "corporate") {
      return <CorporateSidebar pathname={location.pathname} onNavigate={() => setMobileOpen(false)} name={name} role={role} avatarUrl={avatarUrl} />;
    }
    return <ProductSidebar variant={variant as "payroll" | "manager" | "super_admin"} pathname={location.pathname} onNavigate={() => setMobileOpen(false)} />;
  }, [avatarUrl, location.pathname, mode, name, role, variant]);

  return (
    <div className={cn("reference-app-shell", mode === "corporate" ? "reference-app-shell--corporate" : "reference-app-shell--product")}>
      {mobileOpen ? <button type="button" className="reference-shell-mobile-overlay" onClick={() => setMobileOpen(false)} aria-label="Close navigation" /> : null}

      <aside className={cn("reference-shell-sidebar hidden lg:block", mode === "corporate" ? "reference-shell-sidebar--corporate" : "reference-shell-sidebar--product")}>{sidebar}</aside>
      <aside className={cn("reference-shell-mobile-drawer lg:hidden", mobileOpen ? "is-open" : "") }>
        <button type="button" className="reference-shell-mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X className="h-5 w-5" /></button>
        {sidebar}
      </aside>

      <div className="reference-shell-main">
        {mode === "corporate" ? <CorporateTopbar onMenu={() => setMobileOpen(true)} name={name} role={role} avatarUrl={avatarUrl} /> : null}
        <div className="reference-shell-content">
          {mode === "product" ? <ProductFloatingHeader onMenu={() => setMobileOpen(true)} name={name} role={role} avatarUrl={avatarUrl} /> : null}
          {children}
        </div>
      </div>
    </div>
  );
}
