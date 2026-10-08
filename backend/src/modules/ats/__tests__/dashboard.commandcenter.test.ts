import { beforeEach, describe, expect, it, vi } from "vitest";

const qMock = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../dashboard.overview.service.js", async (orig) => ({ ...(await orig<typeof import("../dashboard.overview.service.js")>()), q: qMock }));
vi.mock("../dashboard.joined.js", () => ({ getJoinedInfo: async () => ({ ids: [] }), joinedIdSql: () => ({ sql: "0", params: [] }) }));

import { getDrill } from "../dashboard.pipeline.service.js";
import { buildCohorts, buildLeakage, buildNameSuspects, clampWeeks, computeDwell, fixableReason, getReusablePool, isExpectedWait, poolReason, weekStarts } from "../dashboard.commandcenter.service.js";

const H = 3_600_000;

describe("drill splits", () => {
  beforeEach(() => qMock.mockReset());
  it("returns extended split rows, capped at 25, plus hourDow", async () => {
    const base = { d: "2026-09-01", process: "Sales", source: "WALK_IN", recruiter: "A", dow: 3, jn: 0 };
    const rows = [
      { ...base, branch: "Pune", status: "Selected", stage: "Offered", n: 4 },
      { ...base, branch: "Pune", status: "Rejected", stage: "Interview", n: 3 },
      { ...base, branch: "Pune", status: "No Show", stage: "Interview", n: 1 },
      { ...base, branch: "Pune", status: "Hold", stage: "Interview", n: 1 },
      { ...base, branch: "Pune", status: "Waiting", stage: "Interview", n: 1 },
      { ...base, branch: "Pune", status: "Selected", stage: "Onboarded", jn: 1, n: 2 },
      ...Array.from({ length: 30 }, (_, i) => ({ ...base, branch: `B${i}`, status: "Waiting", stage: "x", n: 1 })),
    ];
    qMock.mockResolvedValueOnce(rows).mockResolvedValueOnce([{ dow: 3, hour: 10, total: "5", selected: "2" }]);
    const r = (await getDrill({ page: 1, limit: 10, includeLeads: true, from: "2026-01-01" })) as any;
    const pune = r.splits.branch.find((x: any) => x.name === "Pune");
    expect(pune).toMatchObject({ total: 12, selected: 6, rejected: 3, noShow: 1, hold: 1, waiting: 1, joined: 2, selRate: 50, rejRate: 25, noShowRate: 8.3, joinRate: 33.3 });
    expect(r.splits.branch.length).toBe(25);
    expect(r.hourDow).toEqual([{ dow: 3, hour: 10, total: 5, selected: 2 }]);
    expect(r.kpis.total).toBe(r.total);
  });
});

describe("computeDwell", () => {
  it("computes median, p90, avg, stuck count and bottleneck", () => {
    const now = 1_000 * H;
    const rows: any[] = [];
    for (let i = 0; i < 20; i++) {
      const t = i * 10 * H; // stage A dwell = (i+1) hours
      rows.push({ candidate_id: `c${i}`, to_stage: "A", at: t, status: "Rejected" });
      rows.push({ candidate_id: `c${i}`, to_stage: "B", at: t + (i + 1) * H, status: "Rejected" });
    }
    rows.push({ candidate_id: "o1", to_stage: "C", at: now - 100 * H, status: "Waiting" });
    rows.push({ candidate_id: "o2", to_stage: "C", at: now - 10 * H, status: "Waiting" });
    rows.push({ candidate_id: "o3", to_stage: "C", at: now - 500 * H, status: "Rejected" });
    const out = computeDwell(rows, now);
    const a = out.stages.find((s) => s.stage === "A")!;
    expect(a).toMatchObject({ n: 20, medianHours: 10.5, avgHours: 10.5, stuckOver72h: 0 });
    expect(a.p90Hours).toBe(18.1);
    const c = out.stages.find((s) => s.stage === "C")!;
    expect(c).toMatchObject({ n: 2, stuckOver72h: 1 });
    expect(out.bottleneck).toBe("A");
  });
  it("has null bottleneck with no stage reaching n>=20", () => {
    expect(computeDwell([{ candidate_id: "x", to_stage: "A", at: 0, status: "Waiting" }], 100 * H).bottleneck).toBeNull();
  });
});

