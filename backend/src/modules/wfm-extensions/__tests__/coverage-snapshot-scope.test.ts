import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * computedCoverageSnapshot()'s manual/override branch (triggered whenever the caller
 * supplies planned_headcount) took process_id/branch_id straight from the request body
 * with no scope check at all — unlike the computed branch just below it, which correctly
 * applies employeeScope(). A "manager" role scoped to one branch could write a
 * fabricated headcount/shrinkage snapshot for any other branch or process.
 *
 * Route-handler logic in this file is not usefully unit-testable without a live
 * Express/DB harness (it's one big router with inline handlers, not an exported
 * service layer), so this pins the fix at the source level: the scope check must exist
 * in the manual-override branch, ahead of the `return` that builds the snapshot.
 */
describe("wfm-ext coverage/snapshot scope check", () => {
  const source = readFileSync(resolve(__dirname, "../wfm-ext.routes.ts"), "utf-8");

  function manualOverrideBranch(): string {
    const start = source.indexOf("if (input.planned_headcount !== undefined)");
    expect(start, "manual-override branch not found").toBeGreaterThan(-1);
    const end = source.indexOf("const scope = await employeeScope(userId);", start);
    expect(end, "computed branch (end marker) not found").toBeGreaterThan(start);
    return source.slice(start, end);
  }

  it("checks the caller's scope before accepting a manually-supplied process_id/branch_id", () => {
    const branch = manualOverrideBranch();
    expect(branch).toMatch(/hasProcessScope\(userId, processId, branchId, \.\.\.WFM_SCOPE_ROLES\)/);
  });

  it("bypasses the check only for admin/hr, matching the read-path convention elsewhere in this file", () => {
    const branch = manualOverrideBranch();
    expect(branch).toMatch(/hasRole\(userId, "admin", "hr"\)/);
  });

  it("rejects when process_id/branch_id validation fails, rather than falling through to the write", () => {
    const branch = manualOverrideBranch();
    expect(branch).toMatch(/statusCode:\s*403/);
  });
});
