/**
 * TopBar — Glassmorphism topbar with breadcrumb, global search hint,
 * notification bell, and user avatar.
 *
 * Does NOT touch auth flow, WorkforcePageGate, or any hooks.
 */
import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import {
  Bell,
  ChevronRight,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  Sun,
  User,
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
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { useAuth } from "@/contexts/AuthContext";
import { useEmployeeProfile } from "@/hooks/useEmployeeProfile";
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
  const breadcrumbs = useBreadcrumbs();
  const userInitials = (user?.email ?? "MC").slice(0, 2).toUpperCase();
  const { resolvedTheme, setTheme } = useTheme();

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  return (
    <header
      className="hrms-topbar sticky top-0 z-30"
      style={{ minHeight: "var(--topbar-height)" }}
    >
      <div className="flex min-h-[64px] items-center gap-3 px-4 sm:px-5 lg:px-6">
        {/* Mobile menu trigger */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-xl text-slate-500 hover:bg-slate-100 lg:hidden"
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

        {/* Search */}
        <form
          onSubmit={onSearchSubmit}
          className="relative ml-auto max-w-sm flex-1 lg:ml-4 lg:max-w-md"
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search..."
            className="h-9 rounded-xl border-slate-200 bg-slate-50 pl-9 pr-16 text-sm focus:bg-white"
            aria-label="Search modules"
          />
          <span
            className="cmd-key-hint pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2"
            aria-hidden
          >
            ⌘K
          </span>

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

        {/* Right actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Dark / light toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            aria-label="Toggle dark mode"
          >
            {resolvedTheme === "dark" ? (
              <Sun className="h-4 w-4 text-amber-400" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>

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