describe("cohorts", () => {
  it("clamps weeks and builds Monday-aligned weeks", () => {
    expect(clampWeeks(1)).toBe(4); expect(clampWeeks(99)).toBe(26); expect(clampWeeks("abc")).toBe(12);
    const w = weekStarts(4, new Date("2026-10-01T10:00:00Z")); // Thursday
    expect(w).toEqual(["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
  });
  it("buckets rows and computes rates", () => {
    const weeks = ["2026-09-21", "2026-09-28"];
    const c = buildCohorts(weeks, [
      { week: "2026-09-21", status: "Selected", stage: "Offered", jn: 0, n: 5 },
      { week: "2026-09-21", status: "Selected", stage: "Onboarded", jn: 1, n: 5 },
      { week: "2026-09-21", status: "Rejected", stage: "x", jn: 0, n: 5 },
      { week: "2026-09-21", status: "No Show", stage: "x", jn: 0, n: 5 },
      { week: "2026-09-21", status: "Waiting", stage: "x", jn: 0, n: 5 },
      { week: "2099-01-01", status: "Waiting", stage: "x", jn: 0, n: 9 },
    ], [{ week: "2026-09-21", days: 1 }, { week: "2026-09-21", days: 3 }, { week: "2026-09-21", days: 2 }]);
    expect(c[0]).toMatchObject({ week: "2026-09-21", total: 25, selected: 10, rejected: 5, noShow: 5, open: 5, joined: 5, selRate: 40, rejRate: 20, joinRate: 50, medianDaysToDecision: 2 });
    expect(c[1]).toMatchObject({ total: 0, selRate: 0, medianDaysToDecision: null });
  });
});

describe("buildLeakage", () => {
  it("orders stages, stays monotone and attributes losses", () => {
    const z = { jn: 0, made: 0, appr: 0, rej: 0, clr: 0, bad: 0 };
    const out = buildLeakage([
      { ...z, status: "Rejected", stage: "Interview", n: 10 },
      { ...z, status: "Selected", stage: "Interview", n: 4 },
      { ...z, status: "Selected", stage: "Offered", made: 1, rej: 1, n: 2 },
      { ...z, status: "Selected", stage: "offer_approved", made: 1, appr: 1, bad: 1, n: 3 },
      { ...z, status: "Selected", stage: "Onboarded", jn: 1, n: 5 },
    ]);
    expect(out.stages.map((s) => s.key)).toEqual(["registered", "selected", "offerMade", "offerApproved", "bgvClear", "joined"]);
    expect(out.stages.map((s) => s.n)).toEqual([24, 14, 10, 8, 5, 5]);
    expect(out.losses[0]).toMatchObject({ from: "registered", to: "selected", reason: "Rejected in interview", n: 10 });
    expect(out.losses.find((l) => l.reason === "BGV adverse / refer")).toMatchObject({ from: "offerApproved", to: "bgvClear", n: 3 });
  });
});

describe("bottleneck ignores stages where waiting is expected", () => {
  it("recognises approved-offer and terminal stages", () => {
    for (const s of ["offer_approved", "Offer Rejected", "Joined", "No Show", "rejected"]) expect(isExpectedWait(s)).toBe(true);
    for (const s of ["Round 1- HR Screening", "BGV In Progress", "Selection Discussion"]) expect(isExpectedWait(s)).toBe(false);
  });

  it("names the slowest real stage, not an approved offer waiting to join", () => {
    const H = 3_600_000, rows: { candidate_id: string; to_stage: string; at: number; status: string }[] = [];
    for (let i = 0; i < 25; i++) {
      rows.push({ candidate_id: "a" + i, to_stage: "offer_approved", at: 0, status: "Selected" }, { candidate_id: "a" + i, to_stage: "Joined", at: 500 * H, status: "Selected" });
      rows.push({ candidate_id: "b" + i, to_stage: "Round 1", at: 0, status: "Selected" }, { candidate_id: "b" + i, to_stage: "Round 2", at: 30 * H, status: "Selected" });
    }
    const out = computeDwell(rows, 1000 * H);
    expect(out.stages[0].stage).toBe("offer_approved");
    expect(out.bottleneck).toBe("Round 1");
  });
});

describe("buildNameSuspects", () => {
  it("flags names where one is contained in the other and ignores unassigned", () => {
    const r = buildNameSuspects(["Amit Sharma", "AMIT KUMAR SHARMA", "Unassigned", "Neha Rao"]);
    expect(r.suspects.some((s) => [s.a, s.b].includes("Amit Sharma"))).toBe(true);
    expect(r.suspects.flatMap((s) => [s.a, s.b])).not.toContain("Unassigned");
    expect(r.truncated).toBe(false);
  });
  it("collapses spellings the backend already treats as one person", () => {
    expect(buildNameSuspects(["Neha Rao", "NEHA RAO"]).suspects).toEqual([]);
  });
  it("caps the list and says so", () => {
    const names = Array.from({ length: 40 }, (_, i) => `Person${i} Kumar`).concat(Array.from({ length: 40 }, (_, i) => `Person${i} Raj Kumar`));
    const r = buildNameSuspects(names, 10);
    expect(r.suspects.length).toBe(10);
    expect(r.truncated).toBe(true);
  });
});

describe("reusable pool", () => {
  beforeEach(() => qMock.mockReset());
  it("matches fixable reasons case-insensitively", () => {
    expect(fixableReason("Candidate unhappy with SALARY offered")).toBe("salary");
    expect(fixableReason("Not Interested in night shift")).toBe("shift");
    expect(fixableReason("poor communication")).toBeNull();
    expect(fixableReason(null)).toBeNull();
  });
  it("selects the reason text by status", () => {
    expect(poolReason("Hold")).toBe("Hold - reusable after follow-up");
    expect(poolReason("Client Round - Pending")).toBe("Hold - reusable after follow-up");
    expect(poolReason("No Show")).toBe("No show - reattempt confirmation call");
    expect(poolReason("Rejected", "location too far")).toBe("Rejected on a fixable reason: location too far");
    expect(poolReason("Rejected", "poor typing")).toBeNull();
    expect(poolReason("Selected", "salary")).toBeNull();
  });
  it("returns the shaped payload without a COUNT, with parameterised SQL", async () => {
    qMock
      .mockResolvedValueOnce([
        { id: "7", candidate_code: "C-7", full_name: "Asha", branch: "Pune", process: "Sales", status: "Rejected", stage: "Interview", updated_at: new Date("2026-09-30T10:00:00Z"), voc: "salary too low" },
        { id: "8", candidate_code: "C-8", full_name: "Ravi", branch: "Pune", process: null, status: "No Show", stage: "Interview", updated_at: null, voc: null },
      ]);
    const r = (await getReusablePool({ page: 1, limit: 10, from: "2026-08-01", branch: "zz-pool" })) as any;
    expect(r).toMatchObject({ shown: 2, more: false });
    expect(r.rows[0]).toMatchObject({ id: "7", candidateCode: "C-7", name: "Asha", status: "Rejected", reason: "Rejected on a fixable reason: salary too low", lastUpdate: "2026-09-30T10:00:00.000Z" });
    expect(r.rows[1]).toMatchObject({ id: "8", reason: "No show - reattempt confirmation call", process: "", lastUpdate: null });
    const [sql, params] = qMock.mock.calls[0];
    expect(sql).toContain("ORDER BY c.updated_at DESC LIMIT 101");
    expect(qMock).toHaveBeenCalledTimes(1);
    expect(params).toEqual(expect.arrayContaining(["2026-08-01", "Hold", "No Show", "%salary%", "%not interested%"]));
    expect((params as string[]).filter((p) => String(p).startsWith("%")).length).toBe(24);
    expect(sql).not.toContain("salary");
  });
});
