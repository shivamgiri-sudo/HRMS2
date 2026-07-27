import { useMemo } from "react";
import type { NavGroup, NavItem } from "@/components/layout/SidebarNav";
import { getRoutePageCode } from "@/lib/pageRoutePageCodes";
import {
  DASHBOARD_ACCESS_REGISTRY,
  canAccessDashboard,
  getDashboardDefinition,
} from "../../backend/src/shared/dashboardAccessRegistry";
import { useIsAdminOrHR, useWorkforceAccess } from "@/hooks/useUserRole";

type AccessContext = {
  canViewPage: (pageCode: string) => boolean;
  hasAnyRole: (...roles: string[]) => boolean;
  isAdminOrHR: boolean;
  roleKeys: string[];
  visiblePageCodes: string[];
};

export function canAccessNavItem(
  item: Pick<NavItem, "href" | "pageCode" | "roles" | "public">,
  access: AccessContext,
): boolean {
  const visibleSet = new Set(access.visiblePageCodes);
  const isSuperAdmin = access.hasAnyRole("super_admin");
  const pageCode = item.pageCode ?? getRoutePageCode(item.href);
  const dashboardByRoute = new Map(
    Object.values(DASHBOARD_ACCESS_REGISTRY).map((dashboard) => [dashboard.route, dashboard.code]),
  );
  const dashboardCode = getDashboardDefinition(pageCode)?.code ?? dashboardByRoute.get(item.href);

  if (dashboardCode) return canAccessDashboard(dashboardCode, access.roleKeys);
  if (isSuperAdmin) return true;
  if (pageCode) return visibleSet.has(pageCode) || access.canViewPage(pageCode);
  if (item.roles?.length) return access.hasAnyRole(...item.roles);
  if (item.public === true) return true;
  if ("adminOnly" in item && (item as NavItem & { adminOnly?: boolean }).adminOnly) return access.isAdminOrHR;
  return false;
}

export function filterNavGroups(groups: NavGroup[], access: AccessContext): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items
        .map((item) => {
          if (item.children?.length) {
            const filteredChildren = item.children.filter((child) => canAccessNavItem(child, access));
            if (filteredChildren.length === 0) return null;
            return { ...item, children: filteredChildren };
          }
          return canAccessNavItem(item, access) ? item : null;
        })
        .filter(Boolean) as NavItem[],
    }))
    .filter((group) => group.items.length > 0);
}

export function flattenNavGroups(groups: NavGroup[]) {
  return groups.flatMap((group) =>
    group.items.flatMap((item) => {
      const base = [{ label: item.label, href: item.href, group: group.title, description: item.description }];
      const children = (item.children ?? []).map((child) => ({
        label: child.label,
        href: child.href,
        group: item.label,
        description: child.description,
      }));
      return [...base, ...children];
    }),
  );
}

export function useAccessibleNavGroups(groups: NavGroup[]) {
  const { canViewPage, visiblePageCodes, hasAnyRole, roleKeys } = useWorkforceAccess();
  const { isAdminOrHR } = useIsAdminOrHR();

  return useMemo(
    () =>
      filterNavGroups(groups, {
        canViewPage,
        visiblePageCodes,
        hasAnyRole,
        roleKeys,
        isAdminOrHR,
      }),
    [canViewPage, visiblePageCodes, hasAnyRole, roleKeys, isAdminOrHR, groups],
  );
}
