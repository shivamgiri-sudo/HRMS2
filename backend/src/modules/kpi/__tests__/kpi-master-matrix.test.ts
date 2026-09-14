import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

import { getKpiTargetMatrix, resolveEmployeeKpis } from "../kpi-master.service.js";

const PROC_ONFIDO = "proc-onfido";
const DESIG_EXEC = "desig-exec";
const DESIG_TL = "desig-tl";
const DEPT_OPS = "dept-ops";

/** Two metrics deliberately share every scope, so a scope-only index would collapse them. */
const METRICS = [
  { id: "metric-dials", metric_code: "DIALS", metric_name: "Total Dials", unit: "count", direction: "higher_is_better", category: "productivity", actual_rows: 2113, config_rows: 97 },
  { id: "metric-talk", metric_code: "TALK_TIME", metric_name: "Average Talk Time", unit: "seconds", direction: "lower_is_better", category: "productivity", actual_rows: 2113, config_rows: 97 },
];

function setupMatrix(options: { pairs?: any[]; configs?: any[]; produced?: any[] } = {}) {
  const pairs = options.pairs ?? [
    {
      process_id: PROC_ONFIDO, process_name: "Onfido",
      designation_id: DESIG_EXEC, designation_name: "EXECUTIVE",
      headcount: 173, department_id: DEPT_OPS, cost_centre_id: null,
      department_variants: 1, cost_centre_variants: 1,
    },
    {
      process_id: PROC_ONFIDO, process_name: "Onfido",
      designation_id: DESIG_TL, designation_name: "TEAM LEADER",
      headcount: 12, department_id: DEPT_OPS, cost_centre_id: null,
      department_variants: 1, cost_centre_variants: 1,
    },
  ];
  dbExecute.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM employees") && sql.includes("designation_name")) return [pairs, []];
    if (sql.includes("FROM kpi_metric_master")) return [METRICS, []];
    if (sql.includes("FROM kpi_master_config")) return [options.configs ?? [], []];
    // Which metrics each process actually produces.
    if (sql.includes("FROM kpi_daily_actual")) return [options.produced ?? [], []];
    return [[], []];
  });
}

describe("KPI target matrix", () => {
  // Block body, not a concise arrow: mockReset() returns the mock itself, and Vitest treats a
  // function returned from beforeEach as a teardown callback — it would invoke dbExecute()
  // with no arguments after every test.
  beforeEach(() => {
    dbExecute.mockReset();
  });

  it("keeps metrics distinct when they share the same org scope", async () => {
    // Both rows are process-wide on Onfido. Indexing config by scope alone would let the
    // second overwrite the first and every column would show TALK_TIME's target.
    setupMatrix({
      configs: [
        { metric_id: "metric-dials", org_unit_type: "process", org_unit_id: PROC_ONFIDO, designation_id: null, target_value: "80.0000", min_threshold: "60.0000", max_achievement: "120.0000", weightage: "30.00" },
        { metric_id: "metric-talk", org_unit_type: "process", org_unit_id: PROC_ONFIDO, designation_id: null, target_value: "240.0000", min_threshold: "360.0000", max_achievement: "120.0000", weightage: "30.00" },
      ],
    });

    const matrix = await getKpiTargetMatrix();

    expect(matrix.cells[`${PROC_ONFIDO}|${DESIG_EXEC}|metric-dials`].target_value).toBe(80);
    expect(matrix.cells[`${PROC_ONFIDO}|${DESIG_EXEC}|metric-talk`].target_value).toBe(240);
  });

  it("prefers a designation-specific target over the process-wide one", async () => {
    setupMatrix({
      configs: [
        { metric_id: "metric-dials", org_unit_type: "process", org_unit_id: PROC_ONFIDO, designation_id: null, target_value: "80.0000", min_threshold: null, max_achievement: "120.0000", weightage: "30.00" },
        { metric_id: "metric-dials", org_unit_type: "process", org_unit_id: PROC_ONFIDO, designation_id: DESIG_TL, target_value: "40.0000", min_threshold: null, max_achievement: "120.0000", weightage: "30.00" },
      ],
    });

    const matrix = await getKpiTargetMatrix();

    const exec = matrix.cells[`${PROC_ONFIDO}|${DESIG_EXEC}|metric-dials`];
    const teamLeader = matrix.cells[`${PROC_ONFIDO}|${DESIG_TL}|metric-dials`];

    expect(exec.target_value).toBe(80);
    expect(exec.source).toBe("process");
    expect(teamLeader.target_value).toBe(40);
    expect(teamLeader.source).toBe("explicit");
  });

  it("falls back through designation and department when no process target exists", async () => {
    setupMatrix({
      configs: [
        { metric_id: "metric-dials", org_unit_type: "designation", org_unit_id: DESIG_EXEC, designation_id: null, target_value: "70.0000", min_threshold: null, max_achievement: "120.0000", weightage: "30.00" },
        { metric_id: "metric-talk", org_unit_type: "department", org_unit_id: DEPT_OPS, designation_id: null, target_value: "300.0000", min_threshold: null, max_achievement: "120.0000", weightage: "30.00" },
      ],
    });

    const matrix = await getKpiTargetMatrix();

    expect(matrix.cells[`${PROC_ONFIDO}|${DESIG_EXEC}|metric-dials`]).toMatchObject({ target_value: 70, source: "designation" });
    expect(matrix.cells[`${PROC_ONFIDO}|${DESIG_EXEC}|metric-talk`]).toMatchObject({ target_value: 300, source: "department" });
    // TEAM LEADER has no designation row of its own, so DIALS is genuinely unset for it.
    expect(matrix.cells[`${PROC_ONFIDO}|${DESIG_TL}|metric-dials`]).toMatchObject({ target_value: null, source: "none" });
  });

  it("flags pairs whose employees span several departments", async () => {
    setupMatrix({
      pairs: [{
        process_id: PROC_ONFIDO, process_name: "Onfido",
        designation_id: DESIG_EXEC, designation_name: "EXECUTIVE",
        headcount: 173, department_id: DEPT_OPS, cost_centre_id: null,
        department_variants: 3, cost_centre_variants: 1,
      }],
    });

    const matrix = await getKpiTargetMatrix();

    // An inherited department value shown for this pair does not apply to all 173 people,
    // so the UI must be able to say so rather than implying one number covers everyone.
    expect(matrix.pairs[0].inherit_varies).toBe(true);
  });

  it("marks a metric inapplicable when the process never reports it", async () => {
    // Processes do not share a metric set. CUSTOMER ACQUISITION reports attendance alone
    // while an e-commerce process reports thirteen metrics; a grid that offered every
    // metric everywhere would invite a sales target on a process with no sales feed.
    setupMatrix({ produced: [{ process_id: PROC_ONFIDO, metric_id: "metric-dials" }] });

    const matrix = await getKpiTargetMatrix();

    expect(matrix.cells[`${PROC_ONFIDO}|${DESIG_EXEC}|metric-dials`].applicable).toBe(true);
    expect(matrix.cells[`${PROC_ONFIDO}|${DESIG_EXEC}|metric-talk`].applicable).toBe(false);
  });

  it("treats an existing target as applicable even with no data behind it", async () => {
    // Otherwise a live configuration would silently vanish from the grid.
    setupMatrix({
      produced: [],
      configs: [
        { metric_id: "metric-talk", org_unit_type: "process", org_unit_id: PROC_ONFIDO, designation_id: null, target_value: "240.0000", min_threshold: null, max_achievement: "120.0000", weightage: "30.00" },
      ],
    });

    const matrix = await getKpiTargetMatrix();

    expect(matrix.cells[`${PROC_ONFIDO}|${DESIG_EXEC}|metric-talk`]).toMatchObject({ applicable: true, target_value: 240 });
    expect(matrix.cells[`${PROC_ONFIDO}|${DESIG_EXEC}|metric-dials`].applicable).toBe(false);
  });

  it("only offers metrics that have data or an existing target", async () => {
    setupMatrix({});
    await getKpiTargetMatrix();

    const metricQuery = dbExecute.mock.calls.map(([sql]) => String(sql)).find((sql) => sql.includes("FROM kpi_metric_master"));
    expect(metricQuery).toContain("COALESCE(a.n, 0) > 0 OR COALESCE(c.n, 0) > 0");
  });
});

