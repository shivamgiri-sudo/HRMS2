/**
 * SidebarNav — collapsible master categories with expandable sub-items.
 * Master items with `children` render as accordion-style expanders.
 * Leaf items render as direct links (unchanged behaviour).
 */
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ChevronRight, ChevronDown } from "lucide-react";
import { useState, useEffect, type ReactNode } from "react";

export type NavItem = {
  label: string;
  href: string;
  icon: ReactNode;
  badge?: number;
  pageCode?: string;
  roles?: string[];
  description?: string;
  /** Sub-items — when present this item becomes a collapsible master */
  children?: NavItem[];
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

interface SidebarNavProps {
  groups: NavGroup[];
  onNavigate?: () => void;
}

function useIsChildActive(items: NavItem[], pathname: string): boolean {
  return items.some((item) => {
    const match =
      item.href === "/dashboard"
        ? pathname === "/dashboard"
        : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (match) return true;
    if (item.children) return item.children.some((c) =>
      c.href === "/dashboard" ? pathname === "/dashboard"
        : pathname === c.href || pathname.startsWith(`${c.href}/`)
    );
    return false;
  });
}

function MasterNavItem({
  item,
  onNavigate,
  pathname,
}: {
  item: NavItem;
  onNavigate?: () => void;
  pathname: string;
}) {
  const children = item.children ?? [];
  const childActive = useIsChildActive(children, pathname);
  const [open, setOpen] = useState(childActive);

  // Auto-open when a child becomes active (e.g. direct URL navigation)
  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "nav-item group w-full text-left",
          childActive && "active"
        )}
        aria-expanded={open}
      >
        <span className="nav-icon">{item.icon}</span>
        <span className="flex-1 truncate text-[13.5px]">{item.label}</span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 opacity-50 shrink-0 transition-transform" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 opacity-40 shrink-0 transition-transform" />
        )}
      </button>

      {open && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-white/10 pl-2">
          {children.map((child) => {
            const active =
              child.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname === child.href || pathname.startsWith(`${child.href}/`);
            return (
              <Link
                key={child.href}
                to={child.href}
                onClick={onNavigate}
                className={cn("nav-item group text-[12.5px]", active && "active")}
                aria-current={active ? "page" : undefined}
              >
                <span className="nav-icon opacity-75">{child.icon}</span>
                <span className="flex-1 truncate">{child.label}</span>
                {active && (
                  <ChevronRight className="h-3 w-3 opacity-40 shrink-0" />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
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
                if (item.children?.length) {
                  return (
                    <MasterNavItem
                      key={`${group.title}-${item.label}`}
                      item={item}
                      onNavigate={onNavigate}
                      pathname={location.pathname}
                    />
                  );
                }
                const active = isActive(item.href);
                return (
                  <Link
                    key={`${group.title}-${item.href}`}
                    to={item.href}
                    onClick={onNavigate}
                    className={cn("nav-item group", active && "active")}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="nav-icon">{item.icon}</span>
                    <span className="flex-1 truncate text-[13.5px]">
                      {item.label}
                    </span>
                    {item.badge ? (
                      <span
                        className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold"
                        style={{
                          background: "rgba(27,106,181,0.25)",
                          color: "#5aa0dd",
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
