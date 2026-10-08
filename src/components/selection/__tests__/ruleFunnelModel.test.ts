import { describe, expect, it } from "vitest";
import { cellView, funnelView, outcomeTiles, partialText, SUB_SOURCES_FOR } from "../ruleFunnelModel";
import type { PreviewResult } from "../selectionTypes";

const P = (o: Partial<PreviewResult> = {}): PreviewResult => ({ requisitionId: "r1", versionId: "v", draft: false, source: "he", subSource: "all", start: 40,
  steps: [
    { key: "system", label: "System rules (never contacted)", kind: "system", remaining: 30, failedHere: 10, reviewHere: 0, onlyThisRuleFails: 10, ifRemovedGain: 0 },
    { key: "age", label: "Age: 18 to 35", kind: "must", remaining: 22, failedHere: 8, reviewHere: 5, onlyThisRuleFails: 6, ifRemovedGain: 4 },
    { key: "night_shift", label: "Willing to work night shift: willing to work night shift", kind: "must", remaining: 20, failedHere: 2, reviewHere: 9, onlyThisRuleFails: 2, ifRemovedGain: 1 },
  ],
  outcome: { shortlist: 8, review: 12, rejected: 10, systemExcluded: 10 }, scoreBuckets: [{ from: 0, to: 20, n: 1 }, { from: 20, to: 40, n: 19 }], sample: [],
  capPreview: { seatsLeft: 6, dailyCap: null }, generatedAt: "t", partial: [], ...o });

describe("funnelView: one adapter for the bars and the table", () => {
  it("bars and table rows carry the same numbers (parity)", () => {
    const v = funnelView(P());
    expect(v.bars.map((b) => [b.label, b.still, b.left])).toEqual([["Everyone in the source", 40, 0], ["System rules (never contacted)", 30, 10], ["Age: 18 to 35", 22, 8], ["Willing to work night shift", 20, 2]]);
    for (const [i, b] of v.bars.entries()) expect([v.table.rows[i][1], v.table.rows[i][2]]).toEqual([String(b.still), String(b.left)]);
    expect(v.table.columns).toEqual(["Step", "Still in", "Left at this step", "Sent to review here", "Fail only this rule", "Would pass if removed"]);
    expect(v.table.rows[2]).toEqual(["Age: 18 to 35", "22", "8", "5", "6", "4"]);
    expect(v.aria).toBe("Rule funnel: 40 people start, 20 remain after every rule; 8 shortlisted, 12 for review, 10 rejected, 10 never contacted.");
  });
  it("empty source", () => expect(funnelView(P({ start: 0, steps: [] })).empty).toBe(true));
});

describe("outcome tiles and partial banner", () => {
  it("tiles are words plus numbers", () => {
    expect(outcomeTiles(P()).map((t) => `${t.label} ${t.value}`)).toEqual(["Shortlist 8", "Review 12", "Rejected 10", "Never contacted 10", "Seats left 6"]);
  });
  it.each([
    [["facts_cache_empty_live_read"], "The facts cache was empty for this source, so the records were read live."],
    [["facts_cache_empty_live_read_capped_at_5000"], "The facts cache was empty, so the first 5,000 records were read live: the counts are partial."],
    [["capped_at_100000"], "Only the first 1,00,000 people were evaluated: the counts are partial."],
    [[], null],
  ])("%o", (p, txt) => expect(partialText(P({ partial: p as string[] }))).toBe(txt));
});

describe("sample cells", () => {
  it("icon + word per outcome, with the reason as the accessible name", () => {
    expect(cellView({ key: "age", outcome: "fail", text: "age 41 (required 18 to 35)" })).toEqual({ icon: "x", word: "No", aria: "Age: no, age 41 (required 18 to 35)" });
    expect(cellView({ key: "age", outcome: "unknown", text: "unknown: not on record (required 18 to 35)" })).toMatchObject({ icon: "help", word: "Unknown" });
    expect(cellView({ key: "age", outcome: "pass", text: "age 25" })).toMatchObject({ icon: "check", word: "Yes" });
  });
  it("sub-source filters per source", () => {
    expect(SUB_SOURCES_FOR.he.map((s) => s.id)).toEqual(["all", "candidate", "naukri_import", "workindia_import", "walk_in", "intake_upload", "pool_other"]);
    expect(SUB_SOURCES_FOR.meta_live.map((s) => s.id)).toEqual(["all"]);
  });
});
