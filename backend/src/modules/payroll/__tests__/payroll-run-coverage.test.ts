/**
 * Month coverage — the check that stops a month closing with somebody unpaid.
 *
 * Once a month can be paid in several runs, no single run can answer "is this month done?". The
 * dangerous version of that question is the one shaped around cost centres: a month where every
 * cost centre has a run can still leave people out, because 2 of 1,037 active employees have no
 * cost_centre_id at all and belong to no cost centre. Completeness is therefore defined against
 * employees, and those two are reported with a reason rather than omitted — an employee silently
 * skipped looks identical to one correctly excluded, and the difference is somebody not paid.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { getMonthCoverage } = await import("../payroll-run-coverage.service.js");

const DIR = path.dirname(fileURLToPath(import.meta.url));
const routes = fs.readFileSync(path.resolve(DIR, "../payroll.routes.ts"), "utf8");

const cc = (over: Record<string, unknown> = {}) => ({
  cost_centre_id: "cc-1",
  cost_centre_code: "IT/SYSTEM",
  branch_id: "br-1",
  branch_name: "HEAD OFFICE",
  staff: 1,
  run_id: null,
  run_status: null,
  ...over,
});

/** First query is the cost-centre rollup, second is the uncovered-employee list. */
const respond = (costCentres: unknown[], uncovered: unknown[]) =>
  execute.mockResolvedValueOnce([costCentres, []]).mockResolvedValueOnce([uncovered, []]);

beforeEach(() => execute.mockReset());

describe("completeness is judged on employees, not cost centres", () => {
  it("is incomplete while any active employee sits outside every run", async () => {
    respond([cc({ run_id: "r1", run_status: "finalized" })], [
      { id: "e-9", employee_code: "MAS9", reason: "no cost centre assigned" },
    ]);
    const cov = await getMonthCoverage("2026-08");
    expect(cov.complete).toBe(false);
    expect(cov.uncoveredEmployees).toHaveLength(1);
  });

  it("is complete only when nothing is uncovered", async () => {
    respond([cc({ run_id: "r1", run_status: "finalized" })], []);
    await expect(getMonthCoverage("2026-08")).resolves.toMatchObject({ complete: true });
  });

  it("stays incomplete even when every cost centre has a run", async () => {
    // The exact case a cost-centre-shaped check would call finished.
    respond([cc({ run_id: "r1", run_status: "finalized" })], [
      { id: "e-9", employee_code: "MAS9", reason: "no cost centre assigned" },
    ]);
    const cov = await getMonthCoverage("2026-08");
    expect(cov.totals.notStarted).toBe(0);
    expect(cov.complete).toBe(false);
  });
});

describe("uncovered employees are named, with why", () => {
  it("distinguishes 'no cost centre' from 'cost centre not run'", async () => {
    // Different fixes: one needs a posting corrected, the other needs a run.
    respond([], [
      { id: "e-1", employee_code: "MAS1", reason: "no cost centre assigned" },
      { id: "e-2", employee_code: "MAS2", reason: "cost centre not included in any run this month" },
    ]);
    const cov = await getMonthCoverage("2026-08");
    expect(cov.uncoveredEmployees.map((e) => e.reason)).toEqual([
      "no cost centre assigned",
      "cost centre not included in any run this month",
    ]);
  });

  it("asks the database for both reasons rather than only the unassigned ones", async () => {
    respond([], []);
    await getMonthCoverage("2026-08");
    const sql = String(execute.mock.calls[1][0]);
    expect(sql).toContain("cost_centre_id IS NULL");
    expect(sql).toContain("NOT EXISTS");
  });

  it("says so when the cost centre is inactive and therefore unrunnable", async () => {
    /*
     * Measured on production 2026-09-04: 15 active employees sit in BSS/BO/AHMH-JD/560, whose
     * active_status is 0. resolveCostCentreScope refuses inactive cost centres, so those people can
     * never be put in a run and would block month close forever — while a generic "not included in
     * any run" sends somebody hunting the picker for a cost centre it deliberately does not offer.
     */
    respond([], []);
    await getMonthCoverage("2026-08");
    const sql = String(execute.mock.calls[1][0]);
    expect(sql).toContain("ccm.active_status <> 1");
    expect(sql).toContain("is inactive and cannot be selected for a run");
  });

  it("distinguishes an inactive branch from an inactive cost centre", async () => {
    respond([], []);
    await getMonthCoverage("2026-08");
    expect(String(execute.mock.calls[1][0])).toContain("branch of cost centre");
  });
});

describe("run status drives the cost-centre state", () => {
  it("reports a closed run as paid", async () => {
    respond([cc({ run_id: "r1", run_status: "FINALIZED" })], []);
    // Uppercase on purpose: production stores FINALIZED that way, and isRunClosed is
    // case-insensitive for exactly that reason.
    const cov = await getMonthCoverage("2026-08");
    expect(cov.costCentres[0].status).toBe("paid");
  });

  it("reports an open run as in_run", async () => {
    respond([cc({ run_id: "r1", run_status: "processing" })], []);
    await expect(getMonthCoverage("2026-08")).resolves.toMatchObject({
      costCentres: [expect.objectContaining({ status: "in_run" })],
    });
  });

  it("reports no run as not_started", async () => {
    respond([cc()], []);
    await expect(getMonthCoverage("2026-08")).resolves.toMatchObject({
      costCentres: [expect.objectContaining({ status: "not_started", runId: null })],
    });
  });

  it("excludes cancelled runs, so their cost centres read as free", async () => {
    /*
     * Must agree with assertCostCentresFree, which also ignores cancelled runs. If coverage counted
     * them the picker would show a cost centre as taken that the API would happily accept, and vice
     * versa.
     */
    respond([], []);
    await getMonthCoverage("2026-08");
    expect(String(execute.mock.calls[0][0])).toContain("cancelled");
    expect(String(execute.mock.calls[1][0])).toContain("cancelled");
  });
});

