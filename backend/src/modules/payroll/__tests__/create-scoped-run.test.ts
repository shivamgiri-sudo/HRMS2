/**
 * Creating a payroll run for a chosen set of cost centres.
 *
 * Three things this pins, each of which was wrong or missing:
 *
 *   * `payroll_head` could not create or calculate a run. It owns this workflow — the HO stage of
 *     the cost-centre attendance chain ends with it, and the readiness page's HO override is its
 *     call — but it appeared in neither role list, so the role chosen to run payroll could not.
 *
 *   * The row-scope guard resolved `req.body.branch_id`, a field this API never sends. The target
 *     therefore carried no branch, and the check could not confine anybody to their own.
 *
 *   * A company run is one per month; a scoped month is expected to hold several. Applying the
 *     old duplicate check to scoped runs would have allowed exactly one cost-centre run per month,
 *     which defeats the point.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createRunSchema } from "../payroll.validation.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const routes = fs.readFileSync(path.resolve(DIR, "../payroll.routes.ts"), "utf8");
const service = fs.readFileSync(path.resolve(DIR, "../payroll.service.ts"), "utf8");

/** The `POST /runs` registration only — later routes have different role rules. */
function createRunRoute(): string {
  const start = routes.indexOf('router.post("/runs",');
  expect(start, "POST /runs not found").toBeGreaterThan(-1);
  return routes.slice(start, routes.indexOf('router.get("/runs/:id"', start));
}

describe("the request contract", () => {
  it("accepts a list of cost centre ids", () => {
    expect(createRunSchema.parse({ runMonth: "2026-08", costCentreIds: ["a", "b"] }).costCentreIds)
      .toEqual(["a", "b"]);
  });

  it("still accepts a company-wide run with no cost centres", () => {
    expect(createRunSchema.parse({ runMonth: "2026-08" }).costCentreIds).toBeUndefined();
  });

  it("rejects an empty array rather than treating it as 'scoped to nothing'", () => {
    /*
     * An empty selection reaching the service would produce a run with no scope rows, and a scoped
     * run with no scope rows selects an unfiltered population — the whole company, from a screen
     * that said it was paying none of it.
     */
    expect(() => createRunSchema.parse({ runMonth: "2026-08", costCentreIds: [] })).toThrow();
  });

  it("rejects a blank id inside the list", () => {
    expect(() => createRunSchema.parse({ runMonth: "2026-08", costCentreIds: [""] })).toThrow();
  });
});

describe("run authority", () => {
  it("lets the Payroll Head create a run", () => {
    expect(createRunRoute()).toContain('"payroll_head"');
  });

  it("lets the Payroll Head calculate a run", () => {
    const calc = routes.slice(routes.indexOf('router.post("/runs/:id/calculate"'));
    expect(calc.slice(0, 300)).toContain('"payroll_head"');
  });

  it("admits no branch-side role to run creation", () => {
    // Branches finalise and approve attendance; HO runs payroll. Adding a branch role here would
    // put salary calculation in branch hands without an approval gate.
    const route = createRunRoute();
    for (const role of ["branch_head", "payroll_hr", "payroll_branch", "wfm"]) {
      expect(route, `${role} must not create runs`).not.toContain(`"${role}"`);
    }
  });
});

describe("row scope", () => {
  it("no longer reads a branch the API never sends", () => {
    expect(createRunRoute()).not.toContain("req.body.branch_id");
  });

  it("resolves the branch from the selected cost centres, server-side", () => {
    // A caller must not be able to name one branch while selecting another's cost centres.
    expect(createRunRoute()).toContain("resolveCostCentreScope");
  });
});

describe("duplicate rules differ by run kind", () => {
  it("keeps one company run per month", () => {
    expect(service).toContain("scope_kind = 'company'");
    expect(service).toContain("Payroll run already exists for this month");
  });

  it("allows a month to hold several scoped runs", () => {
    /*
     * The month/branch/process duplicate check now sits in the else arm. Left applying to scoped
     * runs it would permit exactly one cost-centre run per month, which is the opposite of the
     * feature.
     */
    const idx = service.indexOf("const isScoped = scopeRows.length > 0;");
    expect(idx).toBeGreaterThan(-1);
    const after = service.slice(idx, idx + 1400);
    expect(after).toContain("if (isScoped) {");
    expect(after).toContain("} else {");
    expect(after.indexOf("assertCostCentresFree")).toBeLessThan(after.indexOf("Payroll run already exists"));
  });

  it("writes the scope inside the same transaction as the run", () => {
    // A run that committed without its scope rows would select every employee in the company.
    const idx = service.indexOf("insertRunScope(conn, id, input.runMonth, scopeRows)");
    expect(idx).toBeGreaterThan(-1);
    expect(service.slice(idx, idx + 200)).toContain("conn.commit()");
  });

  it("records scope_kind on the run so both selection sites can branch on it", () => {
    expect(service).toContain('isScoped ? "scoped" : "company"');
  });

  it("keys the creation lock on the selection", () => {
    // Two scoped creations for different cost centres in one month must not serialise on each
    // other, but two for the SAME selection must.
    expect(service).toContain("input.costCentreIds ?? []");
    expect(service).toContain("payroll_run_create:");
  });
});
