import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

describe("branch budget delete guard — approved budgets are superseded, never hard-deleted", () => {
  it("blocks hard delete once a budget has an approval decision, regardless of GRN touch", () => {
    const service = read("src/modules/process-pnl/branch-budget.service.ts");
    const fnStart = service.indexOf("async deleteOrSupersede(");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = service.slice(fnStart, fnStart + 6500);

    // The approved-status list must be checked independently of GRN touch.
    expect(fnBody).toContain('APPROVED_STATUSES = ["branch_head_approved", "finance_head_approved", "active"]');
    // GRN touch forces supersede for everyone; an approval decision forces it for everyone except
    // super_admin, which is the one role trusted to delete an approved-but-unspent budget. This
    // assertion previously demanded the pre-override form and had been failing silently against
    // the shipped code — pinned to the real expression now.
    expect(fnBody).toContain(
      "requiresSupersede = touchedByGrn || (APPROVED_STATUSES.includes(status) && !isSuperAdminActor)"
    );
    // touchedByGrn is never overridable: real spend history is not deletable by anyone.
    expect(fnBody).toMatch(/requiresSupersede = touchedByGrn \|\|/);

    // The supersede branch (not the hard-delete branch) must be the one gated on requiresSupersede.
    const supersedeBranch = fnBody.slice(fnBody.indexOf("if (requiresSupersede)"));
    expect(supersedeBranch).toContain("status = 'closed'");
    expect(supersedeBranch.indexOf("status = 'closed'")).toBeLessThan(supersedeBranch.indexOf("DELETE FROM finance_budget_header"));
  });

  it("still allows a true hard delete for an untouched draft/submitted/revision_required budget", () => {
    const service = read("src/modules/process-pnl/branch-budget.service.ts");
    const fnStart = service.indexOf("async deleteOrSupersede(");
    const fnBody = service.slice(fnStart, fnStart + 6500);
    // The DELETE branch must still exist and remain reachable when requiresSupersede is false.
    expect(fnBody).toContain("DELETE FROM finance_budget_header");
    expect(fnBody).toContain('outcome: "deleted" as const');
  });
});

describe("branch budget delete guard — who may delete", () => {
  it("lets only the creator delete, and only while the budget is still a draft", () => {
    const service = read("src/modules/process-pnl/branch-budget.service.ts");
    const fnStart = service.indexOf("async deleteOrSupersede(");
    const fnBody = service.slice(fnStart, fnStart + 6500);

    // created_by has to be read for the ownership test to be possible at all.
    expect(fnBody).toContain("created_by FROM finance_budget_header");
    // A non-super-admin must fail both the ownership check and the draft-only check.
    expect(fnBody).toContain("Only the person who raised this budget can delete it");
    expect(fnBody).toMatch(/if \(!isSuperAdminActor\)/);
    expect(fnBody).toMatch(/status !== "draft"/);
  });

  it("keeps the authority check in the service, not only on the route", () => {
    // The route's requireRole narrows to budget-raising roles; it cannot know who created a given
    // budget. If this check ever moves out of the service, any of those roles could delete any
    // other branch admin's draft.
    const routes = read("src/modules/process-pnl/process-pnl.routes.ts");
    const deleteRoute = routes.slice(routes.indexOf('router.delete(\n  "/pnl/budgets/:id"'));
    expect(deleteRoute).toContain('requireRole("super_admin", "admin", "branch_admin")');

    const service = read("src/modules/process-pnl/branch-budget.service.ts");
    expect(service).toContain("Only the person who raised this budget can delete it");
  });
});
