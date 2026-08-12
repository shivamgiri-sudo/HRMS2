import { describe, it, expect, beforeEach, vi } from "vitest";

import { db } from "../../../db/mysql.js";
import { PerformanceFeedbackService } from "../performance-feedback.service.js";

/**
 * No performance feedback has ever been submitted, and no development plan has
 * ever been created.
 *
 * 037_performance_feedback.sql defines a coherent 360-degree schema and
 * production matches it exactly. The service disagreed with both:
 *
 *   performance_feedback_request was written with manager_id. The column is
 *   reviewer_id, and reviewer_type sits beside it NOT NULL with no default.
 *
 *   performance_feedback_response was written as one blob row - ratings_json,
 *   overall_strengths, development_areas - none of which exist. The table is one
 *   row per (request_id, competency_id) with competency_id and rating both NOT
 *   NULL, so the blob could not be stored under any spelling.
 *
 *   the request was then marked status = 'submitted', submitted_at = NOW(). The
 *   enum is ('pending','completed','declined','expired') and the column is
 *   completed_at.
 *
 *   competency_master was written with display_order; training_need with title
 *   and identified_date; development_plan with created_by and target_date;
 *   development_plan_goal with description. None of those columns exist, and
 *   development_plan additionally requires report_id, manager_id,
 *   plan_start_date and plan_end_date, all NOT NULL, none of which were supplied.
 *
 * Every primary key here is CHAR(36) DEFAULT (UUID()), so result.insertId came
 * back 0. Even had the columns been right, every goal would have been inserted
 * against plan_id '0'.
 *
 * Verified against production 8.0.42 on TEMPORARY copies of all seven tables:
 * each old statement fails with ER_BAD_FIELD_ERROR, each new one succeeds.
 */
const mockExecute = db.execute as unknown as ReturnType<typeof vi.fn>;

interface Captured {
  sql: string;
  params: unknown[];
}

const service = new PerformanceFeedbackService();

const REQUEST_ID = "11111111-1111-1111-1111-111111111111";
const REVIEWER_ID = "22222222-2222-2222-2222-222222222222";
const EMPLOYEE_ID = "33333333-3333-3333-3333-333333333333";
const CYCLE_ID = "44444444-4444-4444-4444-444444444444";
const REPORT_ID = "55555555-5555-5555-5555-555555555555";

function captureSubmit(): Captured[] {
  const calls: Captured[] = [];
  mockExecute.mockImplementation((sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/SELECT \* FROM performance_feedback_request/i.test(sql)) {
      return Promise.resolve([
        [
          {
            request_id: REQUEST_ID,
            reviewer_id: REVIEWER_ID,
            reviewer_type: "manager",
            cycle_id: CYCLE_ID,
            employee_id: EMPLOYEE_ID,
          },
        ],
        [],
      ]);
    }
    return Promise.resolve([{ affectedRows: 1 } as never, []]);
  });
  return calls;
}

const RATINGS = {
  competencies: [
    { competency_id: "7", competency_name: "", rating: 2, comment: "needs work" },
    { competency_id: "8", competency_name: "", rating: 5, comment: "strong" },
  ],
};

describe("performance feedback writes use the real schema", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([[], []]);
  });

  it("stores one response row per competency, not a ratings_json blob", async () => {
    const calls = captureSubmit();

    const result = await service.submitFeedback(
      { request_id: REQUEST_ID, ratings_json: RATINGS } as never,
      REVIEWER_ID
    );

    const inserts = calls.filter((c) => /INSERT INTO performance_feedback_response/i.test(c.sql));
    expect(inserts).toHaveLength(2);
    expect(result.competencies_recorded).toBe(2);

    for (const ins of inserts) {
      expect(ins.sql).toContain("competency_id");
      expect(ins.sql).toContain("rating");
      expect(ins.sql).not.toContain("ratings_json");
      expect(ins.sql).not.toContain("overall_strengths");
      expect(ins.sql).not.toContain("development_areas");
    }

    // response_id is CHAR(36) DEFAULT (UUID()); the app supplies it because
    // insertId would otherwise be 0
    expect(String(inserts[0].params[0])).toMatch(/^[0-9a-f-]{36}$/i);
    expect(inserts[0].params).toContain(2);
    expect(inserts[1].params).toContain(5);
  });

  it("upserts on re-submission rather than duplicating a competency row", async () => {
    const calls = captureSubmit();
    await service.submitFeedback(
      { request_id: REQUEST_ID, ratings_json: RATINGS } as never,
      REVIEWER_ID
    );
    const insert = calls.find((c) => /INSERT INTO performance_feedback_response/i.test(c.sql))!;
    expect(insert.sql).toMatch(/ON DUPLICATE KEY UPDATE/i);
  });

  it("closes the request with a status the enum actually has", async () => {
    const calls = captureSubmit();
    await service.submitFeedback(
      {
        request_id: REQUEST_ID,
        ratings_json: RATINGS,
        development_areas: "closing narrative",
      } as never,
      REVIEWER_ID
    );

    const update = calls.find((c) => /UPDATE performance_feedback_request/i.test(c.sql))!;
    expect(update.sql).toContain("'completed'");
    expect(update.sql).not.toContain("'submitted'");
    // submitted_at does not exist on this table; completed_at does
    expect(update.sql).not.toMatch(/\bsubmitted_at\b/);
    expect(update.sql).toContain("completed_at");
    expect(update.params).toContain("closing narrative");
  });

  it("refuses KPI ratings instead of silently dropping them", async () => {
    captureSubmit();
    await expect(
      service.submitFeedback(
        {
          request_id: REQUEST_ID,
          ratings_json: {
            competencies: RATINGS.competencies,
            kpis: [{ kpi_id: "1", kpi_name: "AHT", rating: 4 }],
          },
        } as never,
        REVIEWER_ID
      )
    ).rejects.toMatchObject({ statusCode: 400, code: "KPI_RATINGS_UNSUPPORTED" });
  });

  it("rejects a rating outside the 1-5 CHECK constraint before writing", async () => {
    const calls = captureSubmit();
    await expect(
      service.submitFeedback(
        {
          request_id: REQUEST_ID,
          ratings_json: { competencies: [{ competency_id: "7", competency_name: "", rating: 9 }] },
        } as never,
        REVIEWER_ID
      )
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_COMPETENCY_RATING" });

    expect(calls.some((c) => /INSERT INTO performance_feedback_response/i.test(c.sql))).toBe(false);
  });

  it("authorises against reviewer_id, the column that exists", async () => {
    captureSubmit();
    await expect(
      service.submitFeedback(
        { request_id: REQUEST_ID, ratings_json: RATINGS } as never,
        "someone-else"
      )
    ).rejects.toThrow(/Unauthorized/);
  });

  it("creates a competency without display_order", async () => {
    const calls: Captured[] = [];
    mockExecute.mockImplementation((sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return Promise.resolve([[{ competency_id: 1, competency_name: "Communication" }], []]);
    });

    await service.createCompetency({ competency_name: "Communication" });

    const insert = calls.find((c) => /INSERT INTO competency_master/i.test(c.sql))!;
    expect(insert.sql).not.toContain("display_order");
    expect(insert.sql).toContain("competency_name");
  });
});

