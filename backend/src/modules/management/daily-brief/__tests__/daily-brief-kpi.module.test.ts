import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

import { buildKpiPerformanceModule } from "../daily-brief-kpi.module.js";

describe("daily-brief-kpi.module: direction handling", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("higher_is_better: D-1 value at/above target is above_or_at_target", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM kpi_daily_actual kda") && sql.includes("kpi_process_config kpc")) {
        return [[{
          employee_id: "e1", employee_code: "MAS001", full_name: "Alice",
          metric_id: "m1", metric_code: "CSAT", metric_name: "Customer Satisfaction",
          direction: "higher_is_better", d1_value: 92, target_value: 90, min_threshold: 70,
        }]];
      }
      if (sql.includes("GROUP BY employee_id, metric_id")) return [[]];
      if (sql.includes("FROM performance_alert")) return [[]];
      if (sql.includes("FROM coaching_session")) return [[]];
      if (sql.includes("FROM training_need")) return [[]];
      return [[]];
    });

    const result = await buildKpiPerformanceModule(["e1"], "2026-08-18");
    expect(result.employeeSignals).toHaveLength(1);
    expect(result.employeeSignals[0].observation).toBe("above_or_at_target");
    expect(result.employeeSignals[0].note).toContain("At or above configured target");

    const kpiHealth = result.sourceHealth.find((h) => h.module === "kpi_performance");
    expect(kpiHealth?.state).toBe("AVAILABLE");
  });

  it("lower_is_better: D-1 value above target is below_target (worse), not above_or_at_target", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM kpi_daily_actual kda") && sql.includes("kpi_process_config kpc")) {
        return [[{
          employee_id: "e1", employee_code: "MAS001", full_name: "Alice",
          metric_id: "m2", metric_code: "AHT", metric_name: "Average Handle Time",
          direction: "lower_is_better", d1_value: 400, target_value: 300, min_threshold: null,
        }]];
      }
      if (sql.includes("GROUP BY employee_id, metric_id")) return [[]];
      if (sql.includes("FROM performance_alert")) return [[]];
      if (sql.includes("FROM coaching_session")) return [[]];
      if (sql.includes("FROM training_need")) return [[]];
      return [[]];
    });

    const result = await buildKpiPerformanceModule(["e1"], "2026-08-18");
    expect(result.employeeSignals[0].observation).toBe("below_target");
    expect(result.employeeSignals[0].note).toContain("Below configured target");
  });

  it("lower_is_better: D-1 value below target is above_or_at_target (better)", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM kpi_daily_actual kda") && sql.includes("kpi_process_config kpc")) {
        return [[{
          employee_id: "e1", employee_code: "MAS001", full_name: "Alice",
          metric_id: "m2", metric_code: "AHT", metric_name: "Average Handle Time",
          direction: "lower_is_better", d1_value: 250, target_value: 300, min_threshold: null,
        }]];
      }
      if (sql.includes("GROUP BY employee_id, metric_id")) return [[]];
      if (sql.includes("FROM performance_alert")) return [[]];
      if (sql.includes("FROM coaching_session")) return [[]];
      if (sql.includes("FROM training_need")) return [[]];
      return [[]];
    });

    const result = await buildKpiPerformanceModule(["e1"], "2026-08-18");
    expect(result.employeeSignals[0].observation).toBe("above_or_at_target");
  });

  it("no kpi_process_config row: reports observation_only, never invents pass/fail", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM kpi_daily_actual kda") && sql.includes("kpi_process_config kpc")) {
        return [[{
          employee_id: "e1", employee_code: "MAS001", full_name: "Alice",
          metric_id: "m3", metric_code: "FCR", metric_name: "First Call Resolution",
          direction: "higher_is_better", d1_value: 55, target_value: null, min_threshold: null,
        }]];
      }
      if (sql.includes("GROUP BY employee_id, metric_id")) return [[]];
      if (sql.includes("FROM performance_alert")) return [[]];
      if (sql.includes("FROM coaching_session")) return [[]];
      if (sql.includes("FROM training_need")) return [[]];
      return [[]];
    });

    const result = await buildKpiPerformanceModule(["e1"], "2026-08-18");
    expect(result.employeeSignals[0].observation).toBe("observation_only");
    expect(result.employeeSignals[0].note).toContain("observation only");
  });

  it("a thrown KPI query error yields sourceHealth = ERROR, not a silent zero", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM kpi_daily_actual kda") && sql.includes("kpi_process_config kpc")) {
        throw new Error("ER_NO_SUCH_TABLE: simulated failure");
      }
      if (sql.includes("FROM performance_alert")) return [[]];
      if (sql.includes("FROM coaching_session")) return [[]];
      if (sql.includes("FROM training_need")) return [[]];
      return [[]];
    });

    const result = await buildKpiPerformanceModule(["e1"], "2026-08-18");
    const kpiHealth = result.sourceHealth.find((h) => h.module === "kpi_performance");
    expect(kpiHealth?.state).toBe("ERROR");
    expect(kpiHealth?.detail).toContain("simulated failure");
    expect(result.employeeSignals).toEqual([]);
  });

  it("a thrown performance_alert query error yields ERROR for that module only", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM kpi_daily_actual kda") && sql.includes("kpi_process_config kpc")) return [[]];
      if (sql.includes("GROUP BY employee_id, metric_id")) return [[]];
      if (sql.includes("FROM performance_alert")) throw new Error("simulated alert failure");
      if (sql.includes("FROM coaching_session")) return [[]];
      if (sql.includes("FROM training_need")) return [[]];
      return [[]];
    });

    const result = await buildKpiPerformanceModule(["e1"], "2026-08-18");
    const alertHealth = result.sourceHealth.find((h) => h.module === "performance_alerts");
    const kpiHealth = result.sourceHealth.find((h) => h.module === "kpi_performance");
    expect(alertHealth?.state).toBe("ERROR");
    expect(kpiHealth?.state).toBe("NO_DATA");
  });

  it("empty team scope yields NOT_APPLICABLE across all sub-modules without querying", async () => {
    const result = await buildKpiPerformanceModule([], "2026-08-18");
    expect(result.sourceHealth.every((h) => h.state === "NOT_APPLICABLE")).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });
});
