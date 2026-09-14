/**
 * "My journey" shows my promotions and transfers — not everyone's.
 *
 * EmployeeJourney builds one personal timeline from three sources: /me/journey,
 * /me/promotions and /me/transfers. The last two had no route at all, so the page
 * silently rendered a timeline with every promotion and transfer missing. The
 * route-contract gate flagged both as reachable-and-unserved.
 *
 * The obvious fix — point the page at /api/mobility/{promotions,transfers}, which
 * already exist — is wrong in one specific case. Those routes branch on role:
 *
 *   if (await hasRole(userId, "admin", "hr")) return everything;
 *   else return only the caller's own records;
 *
 * That is correct for a mobility admin screen and wrong for a personal timeline.
 * An HR user opening "my journey" would have seen the whole company's promotion
 * history presented as their own. So these routes always scope to the actor,
 * whatever role they hold, and delegate to the same mobilityService rather than
 * duplicating its queries.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const employeeRoutes = read("src/modules/employees/employee.routes.ts");
const mobilityRoutes = read("src/modules/mobility/mobility.routes.ts");

/** The /me/promotions + /me/transfers block. */
const meBlock = employeeRoutes.slice(
  employeeRoutes.indexOf("function meScopedMobility"),
  employeeRoutes.indexOf("bank-change-status"),
);

describe("/me/promotions and /me/transfers exist", () => {
  it("both routes are registered", () => {
    expect(employeeRoutes).toContain('meScopedMobility("promotions"');
    expect(employeeRoutes).toContain('meScopedMobility("transfers"');
    expect(meBlock).toContain("router.get(`/me/${path}`");
  });

  it("they reuse mobilityService rather than re-querying the tables", () => {
    expect(employeeRoutes).toContain('import { mobilityService } from "../mobility/mobility.service.js"');
    expect(employeeRoutes).toContain("mobilityService.listPromotions({ employee_id })");
    expect(employeeRoutes).toContain("mobilityService.listTransfers({ employee_id })");
  });
});

describe("they are scoped to the caller, for every role", () => {
  it("resolve the actor's own employee row from the JWT", () => {
    expect(meBlock).toContain("req.authUser?.id");
    expect(meBlock).toContain("SELECT id FROM employees WHERE user_id = ?");
  });

  it("never widen the result set by role", () => {
    // The bug this guards against is an admin/hr branch returning everything.
    expect(meBlock).not.toContain("hasRole");
    expect(meBlock).not.toMatch(/listPromotions\(\{\s*status/);
    expect(meBlock).not.toMatch(/listTransfers\(\{\s*status/);
  });

  it("always pass an employee_id filter", () => {
    const calls = [...meBlock.matchAll(/mobilityService\.list(Promotions|Transfers)\(([^)]*)\)/g)];
    expect(calls).toHaveLength(2);
    for (const [, , args] of calls) expect(args).toContain("employee_id");
  });

  it("401 without a session, 404 without an employee record", () => {
    expect(meBlock).toContain("Unauthorized");
    expect(meBlock).toContain("No employee record for this user");
  });
});

describe("the mobility admin routes are left alone", () => {
  it("still widen for admin and hr, which is right for that screen", () => {
    expect(mobilityRoutes).toContain('hasRole(userId, "admin", "hr")');
  });
});
