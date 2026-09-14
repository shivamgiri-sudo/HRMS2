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
  createContext,
  useContext,
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
import { flattenNavGroups, useAccessibleNavGroups } from "@/lib/navigationAccess";
import { useNavBadges } from "@/hooks/useNavBadges";
import {
  DASHBOARD_ACCESS_REGISTRY,
} from "../../../backend/src/shared/dashboardAccessRegistry";

type Props = { children: ReactNode; subheader?: ReactNode };

/**
 * True once a DashboardLayout is already rendering above us.
 *
 * Almost every page in this app wraps itself in <DashboardLayout>, which is correct when the page
 * owns the whole route. It stops being correct the moment one page renders another as a tab: the
 * shell would then mount twice — two sidebars, two headers, and a second round of useNavBadges /
 * useVersionCheck / useEmployeeProfile requests on every tab switch.
 *
 * Rather than strip the wrapper out of each page (which would mean editing working pages purely to
 * suit a new container, and would break them if they were ever routed standalone again), a nested
 * DashboardLayout detects the outer one and renders its children straight through. Top-level usage
 * is completely unchanged — the context defaults to false, so a page that owns its route still gets
 * the full shell exactly as before.
 *
 * This is what lets the consolidated Roster Rules page host the seven existing config pages as tabs
 * without modifying any of them.
 */
const InsideDashboardLayout = createContext(false);

const companyLogo = "/mcn-logo.png?v=999";


/* Bottom nav items (mobile only — 5 tabs max) */
const BOTTOM_NAV = [
  { label: "Home",    href: "/dashboard",  icon: <Home className="h-5 w-5" /> },
  { label: "People",  href: "/employees",  icon: <Users className="h-5 w-5" /> },
  { label: "Alerts",  href: "/notifications", icon: <Bell className="h-5 w-5" /> },
  { label: "Attend",  href: "/attendance", icon: <Clock className="h-5 w-5" /> },
  { label: "Me",      href: "/profile",    icon: <User className="h-5 w-5" /> },
];

/**
 * Renders the full app shell, or nothing but its children when another DashboardLayout is already
 * above it. The check lives in this thin wrapper rather than inside the shell because the shell
 * calls a long list of hooks — an early return placed after them would change hook order between
 * renders and violate the rules of hooks. useContext here is called unconditionally, so the order
 * is stable either way.
 */
export function DashboardLayout(props: Props) {
  const alreadyInsideLayout = useContext(InsideDashboardLayout);
  if (alreadyInsideLayout) return <>{props.children}</>;
  return <DashboardLayoutShell {...props} />;
}

