import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { appRouteElements } from "@/config/routes";

/**
 * path -> the `roles` list its <ProtectedRoute> enforces, read straight from the mounted route tree.
 *
 * ProtectedRoute denies a user whose roles miss that list, so a sidebar / launcher / search entry for
 * the same path is a dead link for them. The nav used to decide from the DB page grant alone, which
 * offered finance, payroll and WFM users whole admin areas (Security Center, Access Control, Module
 * Access, Policy Engine ...) that opened onto "Access Denied". Deriving the ceiling from the routes
 * themselves means it cannot drift from the guard it mirrors.
 */
type RouteProps = { path?: string; element?: ReactNode; children?: ReactNode };
type GuardProps = { roles?: readonly string[]; entitlementVerified?: boolean; children?: ReactNode };

function findGuardRoles(node: ReactNode, depth = 0): readonly string[] | undefined {
  if (depth > 6 || !isValidElement(node)) return undefined;
  const el = node as ReactElement<GuardProps>;
  if (el.type === ProtectedRoute) {
    if (el.props.entitlementVerified) return undefined;
    return el.props.roles?.length ? el.props.roles : undefined;
  }
  return findGuardRoles(el.props?.children, depth + 1);
}

function collect(node: ReactNode, out: Map<string, readonly string[]>) {
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<RouteProps>;
    const { path, element, children } = el.props ?? {};
    if (typeof path === "string" && path.startsWith("/") && !out.has(path)) {
      const roles = findGuardRoles(element);
      if (roles) out.set(path, roles);
    }
    if (children) collect(children, out);
  });
}

let cache: Map<string, readonly string[]> | null = null;

export function getRouteRoleCeiling(href: string): readonly string[] | undefined {
  if (!cache) {
    cache = new Map();
    collect(appRouteElements, cache);
  }
  return cache.get(href.split(/[?#]/)[0]);
}
