import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
vi.mock("../src/db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));
vi.mock("../src/modules/kpi/kpi-score-engine.js", () => ({
  calculateMetricScore: () => ({ metricScore: 0, weightedScore: 0, status: "calculated", note: "" }),
}));

const { resolveEmployeeKpis, resetEffectiveDatingSupport } = await import(
  "../src/modules/kpi/kpi-master.service.js"
);

/**
 * kpi_master_config upserts in place, so editing a target rewrites history: a
 * score computed in June against a target of 80 later reports as having been
 * measured against 95, and a performance conversation cannot separate "the
 * agent got worse" from "we raised the bar". Migration 1048 adds
 * effective_from / effective_to.
 *
 * The guard here is not defensive padding. Production runs SKIP_MIGRATIONS=true,
 * so this code can ship before 1048 is applied, and an unconditional date
 * predicate would make every KPI resolution fail with ER_BAD_FIELD_ERROR. That
 * exact sequence took reimbursements down from the day it shipped.
 */

const EMPLOYEE = [[{ department_id: "d1", designation_id: "des1", process_id: "p1", cost_centre_id: null }], []];

function columnsPresent(n: number) {
  return [[{ n }], []];
}

beforeEach(() => {
  execute.mockReset();
  resetEffectiveDatingSupport();
});

describe("undated rows must still resolve", () => {
  it("treats a NULL effective_from as 'always applied', not as excluded", async () => {
    // Both columns already existed on production — nullable, and NULL on all 372
    // rows. The first version of this predicate read `effective_from <= CURDATE()`,
    // so the support check found the columns, switched the filter on, and
    // NULL <= CURDATE() is never true. Every target row would have been filtered
    // out and every employee would have resolved to zero KPIs.
    //
    // Caught by executing the migration against a clone of production rather
    // than reading it.
    execute
      .mockResolvedValueOnce(EMPLOYEE)
      .mockResolvedValueOnce(columnsPresent(2))
      .mockResolvedValueOnce([[], []]);

    await resolveEmployeeKpis("emp-1");

    const sql = String(execute.mock.calls[2][0]);
    expect(sql).toMatch(/kmc\.effective_from IS NULL OR kmc\.effective_from <= CURDATE\(\)/);
    // The bare form must not survive anywhere in the predicate.
    expect(sql).not.toMatch(/AND kmc\.effective_from <= CURDATE\(\)/);
  });
});

describe("target resolution when the migration has been applied", () => {
  it("restricts to the version in force today", async () => {
    execute
      .mockResolvedValueOnce(EMPLOYEE)      // employee org units
      .mockResolvedValueOnce(columnsPresent(2)) // both columns exist
      .mockResolvedValueOnce([[], []]);     // candidates

    await resolveEmployeeKpis("emp-1");

    const resolutionSql = String(execute.mock.calls[2][0]);
    expect(resolutionSql).toMatch(/kmc\.effective_from <= CURDATE\(\)/);
    expect(resolutionSql).toMatch(/kmc\.effective_to IS NULL OR kmc\.effective_to >= CURDATE\(\)/);
  });
});

describe("target resolution before 1048 is applied", () => {
  it("omits the date predicate entirely rather than erroring", async () => {
    // The whole point of the check: SKIP_MIGRATIONS=true means the column may
    // simply not be there yet, and every KPI read must keep working.
    execute
      .mockResolvedValueOnce(EMPLOYEE)
      .mockResolvedValueOnce(columnsPresent(0))
      .mockResolvedValueOnce([[], []]);

    await resolveEmployeeKpis("emp-1");
    expect(String(execute.mock.calls[2][0])).not.toMatch(/effective_from/);
  });

  it("treats a partially applied migration as unsupported", async () => {
    // One column of two means the ALTER did not complete. Filtering on a column
    // that may not exist is worse than not filtering.
    execute
      .mockResolvedValueOnce(EMPLOYEE)
      .mockResolvedValueOnce(columnsPresent(1))
      .mockResolvedValueOnce([[], []]);

    await resolveEmployeeKpis("emp-1");
    expect(String(execute.mock.calls[2][0])).not.toMatch(/effective_from/);
  });

  it("degrades to unsupported if the column check itself fails", async () => {
    execute
      .mockResolvedValueOnce(EMPLOYEE)
      .mockImplementationOnce(() => Promise.reject(new Error("information_schema unavailable")))
      .mockResolvedValueOnce([[], []]);

    await resolveEmployeeKpis("emp-1");
    expect(String(execute.mock.calls[2][0])).not.toMatch(/effective_from/);
  });
});

describe("the support check is cached", () => {
  it("does not re-query INFORMATION_SCHEMA on every resolution", async () => {
    // resolveEmployeeKpis is called once per direct report by getTeamKpiSummary,
    // so an uncached check would add a metadata query per employee per request.
    execute
      .mockResolvedValueOnce(EMPLOYEE).mockResolvedValueOnce(columnsPresent(2)).mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce(EMPLOYEE).mockResolvedValueOnce([[], []]);

    await resolveEmployeeKpis("emp-1");
    await resolveEmployeeKpis("emp-2");

    const schemaChecks = execute.mock.calls.filter(([sql]) =>
      /INFORMATION_SCHEMA\.COLUMNS/i.test(String(sql)),
    );
    expect(schemaChecks).toHaveLength(1);
  });
});
