import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Round-trip contracts for the requisition page loads. The database is remote, so each sequential
 * `await db.execute` is a full network round trip; these reads are independent and are now issued
 * together. Responses are unchanged, so each test pins the assembled output too.
 *
 *  - listRequisitions: the COUNT and the page query.
 *  - getDashboardMetrics: four aggregates over the same filtered set.
 *  - getHandoverPack: funnel, joined employees and candidate pipeline.
 */

const { execute, query } = vi.hoisted(() => ({
  execute: vi.fn(),
  query: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query, getConnection: vi.fn() },
}));
vi.mock("../../workflow/workflow.service.js", () => ({ workflowService: {} }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: {} }));
vi.mock("../../communication/email.service.js", () => ({ emailService: {} }));
vi.mock("../../communication/template.service.js", () => ({
  templateService: {},
}));
vi.mock("../../it-provisioning/notification-recipients.service.js", () => ({
  getConfiguredRecipients: vi.fn(),
}));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  resolveUserBusinessScope: vi.fn(async () => ({
    userId: "u1",
    roles: ["admin"],
    assignments: [],
    isSuperAdmin: true,
    isAdmin: true,
    isHr: false,
  })),
  buildProcessScopeCondition: vi.fn(() => ({ sql: "1=1", params: [] })),
}));

const { jobRequisitionService: svc } =
  await import("../job-requisition.service.js");

let inFlight = 0;
let maxInFlight = 0;
function track(handler: (sql: string) => unknown) {
  inFlight = 0;
  maxInFlight = 0;
  const impl = async (sql: string) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    const out = handler(String(sql));
    if (out instanceof Error) throw out;
    return [out, []];
  };
  execute.mockImplementation(impl);
  query.mockImplementation(impl);
}

const actor = { id: "u1", role: "admin" } as never;

beforeEach(() => {
  execute.mockReset();
  query.mockReset();
});

describe("listRequisitions", () => {
  it("issues the COUNT and the page together and returns both", async () => {
    track((sql) =>
      sql.includes("COUNT(*) AS total FROM job_requisition")
        ? [{ total: 45 }]
        : [{ id: "r1" }, { id: "r2" }],
    );
    const out = await svc.listRequisitions({ page: 2, limit: 20 }, actor);
    expect(maxInFlight).toBe(2);
    expect(out).toEqual({
      data: [{ id: "r1" }, { id: "r2" }],
      total: 45,
      page: 2,
      limit: 20,
      totalPages: 3,
    });
    // the page keeps its bound offset/limit and ordering
    const pageSql = String(query.mock.calls[0][0]).replace(/\s+/g, " ");
    expect(pageSql).toContain("LIMIT 20 OFFSET 20");
  });

  it("still fails if the COUNT fails, without an unhandled rejection", async () => {
    track((sql) =>
      sql.includes("COUNT(*) AS total FROM job_requisition")
        ? new Error("count down")
        : [{ id: "r1" }],
    );
    await expect(svc.listRequisitions({}, actor)).rejects.toThrow("count down");
  });

  it("still fails if the page query fails", async () => {
    track((sql) =>
      sql.includes("COUNT(*) AS total FROM job_requisition")
        ? [{ total: 1 }]
        : new Error("page down"),
    );
    await expect(svc.listRequisitions({}, actor)).rejects.toThrow("page down");
  });
});

describe("getDashboardMetrics", () => {
  it("issues its four aggregates together and assembles the same metrics", async () => {
    track((sql) => {
      if (sql.includes("total_requisitions")) {
        return [
          {
            total_requisitions: 10,
            open_requisitions: 7,
            pending_approval: 2,
            approved_active: 4,
            total_open_positions: 12,
            total_fulfilled: 8,
            fill_rate_percent: "40.0",
            avg_time_to_fill_days: "5",
          },
        ];
      }
      if (sql.includes("SELECT priority, COUNT(*)"))
        return [
          { priority: "urgent", count: 3 },
          { priority: "normal", count: 7 },
        ];
      if (sql.includes("GROUP BY branch_name"))
        return [{ branch_name: "NOIDA", count: 6, open_positions: "9" }];
      if (sql.includes("SELECT approval_status, COUNT(*)"))
        return [{ approval_status: "approved", count: 4 }];
      return [];
    });
    const out = await svc.getDashboardMetrics({}, actor);
    expect(maxInFlight).toBe(4);
    expect(out).toEqual({
      total_requisitions: 10,
      open_requisitions: 7,
      pending_approval: 2,
      approved_active: 4,
      total_open_positions: 12,
      total_fulfilled: 8,
      fill_rate_percent: 40,
      avg_time_to_fill_days: 5,
      by_priority: { low: 0, normal: 7, high: 0, urgent: 3 },
      by_branch: [{ branch_name: "NOIDA", count: 6, open_positions: 9 }],
      by_status: { approved: 4 },
    });
  });
});

describe("getHandoverPack", () => {
  it("issues funnel, joined employees and pipeline together after the requisition read", async () => {
    track((sql) => {
      if (sql.includes("FROM job_requisition WHERE id")) {
        return [
          {
            requisition_code: "REQ-1",
            designation_name: "Agent",
            branch_name: "NOIDA",
            requested_headcount: 5,
            fulfilled_headcount: 5,
          },
        ];
      }
      if (sql.includes("COUNT(DISTINCT jrc.candidate_id) AS linked"))
        return [
          {
            linked: 6,
            walkin: 5,
            screened: 4,
            selected_cnt: 3,
            offered: 3,
            onboarding: 2,
            joined: 2,
            lms: 1,
          },
        ];
      if (sql.includes("UNION"))
        return [
          {
            employee_id: "e1",
            full_name: "A",
            employee_code: "E1",
            date_of_joining: "2026-09-01",
            bridge_status: "completed",
            candidate_id: "c1",
            candidate_name: "A",
            lms_enrolled: 1,
          },
        ];
      if (sql.includes("jrc.outcome"))
        return [
          {
            candidate_id: "c1",
            full_name: "A",
            outcome: "selected",
            linked_at: "2026-08-01",
          },
        ];
      return [];
    });
    const out = await svc.getHandoverPack("req-1");
    // 3 reads together (was 3 in series) after the first read
    expect(maxInFlight).toBe(3);
    expect(out.funnel).toEqual({
      linked: 6,
      walkin: 5,
      screened: 4,
      selected: 3,
      offered: 3,
      onboarding: 2,
      joined: 2,
      lms: 1,
    });
    expect(out.joined_employees).toEqual([
      {
        employee_id: "e1",
        full_name: "A",
        employee_code: "E1",
        date_of_joining: "2026-09-01",
        bridge_status: "completed",
        lms_enrolled: true,
        candidate_id: "c1",
        candidate_name: "A",
      },
    ]);
    expect(out.candidate_pipeline).toEqual([
      {
        candidate_id: "c1",
        full_name: "A",
        outcome: "selected",
        linked_at: "2026-08-01",
      },
    ]);
    expect(out.summary).toMatchObject({
      requisition_code: "REQ-1",
      requested_headcount: 5,
      fulfilled_headcount: 5,
    });
  });

  it("still 404s on a missing requisition without running the other reads", async () => {
    track(() => []);
    await expect(svc.getHandoverPack("nope")).rejects.toMatchObject({
      status: 404,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
