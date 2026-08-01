/**
 * TopBar — Glassmorphism topbar with breadcrumb, global search hint,
 * notification bell, and user avatar.
 *
 * Does NOT touch auth flow, WorkforcePageGate, or any hooks.
 */
import { type FormEvent, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  ChevronRight,
  Eye,
  LogOut,
  Menu,
  Search,
  Settings,
  User,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { useAuth } from "@/contexts/AuthContext";
import { useViewAs } from "@/contexts/ViewAsContext";
import { useEmployeeProfile } from "@/hooks/useEmployeeProfile";
import { useEmployeeSearchOptions } from "@/hooks/useEmployees";
import { useUserRole } from "@/hooks/useUserRole";
import { cn } from "@/lib/utils";
import { normalizeMediaUrl } from "@/lib/mediaUrl";
import { navGroups } from "./navConfig";

interface TopBarProps {
  onMenuClick: () => void;
  searchResults?: Array<{ href: string; label: string; description?: string; icon?: React.ReactNode }>;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSearchSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onSearchResultClick: (href: string) => void;
}

/** Derive breadcrumb segments from pathname */
function useBreadcrumbs() {
  const location = useLocation();
  const parts = location.pathname.split("/").filter(Boolean);
  const labelByHref = new Map<string, string>();

  navGroups.forEach((group) => {
    group.items.forEach((item) => {
      labelByHref.set(item.href, item.label);
      item.children?.forEach((child) => labelByHref.set(child.href, child.label));
    });
  });

  const crumbs = parts.map((part, i) => ({
    href: "/" + parts.slice(0, i + 1).join("/"),
    isLast: i === parts.length - 1,
  })).map((crumb) => ({
    ...crumb,
    label:
      labelByHref.get(crumb.href) ||
      crumb.href
        .split("/")
        .filter(Boolean)
        .at(-1)
        ?.split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ") ||
      "Home",
  }));
  return crumbs;
}

export function TopBar({
  onMenuClick,
  searchResults,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  onSearchResultClick,
}: TopBarProps) {
  const navigate = useNavigate();
  const { user, signOut, isSigningOut } = useAuth();
  const { data: myProfile } = useEmployeeProfile();
  const { data: roleData } = useUserRole();
  const breadcrumbs = useBreadcrumbs();
  const userInitials = (user?.email ?? "MC").slice(0, 2).toUpperCase();

  const { isViewAsEnabled, activeEmployee, isLoading: viewAsLoading, setActiveEmployee, clearViewAs } = useViewAs();
  const isSuperAdmin = roleData?.roles?.includes("super_admin") ?? false;
  const showViewAsPicker = isViewAsEnabled && isSuperAdmin;

  const [viewAsOpen, setViewAsOpen] = useState(false);
  const [viewAsQuery, setViewAsQuery] = useState("");
  const { data: viewAsResults } = useEmployeeSearchOptions(viewAsQuery);
  const viewAsInputRef = useRef<HTMLInputElement>(null);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  return (
    <header
      className="hrms-topbar sticky top-0 z-30"
      style={{
        minHeight: "var(--topbar-height)",
        background: "rgba(255,255,255,0.88)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
      }}
    >
      <div className="flex min-h-[64px] items-center gap-2 px-3 sm:gap-3 sm:px-5 lg:px-6">
        {/* Mobile menu trigger — touch-friendly 44px minimum */}
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0 rounded-xl text-slate-500 hover:bg-slate-100/80 lg:hidden"
          onClick={onMenuClick}
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Breadcrumb — desktop only */}
        <nav
          className="hrms-breadcrumb hidden lg:flex"
          aria-label="Breadcrumb"
        >
          <Link to="/dashboard" className="hover:text-[#1B6AB5]">
            Home
          </Link>
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.href} className="flex items-center gap-1.5">
              <ChevronRight className="separator h-3 w-3" />
              {crumb.isLast ? (
                <span className="current">{crumb.label}</span>
              ) : (
                <Link to={crumb.href}>{crumb.label}</Link>
              )}
            </span>
          ))}
        </nav>

        {/* Search — responsive, collapsible on small screens */}
        <form
          onSubmit={onSearchSubmit}
          className="relative ml-auto max-w-[180px] flex-1 sm:max-w-sm lg:ml-4 lg:max-w-md"
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search..."
            className="h-10 rounded-xl border-slate-200/80 bg-slate-50/80 pl-10 pr-4 text-sm backdrop-blur-sm transition-all focus:bg-white focus:border-[#1B6AB5] sm:h-9"
            aria-label="Search modules"
          />
          {searchQuery.trim() && searchResults && searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-2xl border border-[var(--border-hairline)] bg-white p-2 shadow-[var(--shadow-xl)]">
              <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[var(--tracking-wider)] text-[var(--text-muted)]">
                Navigate
              </div>
              {searchResults.slice(0, 7).map((item) => (
                <button
                  key={item.href}
                  type="button"
                  onClick={() => onSearchResultClick(item.href)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-[var(--surface-1)]"
                >
                  {item.icon && (
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand-50)] text-[var(--brand-600)]">
                      {item.icon}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800">{item.label}</p>
                    {item.description && (
                      <p className="truncate text-xs text-slate-400">{item.description}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </form>

        {/* Right actions — touch-friendly spacing */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          {/* View As Employee picker — super_admin only, when feature is enabled */}
          {showViewAsPicker && (
            <Popover open={viewAsOpen} onOpenChange={(open) => {
              setViewAsOpen(open);
              if (open) setTimeout(() => viewAsInputRef.current?.focus(), 50);
              if (!open) setViewAsQuery("");
            }}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-9 gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition-colors",
                    activeEmployee
                      ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                      : "text-slate-500 hover:bg-slate-100"
                  )}
                  title="View As Employee"
                >
                  <Eye className="h-4 w-4 shrink-0" />
                  {activeEmployee ? (
                    <span className="max-w-[100px] truncate">{activeEmployee.full_name}</span>
                  ) : (
                    <span className="hidden sm:inline">View As</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  View Dashboard As Employee
                </p>
                <Input
                  ref={viewAsInputRef}
                  placeholder="Search by name or code…"
                  value={viewAsQuery}
                  onChange={(e) => setViewAsQuery(e.target.value)}
                  className="mb-2 h-8 text-sm"
                />
                {viewAsLoading && (
                  <p className="py-2 text-center text-xs text-slate-400">Loading…</p>
                )}
                {!viewAsLoading && viewAsQuery.length >= 1 && (viewAsResults ?? []).length === 0 && (
                  <p className="py-2 text-center text-xs text-slate-400">No employees found</p>
                )}
                <div className="max-h-52 overflow-y-auto space-y-0.5">
                  {(viewAsResults ?? []).map((emp) => (
                    <button
                      key={emp.id}
                      type="button"
                      className="flex w-full flex-col rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-50 transition-colors"
                      onClick={async () => {
                        await setActiveEmployee({
                          id: String(emp.id),
                          employee_code: emp.employee_code ?? "",
                          full_name: emp.full_name ?? emp.name ?? "",
                          designation_name: emp.designation_name,
                          branch_name: emp.branch_name,
                        });
                        setViewAsOpen(false);
                        setViewAsQuery("");
                      }}
                    >
                      <span className="font-medium text-slate-800">{emp.full_name ?? emp.name}</span>
                      <span className="text-xs text-slate-400">
                        {emp.employee_code}
                        {emp.designation_name && ` · ${emp.designation_name}`}
                        {emp.branch_name && ` · ${emp.branch_name}`}
                      </span>
                    </button>
                  ))}
                </div>
                {activeEmployee && (
                  <div className="mt-2 border-t pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-center gap-1.5 text-xs text-amber-700 hover:bg-amber-50"
                      onClick={() => { clearViewAs(); setViewAsOpen(false); }}
                    >
                      <X className="h-3 w-3" />
                      Exit View As Mode
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          )}

          <NotificationBell />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="relative h-11 w-11 rounded-full p-0"
                aria-label="Account menu"
              >
                <Avatar className="h-11 w-11 ring-2 ring-[#1B6AB5]/25">
                  <AvatarImage src={normalizeMediaUrl(myProfile?.avatar_url)} alt="My photo" />
                  <AvatarFallback className="text-sm font-bold text-white" style={{ background: "#1B6AB5" }}>
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl">
              <DropdownMenuLabel>
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-semibold">My Account</p>
                  <p className="truncate text-xs font-normal text-slate-400">
                    {user?.email}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/profile" className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/settings" className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="text-red-600 focus:text-red-600"
              >
                <LogOut className="mr-2 h-4 w-4" />
                {isSigningOut ? "Signing out…" : "Sign out"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
