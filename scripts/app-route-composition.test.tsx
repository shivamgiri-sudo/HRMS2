import { createRoutesFromElements, type RouteObject } from "react-router-dom";

import { appRouteElements } from "../src/config/routes";

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
