import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * Round-trip contracts for the ATS analytics pages.
 *
 * - analytics.unified.service: getSourceChannelROI, getPredictiveAnalytics and
 *   getTimeToHireMetrics each awaited 2-5 independent reads in series (and the first also waited on
 *   a ~6 s cold employees-by-mobile aggregate). They now issue them together.
 * - bmi-benchmark: the board awaited ~30 queries one after another, including two sequential
 *   salary_prep_run/salary_prep_line lookups per month for each of six months. Everything is now
 *   issued together and the duplicated per-month run lookup is done once.
 *
 * The assembled responses must be unchanged, so each test also pins the output.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => next(),
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole:
    () =>
    (
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) =>
      next(),
}));

function trackConcurrency(
  handler: (sql: string, params: unknown[]) => unknown,
) {
  let inFlight = 0;
  let maxInFlight = 0;
  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    const out = handler(String(sql), params);
    if (out instanceof Error) throw out;
    return [out, []];
  });
  return { max: () => maxInFlight };
}

beforeEach(() => {
  execute.mockReset();
});

describe("analytics.unified.service", () => {
  it("getSourceChannelROI issues the channel totals, candidate rows and mobile map together", async () => {
    vi.resetModules();
    const svc = await import("../analytics.unified.service.js");
    svc.resetEmployeeMobileJoinMapCacheForTest();
    const t = trackConcurrency((sql) => {
      if (sql.includes("FROM employees"))
        return [{ mobile: "9111111111", doj: "2026-09-01" }];
      if (sql.includes("COUNT(*) as total_candidates")) {
        return [
          {
            source_channel: "Walk-in",
            total_candidates: 2,
            avg_time_to_hire_days: "3.5",
          },
        ];
      }
      if (sql.includes("current_stage, mobile, created_at")) {
        return [
          {
            source_channel: "Walk-in",
            current_stage: "onboarded",
            mobile: "9000000000",
            created_at: "2026-08-01",
          },
          {
            source_channel: "Walk-in",
            current_stage: "new",
            mobile: "9111111111",
            created_at: "2026-08-01",
          },
        ];
      }
      return [];
    });
    const out = await svc.getSourceChannelROI();
    expect(t.max()).toBe(3);
    // one hired by stage, one by joining an employee record later than their registration
    expect(out).toEqual([
      {
        source_channel: "Walk-in",
        total_candidates: 2,
        total_hired: 2,
        conversion_rate: 100,
        avg_time_to_hire_days: 3.5,
      },
    ]);
  });

  it("getSourceChannelROI does not leave an unhandled rejection if a query fails", async () => {
    vi.resetModules();
    const svc = await import("../analytics.unified.service.js");
    svc.resetEmployeeMobileJoinMapCacheForTest();
    trackConcurrency((sql) =>
      sql.includes("FROM employees")
        ? new Error("employees down")
        : new Error("candidates down"),
    );
    await expect(svc.getSourceChannelROI()).rejects.toThrow();
  });

  it("getPredictiveAnalytics issues its four reads together", async () => {
    vi.resetModules();
    const svc = await import("../analytics.unified.service.js");
    const t = trackConcurrency((sql) => {
      if (sql.includes("COUNT(*) as hires"))
        return [
          { month: "2026-07", hires: 20 },
          { month: "2026-08", hires: 40 },
        ];
      if (sql.includes("stuck_count"))
        return [
          { current_stage: "bgv_pending", stuck_count: 3, avg_days_stuck: 9 },
        ];
      if (sql.includes("avg_days")) return [{ avg_days: 6.4 }];
      if (sql.includes("month_name")) return [{ month_name: "August", cnt: 4 }];
      return [];
    });
    const out = await svc.getPredictiveAnalytics();
    expect(t.max()).toBe(4);
    expect(out).toEqual({
      forecasted_hires_next_month: 33, // avg 30 * 1.1
      recommended_recruiters_needed: 2,
      peak_hiring_months: ["August"],
      bottleneck_stage: "bgv_pending",
      avg_candidate_journey_days: 6,
    });
  });

  it("getTimeToHireMetrics issues its five reads together", async () => {
    vi.resetModules();
    const svc = await import("../analytics.unified.service.js");
    const t = trackConcurrency((sql) => {
      if (sql.includes("as fastest")) return [{ fastest: 1, slowest: 30 }];
      if (sql.includes("as role")) return [{ role: "Agent", avg_days: "7.4" }];
      if (sql.includes("as source"))
        return [{ source: "Walk-in", avg_days: "5" }];
      if (sql.includes("as branch"))
        return [{ branch: "NOIDA", avg_days: "9.6" }];
      return [{ avg_days: 8.2 }];
    });
    const out = await svc.getTimeToHireMetrics();
    expect(t.max()).toBe(5);
    expect(out).toEqual({
      overall_avg_days: 8,
      by_role: [{ role: "Agent", avg_days: 7 }],
      by_source: [{ source: "Walk-in", avg_days: 5 }],
      by_branch: [{ branch: "NOIDA", avg_days: 10 }],
      fastest_hire_days: 1,
      slowest_hire_days: 30,
    });
  });
});

