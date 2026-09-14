/**
 * Statutory and bank outputs across a whole payroll month.
 *
 * A month used to be one run, so "the run's ECR" and "the month's ECR" were the same document. Now
 * a month can be paid in several runs, one per group of cost centres — but PF, ESI and the bank
 * advice are still filed and paid once. Six runs must not produce six challans.
 *
 * The per-run and per-month URLs share one handler each. Two copies of these aggregations could
 * drift into computing contributions differently, and that discrepancy would be found by EPFO or by
 * a bank, not by us.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { getMonthRunIds, resolveOutputRunIds, runIdPlaceholders, MonthOutputError } =
  await import("../payroll-month-outputs.service.js");

const DIR = path.dirname(fileURLToPath(import.meta.url));
const routes = fs.readFileSync(path.resolve(DIR, "../payroll.routes.ts"), "utf8");

beforeEach(() => execute.mockReset());

describe("getMonthRunIds", () => {
  it("collects every run in the month", async () => {
    execute.mockResolvedValue([[{ id: "r1" }, { id: "r2" }], []]);
    await expect(getMonthRunIds("2026-08")).resolves.toEqual(["r1", "r2"]);
  });

  it("excludes cancelled runs, whose lines were never paid", async () => {
    // Including them would overstate a challan against money that never moved.
    execute.mockResolvedValue([[], []]);
    await getMonthRunIds("2026-08");
    expect(String(execute.mock.calls[0][0])).toContain("cancelled");
  });

  it("counts runs still in progress", async () => {
    /*
     * Only 'cancelled' is excluded. A run mid-flight is money that will be paid this month, and
     * omitting it would understate the liability — the opposite error, and the one a regulator
     * cares about.
     */
    execute.mockResolvedValue([[], []]);
    await getMonthRunIds("2026-08");
    const sql = String(execute.mock.calls[0][0]);
    expect(sql).not.toContain("finalized");
    expect(sql).not.toContain("processing");
  });
});

describe("resolveOutputRunIds", () => {
  it("returns the single run for a per-run request", async () => {
    execute.mockResolvedValueOnce([[{ id: "r1", run_month: "2026-08" }], []]);
    await expect(resolveOutputRunIds({ runId: "r1" })).resolves.toEqual({
      runIds: ["r1"],
      month: "2026-08",
      scope: "run",
    });
  });

  it("404s an unknown run rather than returning an empty document", async () => {
    execute.mockResolvedValueOnce([[], []]);
    await expect(resolveOutputRunIds({ runId: "nope" })).rejects.toMatchObject({
      code: "RUN_NOT_FOUND",
      statusCode: 404,
    });
  });

  it("returns every run for a per-month request", async () => {
    execute.mockResolvedValueOnce([[{ id: "r1" }, { id: "r2" }], []]);
    await expect(resolveOutputRunIds({ month: "2026-08" })).resolves.toMatchObject({
      runIds: ["r1", "r2"],
      scope: "month",
    });
  });

  it("rejects a malformed month before querying with it", async () => {
    await expect(resolveOutputRunIds({ month: "August" })).rejects.toMatchObject({ code: "BAD_MONTH" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a month with no runs instead of emitting an empty filing", async () => {
    /*
     * An empty ECR is indistinguishable from a month in which nobody had PF. Filing that is worse
     * than filing nothing, so the absence of runs is an error the caller must see.
     */
    execute.mockResolvedValueOnce([[], []]);
    await expect(resolveOutputRunIds({ month: "2026-08" })).rejects.toMatchObject({
      code: "NO_RUNS",
      statusCode: 404,
    });
  });

  it("carries statusCode, which is the property the error handler reads", () => {
    // errorHandler.ts reads `statusCode` and masks anything else as a generic 500 — a refusal the
    // user could act on turned into one they could not.
    expect(new MonthOutputError("X", "y", 409).statusCode).toBe(409);
  });
});

describe("runIdPlaceholders", () => {
  it("emits one bound placeholder per id and never the ids themselves", () => {
    expect(runIdPlaceholders(["a", "b", "c"])).toBe("?, ?, ?");
  });
});

describe("the routes serve both scopes from one handler", () => {
  for (const output of ["ecr", "esic-challan", "neft-export"]) {
    it(`registers /runs/:id/${output} and /month/:month/${output} against the same handler`, () => {
      const perRun = routes.match(new RegExp(`router\\.get\\("/runs/:id/${output}".*?,\\s*(\\w+)\\);`, "s"));
      const perMonth = routes.match(new RegExp(`router\\.get\\("/month/:month/${output}".*?,\\s*(\\w+)\\);`, "s"));
      expect(perRun, `per-run ${output} route`).toBeTruthy();
      expect(perMonth, `per-month ${output} route`).toBeTruthy();
      // Same handler identifier on both — one implementation, so they cannot drift.
      expect(perRun![1]).toBe(perMonth![1]);
    });
  }

  it("queries lines by a run-id list, not a single id", () => {
    // `run_id = ?` would silently return only the first run's lines for a month request.
    const ecr = routes.slice(routes.indexOf("const ecrHandler"), routes.indexOf("const esicChallanHandler"));
    expect(ecr).toContain("spl.run_id IN (");
    expect(ecr).not.toContain("spl.run_id = ?");
  });
});

describe("the month payment file applies every gate to every run", () => {
  /** The NEFT handler body. */
  const neft = routes.slice(
    routes.indexOf("const neftExportHandler"),
    routes.indexOf('router.get("/runs/:id/neft-export"'),
  );

  it("refuses when any run in scope is not closed", () => {
    expect(neft).toContain("runs.filter((r) => !isRunClosed(r.status))");
  });

  it("refuses when any run in scope is unvalidated", () => {
    expect(neft).toContain("r.validation_status !== 'validated'");
  });

  it("refuses when any run in scope lacks finance sign-off", () => {
    /*
     * The one that matters most. A file assembled from a mix of approved and unapproved runs moves
     * money nobody signed off, and the offending run is invisible in a CSV that looks complete.
     */
    expect(neft).toContain("runs.filter((r) => !r.finance_approved_by)");
    expect(neft).toContain("FINANCE_SIGNOFF_MISSING");
  });

  it("names the offending runs so the refusal is actionable", () => {
    // "Some run isn't approved" across six runs is not something a person can act on.
    expect(neft).toContain("runs: unsigned.map");
    expect(neft).toContain("runs: notClosed.map");
  });

  it("fails when a requested run id does not exist, rather than paying a subset", () => {
    expect(neft).toContain("runs.length !== neftRunIds.length");
  });
});
