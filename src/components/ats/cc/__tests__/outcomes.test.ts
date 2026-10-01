import { describe, expect, it } from "vitest";
import type { DrillData } from "@/hooks/useAtsDashboards";
import { avgOfferedSalary, buildOutcomeFindings, buildReasonProcessMatrix, calibrateInterviewers, fastDecisionShare, leakageOutcome, monthEnd } from "../outcomes-helpers";

const drill = (proc: Record<string, number>): DrillData => ({
  total: 0, kpis: {} as DrillData["kpis"], trend: [], weekly: false, weekday: [],
  splits: { branch: [], source: [], recruiter: [], stage: [], status: [], process: Object.entries(proc).map(([name, total]) => ({ name, total, selected: 0, rejected: total, selRate: 0 })) },
});

describe("reason x process matrix", () => {
  it("ranks and caps processes, skips unloaded reasons", () => {
    const m = buildReasonProcessMatrix(["A", "B", "C"], [drill({ P1: 30, P2: 5 }), undefined, drill({ P1: 4, P3: 40 })], 2);
    expect(m.processes).toEqual(["P3", "P1"]);
    expect(m.rows.map((r) => r.name)).toEqual(["A", "C"]);
    expect(m.rows[0].total).toBe(35);
  });
});

describe("interviewer calibration", () => {
  const rows = [
    { name: "a", interviews: 100, selected: 50, rejected: 50, passRate: 50 },
    { name: "b", interviews: 100, selected: 52, rejected: 48, passRate: 52 },
    { name: "c", interviews: 100, selected: 48, rejected: 52, passRate: 48 },
    { name: "d", interviews: 100, selected: 50, rejected: 50, passRate: 50 },
    { name: "hi", interviews: 80, selected: 78, rejected: 2, passRate: 97 },
    { name: "tiny", interviews: 3, selected: 0, rejected: 3, passRate: 0 },
  ];
  it("flags only well-sampled, far-off interviewers", () => {
    const c = calibrateInterviewers(rows);
    expect(c.points.find((p) => p.name === "hi")?.outlier).toBe("high");
    expect(c.points.find((p) => p.name === "tiny")?.outlier).toBeNull();
    expect(c.points.find((p) => p.name === "a")?.outlier).toBeNull();
  });
  it("handles empty input", () => expect(calibrateInterviewers([])).toEqual({ peerAvg: 0, sd: 0, points: [] }));
});

describe("small helpers", () => {
  it("decision speed and salary", () => {
    expect(fastDecisionShare([{ bucket: "<1h", n: 30 }, { bucket: "1-3h", n: 30 }, { bucket: "1d", n: 40 }]).pct).toBe(60);
    expect(fastDecisionShare([]).pct).toBe(0);
    expect(avgOfferedSalary([{ process: "a", avg: 10, min: 1, max: 2, n: 1 }, { process: "b", avg: 20, min: 1, max: 2, n: 3 }])).toBe(17.5);
  });
  it("leakage mapping and month end", () => {
    expect(leakageOutcome("joined")).toBe("joined");
    expect(leakageOutcome("x", "Offer approved")).toBe("offered");
    expect(leakageOutcome("sel", "Selected")).toBe("selected");
    expect(leakageOutcome("x", "Other")).toBeUndefined();
    expect(monthEnd("2026-02")).toBe("2026-02-28");
  });
});

describe("findings", () => {
  it("builds from sparse data without throwing", () => {
    const d = { monthly: [], rounds: [], rejectionReasons: [{ reason: "Voice", n: 50, share: 40 }], skill: [], salary: [], ctcBands: [], decisionSpeed: [], interviewers: [], experience: [], education: [], shift: [], ageBands: [], rewalkins: 0 } as never;
    const f = buildOutcomeFindings({ insights: d, dropoff: [{ stage: "HR Screening", n: 9 }], leakage: { generatedAt: "", stages: [{ key: "selected", label: "Selected", n: 100 }, { key: "offered", label: "Offered", n: 60 }, { key: "joined", label: "Joined", n: 50 }], losses: [] } });
    expect(f.map((x) => x.title).join("|")).toContain("Voice");
    expect(f.find((x) => x.title.includes("Biggest offer-to-join"))?.drill?.extra.outcome).toBe("selected");
  });
});

describe("leakageOutcome with the real /dashboard/leakage step keys", () => {
  it("maps every key the backend returns", () => {
    const want: Record<string, string | undefined> = { registered: undefined, selected: "selected", offerMade: "offered", offerApproved: "offered", bgvClear: "offered", joined: "joined" };
    for (const [key, outcome] of Object.entries(want)) expect(leakageOutcome(key, "")).toBe(outcome);
  });
});

describe("month-on-month finding ignores the month in progress", () => {
  it("does not compare a full month with the first days of the current one", () => {
    const now = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);
    const d = { monthly: [{ month: "2000-01", registered: 100, selected: 30, rejected: 50, noShow: 5, selRate: 30 }, { month: now, registered: 3, selected: 0, rejected: 1, noShow: 0, selRate: 0 }], rounds: [], rejectionReasons: [], interviewers: [], decisionSpeed: [], experience: [], education: [], shift: [], skill: [], salary: [], ctcBands: [], ageBands: [], rewalkins: 0 } as never;
    expect(buildOutcomeFindings({ insights: d }).some((f) => f.title.includes("month on month"))).toBe(false);
  });
});
