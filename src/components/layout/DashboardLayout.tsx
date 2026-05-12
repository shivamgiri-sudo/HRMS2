import { ReactNode, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Bell,
  Building2,
  Calendar,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Clock,
  CreditCard,
  Home,
  LogOut,
  Menu,
  Package,
  Search,
  Settings,
  Target,
  User,
  UserPlus,
  Users,
  X,
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

interface DashboardLayoutProps {
  children: ReactNode;
}

const companyLogo = "/company-logo.png?v=101";

const navGroups: NavGroup[] = [
  {
    title: "Overview",
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: <Home className="h-4 w-4" />,
        description: "Workspace overview",
      },
      {
        label: "Reports",
        href: "/reports",
        icon: <BarChart3 className="h-4 w-4" />,
        adminOnly: true,
        description: "Reports and insights",
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
        description: "Employee directory",
      },
      {
        label: "Team Directory",
        href: "/employees",
        icon: <Users className="h-4 w-4" />,
        employeeOnly: true,
        description: "Team directory",
      },
      {
        label: "Departments",
        href: "/departments",
        icon: <Building2 className="h-4 w-4" />,
        adminOnly: true,
        description: "Department structure",
      },
      {
        label: "Onboarding",
        href: "/onboarding",
        icon: <UserPlus className="h-4 w-4" />,
        adminOnly: true,
        description: "New employee onboarding",
      },
    ],
  },
  {
    title: "Time",
    items: [
      {
        label: "Attendance",
        href: "/attendance",
        icon: <Clock className="h-4 w-4" />,
        description: "Attendance records",
      },
      {
        label: "Calendar",
        href: "/calendar",
        icon: <Calendar className="h-4 w-4" />,
        description: "Company calendar",
      },
      {
        label: "Leaves",
        href: "/leaves",
        icon: <CalendarDays className="h-4 w-4" />,
        description: "Leave requests",
      },
    ],
  },
  {
    title: "Operations",
    items: [
      {
        label: "Performance",
        href: "/performance",
        icon: <Target className="h-4 w-4" />,
        description: "Goals and performance",
      },
      {
        label: "Reviews",
        href: "/reviews-management",
        icon: <ClipboardList className="h-4 w-4" />,
        adminOnly: true,
        description: "Performance reviews",
      },
      {
        label: "Assets",
        href: "/assets",
        icon: <Package className="h-4 w-4" />,
        adminOnly: true,
        description: "Asset management",
      },
      {
        label: "Payroll",
        href: "/payroll",
        icon: <CreditCard className="h-4 w-4" />,
        adminOnly: true,
        description: "Payroll workspace",
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
        description: "System settings",
      },
    ],
  },
];

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
        if (item.href === "/dashboard") {
          return location.pathname === "/dashboard";
        }

        return (
          location.pathname === item.href ||
          location.pathname.startsWith(`${item.href}/`)
        );
      });
  }, [filteredNavGroups, location.pathname]);

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

  const isActivePath = (href: string) => {
    if (href === "/dashboard") {
      return location.pathname === "/dashboard";
    }

    return location.pathname === href || location.pathname.startsWith(`${href}/`);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const pageTitle = activeItem?.label || "Dashboard";
  const pageDescription =
    activeItem?.description || "Modern HRMS workspace for daily operations.";

  const SidebarContent = () => {
    return (
      <div className="flex h-full flex-col bg-[#0f172a] text-slate-100">
        {/* Brand */}
        <div className="relative border-b border-white/10 px-4 py-4">
          <div className="absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.24),transparent_48%)]" />

          <div className="relative rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <div className="flex min-h-[58px] items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-xl shadow-slate-950/30">
              <img
                src={companyLogo}
                alt="Company Logo"
                className="max-h-12 w-auto max-w-[178px] object-contain"
              />
            </div>

            <div className="mt-3 min-w-0 text-center">
              <p className="truncate text-[13px] font-semibold tracking-tight text-white">
                Mas Callnet HRMS
              </p>
              <p className="truncate text-[11px] text-slate-400">
                Employee Portal
              </p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="mcn-sidebar-scroll flex-1 overflow-y-auto px-3 py-4">
          <div className="space-y-5">
            {filteredNavGroups.map((group) => (
              <div key={group.title}>
                <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {group.title}
                </p>

                <div className="space-y-1">
                  {group.items.map((item) => {
                    const active = isActivePath(item.href);

                    return (
                      <Link
                        key={`${group.title}-${item.label}`}
                        to={item.href}
                        onClick={() => setSidebarOpen(false)}
                        className={cn(
                          "group flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-medium transition",
                          active
                            ? "bg-white text-slate-950 shadow-lg shadow-slate-950/20"
                            : "text-slate-300 hover:bg-white/10 hover:text-white"
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span
                            className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition",
                              active
                                ? "bg-slate-100 text-slate-950"
                                : "bg-white/5 text-slate-400 group-hover:bg-white/10 group-hover:text-white"
                            )}
                          >
                            {item.icon}
                          </span>

                          <span className="truncate">{item.label}</span>
                        </span>

                        {item.badge ? (
                          <Badge className="ml-2 h-5 rounded-full bg-cyan-100 px-2 text-[10px] font-semibold text-cyan-700 hover:bg-cyan-100">
                            {item.badge}
                          </Badge>
                        ) : active ? (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        {/* Sidebar user */}
        <div className="border-t border-white/10 p-3">
          <Link
            to="/profile"
            onClick={() => setSidebarOpen(false)}
            className="flex items-center gap-3 rounded-2xl bg-white/5 p-3 transition hover:bg-white/10"
          >
            <Avatar className="h-9 w-9 border border-white/10">
              <AvatarImage alt={getUserName()} />
              <AvatarFallback className="bg-white text-xs font-semibold text-slate-950">
                {getUserInitials()}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white">
                {getUserName()}
              </p>
              <p className="truncate text-[11px] text-slate-400">{user?.email}</p>
            </div>
          </Link>

          <Link
            to="/changelog"
            onClick={() => setSidebarOpen(false)}
            className="mt-2 flex items-center justify-center rounded-xl px-3 py-2 text-[11px] text-slate-500 transition hover:bg-white/5 hover:text-slate-300"
          >
            v{displayVersion}
          </Link>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#f3f6fb] text-slate-900">
      <PWAInstallBanner />

      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[260px] border-r border-slate-900 bg-[#0f172a] shadow-2xl lg:block">
        <SidebarContent />
      </aside>

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[280px] bg-[#0f172a] shadow-2xl transition-transform duration-300 lg:hidden",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="absolute right-3 top-3 z-10">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <SidebarContent />
      </aside>

      <div className="min-h-screen lg:pl-[260px]">
        <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 shadow-sm shadow-slate-200/50 backdrop-blur">
          <div className="flex min-h-[68px] items-center justify-between gap-4 px-4 sm:px-5 lg:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-xl text-slate-600 hover:bg-slate-100 lg:hidden"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>

              <div className="min-w-0">
                <div className="mb-0.5 hidden items-center gap-1.5 text-[11px] font-medium text-slate-400 sm:flex">
                  <span>HRMS</span>
                  <ChevronRight className="h-3 w-3" />
                  <span className="truncate">{pageTitle}</span>
                </div>

                <h1 className="truncate text-[17px] font-semibold tracking-tight text-slate-950">
                  {pageTitle}
                </h1>

                <p className="hidden truncate text-[12px] text-slate-500 md:block">
                  {pageDescription}
                </p>
              </div>
            </div>

            <div className="hidden w-full max-w-xs items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-400 xl:flex">
              <Search className="h-4 w-4" />
              <span>Search HRMS...</span>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {isAdminOrHR ? (
                <Button
                  asChild
                  size="sm"
                  className="hidden h-9 rounded-xl bg-slate-950 px-3 text-xs font-medium text-white shadow-sm hover:bg-slate-800 sm:inline-flex"
                >
                  <Link to="/onboarding">
                    <UserPlus className="mr-2 h-3.5 w-3.5" />
                    Add Employee
                  </Link>
                </Button>
              ) : (
                <Button
                  asChild
                  size="sm"
                  className="hidden h-9 rounded-xl bg-slate-950 px-3 text-xs font-medium text-white shadow-sm hover:bg-slate-800 sm:inline-flex"
                >
                  <Link to="/leaves">
                    <CalendarDays className="mr-2 h-3.5 w-3.5" />
                    Apply Leave
                  </Link>
                </Button>
              )}

              {isAdminOrHR ? (
                <NotificationBell />
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-xl border-slate-200 bg-white text-slate-500 shadow-sm"
                >
                  <Bell className="h-4 w-4" />
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-10 gap-2 rounded-xl px-2 hover:bg-slate-100"
                  >
                    <Avatar className="h-8 w-8 border border-slate-200">
                      <AvatarImage alt={getUserName()} />
                      <AvatarFallback className="bg-slate-950 text-[11px] font-semibold text-white">
                        {getUserInitials()}
                      </AvatarFallback>
                    </Avatar>

                    <div className="hidden min-w-0 text-left lg:block">
                      <p className="max-w-[120px] truncate text-xs font-semibold text-slate-950">
                        {getUserName()}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {isAdminOrHR ? "Admin / HR" : "Employee"}
                      </p>
                    </div>
                  </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent
                  align="end"
                  className="z-50 w-64 rounded-2xl border-slate-200 bg-white p-2 shadow-xl"
                >
                  <DropdownMenuLabel className="p-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10 border border-slate-200">
                        <AvatarImage alt={getUserName()} />
                        <AvatarFallback className="bg-slate-950 text-xs font-semibold text-white">
                          {getUserInitials()}
                        </AvatarFallback>
                      </Avatar>

                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-950">
                          {getUserName()}
                        </p>
                        <p className="truncate text-xs font-normal text-slate-500">
                          {user?.email}
                        </p>
                      </div>
                    </div>
                  </DropdownMenuLabel>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem asChild className="rounded-xl text-xs">
                    <Link to="/profile">
                      <User className="mr-2 h-4 w-4" />
                      Profile
                    </Link>
                  </DropdownMenuItem>

                  {isAdminOrHR && (
                    <DropdownMenuItem asChild className="rounded-xl text-xs">
                      <Link to="/settings">
                        <Settings className="mr-2 h-4 w-4" />
                        Settings
                      </Link>
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuSeparator />

                  <DropdownMenuItem
                    className="rounded-xl text-xs text-slate-700"
                    onClick={handleSignOut}
                    disabled={isSigningOut}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    {isSigningOut ? "Signing out..." : "Sign out"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        <main className="px-4 py-5 sm:px-5 lg:px-6">
          <div className="mx-auto max-w-[1480px]">{children}</div>
        </main>
      </div>
    </div>
  );
}