function DashboardLayoutShell({ children, subheader }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [logoError, setLogoError] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { data: myProfile } = useEmployeeProfile();
  const filteredGroups = useAccessibleNavGroups(navGroups);
  const { roleKeys } = useWorkforceAccess();
  const { data: versionData } = useVersionCheck();
  const navBadges = useNavBadges();

  // Deep-clone filteredGroups and inject dynamic badge counts by href
  const badgedGroups = useMemo(() => {
    if (!navBadges.size) return filteredGroups;
    return filteredGroups.map((group) => ({
      ...group,
      items: group.items.map((item) => {
        const count = navBadges.get(item.href);
        if (count === undefined) return item;
        return { ...item, badge: count };
      }),
    }));
  }, [filteredGroups, navBadges]);

  const displayVersion = isAutoUpdatingEnvironment()
    ? (versionData?.currentVersion ?? APP_VERSION)
    : versionData?.hasUpdate
    ? APP_VERSION
    : (versionData?.currentVersion ?? APP_VERSION);

  const searchableItems = useMemo(
    () => flattenNavGroups(filteredGroups).map((item) => ({ ...item, groupTitle: item.group })),
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
        groups={badgedGroups}
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
  ), [badgedGroups, logoError, companyLogo, myProfile, userInitials, displayVersion]);

  return (
    <InsideDashboardLayout.Provider value={true}>
    <div className="min-h-dvh" style={{ background: "var(--surface-page)" }}>
      <PWAInstallBanner />

      {/* Mobile overlay — glass blur backdrop */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-40 lg:hidden"
          style={{
            background: "rgba(7, 15, 35, 0.65)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
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

      {/* Mobile slide-in sidebar — full-height, max 85vw, all menu items */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 lg:hidden flex flex-col",
          "transition-transform duration-300 ease-out will-change-transform",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
        style={{
          width: "min(320px, 85vw)",
          background: "linear-gradient(160deg, rgba(7,45,95,0.98) 0%, rgba(3,14,40,0.99) 100%)",
          backdropFilter: "blur(24px) saturate(200%)",
          WebkitBackdropFilter: "blur(24px) saturate(200%)",
          borderRight: "1px solid rgba(255,255,255,0.09)",
          boxShadow: "6px 0 60px rgba(0,0,0,0.55), inset -1px 0 0 rgba(255,255,255,0.06)",
        }}
      >
        {/* ── Header: logo + close ── */}
        <div
          className="flex flex-shrink-0 items-center justify-between px-3 py-3"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.09)" }}
        >
          <Link
            to="/dashboard"
            onClick={() => setSidebarOpen(false)}
            className="flex items-center gap-2.5 min-w-0"
          >
            <div
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl"
              style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.18)" }}
            >
              {logoError ? (
                <span className="text-[11px] font-black text-white">MCN</span>
              ) : (
                <img
                  src={companyLogo}
                  alt="MCN"
                  className="h-6 w-6 object-contain"
                  onError={() => setLogoError(true)}
                />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-extrabold uppercase tracking-[0.07em] text-white leading-none">
                MAS Callnet
              </p>
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] leading-none mt-0.5"
                style={{ color: "rgba(159,198,231,0.65)" }}>
                PeopleOS
              </p>
            </div>
          </Link>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 flex-shrink-0 rounded-xl transition-all active:scale-95"
            style={{ color: "rgba(255,255,255,0.65)", minHeight: 44, minWidth: 44 }}
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* ── User profile chip ── */}
        <Link
          to="/profile"
          onClick={() => setSidebarOpen(false)}
          className="mx-2.5 mt-2.5 flex flex-shrink-0 items-center gap-3 rounded-2xl px-3 py-2 transition-all active:scale-[0.97]"
          style={{
            background: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.11)",
          }}
        >
          <Avatar className="h-9 w-9 flex-shrink-0 ring-2 ring-white/25">
            <AvatarImage src={normalizeMediaUrl(myProfile?.avatar_url)} alt="My photo" />
            <AvatarFallback
              className="text-sm font-bold"
              style={{ background: "#3BAD49", color: "#fff" }}
            >
              {userInitials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-bold leading-tight text-white">
              {myProfile?.full_name || myProfile?.first_name || "My Profile"}
            </p>
            <p className="mt-0.5 truncate text-[10px] leading-none" style={{ color: "rgba(159,198,231,0.75)" }}>
              {myProfile?.designation || myProfile?.employee_code || user?.email}
            </p>
          </div>
          <span
            className="flex-shrink-0 rounded-lg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
            style={{ background: "rgba(59,173,73,0.20)", border: "1px solid rgba(59,173,73,0.35)", color: "#86efac" }}
          >
            View
          </span>
        </Link>

        {/* ── Full nav — all groups, all items, scrollable ── */}
        <div
          className="mobile-drawer-nav flex-1 overflow-y-auto overscroll-contain px-1 py-1"
          style={{
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(255,255,255,0.10) transparent",
          }}
        >
          <SidebarNav
            groups={filteredGroups}
            onNavigate={() => setSidebarOpen(false)}
          />
        </div>

        {/* ── Version footer ── */}
        <div
          className="flex-shrink-0 px-3 pb-3 pt-2 text-center"
          style={{
            borderTop: "1px solid rgba(255,255,255,0.07)",
            paddingBottom: "max(12px, env(safe-area-inset-bottom, 12px))",
          }}
        >
          <Link
            to="/changelog"
            onClick={() => setSidebarOpen(false)}
            className="text-[10px] font-medium transition-opacity hover:opacity-80"
            style={{ color: "rgba(159,198,231,0.50)" }}
          >
            v{displayVersion} · MAS PeopleOS
          </Link>
        </div>
      </aside>

      {/* Main content area — owns the scroll so sidebar position is preserved on navigation */}
      <div
        id="main-content-area"
        className="flex min-w-0 flex-col lg:pl-[var(--sidebar-width)]"
        style={{
          height: "100dvh",
          overflowY: "auto",
          paddingBottom: "calc(58px + env(safe-area-inset-bottom, 0px) + 0.5rem)",
        }}
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
        <main className="flex-1 px-4 py-5 pb-9 sm:px-5 lg:px-6 lg:py-6">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation — glassmorphism */}
      <nav
        className="glass-nav fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around px-2 lg:hidden"
        style={{
          height: "calc(58px + env(safe-area-inset-bottom, 0px))",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
        aria-label="Primary navigation"
      >
        {BOTTOM_NAV.map((tab) => {
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.href}
              to={tab.href}
              className={cn(
                "flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1 rounded-2xl px-3 py-2 text-[10px] font-bold",
                active ? "text-[#1B6AB5]" : "text-slate-400",
              )}
              aria-current={active ? "page" : undefined}
            >
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-xl",
                  active ? "bg-gradient-to-br from-[#e8f2fc] to-[#d1e6f9] shadow-sm" : "",
                )}
              >
                {tab.icon}
              </span>
              <span className={cn(active ? "opacity-100" : "opacity-70")}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
    </InsideDashboardLayout.Provider>
  );
}
