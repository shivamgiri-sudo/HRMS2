/**
 * The four independent gates for /wfm/team-roster must describe the same audience, or the page is
 * routed but unreachable (or reachable but not in the nav). This pins them together:
 *   1. page_catalog + role_page_access  (backend/sql/1860)
 *   2. rbacPageMatrix.ts                (the applier would otherwise revoke the live grant)
 *   3. workforce.routes.tsx + pageRoutePageCodes.ts (route gate / route -> page-code map)
 *   4. navConfig.tsx                    (sidebar entry)
 * plus the backend mount order: the router must sit ahead of the catch-all /api/wfm routers.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_CODE_BY_ROUTE } from "@/lib/pageRoutePageCodes";
import { ROLE_SPECIFIC_PAGE_CODES } from "../../backend/src/shared/rbacPageMatrix";
import { REGISTER_PAGE_CODE, REGISTER_ROLES } from "@/components/wfm/team-roster/TeamAttendanceTab";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("Team Roster access gates agree", () => {
  it("route -> page code map points /wfm/team-roster at WFM_TEAM_ROSTER", () => {
    expect(PAGE_CODE_BY_ROUTE["/wfm/team-roster"]).toBe("WFM_TEAM_ROSTER");
  });

  it("the route sits under ProtectedRoute with the same page code and NO role ceiling (employee-role managers must get in)", () => {
    const routes = read("src/config/routes/workforce.routes.tsx");
    const line = routes.split("\n").find((l) => l.includes('path="/wfm/team-roster"'));
    expect(line).toBeTruthy();
    expect(line).toContain("<ProtectedRoute>");
    expect(line).not.toMatch(/ProtectedRoute roles=/);
    expect(line).toContain('<Gate pageCode="WFM_TEAM_ROSTER">');
  });

  it("the sidebar entry uses the same page code", () => {
    expect(read("src/components/layout/navConfig.tsx")).toMatch(/href: "\/wfm\/team-roster"[^\n]*pageCode: "WFM_TEAM_ROSTER"/);
  });

  it("the migration grants the page to employee AND the WFM / manager roles at the same path", () => {
    const sql = read("backend/sql/1860_team_roster_page_access.sql");
    expect(sql).toContain("'/wfm/team-roster'");
    for (const role of ["employee", "wfm", "branch_wfm", "ho_wfm", "manager", "process_manager", "admin", "super_admin"]) expect(sql).toContain(`'${role}'`);
  });

  it("rbacPageMatrix lists the page for employee (so the applier cannot revoke the live grant) and the WFM roles it knows", () => {
    expect(ROLE_SPECIFIC_PAGE_CODES.employee).toContain("WFM_TEAM_ROSTER");
    for (const role of ["wfm", "admin", "manager", "process_manager"] as const) expect(ROLE_SPECIFIC_PAGE_CODES[role]).toContain("WFM_TEAM_ROSTER");
  });

  it("the API is mounted ahead of the catch-all /api/wfm routers, and the router only requires authentication", () => {
    const app = read("backend/src/app.ts");
    const mount = app.indexOf('app.use("/api/wfm/team-roster", teamRosterRouter)');
    expect(mount).toBeGreaterThan(0);
    expect(mount).toBeLessThan(app.indexOf('app.use("/api/wfm", wfmRegularizationSecureRouter)'));
    expect(mount).toBeLessThan(app.indexOf('app.use("/api/wfm", wfmRouter)'));
    const routes = read("backend/src/modules/wfm/team-roster.routes.ts");
    expect(routes).toContain("teamRosterRouter.use(requireAuth)");
    expect(routes).not.toMatch(/requireRole\(/);
  });
  it("Team Attendance: the register link uses exactly the page code and roles the Attendance Register route itself enforces", () => {
    const routes = read("src/config/routes/payroll.routes.tsx");
    const line = routes.split("\n").find((l) => l.includes('path="/payroll/attendance-register"'));
    expect(line).toBeTruthy();
    expect(line).toContain('pageCode="' + REGISTER_PAGE_CODE + '"');
    const listed = [...(line!.match(/roles=\{\[([^\]]*)\]\}/)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect([...REGISTER_ROLES].sort()).toEqual(listed);
  });

  it("Team Attendance reads attendance only: no roster tables, no salary / bank / statutory fields in the module", () => {
    const src = read("backend/src/modules/wfm/team-roster-attendance.ts");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/wfm_roster|roster_team_/);
    expect(code).not.toMatch(/sal_days|salary|bank|pan_number|aadhaar|uan_number|cost_center/i);
    expect(code).toContain("attendanceRegisterMonthly");
    expect(code).toContain("employeeIds");
  });
});
