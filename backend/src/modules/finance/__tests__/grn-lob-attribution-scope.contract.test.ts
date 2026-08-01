import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";
import { hasGlobalFinanceScope } from "../finance-access-scope.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

/**
 * GRN LOB attribution is branch-scoped data, and branch_admin / branch_head are
 * allowed on those endpoints. Before this was enforced, all three
 * /grn-attribution routes returned and wrote records from every branch.
 */
describe("GRN LOB attribution branch scope", () => {
  it("treats branch roles as branch-scoped, never global finance scope", () => {
    // The actual predicate the scope helpers branch on — if a branch role ever
    // gains global scope, every check below becomes a no-op.
    expect(hasGlobalFinanceScope("branch_admin")).toBe(false);
    expect(hasGlobalFinanceScope("branch_head")).toBe(false);
    expect(hasGlobalFinanceScope(undefined, ["branch_admin"])).toBe(false);

    // Sanity: the roles that legitimately see every branch still do.
    expect(hasGlobalFinanceScope("finance_head")).toBe(true);
    expect(hasGlobalFinanceScope("super_admin")).toBe(true);
  });

  it("filters listPending by branch when a branch id is supplied", async () => {
    const { db } = await import("../../../db/mysql.js");
    const execute = vi.mocked(db.execute as unknown as (...args: unknown[]) => unknown);
    execute.mockResolvedValue([[], []] as never);

    const { grnLobAttributionService } = await import("../grn-lob-attribution.service.js");
    await grnLobAttributionService.listPending(50, "branch-abc");

    const [sql, params] = execute.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toContain("g.branch_id = ?");
    expect(params).toEqual(["branch-abc"]);
  });

  it("does not filter by branch for global finance roles", async () => {
    const { db } = await import("../../../db/mysql.js");
    const execute = vi.mocked(db.execute as unknown as (...args: unknown[]) => unknown);
    execute.mockResolvedValue([[], []] as never);

    const { grnLobAttributionService } = await import("../grn-lob-attribution.service.js");
    await grnLobAttributionService.listPending(50, null);

    const [sql, params] = execute.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).not.toContain("g.branch_id = ?");
    expect(params).toEqual([]);
  });

  it("applies a branch check on every /grn-attribution route", () => {
    const routes = read("src/modules/process-pnl/process-lob.routes.ts");

    // The listing resolves the caller's branch rather than trusting the query.
    expect(routes).toContain("resolveFinanceBranchScope");
    // Both :grnId routes assert the record's branch before reading or writing.
    const assertions = routes.match(/assertGrnAttributionBranch\(req, req\.params\.grnId\)/g) ?? [];
    expect(assertions).toHaveLength(2);
    expect(routes).toContain("assertFinanceRecordBranch");
  });

  it("keeps branch roles out of GRN review authority", () => {
    const grnRoutes = read("src/modules/finance/grn.routes.ts");
    const review = grnRoutes.match(/GRN_REVIEW_ROLES: RoleKey\[\] = \[([^\]]*)\]/)?.[1] ?? "";
    expect(review).not.toContain("branch_admin");
    // branch_head reviews at the first approval stage, so it is expected here.
    expect(review).toContain("branch_head");
  });
});
