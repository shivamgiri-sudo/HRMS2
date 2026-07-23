import { useCallback } from "react";

import { navGroups } from "@/components/layout/navConfig";
import type { NavItem } from "@/components/layout/SidebarNav";
import { useUserRole, type WorkforcePageAccess } from "@/hooks/useUserRole";

export type DashboardLinkAccessContext = {
  authenticated: boolean;
  roleKeys: readonly string[];
  pages: readonly Pick<WorkforcePageAccess, "page_code" | "can_view">[];
  disabledPageCodes: readonly string[];
};

function normalizePath(href: string): string {
  const path = href.split(/[?#]/, 1)[0] || "/";
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function flatten(items: readonly NavItem[]): NavItem[] {
  return items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
}

const LINK_RULES = navGroups
  .flatMap((group) => flatten(group.items))
  .reduce<Map<string, NavItem[]>>((rules, item) => {
    const path = normalizePath(item.href);
    rules.set(path, [...(rules.get(path) ?? []), item]);
    return rules;
  }, new Map());

function roleMatches(allowed: readonly string[], actual: ReadonlySet<string>): boolean {
  return allowed.some((role) => {
    if (actual.has(role)) return true;
    if (role === "admin" && actual.has("super_admin")) return true;
    if (role === "tl" && actual.has("team_leader")) return true;
    if (role === "team_leader" && actual.has("tl")) return true;
    return false;
  });
}

export function canAccessDashboardLink(
  href: string,
  context: DashboardLinkAccessContext,
): boolean {
  if (!context.authenticated) return false;

  const rules = LINK_RULES.get(normalizePath(href));
  if (!rules?.length) return false;

  const roles = new Set(context.roleKeys);
  if (roles.has("super_admin")) return true;

  const disabled = new Set(context.disabledPageCodes);
  const visiblePages = new Set(
    context.pages
      .filter((page) => page.can_view && !disabled.has(page.page_code))
      .map((page) => page.page_code),
  );

  return rules.some((rule) => {
    if (rule.public) return true;
    if (rule.pageCode) return visiblePages.has(rule.pageCode);
    if (rule.roles?.length) return roleMatches(rule.roles, roles);
    return false;
  });
}

export function useDashboardLinkAccess(): (href: string) => boolean {
  const { data, isLoading } = useUserRole();
  return useCallback(
    (href: string) => canAccessDashboardLink(href, {
      authenticated: !isLoading && Boolean(data),
      roleKeys: data?.roleKeys ?? [],
      pages: data?.pages ?? [],
      disabledPageCodes: data?.disabledPageCodes ?? [],
    }),
    [data, isLoading],
  );
}
