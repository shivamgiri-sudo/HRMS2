import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Process-grain preview — the builder's "test it" button for a metric with no employee.
 *
 * The properties under protection are the ones that make a preview trustworthy:
 *  - it must not silently look like "your formula found nothing" when the real
 *    problem is an unapplied migration or an unmapped source;
 *  - it must read through the SAME path the nightly compute reads through, so a
 *    formula that previews cannot then fail overnight for an unshown reason;
 *  - the headline average must skip days that produced nothing rather than
 *    counting them as zero, which would understate every metric it previews.
 */
const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { query: vi.fn(), execute: (...args: unknown[]) => execute(...args) } }));

const capability = vi.fn();
const readProcessGrainValues = vi.fn();
vi.mock("../kpi-studio.service.js", () => ({
  getStudioCapability: () => capability(),
  listDefinitions: vi.fn(),
  resolveStudioForEmployee: vi.fn(),
  // Every definition reads exactly its own primary source in these tests; the
  // extra-source fan-out has its own file.
  getDefinitionSourceIds: async (defs: Array<{ id: string; data_source_id: string }>) =>
    new Map(defs.map((d) => [d.id, [d.data_source_id]])),
  StudioNotInstalledError: class extends Error {},
}));
vi.mock("../kpi-studio.sources.js", () => ({
  readMergedSourceValues: vi.fn(),
  readSourceValues: vi.fn(),
  readProcessGrainValues: (...args: unknown[]) => readProcessGrainValues(...args),
}));

const { previewProcessFormula } = await import("../kpi-studio.compute.js");

const INSTALLED = { tables: true, resolution: true, processGrain: true, fieldFilters: true };

/** Two rows back from the source-and-fields load loadSourcesWithFields performs. */
function sourceLoads(source: Record<string, unknown>, fields: Record<string, unknown>[]) {
  execute.mockReset();
  execute
    .mockResolvedValueOnce([[source], []])
    .mockResolvedValueOnce([fields, []]);
}

const SOURCE = {
  id: "s1", source_code: "DIALER_IN", source_name: "Dialer inbound",
  source_type: "integration_connector", integration_key: "dialer_db",
  source_object: "cdr_in_10_4", date_column: "CallDate",
  process_key_kind: "constant", process_id: "p-bla",
};
const FIELDS = [
  { id: "f1", data_source_id: "s1", field_name: "answered", source_column: "a", aggregate_fn: "SUM" },
  { id: "f2", data_source_id: "s1", field_name: "offered", source_column: "b", aggregate_fn: "SUM" },
];

beforeEach(() => {
  capability.mockReset();
  readProcessGrainValues.mockReset();
  capability.mockResolvedValue(INSTALLED);
});