describe("development plans hang off a generated report", () => {
  let conn: { execute: ReturnType<typeof vi.fn> };
  let calls: Captured[];

  async function connection() {
    return (await (db as unknown as { getConnection: () => Promise<typeof conn> }).getConnection());
  }

  beforeEach(async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([[], []]);
    conn = await connection();
    conn.execute.mockReset();
    calls = [];
  });

  function wire(reportRows: unknown[]) {
    conn.execute.mockImplementation((sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/FROM performance_feedback_report/i.test(sql)) return Promise.resolve([reportRows, []]);
      if (/SELECT id FROM employees/i.test(sql)) return Promise.resolve([[{ id: REVIEWER_ID }], []]);
      return Promise.resolve([{ affectedRows: 1 } as never, []]);
    });
  }

  it("refuses when no report exists rather than failing on a NOT NULL report_id", async () => {
    wire([]);
    await expect(
      service.createDevelopmentPlan(
        {
          employee_id: EMPLOYEE_ID,
          cycle_id: CYCLE_ID,
          goals: [{ description: "Improve clarity", target_date: "2026-12-31" }],
        } as never,
        REVIEWER_ID
      )
    ).rejects.toMatchObject({ statusCode: 409, code: "REPORT_NOT_GENERATED" });

    expect(calls.some((c) => /INSERT INTO development_plan/i.test(c.sql))).toBe(false);
  });

  it("writes the columns the table actually has, and links the goal to a real plan id", async () => {
    wire([{ report_id: REPORT_ID }]);

    await service
      .createDevelopmentPlan(
        {
          employee_id: EMPLOYEE_ID,
          cycle_id: CYCLE_ID,
          goals: [
            { description: "Improve clarity", target_date: "2026-11-30" },
            { description: "Lead a review", target_date: "2026-12-31" },
          ],
        } as never,
        REVIEWER_ID
      )
      .catch(() => undefined); // the post-insert fetch reads through the pool stub

    const plan = calls.find((c) => /INSERT INTO development_plan\b/i.test(c.sql))!;
    expect(plan.sql).not.toContain("created_by");
    expect(plan.sql).not.toMatch(/\btarget_date\b/);
    for (const col of ["report_id", "manager_id", "plan_start_date", "plan_end_date"]) {
      expect(plan.sql).toContain(col);
    }
    expect(plan.params).toContain(REPORT_ID);
    // plan_end_date is the latest goal target, not the first
    expect(plan.params).toContain("2026-12-31");

    const planId = String(plan.params[0]);
    expect(planId).toMatch(/^[0-9a-f-]{36}$/i);

    const goals = calls.filter((c) => /INSERT INTO development_plan_goal/i.test(c.sql));
    expect(goals).toHaveLength(2);
    for (const g of goals) {
      expect(g.sql).toContain("goal_description");
      // 'pending' is not in the goal status enum
      expect(g.sql).toContain("'not-started'");
      expect(g.sql).not.toContain("'pending'");
      // the goal must point at the plan, not at insertId 0
      expect(g.params[1]).toBe(planId);
    }
  });

  it("refuses a plan with no end date rather than writing NULL into a NOT NULL column", async () => {
    wire([{ report_id: REPORT_ID }]);
    await expect(
      service.createDevelopmentPlan(
        {
          employee_id: EMPLOYEE_ID,
          cycle_id: CYCLE_ID,
          goals: [{ description: "Improve clarity" }],
        } as never,
        REVIEWER_ID
      )
    ).rejects.toMatchObject({ statusCode: 400, code: "PLAN_END_DATE_REQUIRED" });
  });
});
