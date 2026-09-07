import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * A route's `roles` list is a ceiling; the page grant in role_page_access is the floor.
 * A user must clear both.
 *
 * ProtectedRoute used to read `if (!routePageCode && roles && roles.length > 0)`, which
 * skipped the role list entirely the moment a path appeared in PAGE_CODE_BY_ROUTE — nearly
 * every gated route. 95 routes carried a role list that nothing enforced, and 60 of them
 * admitted roles their own file excluded, because the DB grant was the only real check.
 *
 * The one that mattered: role_page_access grants SALARY_REVISION to `employee`, held by
 * 1,440 of ~1,530 live users, so anyone who pasted /salary-revision rendered the Payroll
 * Head revision console. Its API is guarded by requireRole, so the screen came up empty
 * rather than leaking pay — but nothing in the route file was stopping the page opening,
 * despite that file naming six roles that did not include `employee`.
 */
describe("route role lists are enforced as a ceiling", () => {
  const guard = read("src/components/auth/ProtectedRoute.tsx");

  it("applies the role list regardless of whether the route maps to a page code", () => {
    // The defect in one line: this predicate turned the whole list off for mapped routes.
    expect(guard).not.toContain("if (!routePageCode && roles");
    expect(guard).toContain("if (roles && roles.length > 0)");
  });

  it("still applies the page grant on top of the role list", () => {
    // Ceiling AND floor — dropping either half is what produced the original divergence.
    expect(guard).toContain("if (routePageCode && !hasRoutePageAccess)");
  });

  describe("deliberate narrowings survive", () => {
    const routeSource = readdirSync(resolve(process.cwd(), "src/config/routes"))
      .filter((f) => f.endsWith(".routes.tsx"))
      .map((f) => read(`src/config/routes/${f}`))
      .join("\n");

    const rolesFor = (path: string) => {
      const route = routeSource.match(
        new RegExp(`<Route\\s+path="${path.replace(/\//g, "\\/")}"[\\s\\S]*?\\/>`),
      );
      expect(route, `no <Route> found for ${path}`).toBeTruthy();
      const roles = route![0].match(/roles=\{\[([^\]]*)\]\}/);
      expect(roles, `no roles list on ${path}`).toBeTruthy();
      return roles![1].split(",").map((s) => s.trim().replace(/['"]/g, ""));
    };

    it("keeps `employee` off /salary-revision", () => {
      // The grant says employee; the route says otherwise, and the route is right. This is
      // the assertion that fails if someone widens the list back to match the grant instead
      // of revoking the grant.
      const roles = rolesFor("/salary-revision");
      expect(roles).not.toContain("employee");
      expect(roles).toContain("payroll_hr");
    });

    it("keeps /payroll/exception-control on its four write roles", () => {
      // This screen writes attendance and payroll inputs. It shares the
      // PAYROLL_ATTENDANCE_CONTROL_TOWER page code with the read-only Control Tower, so the
      // grant cannot separate them — only this list can. It mirrors assertPayrollAccess() in
      // payable-days-override.routes.ts, which is the API this page writes through.
      expect(rolesFor("/payroll/exception-control").sort()).toEqual(
        ["admin", "payroll_admin", "payroll_head", "super_admin"].sort(),
      );
    });
  });
});
