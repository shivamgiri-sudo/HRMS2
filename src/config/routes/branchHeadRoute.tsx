import { Route } from "react-router-dom";
import type { ReactNode } from "react";

/** Same build flag roleDashboardAccess.ts reads; flag off => no route element at all. */
export function branchHeadRouteEnabled(): boolean {
  return import.meta.env?.VITE_BRANCH_HEAD_HEALTH_ENABLED === "true";
}

export function branchHeadRoute(enabled: boolean, element: ReactNode) {
  return enabled ? <Route path="/branch-head/dashboard" element={element} /> : null;
}
