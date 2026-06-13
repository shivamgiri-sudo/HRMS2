/**
 * SidebarNav — Linear-inspired dark sidebar with surface-ladder depth,
 * left-accent active indicator, and flat nav groups (no accordion).
 *
 * Does NOT change routes, pageCode logic, or WorkforceAccess hooks.
 */
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export type NavItem = {
  label: string;
  href: string;
  icon: ReactNode;
  badge?: number;
  pageCode?: string;
  roles?: string[];
  description?: string;
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

interface SidebarNavProps {
  groups: NavGroup[];
  onNavigate?: () => void;
}

export function SidebarNav({ groups, onNavigate }: SidebarNavProps) {
  const location = useLocation();

  const isActive = (href: string) =>
    href === "/dashboard"
      ? location.pathname === "/dashboard"
      : location.pathname === href || location.pathname.startsWith(`${href}/`);

  return (
    <nav className="mcn-sidebar-scroll flex-1 overflow-y-auto px-3 py-2">
      <div className="space-y-5">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="nav-group-label">{group.title}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={`${group.title}-${item.href}`}
                    to={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "nav-item group",
                      active && "active"
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="nav-icon">
                      {item.icon}
                    </span>
                    <span className="flex-1 truncate text-[13.5px]">
                      {item.label}
                    </span>
                    {item.badge ? (
                      <span
                        className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold"
                        style={{
                          background: "rgba(67,97,238,0.20)",
                          color: "#818cf8",
                        }}
                      >
                        {item.badge}
                      </span>
                    ) : active ? (
                      <ChevronRight className="h-3 w-3 opacity-40 shrink-0" />
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}
