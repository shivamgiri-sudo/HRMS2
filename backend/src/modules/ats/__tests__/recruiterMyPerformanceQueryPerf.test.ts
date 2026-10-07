import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * GET /api/ats/recruiter/my-performance is the recruiter workspace's KPI panel. It awaited nine
 * reads one after another (KPI, hiring flow, roster -> joined count, stage funnel, trend, process,
 * VOC, source, recruiter profile). They are independent apart from roster -> joined, which stays
 * chained inside one promise, so all of them now run together. The joined count also compared
 * `DATE(h.activity_date) >= X` on a DATE column, which only blocked the activity_date index.
 */

const { execute, resolveRecruiterForActor } = vi.hoisted(() => ({
  execute: vi.fn(),
  resolveRecruiterForActor: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    (req as express.Request & { authUser: { id: string } }).authUser = {
      id: "user-1",
    };
    next();
  },
  requireWriteAccess: (
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
vi.mock("../../../middleware/scopeMiddleware.js", () => ({
  requireScopedRole:
    () =>
    (
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) =>
      next(),
}));
vi.mock("../../ats-full-parity/recruiterInterview.service.js", () => ({
  verifyRecruiter: vi.fn(),
  resolveRecruiterForActor,
  getMyPendingCandidates: vi.fn(),
  getOtherRecruitersPendingCandidates: vi.fn(),
  reassignCandidate: vi.fn(),
  getSubmissionHistory: vi.fn(),
  getRecruiterDailyStats: vi.fn(),
}));

let inFlight = 0;
let maxInFlight = 0;

function handler(sql: string): unknown {
  if (sql.includes("COUNT(*)") && sql.includes("avg_tat_min")) {
    return [
      {
        total: 4,
        selected: 2,
        rejected: 1,
        hold: 0,
        no_show: 1,
        client_pending: 0,
        conversion_rate: 50,
        avg_tat_min: 30,
        sla_breach_count: 0,
      },
    ];
  }
  if (sql.includes("walkin_count"))
    return [
      { total_entries: 4, walkin_count: 4, selected_count: 2, joined_count: 0 },
    ];
  if (sql.includes("FROM ats_recruiter_roster"))
    return [{ roster_id: "r1", recruiter_code: "RC1" }];
  if (
    sql.includes("joined_count") &&
    sql.includes("ats_recruiter_hiring_activity")
  )
    return [{ joined_count: "3" }];
  if (sql.includes("effective_stage")) {
    return [
      { effective_stage: "HR Round", final_decision: "Rejected", cnt: 1 },
      { effective_stage: "Selection", final_decision: "Selected", cnt: 2 },
      { effective_stage: "Arrival", final_decision: "No Show", cnt: 1 },
    ];
  }
  if (sql.includes("AS day"))
    return [
      { day: "2026-09-29", total: 4, selected: 2, rejected: 1, no_show: 1 },
    ];
  if (sql.includes("interviewed_for_process"))
    return [{ process: "Inbound", total: 4, selected: 2, rate: 50 }];
  if (sql.includes("voc_reason")) return [{ voc_reason: "Salary", cnt: 1 }];
  if (sql.includes("hiring_source_snapshot"))
    return [{ source: "Walk-in", total: 4, selected: 2 }];
  return [];
}

beforeEach(() => {
  execute.mockReset();
  resolveRecruiterForActor.mockReset();
  inFlight = 0;
  maxInFlight = 0;
  execute.mockImplementation(async (sql: string) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return [handler(String(sql)), []];
  });
  resolveRecruiterForActor.mockResolvedValue({
    id: "r1",
    name: "Asha",
    recruiterCode: "RC1",
    branch: "NOIDA",
    email: null,
    employeeId: "e1",
  });
});

async function app() {
  vi.resetModules();
  const { atsRouter } = await import("../ats.routes.js");
  const a = express();
  a.use("/ats", atsRouter);
  return a;
}

describe("GET /ats/recruiter/my-performance", () => {
  it("issues its independent reads together and returns the same payload", async () => {
    const res = await request(await app()).get(
      "/ats/recruiter/my-performance?period=MTD",
    );
    expect(res.status).toBe(200);
    // kpi, hiring flow, roster, stages, trend, process, voc, source: 8 statements at once
    expect(maxInFlight).toBeGreaterThanOrEqual(8);

    expect(res.body.period).toBe("MTD");
    expect(res.body.profile).toMatchObject({
      name: "Asha",
      recruiterCode: "RC1",
    });
    const { kpi, hiringFlow, funnel, trend, byProcess, voc, bySource } =
      res.body.data;
    expect(kpi).toMatchObject({ total: 4, selected: 2 });
    // joined count still comes from the activity table via the roster row
    expect(hiringFlow).toEqual({
      total_entries: 4,
      walkin_count: 4,
      selected_count: 2,
      joined_count: 3,
    });
    expect(funnel.map((f: { stage: string }) => f.stage)).toEqual([
      "Arrival",
      "HR Round",
      "Skill Test",
      "Ops Round",
      "Client Round",
      "Selection",
    ]);
    expect(trend).toEqual([
      { day: "2026-09-29", total: 4, selected: 2, rejected: 1, no_show: 1 },
    ]);
    expect(byProcess).toEqual([
      { process: "Inbound", total: 4, selected: 2, rate: 50 },
    ]);
    expect(voc).toEqual([{ voc_reason: "Salary", cnt: 1 }]);
    expect(bySource).toEqual([{ source: "Walk-in", total: 4, selected: 2 }]);
  });

  it("skips the joined lookup when the recruiter has no roster row, as before", async () => {
    execute.mockImplementation(async (sql: string) => [
      String(sql).includes("FROM ats_recruiter_roster")
        ? []
        : handler(String(sql)),
      [],
    ]);
    const res = await request(await app()).get("/ats/recruiter/my-performance");
    expect(res.status).toBe(200);
    expect(res.body.data.hiringFlow.joined_count).toBe(0);
    expect(
      execute.mock.calls.some(([sql]) =>
        String(sql).includes("SUM(h.joined_flag=1)"),
      ),
    ).toBe(false);
  });

  it("no longer wraps the DATE column activity_date in DATE()", async () => {
    await request(await app()).get("/ats/recruiter/my-performance?period=L30");
    const joined = execute.mock.calls.find(([sql]) =>
      String(sql).includes("SUM(h.joined_flag=1)"),
    )!;
    const sql = String(joined[0]).replace(/\s+/g, " ");
    expect(sql).not.toContain("DATE(h.activity_date)");
    expect(sql).toContain(
      "h.activity_date >= DATE(DATE_SUB(CURDATE(), INTERVAL 29 DAY))",
    );
    expect(joined[1]).toEqual(["r1"]);
  });

  it("propagates a failing query as an error response", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("interviewed_for_process"))
        throw new Error("boom");
      return [handler(String(sql)), []];
    });
    const res = await request(await app()).get("/ats/recruiter/my-performance");
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
