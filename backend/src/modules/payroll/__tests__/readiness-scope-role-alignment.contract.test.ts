/**
 * Branch RBAC on the two payroll readiness screens.
 *
 * THE DEFECT CLASS. Each branch-addressed route carries two guards: requireRole says who may call
 * it at all, requireScopedRole says which branches they may touch. They take separate role lists,
 * and hasScopedAccess() refuses outright any caller holding none of the roles IT was given —
 * before it ever looks at a scope row. A role named in requireRole but missing from the same
 * route's scope list is therefore admitted and then refused, with a message about branch scope that
 * names the wrong cause.
 *
 * Nothing about that fails loudly, which is why it survived on seven routes at once. Measured on
 * production 2026-09-04:
 *
 *   * payroll_hr was admitted by requireRole on every branch-readiness route and appeared in none
 *     of their scope lists, so Branch Payroll HR — the role that does this work — got 403 on the
 *     page's own read, the checklist, the freeze request, the process sign-off and the projection.
 *     sheelu.verma@teammas.in, who holds only payroll_hr, could not open her own branch. The others
 *     escaped it only by also holding wfm or payroll_branch.
 *
 *   * payroll_head was missing from every cost-centre read scope list, so the HO Payroll Head could
 *     approve a branch's attendance — ho-approve is deliberately unscoped — while unable to read
 *     the grid being approved. nixon.sethi@teammas.in saw HEAD OFFICE only, via a branch_head row.
 *
 * A behavioural test cannot catch this: the guards are middleware composed at module load, and a
 * mocked request exercises whichever list the test itself supplies. The composition IS the bug, so
 * the route file's own source is what gets asserted.
 *
 * Scope rows are keyed by role_key (getUserAssignmentScopes filters on it), so listing a role here
 * does more than pass the gate — it decides whether that user's scope row is consulted at all. A
 * list that omits payroll_hr would ignore a payroll_hr scope row even after the gate passed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => fs.readFileSync(path.resolve(DIR, "..", f), "utf8");

const readiness = read("payroll-branch-readiness.routes.ts");
const ccAttendance = read("payroll-cc-attendance.routes.ts");
const processReadiness = read("payroll-process-readiness.routes.ts");

/** Every `requireScopedRole([...])` role list in a file, in source order. */
function scopeLists(source: string): string[][] {
  return [...source.matchAll(/requireScopedRole\(\s*(\[[^\]]*\])/g)].map((m) =>
    [...m[1].matchAll(/"([a-z_]+)"/g)].map((r) => r[1]),
  );
}

describe("a role admitted by requireRole is scoped, not silently refused", () => {
  it("gives Branch Payroll HR branch scope on every readiness route that admits it", () => {
    /*
     * The branch sign-off is the deliberate exception: requireRole("branch_head") admits only the
     * Branch Head, so its scope list is ["branch_head"] and payroll_hr has no business in it.
     * Every other list must carry payroll_hr, or the role that runs this page is locked out of it.
     */
    const lists = scopeLists(readiness).filter((l) => l.length > 1);
    expect(lists.length, "expected several multi-role scope lists").toBeGreaterThan(4);
    for (const list of lists) {
      expect(list, `payroll_hr missing from scope list [${list.join(", ")}]`).toContain("payroll_hr");
    }
  });

  it("keeps the branch sign-off to the Branch Head alone", () => {
    // Guards the exception above: if this list ever grows, the test above stops meaning anything.
    expect(scopeLists(readiness)).toContainEqual(["branch_head"]);
  });

  it("gives Branch Payroll HR scope on the process readiness screen too", () => {
    // Same defect, same page family: requireRole admitted payroll_hr while one scope list omitted it.
    const lists = scopeLists(processReadiness).filter((l) => l.includes("payroll_head"));
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) {
      expect(list, `payroll_hr missing from [${list.join(", ")}]`).toContain("payroll_hr");
    }
  });

  it("lets the HO Payroll Head read the cost-centre grid it approves", () => {
    /*
     * ho-approve is unscoped on purpose — approving every branch is the whole of that job. The read
     * routes are scoped, so payroll_head must appear in their lists or the approver cannot see what
     * they are approving. The maker lists (finalize, branch-approve, request-unlock) are branch-side
     * and correctly exclude it.
     */
    const readLists = scopeLists(ccAttendance).filter((l) => l.includes("process_manager"));
    expect(readLists.length, "expected the five read routes").toBe(5);
    for (const list of readLists) {
      expect(list).toContain("payroll_head");
      expect(list).toContain("payroll_hr");
    }
  });
});

describe("a missing scope row means no branches, not every branch", () => {
  it("fails closed on both screens", () => {
    /*
     * hasScopedAccess() returns !requireScopeForNonAdmin when a caller has no scope row at all. With
     * it false, a Branch Head created without a scope row silently received every branch in the
     * company — the exact opposite of what the middleware exists to do. Verified against production
     * before flipping: every current holder has a matching row, so nobody was locked out.
     */
    const files = [
      ["branch-readiness", readiness],
      ["cc-attendance", ccAttendance],
      ["process-readiness", processReadiness],
    ] as const;
    for (const [name, source] of files) {
      expect(source, `${name} must not reopen the no-scope bypass`)
        .not.toContain("requireScopeForNonAdmin: false");
      expect(source, `${name} must fail closed`).toContain("requireScopeForNonAdmin: true");
    }
  });
});

describe("every branch-addressed route carries a scope guard", () => {
  /** Route registrations whose path names a :branchId. */
  function branchRoutes(source: string): Array<{ path: string; body: string }> {
    const out: Array<{ path: string; body: string }> = [];
    const re = /Router\.(?:get|post|patch|put)\(\s*\n?\s*"(\/:branchId[^"]*)"([\s\S]*?)(?=\n\s*(?:async )?\(req|\n\s*h\()/g;
    for (const m of source.matchAll(re)) out.push({ path: m[1], body: m[2] });
    return out;
  }

  it("scopes send-back, which alone had no guard at all", () => {
    /*
     * send-back reopens a finalized cost centre and resets its stage. Unscoped, a Branch Head could
     * do that to any branch in the company. It cannot take a plain requireScopedRole because two
     * authorities share the route — an HO send-back must reach every branch like ho-approve, a
     * branch send-back must not — so it has a guard that branches on the stage.
     */
    const sendBack = ccAttendance.slice(ccAttendance.indexOf('"/:branchId/:costCentreId/send-back"'));
    const handlerStart = sendBack.indexOf("async (req");
    expect(handlerStart).toBeGreaterThan(-1);
    expect(sendBack.slice(0, handlerStart)).toContain("scopeSendBackToBranch");
  });

  it("leaves no other branch route unguarded", () => {
    /*
     * ho-approve is the one deliberate exception, documented at its definition and in this file's
     * header. Anything else reaching this list is a new route that forgot its scope guard.
     */
    const UNSCOPED_BY_DESIGN = ["/:branchId/:costCentreId/ho-approve", "/:branchId/ho-override"];
    for (const [name, source] of [["readiness", readiness], ["cc-attendance", ccAttendance]] as const) {
      for (const route of branchRoutes(source)) {
        if (UNSCOPED_BY_DESIGN.includes(route.path)) continue;
        const guarded = /requireScopedRole|scopeSendBackToBranch/.test(route.body);
        expect(guarded, `${name} ${route.path} has no branch scope guard`).toBe(true);
      }
    }
  });
});