describe("the route", () => {
  it("is registered before /runs/:id so 'coverage' is not read as a run id", () => {
    // Express matches in order. Behind the parameterised route this would 404 through a lookup for
    // a run called "coverage".
    expect(routes.indexOf('router.get("/runs/coverage"'))
      .toBeLessThan(routes.indexOf('router.get("/runs/:id"'));
  });

  it("rejects a malformed month instead of querying with it", () => {
    const start = routes.indexOf('router.get("/runs/coverage"');
    const handler = routes.slice(start, start + 800);
    expect(handler).toContain("/^\\d{4}-\\d{2}$/");
    expect(handler).toContain("month must be YYYY-MM");
  });

  it("is HO-only", () => {
    const start = routes.indexOf('router.get("/runs/coverage"');
    const handler = routes.slice(start, start + 400);
    expect(handler).toContain('"payroll_head"');
    expect(handler).not.toContain('"branch_head"');
  });
});

describe("row scope — a branch user does not see the whole company", () => {
  /*
   * This endpoint feeds the run-scope picker, and returned EVERY branch's cost centres and
   * headcounts to anyone holding a payroll role. Creating a run was already confined by
   * requireScopedRole, so this was visibility rather than escalation — but org structure and
   * headcount are not a branch user's to browse, and every comparable payroll surface scopes
   * its rows.
   */
  const twoBranches = [
    cc({ cost_centre_id: "cc-ho", branch_id: "br-ho", branch_name: "HEAD OFFICE" }),
    cc({ cost_centre_id: "cc-noida", branch_id: "br-noida", branch_name: "NOIDA" }),
  ];
  const twoUncovered = [
    { id: "e1", employee_code: "MAS1", branch_id: "br-ho", reason: "no cost centre assigned" },
    { id: "e2", employee_code: "MAS2", branch_id: "br-noida", reason: "no cost centre assigned" },
  ];

  it("returns only the caller's branches when scoped", async () => {
    respond(twoBranches, twoUncovered);
    const r = await getMonthCoverage("2026-08", new Set(["br-ho"]));
    expect(r.costCentres.map((c) => c.branchId)).toEqual(["br-ho"]);
  });

  it("scopes the uncovered list to the same branches", async () => {
    // Left unfiltered, a branch user sees their own cost centres beside the whole company's
    // unpaid employees — two halves of one answer disagreeing about who it is about.
    respond(twoBranches, twoUncovered);
    const r = await getMonthCoverage("2026-08", new Set(["br-ho"]));
    expect(r.uncoveredEmployees.map((e) => e.employeeCode)).toEqual(["MAS1"]);
  });

  it("recomputes totals from what the caller can see", async () => {
    // Totals describing rows the caller cannot see would report a month as incomplete for
    // reasons they have no way to investigate.
    respond(twoBranches, twoUncovered);
    const r = await getMonthCoverage("2026-08", new Set(["br-ho"]));
    expect(r.totals.notStarted).toBe(1);
    expect(r.totals.uncovered).toBe(1);
  });

  it("is unrestricted when no scope is passed, so existing callers are unchanged", async () => {
    respond(twoBranches, twoUncovered);
    const r = await getMonthCoverage("2026-08");
    expect(r.costCentres).toHaveLength(2);
    expect(r.uncoveredEmployees).toHaveLength(2);
  });

  it("shows nothing when the caller is scoped to a branch with no cost centres", async () => {
    // Scoped by something other than branch (process, department) yields an empty set. Falling
    // through to "see everything" there would widen access by accident, which is the failure
    // that actually matters.
    respond(twoBranches, twoUncovered);
    const r = await getMonthCoverage("2026-08", new Set<string>());
    expect(r.costCentres).toHaveLength(0);
    expect(r.uncoveredEmployees).toHaveLength(0);
  });

  it("keeps an uncovered employee visible when their cost centre is dead", async () => {
    /*
     * The whole point of the uncovered list is employees whose cost centre is missing or
     * inactive, so the branch join is frequently NULL. The query COALESCEs to the employee's own
     * branch — without that, scoping would hide exactly the people it exists to surface.
     */
    respond(twoBranches, [
      { id: "e3", employee_code: "MAS3", branch_id: "br-ho", reason: "cost centre no longer exists" },
    ]);
    const r = await getMonthCoverage("2026-08", new Set(["br-ho"]));
    expect(r.uncoveredEmployees.map((e) => e.employeeCode)).toEqual(["MAS3"]);
  });
});

describe("the route resolves scope itself", () => {
  it("never takes the branch from the client", () => {
    // A caller who could name their own branches could read any branch's structure.
    const idx = routes.indexOf('router.get("/runs/coverage"');
    const block = routes.slice(idx, idx + 1400);
    expect(block).toContain("resolveVisibleBranchIdsForCoverage(req.authUser!.id)");
    expect(block).not.toMatch(/req\.(query|body)\.branch/i);
  });

  it("leaves HO roles unrestricted", () => {
    // payroll_head and finance_head run the whole company's payroll; scoping them to a branch
    // would break the view this picker exists for.
    const idx = routes.indexOf("async function resolveVisibleBranchIdsForCoverage");
    const fn = routes.slice(idx, idx + 700);
    expect(fn).toMatch(/"super_admin", "admin", "payroll_head", "finance_head"/);
  });
});