describe("employee KPI resolution priority", () => {
  // Block body, not a concise arrow: mockReset() returns the mock itself, and Vitest treats a
  // function returned from beforeEach as a teardown callback — it would invoke dbExecute()
  // with no arguments after every test.
  beforeEach(() => {
    dbExecute.mockReset();
  });

  /** Captures the SELECT that gathers candidate configs, plus its bound params. */
  async function resolutionQuery(employee: Record<string, unknown>) {
    let captured: { sql: string; params: unknown[] } | null = null;
    dbExecute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM employees WHERE id")) return [[employee], []];
      if (sql.includes("FROM kpi_master_config")) {
        captured = { sql, params: params ?? [] };
        return [[], []];
      }
      return [[], []];
    });
    await resolveEmployeeKpis("emp-1");
    return captured!;
  }

  it("ranks a process+designation target above every other tier", async () => {
    const { sql } = await resolutionQuery({
      department_id: DEPT_OPS, designation_id: DESIG_TL, process_id: PROC_ONFIDO, cost_centre_id: null,
    });

    expect(sql).toContain("kmc.org_unit_type = 'process' AND kmc.org_unit_id = ? AND kmc.designation_id = ?");
    expect(sql).toContain("THEN 0");
  });

  it("constrains every lower tier to designation-agnostic rows", async () => {
    // Without the IS NULL guard the plain-process clause also matches the pair row, and
    // which one survives the per-metric dedup depends on row order rather than priority.
    const { sql } = await resolutionQuery({
      department_id: DEPT_OPS, designation_id: DESIG_TL, process_id: PROC_ONFIDO, cost_centre_id: "cc-1",
    });

    expect(sql).toContain("kmc.org_unit_type = 'process' AND kmc.org_unit_id = ? AND kmc.designation_id IS NULL");
    expect(sql).toContain("kmc.org_unit_type = 'cost_centre' AND kmc.org_unit_id = ? AND kmc.designation_id IS NULL");
    expect(sql).toContain("kmc.org_unit_type = 'department' AND kmc.org_unit_id = ? AND kmc.designation_id IS NULL");
  });

  it("omits the pair tier when the employee has no designation", async () => {
    const { sql, params } = await resolutionQuery({
      department_id: DEPT_OPS, designation_id: null, process_id: PROC_ONFIDO, cost_centre_id: null,
    });

    expect(sql).not.toContain("kmc.designation_id = ?");
    expect(params).toEqual([PROC_ONFIDO, DEPT_OPS]);
  });
});
