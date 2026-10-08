import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

describe("GRN consumption reversal (Phase E — audit finding #9)", () => {
  it("registers migration 1062 in the manifest and widens both status enums additively", () => {
    const sql = read("sql/1062_grn_consumption_reversal.sql");
    const runner = read("src/db/runPendingMigrations.ts");
    expect(sql).toContain("'consumption_reversed'");
    expect(sql).toContain("'reversed'");
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(runner).toContain('"1062_grn_consumption_reversal.sql"');
  });

  it("adds reverseConsumption to budget-consumption.service.ts, symmetric to release()", () => {
    const service = read("src/modules/process-pnl/budget-consumption.service.ts");
    expect(service).toContain("async reverseConsumption(");
    expect(service).toContain("consumed_amount = GREATEST(0, consumed_amount - ?)");
    expect(service).toContain("consumed_quantity = GREATEST(0, consumed_quantity - ?)");
    expect(service).toContain("Cannot reverse more budget amount than is consumed");
  });

  it("grn-smart.service.ts reverses every consumed allocation row, not just one budget line", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    expect(service).toContain("async function reverseConsumedAllocations");
    expect(service).toContain("reverseConsumption(connection: PoolConnection, grnId: string)");
    expect(service).toContain("lifecycle_status = 'reversed'");
    expect(service).toContain("WHERE grn_request_id = ? AND lifecycle_status = 'consumed'");
  });

  it("grn.service.ts only allows reversal from a genuinely-consumed status and requires a reason", () => {
    const service = read("src/modules/finance/grn.service.ts");
    expect(service).toContain("async reverseConsumption(");
    expect(service).toContain("A reason is required to reverse a GRN's budget consumption");
    expect(service).toContain("CONSUMED_GRN_STATUSES");
    // Must branch to the smart-allocation path rather than assuming a single budget_line_id.
    expect(service).toContain("grnSmartService.hasAllocations(grnId)");
    expect(service).toContain("grnSmartService.reverseConsumption(connection, grnId)");
    expect(service).toContain("status = 'consumption_reversed'");
    // Guarded by an affected-rows check, same optimistic-lock pattern as cancelGrn.
    expect(service).toContain("GRN status changed before reversal; refresh and try again");
  });

  it("the route is finance_head/super_admin only — not the broader review-role set", () => {
    const routes = read("src/modules/finance/grn.routes.ts");
    expect(routes).toContain("/grns/:id/reverse-consumption");
    expect(routes).toContain('GRN_REVERSAL_ROLES: RoleKey[] = ["finance_head", "super_admin"]');
    const routeIdx = routes.indexOf('"/grns/:id/reverse-consumption"');
    const nextRouteIdx = routes.indexOf('grnRouter.post(\n  "/grns/:id/attachment"');
    const routeBlock = routes.slice(routeIdx, nextRouteIdx > -1 ? nextRouteIdx : undefined);
    expect(routeBlock).toContain("GRN_REVERSAL_ROLES");
    expect(routeBlock).toContain("authorizeGrnBranch");
    expect(routeBlock).not.toContain("GRN_REVIEW_ROLES");
  });
});