describe("previewProcessFormula", () => {
  it("names the missing migration instead of reporting an empty result", async () => {
    capability.mockResolvedValue({ ...INSTALLED, processGrain: false });
    const result = await previewProcessFormula({
      formula: "PCT(answered, offered)", dataSourceId: "s1", from: "2026-08-01", to: "2026-08-03",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("1680_kpi_studio_process_grain.sql");
    // The distinction that matters: this is not "no data".
    expect(result.days).toHaveLength(0);
  });

  it("says the source is not mapped to a process, rather than returning nothing", async () => {
    sourceLoads({ ...SOURCE, process_id: null }, FIELDS);
    readProcessGrainValues.mockResolvedValue({ values: new Map(), rowsRead: 0 });
    const result = await previewProcessFormula({
      formula: "PCT(answered, offered)", dataSourceId: "s1", from: "2026-08-01", to: "2026-08-03",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("mapped to a process");
  });

  it("computes a value per day and reports the inputs that produced it", async () => {
    sourceLoads(SOURCE, FIELDS);
    readProcessGrainValues.mockResolvedValue({
      rowsRead: 2,
      values: new Map([
        ["2026-08-01", new Map([["answered", 97], ["offered", 100]])],
        ["2026-08-02", new Map([["answered", 98], ["offered", 100]])],
      ]),
    });
    const result = await previewProcessFormula({
      formula: "PCT(answered, offered)", dataSourceId: "s1", from: "2026-08-01", to: "2026-08-02",
    });
    expect(result.ok).toBe(true);
    expect(result.days.map((day) => day.date)).toEqual(["2026-08-01", "2026-08-02"]);
    expect(result.days[0].value).toBeCloseTo(97);
    expect(result.days[0].inputs).toEqual({ answered: 97, offered: 100 });
    expect(result.value).toBeCloseTo(97.5);
    expect(result.process_id).toBe("p-bla");
    expect(result.rows_read).toBe(2);
  });

  it("averages only the days that produced a number", async () => {
    sourceLoads(SOURCE, FIELDS);
    readProcessGrainValues.mockResolvedValue({
      rowsRead: 3,
      values: new Map([
        ["2026-08-01", new Map([["answered", 90], ["offered", 100]])],
        // Nothing was measured on the 2nd. Counting it as 0 would drag the
        // headline to 45 and make a healthy metric look broken.
        ["2026-08-02", new Map([["answered", null], ["offered", null]])],
      ]),
    });
    const result = await previewProcessFormula({
      formula: "PCT(answered, offered)", dataSourceId: "s1", from: "2026-08-01", to: "2026-08-02",
    });
    expect(result.value).toBeCloseTo(90);
    expect(result.days[1].status).toBe("no_data");
  });

  it("reports a broken formula as an error on the day, not as no_data", async () => {
    sourceLoads(SOURCE, FIELDS);
    readProcessGrainValues.mockResolvedValue({
      rowsRead: 1,
      values: new Map([["2026-08-01", new Map([["answered", 5], ["offered", 10]])]]),
    });
    const result = await previewProcessFormula({
      formula: "PCT(answered, nonexistent_field)", dataSourceId: "s1", from: "2026-08-01", to: "2026-08-01",
    });
    expect(result.days[0].status).toBe("error");
    expect(result.days[0].value).toBeNull();
  });

  it("carries a source failure through instead of swallowing it", async () => {
    sourceLoads(SOURCE, FIELDS);
    readProcessGrainValues.mockResolvedValue({ values: new Map(), rowsRead: 0, error: "Unknown column 'CallDate'" });
    const result = await previewProcessFormula({
      formula: "PCT(answered, offered)", dataSourceId: "s1", from: "2026-08-01", to: "2026-08-01",
    });
    expect(result.source_error).toContain("Unknown column 'CallDate'");
    expect(result.message).toContain("could not be read");
  });

  it("refuses a backwards date range", async () => {
    const result = await previewProcessFormula({
      formula: "answered", dataSourceId: "s1", from: "2026-08-31", to: "2026-08-01",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("after the end date");
  });

  it("reads the whole range in ONE call, not one call per day", async () => {
    sourceLoads(SOURCE, FIELDS);
    readProcessGrainValues.mockResolvedValue({
      rowsRead: 1,
      values: new Map([["2026-08-01", new Map([["answered", 1], ["offered", 2]])]]),
    });
    await previewProcessFormula({
      formula: "PCT(answered, offered)", dataSourceId: "s1", from: "2026-08-01", to: "2026-08-31",
    });
    expect(readProcessGrainValues).toHaveBeenCalledTimes(1);
    // Dates in positions 2 and 3; a 4th argument carries the process for a source
    // that finds it through the employee, so the range is asserted by position.
    expect(readProcessGrainValues.mock.calls[0].slice(2, 4)).toEqual(["2026-08-01", "2026-08-31"]);
  });
});

/**
 * A compute run scoped to one process.
 *
 * A process-grain definition takes its process from the SOURCE's mapping rather
 * than its own scope, so nothing about the definition row says which client it
 * belongs to. Before this, `compute --process X` read every process-grain source
 * in the system: wasteful on a 19.8M-row agent log, and worse than wasteful when
 * a rerun for one client rewrites another's figures from whatever their source
 * returns at that moment.
 */
describe("computeStudioKpis honours a process filter", () => {
  it("skips a definition whose source belongs to a different process", async () => {
    const { computeStudioKpis } = await import("../kpi-studio.compute.js");
    capability.mockResolvedValue(INSTALLED);
    readProcessGrainValues.mockReset();

    execute.mockReset();
    execute.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.includes("FROM kpi_studio_definition d")) {
        return Promise.resolve([
          [{
            id: "d1", metric_id: "m1", metric_code: "OTHER_CLIENT_METRIC",
            data_source_id: "s1", formula_expression: "answered", grain: "process",
            effective_from: "2026-08-01", branch_id: null, process_id: null,
            designation_id: null, employee_id: null,
          }],
          [],
        ]);
      }
      if (text.includes("FROM kpi_studio_data_source")) {
        // Mapped to p-other, not the p-wanted the caller asked for.
        return Promise.resolve([[{ ...SOURCE, id: "s1", process_id: "p-other" }], []]);
      }
      if (text.includes("FROM kpi_studio_source_field")) return Promise.resolve([FIELDS, []]);
      return Promise.resolve([[], []]);
    });

    await computeStudioKpis({ date: "2026-08-05", processId: "p-wanted", dryRun: true });

    // The decisive assertion: the other client's source was never read at all.
    expect(readProcessGrainValues).not.toHaveBeenCalled();
  });
});

/**
 * Which formulas can have a period figure computed exactly.
 *
 * Summing a numerator and a denominator across days and dividing reconstructs the
 * period's real ratio ONLY while both sides are linear in the inputs. A ratio of
 * two sums qualifies; a CLAMP or a threshold does not, and claiming otherwise
 * would produce a figure that looks exact and is not — worse than the average it
 * would replace.
 */
describe("ratioParts", () => {
  it("takes the two bare fields of a simple ratio", async () => {
    const { ratioParts } = await import("../kpi-studio.compute.js");
    expect(ratioParts("PCT(answered, offered)", { answered: 97, offered: 100 }))
      .toEqual({ numerator: 9700, denominator: 100 });
  });

  it("handles a compound ratio, which is how occupancy is written", async () => {
    const { ratioParts } = await import("../kpi-studio.compute.js");
    // PCT(talk + dispo, talk + dispo + wait): both sides are sums of fields, so
    // summing them over a month still divides to the month's real occupancy.
    expect(ratioParts("PCT(talk + dispo, talk + dispo + wait)", { talk: 60, dispo: 20, wait: 20 }))
      .toEqual({ numerator: 8000, denominator: 100 });
  });

  it("leaves SAFE_DIV unscaled, unlike PCT", async () => {
    const { ratioParts } = await import("../kpi-studio.compute.js");
    expect(ratioParts("SAFE_DIV(total_sec, calls)", { total_sec: 500, calls: 10 }))
      .toEqual({ numerator: 500, denominator: 10 });
  });

  it("refuses a formula whose parts do not survive being summed", async () => {
    const { ratioParts } = await import("../kpi-studio.compute.js");
    const inputs = { a: 5, b: 10, c: 2 };
    // A clamp, a banded IF and a multiplied term are all non-additive.
    expect(ratioParts("CLAMP(PCT(a, b), 0, 100)", inputs)).toBeNull();
    expect(ratioParts("IF(a > 3, PCT(a, b), 0)", inputs)).toBeNull();
    expect(ratioParts("PCT(a * c, b)", inputs)).toBeNull();
  });

  it("refuses a day whose inputs are missing or whose denominator is zero", async () => {
    const { ratioParts } = await import("../kpi-studio.compute.js");
    expect(ratioParts("PCT(a, b)", { a: null, b: 10 })).toBeNull();
    expect(ratioParts("PCT(a, b)", { a: 5, b: 0 })).toBeNull();
  });
});

/**
 * A day that stops having a reading must say so.
 *
 * Skipping the write on no_data left the previous value in place, so a
 * correction never reached the table: excluding implausible 24-hour biometric
 * shifts turned several days into no_data, and those days went on showing the
 * very averages the exclusion existed to remove.
 */
describe("no_data clears a stale reading", () => {
  it("writes NULL over the previous value rather than leaving it", async () => {
    const { computeStudioKpis } = await import("../kpi-studio.compute.js");
    capability.mockResolvedValue(INSTALLED);
    readProcessGrainValues.mockReset();
    readProcessGrainValues.mockResolvedValue({
      rowsRead: 1,
      // Read successfully; the formula simply has nothing to divide.
      values: new Map([["2026-06-10", new Map([["answered", null], ["offered", null]])]]),
    });

    execute.mockReset();
    execute.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.includes("FROM kpi_studio_definition d")) {
        return Promise.resolve([[{
          id: "d1", metric_id: "m1", metric_code: "SHIFT_MINUTES_AVG",
          data_source_id: "s1", formula_expression: "PCT(answered, offered)", grain: "process",
          effective_from: "2026-06-01", branch_id: null, process_id: "p1",
          designation_id: null, employee_id: null,
        }], []]);
      }
      if (text.includes("FROM kpi_studio_data_source")) return Promise.resolve([[{ ...SOURCE, id: "s1", process_id: "p1" }], []]);
      if (text.includes("FROM kpi_studio_source_field")) return Promise.resolve([FIELDS, []]);
      if (text.includes("INFORMATION_SCHEMA.COLUMNS")) return Promise.resolve([[{ n: 2 }], []]);
      return Promise.resolve([[], []]);
    });

    const out = await computeStudioKpis({ date: "2026-06-10", processId: "p1", dryRun: false });
    expect(out.no_data).toBe(1);

    const cleared = execute.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE process_metric_actual") && String(sql).includes("actual_value = NULL"));
    expect(cleared).toBeTruthy();
    expect(cleared?.[1]).toContain("p1");
    expect(cleared?.[1]).toContain("2026-06-10");
  });

  it("writes nothing at all on a dry run", async () => {
    const { computeStudioKpis } = await import("../kpi-studio.compute.js");
    capability.mockResolvedValue(INSTALLED);
    readProcessGrainValues.mockReset();
    readProcessGrainValues.mockResolvedValue({
      rowsRead: 1,
      values: new Map([["2026-06-10", new Map([["answered", null], ["offered", null]])]]),
    });
    execute.mockReset();
    execute.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.includes("FROM kpi_studio_definition d")) {
        return Promise.resolve([[{
          id: "d1", metric_id: "m1", metric_code: "SHIFT_MINUTES_AVG",
          data_source_id: "s1", formula_expression: "PCT(answered, offered)", grain: "process",
          effective_from: "2026-06-01", branch_id: null, process_id: "p1",
          designation_id: null, employee_id: null,
        }], []]);
      }
      if (text.includes("FROM kpi_studio_data_source")) return Promise.resolve([[{ ...SOURCE, id: "s1", process_id: "p1" }], []]);
      if (text.includes("FROM kpi_studio_source_field")) return Promise.resolve([FIELDS, []]);
      return Promise.resolve([[], []]);
    });

    await computeStudioKpis({ date: "2026-06-10", processId: "p1", dryRun: true });
    expect(execute.mock.calls.some(([sql]) => String(sql).includes("UPDATE process_metric_actual"))).toBe(false);
  });
});
