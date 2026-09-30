import { describe, expect, it } from "vitest";
import {
  SHRINK_CRIT, SHRINK_WARN, attritionRate, bucketAonRows, buildInsights, deltaOf, fmtDate, fmtDateTime, fmtNum, fmtPct, shrinkTone, sortRows, stageLabel,
} from "@/pages/wfm/roster-command-center/trends/trendsCalc";

const day = (over: Record<string, number> = {}) => ({
  date: "2026-09-30", hasData: true, scheduled: 100, present: 80, absent: 12, onLeave: 8, late: 4,
  shrinkagePct: 20, unplannedPct: 12, plannedPct: 8, attendancePct: 80, lateRatePct: 5, ...over,
});

describe("formatting", () => {
  it("formats dates DD/MM/YYYY and Indian numbers", () => {
    expect(fmtDate("2026-09-30")).toBe("30/09/2026");
    expect(fmtDate(null)).toBe("—");
    expect(fmtNum(1234567)).toBe("12,34,567");
    expect(fmtNum(NaN)).toBe("—");
    expect(fmtPct(12.345)).toBe("12.3%");
    expect(fmtPct(undefined)).toBe("—");
    expect(fmtDateTime("not-a-date")).toBe("—");
    expect(fmtDateTime("2026-09-30T08:05:00")).toMatch(/^30\/09\/2026 \d{2}:\d{2}$/);
  });
  it("labels stages and falls back to a readable name", () => {
    expect(stageLabel("generated")).toBe("Not yet published");
    expect(stageLabel("some_new_stage")).toBe("some new stage");
  });
});

describe("shrinkTone", () => {
  it("uses one set of thresholds everywhere", () => {
    expect(shrinkTone(SHRINK_WARN - 0.1)).toBe("green");
    expect(shrinkTone(SHRINK_WARN)).toBe("amber");
    expect(shrinkTone(SHRINK_CRIT)).toBe("red");
    expect(shrinkTone(null)).toBe("neutral");
    expect(shrinkTone(NaN)).toBe("neutral");
  });
});

describe("sortRows", () => {
  const rows = [{ n: "b", v: 2 }, { n: "A", v: null }, { n: "c", v: 10 }, { n: "d", v: 2 }];
  it("sorts numerically, keeps nulls last in both directions, and is stable", () => {
    expect(sortRows(rows, (r) => r.v, "asc").map((r) => r.n)).toEqual(["b", "d", "c", "A"]);
    expect(sortRows(rows, (r) => r.v, "desc").map((r) => r.n)).toEqual(["c", "b", "d", "A"]);
  });
  it("sorts strings case-insensitively with natural numbers", () => {
    expect(sortRows([{ n: "p10" }, { n: "P2" }, { n: "a" }], (r) => r.n, "asc").map((r) => r.n)).toEqual(["a", "P2", "p10"]);
  });
});

describe("attrition", () => {
  it("uses exits / (headcount + exits) and never divides by zero", () => {
    expect(attritionRate(10, 90)).toBe(10);
    expect(attritionRate(5, 0)).toBe(100);
    expect(attritionRate(0, 0)).toBeNull();
  });
  it("buckets report rows and sums duplicates across branch/process groups", () => {
    const b = bucketAonRows(
      [{ aon_bucket: "0-30", headcount: 10 }, { aon_bucket: "0-30", headcount: "5" }, { aon_bucket: "90+", headcount: 100 }, { aon_bucket: "weird", headcount: 9 }],
      [{ aon_bucket: "0-30", exits: 5 }, { aon_bucket: "90+", exits: 1 }],
    );
    expect(b.map((x) => x.bucket)).toEqual(["0-30", "31-60", "61-90", "90+"]);
    expect(b[0]).toMatchObject({ headcount: 15, exits: 5, ratePct: 25 });
    expect(b[1].ratePct).toBeNull();
  });
});

describe("deltaOf", () => {
  it("returns pts change rounded to 1dp, undefined when unknown", () => {
    expect(deltaOf(12.34, 10)).toBe(2.3);
    expect(deltaOf(1, null)).toBeUndefined();
  });
});

describe("buildInsights", () => {
  const funnel = { total: 100, published: 50, unpublished: 50, awaitingAck: 20, acknowledged: 25, disputed: 5, publishedPct: 50, ackPctOfPublished: 50, disputedPctOfPublished: 10 };
  it("orders critical before warning before info", () => {
    const out = buildInsights({
      shrink: { summary: day({ shrinkagePct: 30 }), missingDates: ["2026-09-29"], futureOnly: false },
      publish: { funnel, upcomingUnpublished: 12 },
      late: { totals: { events: 10, employees: 5, avgNetMinutes: 8, mild: 5, moderate: 3, severe: 2, severePct: 20, habitualEmployees: 3 } },
    });
    const sev = out.map((i) => i.severity);
    expect(sev).toEqual([...sev].sort((a, b) => ["critical", "warning", "info"].indexOf(a) - ["critical", "warning", "info"].indexOf(b)));
    expect(out[0].severity).toBe("critical");
    expect(out.find((i) => i.id === "shrink-crit")?.section).toBe("shrinkage");
    expect(out.find((i) => i.id === "disputed")?.count).toBe(5);
    expect(out.find((i) => i.id === "gaps")?.severity).toBe("info");
  });
  it("raises nothing for a healthy or empty scope, and never for future-only ranges", () => {
    expect(buildInsights({})).toEqual([]);
    expect(buildInsights({ shrink: { summary: day({ shrinkagePct: 5 }), missingDates: [], futureOnly: false } })).toEqual([]);
    expect(buildInsights({ shrink: { summary: day({ shrinkagePct: 50 }), missingDates: ["x"], futureOnly: true } })).toEqual([]);
  });
});
