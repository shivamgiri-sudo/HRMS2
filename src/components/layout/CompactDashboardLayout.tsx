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
  Network, Package, Receipt, Server, Settings, Settings2, ShieldCheck, Sparkles,
  Target, TrendingUp, User, UserMinus, UserPlus, Users, Wallet,
  X, Zap,
} from "lucide-react";
import { PWAInstallBanner } from "@/components/layout/PWAInstallBanner";
import { TopBar } from "@/components/layout/TopBar";
import { SidebarNav } from "@/components/layout/SidebarNav";
import { navGroups } from "@/components/layout/navConfig";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ReadOnlyBanner } from "@/components/ReadOnlyBanner";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdminOrHR, useWorkforceAccess } from "@/hooks/useUserRole";
import { useVersionCheck } from "@/hooks/useVersionCheck";
import { useEmployeeProfile } from "@/hooks/useEmployeeProfile";
import { cn } from "@/lib/utils";
import { normalizeMediaUrl } from "@/lib/mediaUrl";
import { APP_VERSION, isAutoUpdatingEnvironment } from "@/lib/version";

type Props = { children: ReactNode; subheader?: ReactNode };

const companyLogo = "/mcn-logo.png?v=999";


/* Bottom nav items (mobile only — 5 tabs max) */
const BOTTOM_NAV = [
  { label: "Home",    href: "/dashboard",  icon: <Home className="h-5 w-5" /> },
  { label: "People",  href: "/employees",  icon: <Users className="h-5 w-5" /> },
  { label: "Alerts",  href: "/notifications", icon: <Bell className="h-5 w-5" /> },
  { label: "Attend",  href: "/attendance", icon: <Clock className="h-5 w-5" /> },
  { label: "Me",      href: "/profile",    icon: <User className="h-5 w-5" /> },
];

export function DashboardLayout({ children, subheader }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [logoError, setLogoError] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { isAdminOrHR } = useIsAdminOrHR();
  const { data: myProfile } = useEmployeeProfile();
  const { canViewPage, visiblePageCodes, hasAnyRole } = useWorkforceAccess();
  const { data: versionData } = useVersionCheck();

  const displayVersion = isAutoUpdatingEnvironment()
    ? (versionData?.currentVersion ?? APP_VERSION)
    : versionData?.hasUpdate
    ? APP_VERSION
    : (versionData?.currentVersion ?? APP_VERSION);

  /* Filter nav items by access — recurses into children */
  const filteredGroups = useMemo(() => {
    const visibleSet = new Set(visiblePageCodes);

    const isSuperAdmin = hasAnyRole("super_admin");

    const canShow = (item: { pageCode?: string; roles?: string[]; adminOnly?: boolean }) => {
      if (isSuperAdmin) return true;
      if (item.pageCode) return visibleSet.has(item.pageCode) || canViewPage(item.pageCode);
      if (item.roles?.length) return hasAnyRole(...item.roles);
      if ((item as any).adminOnly && !isAdminOrHR) return false;
      return true;
    };

    return navGroups
      .map((group) => ({
        ...group,
        items: group.items
          .map((item) => {
            if (item.children?.length) {
              const filteredChildren = item.children.filter(canShow);
              if (filteredChildren.length === 0) return null;
              return { ...item, children: filteredChildren };
            }
            return canShow(item) ? item : null;
          })
          .filter(Boolean) as typeof group.items,
      }))
      .filter((g) => g.items.length > 0);
  }, [visiblePageCodes, canViewPage, hasAnyRole, isAdminOrHR]);

  const searchableItems = useMemo(
    () => filteredGroups.flatMap((g) =>
      g.items.flatMap((item) => {
        if (item.children?.length) {
          return item.children.map((child) => ({ ...child, groupTitle: g.title }));
        }
        return [{ ...item, groupTitle: g.title }];
      })
    ),
    [filteredGroups]
  );

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return searchableItems.filter((item) =>
      `${item.label} ${item.description ?? ""} ${item.groupTitle}`.toLowerCase().includes(q)
    );
  }, [searchQuery, searchableItems]);

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
  const SidebarContent = useMemo(() => (
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
          <div className="rounded-2xl bg-white px-3 py-3 shadow-sm">
            {logoError ? (
              <div
                className="flex h-16 items-center justify-center rounded-xl text-xl font-black text-white"
                style={{ background: "var(--brand-500)" }}
              >
                MCN
              </div>
            ) : (
              <div className="flex h-16 items-center justify-center">
                <img
                  src={companyLogo}
                  alt="Mas Callnet India Pvt Ltd"
                  className="h-full w-full object-contain"
                  onError={() => setLogoError(true)}
                />
              </div>
            )}
            <p className="mt-1 text-center text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#073f78]">
              Mas Callnet India Pvt Ltd
            </p>
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
          className="mb-2 flex items-center gap-3 rounded-2xl px-3 py-3 transition hover:bg-white/15"
          style={{ background: "var(--sidebar-surface-1)" }}
        >
          <Avatar className="h-14 w-14 flex-shrink-0 ring-2 ring-white/70">
            <AvatarImage src={normalizeMediaUrl(myProfile?.avatar_url)} alt="My photo" />
            <AvatarFallback
              className="text-base font-bold"
              style={{ background: "#3BAD49", color: "#fff" }}
            >
              {userInitials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-sm font-bold"
              style={{ color: "var(--sidebar-ink)" }}
            >
              {myProfile?.full_name || myProfile?.first_name || "My Profile"}
            </p>
            <p className="mt-0.5 truncate text-xs text-blue-100">
              {myProfile?.designation || myProfile?.employee_code || user?.email}
            </p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-green-200">
              View profile
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [filteredGroups, logoError, companyLogo, myProfile, userInitials, displayVersion]);

  return (
    <div className="min-h-dvh" style={{ background: "var(--surface-page)" }}>
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
        {SidebarContent}
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
        {SidebarContent}
      </aside>

      {/* Main content area — owns the scroll so sidebar position is preserved on navigation */}
      <div
        id="main-content-area"
        className="flex min-w-0 flex-col pb-16 lg:pb-0 lg:pl-[var(--sidebar-width)]"
        style={{ height: "100dvh", overflowY: "auto" }}
      >
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

        {/* Read-only banner for inactive employees */}
        <ReadOnlyBanner />

        {/* Optional subheader slot — rendered below topbar, above page content, full-width */}
        {subheader ? (
          <div className="border-b border-slate-200 bg-white">
            {subheader}
          </div>
        ) : null}

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
                  ? "text-[#1B6AB5]"
                  : "text-slate-400"
              )}
              aria-current={active ? "page" : undefined}
            >
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-xl transition",
                  active ? "bg-[#e8f2fc]" : ""
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
