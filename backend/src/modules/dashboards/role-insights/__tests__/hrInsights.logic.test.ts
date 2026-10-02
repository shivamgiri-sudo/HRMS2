import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));

import { addDays, attritionPct, composeHealth, lit, monthStart, queueSeverity, scoreBetween, tenureBucket } from "../providers/hrParts/shared.js";
import { computeMovement, groupMovement, monthEndHeadcount, monthlyCounts, reasonCoverage, tenureDistribution, type RosterRow } from "../providers/hrParts/roster.js";
import { hiringCoverage, onboardingFunnel } from "../providers/hrParts/workforce.js";
import { classifyAbsentees, pickAnchor } from "../providers/hrParts/people.js";
import hr from "../providers/hr.js";

const T = "2026-10-02";
const row = (doj: string, xd: string | null, o: Partial<RosterRow> = {}): RosterRow => ({ doj, xd, branchId: "b1", processId: "p1", reason: null, ...o });

describe("attrition rate", () => {
  it("divides by average headcount, not closing headcount", () => {
    // 129 exits, 1063 now, 1000 a month ago -> 129 / 1031.5
    expect(attritionPct(129, 1000, 1063)).toBe(12.5);
    // the summary feed's closing + exits/2 basis would give 11.6 here
    expect(attritionPct(129, 1000, 1063)).not.toBe(Math.round((129 / (1063 + 129 / 2)) * 1000) / 10);
  });
  it("is null (not 0) when there is nothing to divide by", () => {
    expect(attritionPct(5, 0, 0)).toBeNull();
    expect(attritionPct(null, 10, 10)).toBeNull();
  });
});

describe("30-day movement from the roster", () => {
  const list = [
    row("2026-01-01", null), row("2026-01-01", null), row("2025-06-01", null),
    row("2026-09-20", null),                  // joined in window, still here
    row("2026-09-10", "2026-09-25"),          // joined AND left inside the window
    row("2025-01-01", "2026-09-15"),          // long-tenure leaver
    row("2025-01-01", "2026-07-01"),          // left before the 60-day window
  ];
  const m = computeMovement(list, T);
  it("counts a joiner who already left on both sides", () => {
    expect(m.joins).toBe(2);
    expect(m.exits).toBe(2);
  });
  it("measures opening and closing headcount from dates", () => {
    expect(m.hcNow).toBe(4);       // 3 long-standing + the one still-here joiner
    expect(m.hcOpen).toBe(4);      // 30 days ago (2026-09-02): the three, plus the 2025-01-01 leaver who left 09-15
  });
  it("flags exits under 90 days of tenure", () => {
    expect(m.earlyExits).toBe(1);
  });
  it("does not count a pre-boarding future-dated joiner as headcount", () => {
    expect(computeMovement([row("2026-11-01", null)], T).hcNow).toBe(0);
  });
});

describe("month-end headcount and monthly counts", () => {
  it("works back from today so headcount reconciles with joins and exits", () => {
    const months = ["2026-08", "2026-09", "2026-10"];
    const joins = new Map([["2026-09", 10], ["2026-10", 4]]);
    const exits = new Map([["2026-09", 6], ["2026-10", 1]]);
    expect(monthEndHeadcount(100, months, joins, exits)).toEqual([93, 97, 100]);
  });
  it("buckets joins and exits by calendar month", () => {
    const { joins, exits } = monthlyCounts([row("2026-09-05", "2026-09-20"), row("2026-09-06", null)], T, ["2026-09", "2026-10"]);
    expect(joins.get("2026-09")).toBe(2);
    expect(exits.get("2026-09")).toBe(1);
  });
  it("monthStart steps back whole months", () => {
    expect(monthStart("2026-10-02", 11)).toBe("2025-11-01");
  });
});

describe("tenure, reasons and groups", () => {
  const list = [row("2026-09-20", "2026-09-25"), row("2026-08-01", "2026-09-20"), row("2025-01-01", "2026-09-10", { reason: "Resigned - Relocation" })];
  it("distributes exits across tenure buckets", () => {
    const d = Object.fromEntries(tenureDistribution(list, T).map((x) => [x.label, x.value]));
    expect(d["< 30 days"]).toBe(1);
    expect(d["30-89 days"]).toBe(1);
    expect(d["1 year +"]).toBe(1);
  });
  it("tenureBucket edges", () => {
    expect([29, 30, 89, 90, 179, 180, 364, 365].map(tenureBucket)).toEqual(["< 30 days", "30-89 days", "30-89 days", "90-179 days", "90-179 days", "180-364 days", "180-364 days", "1 year +"]);
    expect(tenureBucket(-1)).toBeNull();
  });
  it("reports how many exits carry a reason", () => {
    expect(reasonCoverage(list, T)).toMatchObject({ total: 3, withReason: 1 });
  });
  it("gives a wound-down group a null rate instead of 200%", () => {
    const g = groupMovement([row("2026-01-01", "2026-09-20", { processId: "closed" }), row("2026-01-01", "2026-09-21", { processId: "closed" })], T, (r) => r.processId);
    expect(g[0].headcount).toBe(0);
    expect(g[0].attrition).toBeNull();
  });
});

