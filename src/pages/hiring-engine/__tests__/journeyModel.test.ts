/** Full-journey funnel per drive and the three-drive comparison (pure view-models). */
import { describe, expect, it } from "vitest";
import { MIN_SAMPLE, driveJourney, journeyCompare, journeyCsv, journeyCsvName } from "../command/charts/journeyModel";
import { STAGES } from "../command/driveCommandTypes";
import type { DriveAnalytics, JourneyCounts, StageCounts } from "../command/driveCommandTypes";

const sc = (o: Partial<StageCounts> = {}): StageCounts => ({ leads: 0, qualified: 0, invited: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0, ...o });
const jc = (o: Partial<JourneyCounts> = {}): JourneyCounts => ({ leads: 0, fills: 0, screened: 0, qualified: 0, contacted: 0, invited: 0, replied: 0, confirmed: 0, arrived: 0, ...o });
const typ = (s: StageCounts, noShow = 0) => ({ stages: s, previous: sc(), noShow, declined: 0, conversions: STAGES.slice(1).map((to, i) => ({ from: STAGES[i], to, rate: null })), sparkline: [] });
// The prod picture of 8 Oct 2026 (default window): Live Meta stalled at contact, Old Meta contacted from older fills, HE without form fills.
const prod = (over: Partial<DriveAnalytics> = {}): DriveAnalytics => ({
  generatedAt: "", window: { from: "2026-09-25", to: "2026-10-08", days: 14 }, previousWindow: { from: "2026-09-11", to: "2026-09-24" },
  filter: { requisitionId: null, branch: null }, followupMode: "off", qualifiedTracked: false,
  types: {
    meta_live: typ(sc({ leads: 91, invited: 0 })),
    meta_old: typ(sc({ leads: 344, invited: 257, confirmed: 18, arrived: 3 }), 190),
    he: typ(sc({ leads: 241, invited: 112, confirmed: 8 }), 105),
  },
  journey: {
    meta_live: jc({ leads: 91, fills: 91, screened: 91, qualified: 78 }),
    meta_old: jc({ leads: 344, fills: 103, screened: 103, qualified: 37, contacted: 257, invited: 257, replied: 25, confirmed: 18, arrived: 3 }),
    he: jc({ leads: 241, contacted: 112, invited: 112, replied: 11, confirmed: 8 }),
  },
  typesPresent: ["meta_live", "meta_old", "he"], daily: [], timing: { replies: {}, arrivals: {}, arrivalsWithoutTime: 0 }, scatter: [], waterfall: { meta_live: [], meta_old: [], he: [] },
  groups: [], cost: { available: false, note: "" }, insights: [], requisitionCount: 5, truncated: false, partial: false, failedSections: [], ...over,
}) as unknown as DriveAnalytics;

