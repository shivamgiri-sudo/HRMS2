import { createRoutesFromElements, type RouteObject } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";

import { appRouteElements } from "../src/config/routes";
import SuperAdminDashboardV2 from "../src/pages/SuperAdminDashboardV2";

vi.mock("../src/pages/Index", () => ({
  default: () => <div data-dashboard-entry="switcher" />,
}));

vi.mock("../src/pages/dashboards/ReferenceRoleDashboard", () => ({
  default: () => <div data-dashboard-entry="single-view" />,
}));

function collectPaths(routes: RouteObject[]): string[] {
  return routes.flatMap((route) => [
    ...(route.path ? [route.path] : []),
    ...collectPaths(route.children ?? []),
  ]);
}

test("application route groups contain only valid routes and preserve candidate flows", () => {
  const routeObjects = createRoutesFromElements(appRouteElements);
  const routePaths = collectPaths(routeObjects);

  for (const requiredPath of [
    "/auth",
    "/interview-registration",
    "/onboard-full",
    "/ats/onboarding-requests",
  ]) {
    expect(routePaths).toContain(requiredPath);
  }

  expect(routePaths.length).toBeGreaterThan(100);
});

test("the dedicated super-admin URL preserves the dashboard role switcher", () => {
  const html = renderToStaticMarkup(<SuperAdminDashboardV2 />);

  expect(html).toContain('data-dashboard-entry="switcher"');
  expect(html).not.toContain('data-dashboard-entry="single-view"');
});