describe("GET /bmi-benchmark", () => {
  async function app() {
    vi.resetModules();
    const { bmiBenchmarkRouter } = await import("../bmi-benchmark.routes.js");
    const a = express();
    a.use("/bmi", bmiBenchmarkRouter);
    return a;
  }

  const handler = (sql: string) => {
    if (sql.includes("FROM salary_prep_run")) return [{ id: "run-1" }];
    if (sql.includes("SUM(spl.gross_salary)")) return [{ total: "1000" }];
    if (sql.includes("SUM(spl.overtime_pay)")) return [{ total: "50" }];
    if (
      sql.includes("FROM job_requisition jr") &&
      sql.includes("COUNT(*) AS cnt")
    )
      return [{ mo: "2026-08", cnt: 4 }];
    return [];
  };

  it("issues its queries together and looks up each month's payroll run once", async () => {
    const t = trackConcurrency(handler);
    const res = await request(await app()).get("/bmi");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // ~20 statements in flight together (was 1)
    expect(t.max()).toBeGreaterThan(15);
    const runLookups = execute.mock.calls.filter(([sql]) =>
      String(sql).includes("FROM salary_prep_run"),
    );
    expect(runLookups).toHaveLength(6); // one per month, shared by HR CTC and overtime
    const months: string[] = res.body.data.months;
    expect(months).toHaveLength(6);

    const costs = res.body.data.costs as Array<{
      key: string;
      total: number | null;
      cells: Record<string, { value: number | null }>;
    }>;
    const hrCtc = costs.find((r) => r.key === "hr_ctc")!;
    expect(hrCtc.total).toBe(6000);
    for (const m of months) expect(hrCtc.cells[m].value).toBe(1000);

    const speed = res.body.data.speed as Array<{
      key: string;
      total: number | null;
    }>;
    expect(speed.find((r) => r.key === "overtime_paid")!.total).toBe(300);
  });

  it("leaves months without a payroll run empty, as before", async () => {
    trackConcurrency((sql) =>
      sql.includes("FROM salary_prep_run") ? [] : handler(sql),
    );
    const res = await request(await app()).get("/bmi");
    const costs = res.body.data.costs as Array<{
      key: string;
      total: number | null;
    }>;
    expect(costs.find((r) => r.key === "hr_ctc")!.total).toBeNull();
    expect(
      (
        res.body.data.speed as Array<{ key: string; total: number | null }>
      ).find((r) => r.key === "overtime_paid")!.total,
    ).toBeNull();
  });

  it("fills the demand row from the requisition query", async () => {
    trackConcurrency(handler);
    const res = await request(await app()).get("/bmi");
    const funnel = res.body.data.funnel as Array<{
      key: string;
      total: number | null;
      cells: Record<string, { value: number | null }>;
    }>;
    expect(
      funnel.find((r) => r.key === "demand_raised")!.cells["2026-08"]?.value ??
        null,
    ).toBeDefined();
  });

  it("still answers 500 when any query fails", async () => {
    trackConcurrency((sql) =>
      sql.includes("exit_request") ? new Error("boom") : handler(sql),
    );
    const res = await request(await app()).get("/bmi");
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });

  it("uses the branch filter for the billing-rate query only when a branch is given", async () => {
    trackConcurrency((sql) =>
      sql.includes("branch_master WHERE id")
        ? [{ branch_name: "NOIDA" }]
        : handler(sql),
    );
    await request(await app()).get("/bmi?branch_id=b1");
    expect(
      execute.mock.calls.some(([sql]) =>
        String(sql).includes("FROM process_billing_rate"),
      ),
    ).toBe(true);
    execute.mockClear();
    trackConcurrency(handler);
    await request(await app()).get("/bmi");
    expect(
      execute.mock.calls.some(([sql]) =>
        String(sql).includes("FROM process_billing_rate"),
      ),
    ).toBe(false);
  });
});
