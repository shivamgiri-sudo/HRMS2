import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
vi.mock("../src/db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));

const { getProcessMetricDefinitions, getComparableDefinitions } = await import(
  "../src/modules/kpi/process-metric-definition.service.js"
);

/**
 * All 97 processes carrying KPI config hold the identical three metrics with
 * exactly ONE distinct target value between them, because
 * kpi_metric_master.metric_code is globally unique and nothing let a process
 * name its own. Live quality ranges 23.7% to 72.7% across the ten active
 * clients, so a shared target is meaningless.
 *
 * Migration 1046 adds the per-process definition. These pin the two rules that
 * make it safe: the label a process uses is what gets shown, and a metric that
 * means something different per process never reaches a cross-process average.
 */

const canonical = {
  id: "def-1", process_id: "proc-1", local_code: null, display_name: "CX Score",
  unit: null, direction: null, display_order: 10, weightage: 40, is_fatal: 0,
  metric_code: "QUALITY_SCORE", canonical_unit: "percent", canonical_direction: "higher_is_better",
};
const processLocal = {
  id: "def-2", process_id: "proc-1", local_code: "GREETING_ADHERENCE", display_name: "Greeting Adherence",
  unit: "percent", direction: "higher_is_better", display_order: 20, weightage: 60, is_fatal: 1,
  metric_code: null, canonical_unit: null, canonical_direction: null,
};

beforeEach(() => execute.mockReset());

describe("per-process metric definitions", () => {
  it("shows the name THIS process uses, not the canonical code", () => {
    // The whole point: internally QUALITY_SCORE, on the Neemans dashboard "CX Score".
    execute.mockResolvedValue([[canonical], []]);
    return getProcessMetricDefinitions("proc-1", "2026-08-01").then(([d]) => {
      expect(d.displayName).toBe("CX Score");
      expect(d.metricCode).toBe("QUALITY_SCORE");
    });
  });

  it("inherits unit and direction from the canonical metric", async () => {
    // One edit on kpi_metric_master stays authoritative for every process.
    execute.mockResolvedValue([[canonical], []]);
    const [d] = await getProcessMetricDefinitions("proc-1", "2026-08-01");
    expect(d.unit).toBe("percent");
    expect(d.direction).toBe("higher_is_better");
  });

  it("uses the local unit and direction when there is no canonical peer", async () => {
    // Without these a process-local value cannot be formatted or scored — "62"
    // says nothing without knowing it is a percentage and higher is better.
    execute.mockResolvedValue([[processLocal], []]);
    const [d] = await getProcessMetricDefinitions("proc-1", "2026-08-01");
    expect(d.unit).toBe("percent");
    expect(d.direction).toBe("higher_is_better");
    expect(d.localCode).toBe("GREETING_ADHERENCE");
  });

  it("marks process-local metrics as not comparable across processes", async () => {
    execute.mockResolvedValue([[canonical, processLocal], []]);
    const defs = await getProcessMetricDefinitions("proc-1", "2026-08-01");
    expect(defs.map((d) => d.comparableAcrossProcesses)).toEqual([true, false]);
  });

  it("keeps process-local metrics out of cross-process aggregates", async () => {
    // A parameter that means something different per process must not be
    // averaged with one that does not.
    execute.mockResolvedValue([[canonical, processLocal], []]);
    const comparable = await getComparableDefinitions("proc-1", "2026-08-01");
    expect(comparable).toHaveLength(1);
    expect(comparable[0].metricCode).toBe("QUALITY_SCORE");
  });

  it("carries the fatal flag, which zeroes an audit regardless of other scores", async () => {
    execute.mockResolvedValue([[processLocal], []]);
    const [d] = await getProcessMetricDefinitions("proc-1", "2026-08-01");
    expect(d.isFatal).toBe(true);
  });
});

describe("effective dating", () => {
  it("asks only for definitions in force on the given date", async () => {
    // kpi_master_config upserts in place, so changing a target silently
    // rewrites history. This must not repeat that.
    execute.mockResolvedValue([[], []]);
    await getProcessMetricDefinitions("proc-1", "2026-03-15");

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/effective_from\s*<=\s*\?/);
    expect(sql).toMatch(/effective_to IS NULL OR d\.effective_to >= \?/);
    expect(params).toEqual(["proc-1", "2026-03-15", "2026-03-15"]);
  });

  it("excludes deactivated definitions", async () => {
    execute.mockResolvedValue([[], []]);
    await getProcessMetricDefinitions("proc-1", "2026-08-01");
    expect(execute.mock.calls[0][0]).toMatch(/active_status = 1/);
  });

  it("returns definitions in the order the process configured", async () => {
    execute.mockResolvedValue([[], []]);
    await getProcessMetricDefinitions("proc-1", "2026-08-01");
    expect(execute.mock.calls[0][0]).toMatch(/ORDER BY d\.display_order ASC/);
  });
});
