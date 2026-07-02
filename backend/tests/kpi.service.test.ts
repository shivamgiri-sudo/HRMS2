import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) }, pingDb: vi.fn() }));
vi.mock("../src/modules/engagement/badge.service.js", () => ({ queueAutoAwards: vi.fn() }));

import { db } from "../src/db/mysql.js";
import { kpiService } from "../src/modules/kpi/kpi.service.js";

const exec = db.execute as ReturnType<typeof vi.fn>;

const fakeMetric = { id: "met-1", metric_code: "AHT", metric_name: "Avg Handle Time", category: "operations", unit: "seconds", direction: "lower_is_better", active_status: 1 };
const fakeTemplate = { id: "tpl-1", template_name: "Ops Agent BPO", description: null, active_status: 1 };
const fakeTplMetric = { id: "tm-1", template_id: "tpl-1", metric_id: "met-1", target_value: 300, weight_pct: 40 };
const fakeAssignment = { id: "asgn-1", template_id: "tpl-1", designation_id: "des-1", department_id: null, employee_id: null };
const fakeScore = { id: "sc-1", employee_id: "emp-1", metric_id: "met-1", period: "2026-05", actual_value: 280, source: "manual" };

beforeEach(() => vi.clearAllMocks());

// ─── Metrics ──────────────────────────────────────────────────────────────────

describe("kpiService.listMetrics", () => {
  it("returns all active metrics", async () => {
    exec.mockResolvedValueOnce([[fakeMetric], []]);
    const r = await kpiService.listMetrics();
    expect(r[0].metric_code).toBe("AHT");
  });
});

describe("kpiService.createMetric", () => {
  it("throws on duplicate metric_code", async () => {
    exec.mockResolvedValueOnce([[fakeMetric], []]);
    await expect(kpiService.createMetric({
      metricCode: "AHT", metricName: "X", category: "operations", unit: "seconds", direction: "lower_is_better",
    }, "user-1")).rejects.toThrow("Metric code already exists");
  });

  it("creates metric", async () => {
    exec.mockResolvedValueOnce([[], []]);
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    exec.mockResolvedValueOnce([[fakeMetric], []]);
    const r = await kpiService.createMetric({
      metricCode: "AHT", metricName: "Avg Handle Time", category: "operations", unit: "seconds", direction: "lower_is_better",
    }, "user-1");
    expect(r.metric_code).toBe("AHT");
  });
});

// ─── Templates ────────────────────────────────────────────────────────────────

describe("kpiService.listTemplates", () => {
  it("returns templates", async () => {
    exec.mockResolvedValueOnce([[fakeTemplate], []]);
    const r = await kpiService.listTemplates();
    expect(r[0].template_name).toBe("Ops Agent BPO");
  });
});

describe("kpiService.createTemplate", () => {
  it("creates template", async () => {
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    exec.mockResolvedValueOnce([[fakeTemplate], []]);
    const r = await kpiService.createTemplate({ templateName: "Ops Agent BPO" }, "user-1");
    expect(r.template_name).toBe("Ops Agent BPO");
  });
});

// ─── Template Metrics (targets + weights) ────────────────────────────────────

describe("kpiService.addTemplateMetric", () => {
  it("adds metric with target and weight to template", async () => {
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    exec.mockResolvedValueOnce([[fakeTplMetric], []]);
    const r = await kpiService.addTemplateMetric({
      templateId: "tpl-1", metricId: "met-1", targetValue: 300, weightPct: 40,
    }, "user-1");
    expect(r.target_value).toBe(300);
    expect(r.weight_pct).toBe(40);
  });

  it("updates existing template metric on duplicate (upsert)", async () => {
    exec.mockResolvedValueOnce([{ affectedRows: 2 }, []]);
    exec.mockResolvedValueOnce([[{ ...fakeTplMetric, target_value: 280 }], []]);
    const r = await kpiService.addTemplateMetric({
      templateId: "tpl-1", metricId: "met-1", targetValue: 280, weightPct: 40,
    }, "user-1");
    expect(r.target_value).toBe(280);
  });
});

describe("kpiService.listTemplateMetrics", () => {
  it("returns metrics for template with target and weight", async () => {
    exec.mockResolvedValueOnce([[{ ...fakeTplMetric, metric_code: "AHT", metric_name: "Avg Handle Time" }], []]);
    const r = await kpiService.listTemplateMetrics("tpl-1");
    expect(r[0].metric_code).toBe("AHT");
    expect(r[0].weight_pct).toBe(40);
  });
});

// ─── Assignments ──────────────────────────────────────────────────────────────

describe("kpiService.assignTemplate", () => {
  it("assigns template to designation", async () => {
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    exec.mockResolvedValueOnce([[fakeAssignment], []]);
    const r = await kpiService.assignTemplate({
      templateId: "tpl-1", designationId: "des-1",
    }, "user-1");
    expect(r.designation_id).toBe("des-1");
  });

  it("assigns template to individual employee (override)", async () => {
    const empAsgn = { ...fakeAssignment, designation_id: null, employee_id: "emp-1" };
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    exec.mockResolvedValueOnce([[empAsgn], []]);
    const r = await kpiService.assignTemplate({
      templateId: "tpl-1", employeeId: "emp-1",
    }, "user-1");
    expect(r.employee_id).toBe("emp-1");
  });

  it("throws when none of employeeId/designationId/departmentId provided", async () => {
    await expect(kpiService.assignTemplate({ templateId: "tpl-1" }, "user-1"))
      .rejects.toThrow("Must specify at least one assignment target");
  });
});