describe("driveJourney", () => {
  it("Live Meta: every stage from form fill to joined, counts, conversion from the previous stage and from the start, and drop-off", () => {
    const j = driveJourney(prod(), "meta_live");
    expect(j.rows.map((r) => r.key)).toEqual(["leads", "fills", "screened", "qualified", "contacted", "invited", "replied", "confirmed", "arrived", "selected", "joined"]);
    const q = j.rows.find((r) => r.key === "qualified")!;
    expect(q).toMatchObject({ count: 78, fromPrevText: "86%", fromStartText: "86%", dropOff: 13 });
    const c = j.rows.find((r) => r.key === "contacted")!;
    expect(c).toMatchObject({ count: 0, fromPrevText: "0%", dropOff: 78 });
    expect(j.biggestDrop).toEqual({ from: "qualified", to: "contacted", lost: 78 });
    expect(j.start).toBe("leads");
    expect(j.table.columns).toEqual(["Stage", "People", "From previous stage", "From start", "Drop-off"]);
    expect(j.table.rows[3]).toEqual(["Qualified (screening)", "78", "86%", "86%", "13"]);
  });
  it("a stage with more people than the stage before shows no rate and says why (Old Meta contacts older form fills)", () => {
    const j = driveJourney(prod(), "meta_old");
    const c = j.rows.find((r) => r.key === "contacted")!;
    expect(c).toMatchObject({ count: 257, fromPrev: null, fromPrevText: "–", notSubset: true, dropOff: null, dropOffText: "–" });
    expect(j.notes.join(" ")).toContain("did not all pass through the stage before");
  });
  it("Hiring Engine starts at the first stage that exists and says so; qualified appears only while it is tracked", () => {
    const j = driveJourney(prod(), "he");
    expect(j.rows.map((r) => r.key)).toEqual(["leads", "contacted", "invited", "replied", "confirmed", "arrived", "selected", "joined"]);
    expect(j.notes[0]).toBe("Hiring Engine has no form fill or screening, so its funnel starts at Leads: people lined up on a drive or messaged in this range.");
    const tracked = driveJourney(prod({ qualifiedTracked: true, types: { ...prod().types, he: typ(sc({ leads: 241, qualified: 30, invited: 112 })) } }), "he");
    expect(tracked.rows.map((r) => r.key)).toContain("qualified");
  });
  it("hides percentages under the minimum sample and states the sample", () => {
    const a = prod({ journey: { ...prod().journey!, meta_live: jc({ leads: 12, fills: 12, screened: 12, qualified: 9, contacted: 5 }) } });
    const j = driveJourney(a, "meta_live");
    expect(j.rows.find((r) => r.key === "qualified")).toMatchObject({ fromPrev: null, fromPrevText: "–", fromStartText: "–", dropOff: 3 });
    expect(j.notes).toContain(`Percentages need at least ${MIN_SAMPLE} people at the stage they start from; smaller steps show counts only.`);
  });
  it("without the journey (older server or a failed read) shows the main stages and says what is missing", () => {
    const old = driveJourney(prod({ journey: undefined }), "meta_old");
    expect(old.rows.map((r) => r.key)).toEqual(["leads", "invited", "confirmed", "arrived", "selected", "joined"]);
    expect(old.notes.join(" ")).toContain("Form fills, screening, contact and replies are not available");
    expect(driveJourney(prod({ journey: null }), "meta_old").notes.join(" ")).toContain("could not be read");
  });
  it("an empty drive is empty, never NaN", () => {
    const j = driveJourney(prod({ journey: { meta_live: jc(), meta_old: jc(), he: jc() }, types: { meta_live: typ(sc()), meta_old: typ(sc()), he: typ(sc()) } }), "meta_live");
    expect(j.empty).toBe(true);
    expect(JSON.stringify(j)).not.toContain("NaN");
  });
});

describe("journeyCompare", () => {
  it("one row per stage across the three drives, n/a where a stage does not exist for a drive", () => {
    const v = journeyCompare(prod());
    expect(v.rows.map((r) => r.key)).toEqual(["leads", "fills", "screened", "qualified", "contacted", "invited", "replied", "confirmed", "arrived", "selected", "joined"]);
    const fills = v.rows.find((r) => r.key === "fills")!;
    expect(fills.cells.he).toMatchObject({ count: null, countText: "n/a" });
    expect(fills.cells.meta_live).toMatchObject({ count: 91, countText: "91" });
  });
  it("marks the highest and lowest step conversion per stage in words and an icon name, not colour alone", () => {
    const v = journeyCompare(prod());
    const conf = v.rows.find((r) => r.key === "confirmed")!; // Old 18/25 = 72%, HE 8/11 under the sample, Live none
    expect(conf.cells.meta_old.level).toBeNull(); // only one drive has a rate: nothing to compare
    const inv = v.rows.find((r) => r.key === "invited")!; // Old 257/257 100%, HE 112/112 100%: a tie is not a winner
    expect(inv.cells.meta_old.level).toBeNull();
    const rep = v.rows.find((r) => r.key === "replied")!; // Old 25/257 10%, HE 11/112 10% -> tie
    expect(rep.cells.he.level).toBeNull();
    const a = prod({ journey: { ...prod().journey!, he: jc({ leads: 241, contacted: 112, invited: 112, replied: 40, confirmed: 30 }) } });
    const r2 = journeyCompare(a).rows.find((r) => r.key === "replied")!;
    expect(r2.cells.he).toMatchObject({ level: "high", levelText: "Highest", rateText: "36%" });
    expect(r2.cells.meta_old).toMatchObject({ level: "low", levelText: "Lowest", rateText: "10%" });
    expect(journeyCompare(a).aria).toContain("Replied");
  });
  it("CSV has the same numbers as the table, one row per stage, formula-safe through toCsv", () => {
    const a = prod();
    const csv = journeyCsv(a);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe("Stage,Live Meta people,Live Meta from previous,Live Meta from start,Live Meta drop-off,Old Meta data people,Old Meta data from previous,Old Meta data from start,Old Meta data drop-off,Hiring Engine people,Hiring Engine from previous,Hiring Engine from start,Hiring Engine drop-off");
    expect(lines.find((l) => l.startsWith("Qualified"))).toBe("Qualified,78,86%,86%,13,37,36%,11%,66,,,,");
    expect(journeyCsvName(a)).toBe("drive-funnel-comparison-2026-09-25-to-2026-10-08.csv");
  });
});
