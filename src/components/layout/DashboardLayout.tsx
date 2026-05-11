import { ReactNode, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Building2,
  Calendar,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Clock,
  CreditCard,
  Home,
  LogOut,
  Menu,
  Package,
  Search,
  Settings,
  Sparkles,
  Target,
  User,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { useVersionCheck } from "@/hooks/useVersionCheck";
import hrHubLogo from "@/assets/brand/mcn-logo.png";
import { cn } from "@/lib/utils";
import { APP_VERSION, isAutoUpdatingEnvironment } from "@/lib/version";

interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
  badge?: number;
  adminOnly?: boolean;
  employeeOnly?: boolean;
  description?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    title: "Command Center",
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: <Home className="h-4 w-4" />,
        description: "Today’s status",
      },
      {
        label: "Reports",
        href: "/reports",
        icon: <BarChart3 className="h-4 w-4" />,
        adminOnly: true,
        description: "HR insights",
      },
    ],
  },
  {
    title: "People",
    items: [
      {
        label: "Employees",
        href: "/employees",
        icon: <Users className="h-4 w-4" />,
        adminOnly: true,
        description: "Workforce directory",
      },
      {
        label: "Team Directory",
        href: "/employees",
        icon: <Users className="h-4 w-4" />,
        employeeOnly: true,
        description: "Your team",
      },
      {
        label: "Departments",
        href: "/departments",
        icon: <Building2 className="h-4 w-4" />,
        adminOnly: true,
        description: "Org structure",
      },
      {
        label: "Onboarding",
        href: "/onboarding",
        icon: <UserPlus className="h-4 w-4" />,
        adminOnly: true,
        description: "New joiners",
      },
    ],
  },
  {
    title: "Time & Attendance",
    items: [
      {
        label: "Attendance",
        href: "/attendance",
        icon: <Clock className="h-4 w-4" />,
        description: "Daily punches",
      },
      {
        label: "Calendar",
        href: "/calendar",
        icon: <CalendarDays className="h-4 w-4" />,
        description: "Schedule view",
      },
      {
        label: "Leaves",
        href: "/leaves",
        icon: <Calendar className="h-4 w-4" />,
        badge: 2,
        description: "Leave requests",
      },
    ],
  },
  {
    title: "HR Operations",
    items: [
      {
        label: "Performance",
        href: "/performance",
        icon: <Target className="h-4 w-4" />,
        description: "Goals & reviews",
      },
      {
        label: "Assets",
        href: "/assets",
        icon: <Package className="h-4 w-4" />,
        adminOnly: true,
        description: "Asset tracking",
      },
      {
        label: "Payroll",
        href: "/payroll",
        icon: <CreditCard className="h-4 w-4" />,
        adminOnly: true,
        description: "Salary & payslips",
      },
    ],
  },
  {
    title: "System",
    items: [
      {
        label: "Settings",
        href: "/settings",
        icon: <Settings className="h-4 w-4" />,
        adminOnly: true,
        description: "Configurations",
      },
    ],
  },
];

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut, isSigningOut } = useAuth();
  const { isAdminOrHR } = useIsAdminOrHR();
  const { data: versionData } = useVersionCheck();

  const displayVersion = isAutoUpdatingEnvironment()
    ? versionData?.currentVersion ?? APP_VERSION
    : versionData?.hasUpdate
      ? APP_VERSION
      : versionData?.currentVersion ?? APP_VERSION;

  const filteredNavGroups = useMemo(() => {
    return navGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (item.adminOnly && !isAdminOrHR) return false;
          if (item.employeeOnly && isAdminOrHR) return false;
          return true;
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [isAdminOrHR]);

  const activeItem = useMemo(() => {
    return filteredNavGroups
      .flatMap((group) => group.items)
      .find((item) => {
        if (item.href === "/dashboard") return location.pathname === "/dashboard";
        return location.pathname === item.href || location.pathname.startsWith(`${item.href}/`);
      });
  }, [filteredNavGroups, location.pathname]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const getUserInitials = () => {
    const name = user?.user_metadata?.full_name || user?.email || "User";
    return name
      .split(" ")
      .map((n: string) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getUserName = () => {
    return user?.user_metadata?.full_name || user?.email?.split("@")[0] || "User";
  };

  const pageTitle = activeItem?.label || "MCN HRMS";
  const pageDescription =
    activeItem?.description ||
    "Centralized workforce, attendance, leave, payroll and HR operations cockpit.";

  const today = new Date();

  return (
    <div className="min-h-screen bg-[#f6f7fb] text-slate-900">
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar overlay"
          className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 z-50 h-full w-[292px] transform overflow-hidden bg-[#172033] text-white shadow-[22px_0_70px_rgba(15,23,42,0.22)] transition-transform duration-300 ease-out lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="pointer-events-none absolute -left-16 top-0 h-52 w-52 rounded-full bg-rose-500/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-10 right-0 h-44 w-44 rounded-full bg-cyan-400/10 blur-3xl" />

        <div className="relative flex h-full flex-col">
          <div className="flex h-[88px] items-center justify-between border-b border-white/10 px-5">
            <Link
              to="/dashboard"
              className="flex min-w-0 items-center gap-3"
              onClick={() => setSidebarOpen(false)}
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white shadow-lg shadow-slate-950/20">
                <img src={hrHubLogo} alt="Mas Callnet HRMS" className="max-h-8 max-w-8 object-contain" />
              </div>

              <div className="min-w-0">
                <p className="truncate text-[15px] font-black tracking-tight text-white">
                  Mas Callnet
                </p>
                <p className="-mt-0.5 truncate text-[11px] font-bold uppercase tracking-[0.18em] text-rose-300">
                  HRMS Command
                </p>
              </div>
            </Link>

            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-xl text-white hover:bg-white/10 hover:text-white lg:hidden"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="mx-4 mt-5 rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-2xl shadow-slate-950/10">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500 text-white shadow-lg shadow-rose-500/30">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-extrabold text-white">Today’s Workspace</p>
                <p className="text-xs text-slate-300">
                  {today.toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
            </div>
          </div>

          <nav className="relative mt-5 flex-1 overflow-y-auto px-3 pb-4">
            <div className="space-y-5">
              {filteredNavGroups.map((group) => (
                <div key={group.title}>
                  <p className="mb-2 px-3 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                    {group.title}
                  </p>

                  <ul className="space-y-1.5">
                    {group.items.map((item) => {
                      const isActive =
                        item.href === "/dashboard"
                          ? location.pathname === "/dashboard"
                          : location.pathname === item.href ||
                            location.pathname.startsWith(`${item.href}/`);

                      return (
                        <li key={`${group.title}-${item.label}`}>
                          <Link
                            to={item.href}
                            onClick={() => setSidebarOpen(false)}
                            className={cn(
                              "group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-bold transition-all duration-200",
                              isActive
                                ? "bg-gradient-to-r from-rose-500 to-rose-600 text-white shadow-lg shadow-rose-500/25"
                                : "text-slate-300 hover:bg-white/[0.07] hover:text-white"
                            )}
                          >
                            <span
                              className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-200",
                                isActive
                                  ? "bg-white/18 text-white"
                                  : "bg-white/[0.06] text-slate-300 group-hover:bg-white/10 group-hover:text-white"
                              )}
                            >
                              {item.icon}
                            </span>

                            <span className="min-w-0 flex-1 truncate">{item.label}</span>

                            {item.badge ? (
                              <Badge
                                className={cn(
                                  "h-5 min-w-5 justify-center rounded-full px-1.5 text-[10px] font-black",
                                  isActive
                                    ? "bg-white text-rose-600"
                                    : "bg-rose-500/15 text-rose-200"
                                )}
                              >
                                {item.badge}
                              </Badge>
                            ) : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </nav>

          <div className="relative border-t border-white/10 p-4">
            <Link
              to="/profile"
              onClick={() => setSidebarOpen(false)}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-3 transition-all hover:bg-white/[0.09]"
            >
              <Avatar className="h-11 w-11 border-2 border-white/15">
                <AvatarImage src={user?.user_metadata?.avatar_url} />
                <AvatarFallback className="bg-rose-500 text-sm font-black text-white">
                  {getUserInitials()}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold text-white">{getUserName()}</p>
                <p className="truncate text-xs text-slate-400">{user?.email}</p>
              </div>
            </Link>

            <Link
              to="/changelog"
              onClick={() => setSidebarOpen(false)}
              className="mt-3 flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              <Zap className="h-3.5 w-3.5 text-rose-300" />
              <span>v{displayVersion}</span>
              <span className="text-slate-600">•</span>
              <span>What’s New</span>
            </Link>
          </div>
        </div>
      </aside>

      <div className="min-h-screen lg:pl-[292px]">
        <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-xl lg:px-8">
          <div className="mx-auto flex h-[82px] max-w-[1500px] items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-2xl lg:hidden"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>

              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                  <span>Dashboard</span>
                  <span>/</span>
                  <span className="text-rose-500">{pageTitle}</span>
                </div>
                <h1 className="mt-1 truncate text-xl font-black tracking-tight text-slate-950 lg:text-2xl">
                  {pageTitle}
                </h1>
                <p className="hidden max-w-2xl truncate text-sm font-medium text-slate-500 md:block">
                  {pageDescription}
                </p>
              </div>
            </div>

            <div className="hidden flex-1 justify-center px-4 xl:flex">
              <div className="relative w-full max-w-md">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  placeholder="Search employees, leaves, payroll..."
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50/90 pl-11 pr-4 text-sm font-semibold outline-none transition focus:border-rose-300 focus:bg-white focus:ring-4 focus:ring-rose-500/10"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isAdminOrHR ? (
                <Button
                  asChild
                  className="hidden rounded-2xl bg-slate-950 px-4 font-extrabold text-white shadow-lg shadow-slate-950/15 hover:bg-rose-600 md:inline-flex"
                >
                  <Link to="/employees">
                    <UserPlus className="mr-2 h-4 w-4" />
                    Add Employee
                  </Link>
                </Button>
              ) : (
                <Button
                  asChild
                  className="hidden rounded-2xl bg-slate-950 px-4 font-extrabold text-white shadow-lg shadow-slate-950/15 hover:bg-rose-600 md:inline-flex"
                >
                  <Link to="/leaves">
                    <Calendar className="mr-2 h-4 w-4" />
                    Apply Leave
                  </Link>
                </Button>
              )}

              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <NotificationBell />
              </div>

              {isAdminOrHR && (
                <Button
                  variant="outline"
                  size="icon"
                  asChild
                  className="hidden h-11 w-11 rounded-2xl border-slate-200 bg-white shadow-sm md:inline-flex"
                >
                  <Link to="/settings">
                    <Settings className="h-5 w-5" />
                  </Link>
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-12 rounded-2xl border border-slate-200 bg-white px-2 shadow-sm hover:bg-slate-50"
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user?.user_metadata?.avatar_url} />
                      <AvatarFallback className="bg-rose-500 text-xs font-black text-white">
                        {getUserInitials()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="hidden min-w-0 text-left lg:block">
                      <p className="max-w-[120px] truncate text-xs font-extrabold text-slate-950">
                        {getUserName()}
                      </p>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        {isAdminOrHR ? "Admin / HR" : "Employee"}
                      </p>
                    </div>
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="end" className="w-64 rounded-2xl p-2">
                  <DropdownMenuLabel>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={user?.user_metadata?.avatar_url} />
                        <AvatarFallback className="bg-rose-500 text-sm font-black text-white">
                          {getUserInitials()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold">{getUserName()}</p>
                        <p className="truncate text-xs font-medium text-muted-foreground">
                          {user?.email}
                        </p>
                      </div>
                    </div>
                  </DropdownMenuLabel>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem asChild className="rounded-xl font-semibold">
                    <Link to="/profile">
                      <User className="mr-2 h-4 w-4" />
                      Profile
                    </Link>
                  </DropdownMenuItem>

                  {isAdminOrHR && (
                    <DropdownMenuItem asChild className="rounded-xl font-semibold">
                      <Link to="/settings">
                        <Settings className="mr-2 h-4 w-4" />
                        Settings
                      </Link>
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuSeparator />

                  <DropdownMenuItem
                    onClick={handleSignOut}
                    disabled={isSigningOut}
                    className="rounded-xl font-semibold text-rose-600 focus:text-rose-600"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    {isSigningOut ? "Signing out..." : "Sign out"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] px-4 py-6 lg:px-8 lg:py-8">
          <div className="relative overflow-hidden rounded-[28px] border border-white/70 bg-white/72 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl lg:p-6">
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-rose-500/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
            <div className="relative">{children}</div>
          </div>
        </main>
      </div>

      <PWAInstallBanner />
    </div>
  );
}