describe("kpiService.getEmployeeTemplate", () => {
  it("returns employee-level assignment first (highest priority)", async () => {
    exec.mockResolvedValueOnce([[{ ...fakeAssignment, employee_id: "emp-1" }], []]);
    const r = await kpiService.getEmployeeTemplate("emp-1");
    expect(r?.employee_id).toBe("emp-1");
  });

  it("returns null when no assignment found at any level", async () => {
    exec.mockResolvedValueOnce([[], []]);
    const r = await kpiService.getEmployeeTemplate("emp-nope");
    expect(r).toBeNull();
  });
});

// ─── Scores ───────────────────────────────────────────────────────────────────

describe("kpiService.recordScore", () => {
  it("inserts or updates score for period", async () => {
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    exec.mockResolvedValueOnce([[fakeScore], []]);
    const r = await kpiService.recordScore({
      employeeId: "emp-1", metricId: "met-1", period: "2026-05", actualValue: 280,
    }, "user-1");
    expect(r.actual_value).toBe(280);
  });
});

describe("kpiService.bulkRecordScores", () => {
  it("records multiple scores for period, returns count", async () => {
    exec.mockResolvedValueOnce([{ affectedRows: 3 }, []]);
    const r = await kpiService.bulkRecordScores({
      period: "2026-05",
      scores: [
        { employeeId: "emp-1", metricId: "met-1", actualValue: 280 },
        { employeeId: "emp-1", metricId: "met-2", actualValue: 88 },
        { employeeId: "emp-2", metricId: "met-1", actualValue: 310 },
      ],
    }, "user-1");
    expect(r.recorded).toBe(3);
  });
});

// ─── Summary (computed weighted score) ───────────────────────────────────────

describe("kpiService.getEmployeeSummary", () => {
  it("computes weighted score and rating for period", async () => {
    // template metrics: AHT weight 40%, target 300; CSAT weight 60%, target 90
    exec.mockResolvedValueOnce([[
      { metric_id: "met-1", metric_code: "AHT", target_value: 300, weight_pct: 40, direction: "lower_is_better" },
      { metric_id: "met-2", metric_code: "CSAT", target_value: 90, weight_pct: 60, direction: "higher_is_better" },
    ], []]);
    // actual scores: AHT = 280 (better than 300), CSAT = 85 (below 90)
    exec.mockResolvedValueOnce([[
      { metric_id: "met-1", actual_value: 280 },
      { metric_id: "met-2", actual_value: 85 },
    ], []]);
    const r = await kpiService.getEmployeeSummary("emp-1", "tpl-1", "2026-05");
    // AHT: lower_is_better → achievement = 300/280 = 1.071 (capped at 1.2)
    // CSAT: higher_is_better → achievement = 85/90 = 0.944
    // weighted = (1.071 × 40 + 0.944 × 60) / 100 = (42.84 + 56.67) / 100 = 0.995 → ~99.5%
    expect(r.weighted_score_pct).toBeCloseTo(99.5, 0);
    expect(r.metrics).toHaveLength(2);
  });

  it("assigns rating S when weighted_score >= 100", async () => {
    exec.mockResolvedValueOnce([[
      { metric_id: "met-1", metric_code: "AHT", target_value: 300, weight_pct: 100, direction: "lower_is_better" },
    ], []]);
    exec.mockResolvedValueOnce([[{ metric_id: "met-1", actual_value: 250 }], []]);
    const r = await kpiService.getEmployeeSummary("emp-1", "tpl-1", "2026-05");
    expect(r.rating).toBe("S");
  });

  it("assigns rating D when weighted_score < 60", async () => {
    exec.mockResolvedValueOnce([[
      { metric_id: "met-1", metric_code: "CSAT", target_value: 90, weight_pct: 100, direction: "higher_is_better" },
    ], []]);
    exec.mockResolvedValueOnce([[{ metric_id: "met-1", actual_value: 50 }], []]);
    const r = await kpiService.getEmployeeSummary("emp-1", "tpl-1", "2026-05");
    expect(r.rating).toBe("D");
  });
});

// ─── Leaderboard ─────────────────────────────────────────────────────────────

describe("kpiService.getLeaderboard", () => {
  it("returns ranked employee scores for period", async () => {
    exec.mockResolvedValueOnce([[
      { employee_id: "emp-1", employee_code: "MCN001", full_name: "Ravi Kumar", weighted_score_pct: 102, rating: "S" },
      { employee_id: "emp-2", employee_code: "MCN002", full_name: "Priya Sharma", weighted_score_pct: 88, rating: "B" },
    ], []]);
    const r = await kpiService.getLeaderboard({ period: "2026-05", templateId: "tpl-1" });
    expect(r[0].rating).toBe("S");
    expect(r[0].weighted_score_pct).toBe(102);
  });
});
