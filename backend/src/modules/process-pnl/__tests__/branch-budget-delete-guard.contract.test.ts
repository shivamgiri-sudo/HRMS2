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
    const fnBody = service.slice(fnStart, fnStart + 4000);

    // The approved-status list must be checked independently of GRN touch.
    expect(fnBody).toContain('APPROVED_STATUSES = ["branch_head_approved", "finance_head_approved", "active"]');
    expect(fnBody).toContain("requiresSupersede = touchedByGrn || APPROVED_STATUSES.includes(status)");

    // The supersede branch (not the hard-delete branch) must be the one gated on requiresSupersede.
    const supersedeBranch = fnBody.slice(fnBody.indexOf("if (requiresSupersede)"));
    expect(supersedeBranch).toContain("status = 'closed'");
    expect(supersedeBranch.indexOf("status = 'closed'")).toBeLessThan(supersedeBranch.indexOf("DELETE FROM finance_budget_header"));
  });

  it("still allows a true hard delete for an untouched draft/submitted/revision_required budget", () => {
    const service = read("src/modules/process-pnl/branch-budget.service.ts");
    const fnStart = service.indexOf("async deleteOrSupersede(");
    const fnBody = service.slice(fnStart, fnStart + 4000);
    // The DELETE branch must still exist and remain reachable when requiresSupersede is false.
    expect(fnBody).toContain("DELETE FROM finance_budget_header");
    expect(fnBody).toContain('outcome: "deleted" as const');
  });
});
