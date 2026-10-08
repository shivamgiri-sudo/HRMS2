import { describe, expect, it } from "vitest";
import { categoryOf, drillsForCheck, groupChecks, healthScore, isForbidden, loadRecent, pushRecent, saveRecent, scoreTone, checkLabel, type RecentCandidate } from "../controls-helpers";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

describe("controls helpers", () => {
  it("puts schema checks in their own category", () => {
    expect(categoryOf({ type: "schema", name: "ats_candidate" })).toBe("schema");
    expect(categoryOf({ type: "weird" })).toBe("other");
    const g = groupChecks([{ type: "schema", ok: true }, { type: "sla", ok: false }, { type: "schema", ok: false }]);
    expect(g.map((x) => x.key)).toEqual(["sla", "schema"]);
    expect(g[1].failed).toBe(1);
  });
  it("scores without NaN", () => {
    expect(healthScore([])).toBeNull();
    expect(healthScore([{ ok: true }, { ok: false }, { ok: true }])).toBe(67);
    expect(scoreTone(100)).toBe("good"); expect(scoreTone(85)).toBe("warn"); expect(scoreTone(50)).toBe("bad"); expect(scoreTone(null)).toBe("none");
  });
  it("maps failing checks to drills only when known", () => {
    expect(drillsForCheck({ name: "candidates_without_branch", ok: false })[0].filters).toEqual({ branch: "Unspecified" });
    expect(drillsForCheck({ name: "candidates_without_branch", ok: true })).toEqual([]);
    expect(drillsForCheck({ name: "open_queue_beyond_7_days", ok: false }).map((d) => d.filters.idle)).toEqual(["8-14d", "15d+"]);
    expect(drillsForCheck({ name: "rejections_without_reason", ok: false })).toEqual([]);
  });
  it("detects forbidden and labels", () => {
    expect(isForbidden(403)).toBe(true); expect(isForbidden(500, "boom")).toBe(false); expect(isForbidden(null, "Insufficient permissions")).toBe(true);
    expect(checkLabel("open_queue_beyond_7_days")).toBe("Open queue beyond 7 days");
  });
  it("keeps recent list unique, newest first, capped, and tolerates bad storage", () => {
    let l: RecentCandidate[] = [];
    for (let i = 0; i < 12; i++) l = pushRecent(l, { id: String(i), name: `n${i}` });
    l = pushRecent(l, { id: "5", name: "n5" });
    expect(l.length).toBe(8); expect(l[0].id).toBe("5"); expect(l.filter((x) => x.id === "5").length).toBe(1);
    const s = mem(); saveRecent(l, s); expect(loadRecent(s)).toEqual(l);
    s.setItem("ats-cc-recent-candidates", "{bad"); expect(loadRecent(s)).toEqual([]);
    expect(loadRecent({ getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } })).toEqual([]);
    expect(() => saveRecent(l, { getItem: () => null, setItem: () => { throw new Error("x"); } })).not.toThrow();
  });
});
