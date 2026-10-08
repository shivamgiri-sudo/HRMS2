import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Query-shape contracts for the recruiter hiring page-load endpoints.
 *
 * None of these change what the response contains — they change how many round trips it takes to
 * assemble and how much work each one does, which is invisible in the body and so can regress
 * silently while every functional test still passes. The DB here is remote, so a round trip is
 * the unit of cost:
 *
 *  - listHiringActivity: rows and COUNT are independent -> issued together.
 *  - getHiringDashboard: summary + four breakdowns are independent -> issued together, and the
 *    scoped-user branch lookup (employees + branch_master) runs ONCE, not once per breakdown.
 *  - buildActivityActorContext (bootstrap): roster lookup and employee lookup -> issued together.
 *  - listFollowups: a correlated COUNT(*) on the un-indexed followup_of_activity_id scanned all
 *    ~45k activity rows once per page row (measured >10 s on live data, killed by the 10 s cap);
 *    it is now one grouped derived table.
 */

const { execute, resolveRecruiterForActor } = vi.hoisted(() => ({
  execute: vi.fn(),
  resolveRecruiterForActor: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../ats-full-parity/recruiterInterview.service.js", () => ({ resolveRecruiterForActor }));
vi.mock("../ats.service.js", () => ({ atsService: {} }));
vi.mock("../ats.queue.service.js", () => ({ atsQueueService: {} }));
vi.mock("../ats.onboarding.service.js", () => ({ sendOnboardingToken: vi.fn() }));

const svc = await import("../recruiter-hiring.service.js");

const sqlOf = (call: unknown[]) => String(call[0]).replace(/\s+/g, " ").trim();

/** Tracks how many statements are in flight at once — >1 proves they were not awaited in series. */
function trackConcurrency(handler: (sql: string, params: unknown[]) => unknown) {
  let inFlight = 0;
  let maxInFlight = 0;
  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return [handler(String(sql), params), []];
  });
  return { max: () => maxInFlight };
}

beforeEach(() => {
  execute.mockReset();
  resolveRecruiterForActor.mockReset();
});

describe("listHiringActivity", () => {
  it("issues the page query and the COUNT together and returns both", async () => {
    const t = trackConcurrency((sql) => (sql.includes("COUNT(*) AS total") ? [{ total: 7 }] : [{ id: "a" }, { id: "b" }]));
    const out = await svc.listHiringActivity("u1", "admin", { page: 1, limit: 50 });
    expect(t.max()).toBe(2);
    expect(out).toEqual({ data: [{ id: "a" }, { id: "b" }], total: 7, page: 1, limit: 50 });
  });

  it("still surfaces an error from either query", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("COUNT(*) AS total")) throw new Error("count failed");
      return [[{ id: "a" }], []];
    });
    await expect(svc.listHiringActivity("u1", "admin", {})).rejects.toThrow("count failed");
  });
});

describe("getHiringDashboard", () => {
  const handler = (sql: string) => {
    if (sql.includes("FROM employees e")) return [{ branch_name: "NOIDA" }];
    if (sql.includes("COUNT(*) AS total_records")) return [{ total_records: 3, total_contacted: 2 }];
    return [{ label: "x", total: 1 }];
  };

  it("issues the summary and the four breakdowns together", async () => {
    const t = trackConcurrency(handler);
    const out = await svc.getHiringDashboard("u1", "admin", {});
    expect(t.max()).toBe(5);
    expect(out.metrics.total_records).toBe(3);
    expect(out.byRecruiter).toEqual([{ label: "x", total: 1 }]);
    expect(out.byBranch).toEqual([{ label: "x", total: 1 }]);
  });

  it("resolves a scoped user's branch once, not once per breakdown", async () => {
    trackConcurrency(handler);
    await svc.getHiringDashboard("u1", "recruiter", {});
    const branchLookups = execute.mock.calls.filter(([sql]) => String(sql).includes("FROM employees e"));
    expect(branchLookups).toHaveLength(1);
    // 1 lookup + 1 summary + 4 breakdowns
    expect(execute).toHaveBeenCalledTimes(6);
    // every filtered query carries the same scope bindings
    const filtered = execute.mock.calls.filter(([sql]) => String(sql).includes("is_followup_attempt"));
    expect(filtered).toHaveLength(5);
    for (const call of filtered) expect(call[1]).toEqual(["NOIDA", "u1", "u1"]);
  });

  it("does not leave an unhandled rejection when the summary query fails", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("COUNT(*) AS total_records")) throw new Error("summary failed");
      throw new Error("breakdown failed");
    });
    // super_admin is org-wide (admin is branch-scoped now and would run the branch lookup first, which this
    // mock rejects with "breakdown failed" before the summary is ever issued).
    await expect(svc.getHiringDashboard("u1", "super_admin", {})).rejects.toThrow("summary failed");
  });
});

describe("hiring bootstrap actor context", () => {
  it("runs the roster lookup and the employee lookup together", async () => {
    let rosterInFlight = false;
    let overlapped = false;
    resolveRecruiterForActor.mockImplementation(async () => {
      rosterInFlight = true;
      await new Promise((r) => setTimeout(r, 5));
      rosterInFlight = false;
      return { id: "r1", name: "Asha", recruiterCode: "RC1", branch: "NOIDA", email: null, employeeId: "e1" };
    });
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("FROM employees e")) {
        overlapped = overlapped || rosterInFlight;
        return [[{ employee_id: "e1", employee_code: "E1", employee_name: "Asha K", branch_name: "NOIDA" }], []];
      }
      return [[], []];
    });
    const out = await svc.getHiringActivityBootstrap("u1");
    expect(overlapped).toBe(true);
    expect(out.actor).toMatchObject({ recruiterName: "Asha", recruiterCode: "RC1", branchName: "NOIDA" });
  });
});

describe("listFollowups", () => {
  it("counts attempts through one grouped derived table, not a correlated COUNT per row", async () => {
    const t = trackConcurrency((sql) => {
      if (sql.includes("SUM(arha.followup_date")) return [{ overdue: 1, today: 2, upcoming7: 3, total: 6 }];
      if (sql.includes("server_today")) return [{ server_today: "2026-09-29" }];
      return [{ id: "f1", attempts: 2 }];
    });
    const out = await svc.listFollowups({ userId: "u1", role: "admin", scope: "team", window: "due", page: 1, limit: 50 });

    const pageCall = execute.mock.calls.find(([sql]) => String(sql).includes("days_overdue"))!;
    const sql = sqlOf(pageCall);
    expect(sql).not.toMatch(/\(SELECT COUNT\(\*\) FROM ats_recruiter_hiring_activity a2/);
    expect(sql).toContain("LEFT JOIN ( SELECT followup_of_activity_id, COUNT(*) AS attempts");
    expect(sql).toContain("GROUP BY followup_of_activity_id ) att ON att.followup_of_activity_id = arha.id");
    expect(sql).toContain("COALESCE(att.attempts, 0) AS attempts");
    // ORDER BY / LIMIT are unchanged, so the page is the same rows in the same order.
    expect(sql).toContain("ORDER BY arha.followup_date ASC, arha.created_at ASC LIMIT 50 OFFSET 0");

    // counts, page and server date are issued together
    expect(t.max()).toBe(3);
    expect(out.counts).toEqual({ overdue: 1, today: 2, upcoming7: 3, total: 6 });
    expect(out.serverToday).toBe("2026-09-29");
    expect(out.data).toEqual([{ id: "f1", attempts: 2 }]);
  });
});
