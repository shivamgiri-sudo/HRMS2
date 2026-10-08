import { describe, expect, it } from "vitest";
import { bestSource, median, momentum, peerMedian, pct, poolRows, radarValues, rankRecruiters, recruiterFindings, toStats, type RecruiterStats } from "../sourcing-helpers";

const R = (o: Partial<RecruiterStats>): RecruiterStats => ({ name: "x", handled: 50, selected: 10, rejected: 20, joined: 5, selRate: 20, joinRate: 50, showUp: 80, decidedRate: 90, ...o });

describe("sourcing-helpers", () => {
  it("pct and median handle empty and even sets", () => {
    expect(pct(1, 0)).toBe(0); expect(pct(1, 3)).toBe(33.3);
    expect(median([])).toBe(0); expect(median([1, 3])).toBe(2); expect(median([5, 1, 3])).toBe(3);
  });
  it("bestSource ignores thin samples", () => {
    const rows = [{ name: "a", n: 5, r: 90 }, { name: "b", n: 20, r: 10 }, { name: "c", n: 30, r: 15 }];
    expect(bestSource(rows, (x) => x.n, (x) => x.r)?.name).toBe("c");
    expect(bestSource([rows[0]], (x) => x.n, (x) => x.r)).toBeNull();
  });
  it("toStats derives show-up from noShowRate or counts", () => {
    expect(toStats({ name: "a", total: 100, selected: 10, rejected: 5, selRate: 10, noShowRate: 20, joined: 4 }).showUp).toBe(80);
    expect(toStats({ name: "a", total: 100, selected: 10, rejected: 5, selRate: 10, noShow: 10 }).showUp).toBe(90);
    expect(toStats({ name: "a", total: 10, selected: 4, rejected: 0, selRate: 40, joined: 2 }).joinRate).toBe(50);
  });
  it("rankRecruiters puts thin samples last", () => {
    const r = rankRecruiters([R({ name: "thin", handled: 2, selected: 2 }), R({ name: "b", selected: 3 }), R({ name: "a", selected: 9 })]);
    expect(r.map((x) => x.name)).toEqual(["a", "b", "thin"]);
    expect(r[2].thin).toBe(true); expect(r[0].rank).toBe(1);
  });
  it("peerMedian skips thin recruiters", () => {
    const p = peerMedian([R({ selRate: 10 }), R({ selRate: 30 }), R({ selRate: 99, handled: 1 })]);
    expect(p.selRate).toBe(20);
  });
  it("radarValues puts peer volume at 50 and clamps", () => {
    const peer = R({ handled: 40 });
    expect(radarValues(R({ handled: 40 }), peer)[3]).toBe(50);
    expect(radarValues(R({ handled: 400 }), peer)[3]).toBe(100);
    expect(radarValues(R({ selRate: 140 }), peer)[0]).toBe(100);
    expect(radarValues(R({}), peer)).toHaveLength(5);
  });
  it("findings report gaps in points and stay quiet under 5", () => {
    const f = recruiterFindings(R({ selRate: 11 }), R({ selRate: 20 }));
    expect(f.find((x) => x.key === "selection")?.title).toBe("Selection 9 pts below peers");
    expect(f.find((x) => x.key === "selection")?.tone).toBe("bad");
    expect(recruiterFindings(R({}), R({}))[0].key).toBe("good");
    expect(recruiterFindings(R({ handled: 2 }), R({}))[0].key).toBe("thin");
  });
  it("momentum compares the last two months", () => {
    expect(momentum([{ month: "1", A: 10 }, { month: "2", A: 15 }], ["A"])).toEqual([{ name: "A", prev: 10, last: 15, change: 50 }]);
    expect(momentum([{ month: "1", A: 1 }], ["A"])).toEqual([]);
  });
  it("poolRows tolerates junk", () => {
    expect(poolRows(undefined)).toEqual([]);
    expect(poolRows([{ CandidateID: "C1", FullName: "A" }])[0]).toMatchObject({ id: "C1", name: "A", branch: "" });
  });
});

describe("real-data guards (found on production)", () => {
  const trend = [{ month: "2026-08", A: 100 }, { month: "2026-09", A: 120 }, { month: "2026-10", A: 3 }];

  it("momentum leaves out the month still in progress", async () => {
    const { momentum } = await import("../sourcing-helpers");
    const m = momentum(trend, ["A"], "2026-10");
    expect(m[0]).toMatchObject({ prev: 100, last: 120, change: 20 });
  });

  it("momentum still compares the last two months once a month is complete", async () => {
    const { momentum } = await import("../sourcing-helpers");
    expect(momentum(trend, ["A"], "2026-11")[0]).toMatchObject({ prev: 120, last: 3 });
  });

  it("recognises raw database ids and unowned recruiter buckets", async () => {
    const { isRawId, isUnowned } = await import("../sourcing-helpers");
    expect(isRawId("04f4f313-67ba-11f1-adb1-00155d0ab410")).toBe(true);
    expect(isRawId("Inbound Agent")).toBe(false);
    expect(["Unassigned", "Unspecified", "Unmapped"].every(isUnowned)).toBe(true);
    expect(isUnowned("KHUSHI MISHRA")).toBe(false);
  });
});