describe("queues, health and funnel", () => {
  it("severity follows overdue share, not just size", () => {
    expect(queueSeverity(0, 0)).toBe("info");
    expect(queueSeverity(null, null)).toBe("info");
    expect(queueSeverity(3, 0)).toBe("normal");
    expect(queueSeverity(3, 1)).toBe("high");
    expect(queueSeverity(10, 6)).toBe("critical");
    expect(queueSeverity(40, 0)).toBe("high");
  });
  it("scoreBetween is linear and clamped", () => {
    expect(scoreBetween(3, 3, 15)).toBe(100);
    expect(scoreBetween(15, 3, 15)).toBe(0);
    expect(scoreBetween(9, 3, 15)).toBe(50);
    expect(scoreBetween(null, 3, 15)).toBeNull();
  });
  it("health needs at least half the weight measurable", () => {
    expect(composeHealth([{ label: "a", score: 80, weight: 50 }, { label: "b", score: null, weight: 50 }]).score).toBe(80);
    expect(composeHealth([{ label: "a", score: 80, weight: 30 }, { label: "b", score: null, weight: 70 }]).score).toBeNull();
  });
  it("onboarding funnel is cumulative and excludes rejected / cancelled", () => {
    const f = onboardingFunnel({ pending: 10, profile_submitted: 6, hr_approved: 4, offer_submitted: 3, rejected: 50 });
    expect(f.map((x) => x.value)).toEqual([23, 13, 7, 3, 0, 0]);
    for (let i = 1; i < f.length; i++) expect(f[i].value).toBeLessThanOrEqual(f[i - 1].value);
  });
  it("hiring coverage caps over-staffed processes and sums shortage", () => {
    const c = hiringCoverage([{ target: 100, active: 120, short: 0 }, { target: 100, active: 50, short: 50 }]);
    expect(c).toMatchObject({ target: 200, shortage: 50, short: 1, coverage: 75 });
  });
});

describe("attendance anchor and absentees", () => {
  it("skips a day with under 90% of the busiest day's rows", () => {
    const days = [{ d: "2026-09-29", n: 1081 }, { d: "2026-09-30", n: 1068 }, { d: "2026-10-01", n: 753 }];
    expect(pickAnchor(days)).toBe("2026-09-30");
    expect(pickAnchor(days, 0.5)).toBe("2026-10-01");
    expect(pickAnchor([])).toBeNull();
  });
  it("long absentees need an absent row on every one of the 5 days", () => {
    const r = classifyAbsentees([
      { days7: 7, absent7: 7, days5: 5, absent5: 5 },
      { days7: 7, absent7: 5, days5: 5, absent5: 5 },
      { days7: 6, absent7: 5, days5: 4, absent5: 4 },   // week-off in the window: not a streak
      { days7: 7, absent7: 3, days5: 5, absent5: 3 },
    ]);
    expect(r.long5).toHaveLength(2);
    expect(r.abscond7).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("lit only accepts a calendar date", () => {
    expect(lit("2026-10-02")).toBe("'2026-10-02'");
    expect(() => lit("2026-10-02'; DROP TABLE x;--")).toThrow();
    expect(addDays("2026-10-02", -30)).toBe("2026-09-02");
  });
});

describe("HR provider wiring", () => {
  it("registers independent sections so one slow query cannot blank the page", () => {
    const names = Object.keys(hr.sections);
    expect(names.length).toBeGreaterThanOrEqual(10);
    for (const n of ["queueLeaveAttendance", "queueExit", "queueOnboarding", "headcountMovement", "attritionBreakdown", "hiring", "attendance", "compliance", "health"]) {
      expect(names).toContain(n);
    }
  });
});

describe("metric-service corrections made for the HR dashboard (source guards)", () => {
  const src = readFileSync(resolve(__dirname, "../../dashboard-metric.service.ts"), "utf8");
  const resign = src.slice(src.indexOf("export async function getResignationMetrics"), src.indexOf("export async function getDpdpWithdrawalMetrics"));
  it("resignation 'awaiting review' uses the statuses the exit FSM actually writes", () => {
    for (const s of ["submitted", "manager_review", "hr_review", "admin_review"]) expect(resign).toContain(`'${s}'`);
    // withdrawn / revoked / rejected exits are not open resignations
    expect(resign).toMatch(/NOT IN \('completed','cancelled','exited','withdrawn','revoked','rejected','draft'\)/);
  });
  it("leave oldest-pending age and already-started count only look at the live (post-cutoff) queue", () => {
    const leave = src.slice(src.indexOf("export async function getLeaveApprovalMetrics"));
    expect(leave).toMatch(/pendingAlreadyStarted/);
    expect(leave).toMatch(/raisedOnOrAfterCutoffSql\(LEAVE_RAISED_AT\)\} THEN DATEDIFF\(CURDATE\(\), lr\.from_date\) END\) AS oldestPendingDays/);
  });
});
