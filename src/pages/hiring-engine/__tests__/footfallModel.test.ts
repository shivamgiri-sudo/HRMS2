/** "Plan to raise footfall": open seats -> arrivals needed -> people needed per stage at the drive's own rates (planMath reuse). */
import { describe, expect, it } from "vitest";
import { footfallPlan } from "../command/footfallModel";
import { invitesToClose } from "../command/planMath";
import { STAGES } from "../command/driveCommandTypes";
import type { DriveAnalytics, JourneyCounts, OpenSeats, StageCounts } from "../command/driveCommandTypes";

const sc = (o: Partial<StageCounts> = {}): StageCounts => ({ leads: 0, qualified: 0, invited: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0, ...o });
const jc = (o: Partial<JourneyCounts> = {}): JourneyCounts => ({ leads: 0, fills: 0, screened: 0, qualified: 0, contacted: 0, invited: 0, replied: 0, confirmed: 0, arrived: 0, ...o });
const typ = (s: StageCounts, noShow = 0) => ({ stages: s, previous: sc(), noShow, declined: 0, conversions: STAGES.slice(1).map((to, i) => ({ from: STAGES[i], to, rate: null })), sparkline: [] });
const seat = (requisitionId: string, open: number, closedReason: string | null = null): OpenSeats => ({ requisitionId, code: `REQ-${requisitionId}`, branch: "B", open, closedReason });
const an = (o: Partial<DriveAnalytics>): DriveAnalytics => ({
  types: { meta_live: typ(sc()), meta_old: typ(sc()), he: typ(sc()) }, journey: { meta_live: jc(), meta_old: jc(), he: jc() },
  openSeats: [seat("a", 32), seat("b", 15), seat("c", 0, "requisition is closed")], ...o,
} as unknown as DriveAnalytics);

describe("footfallPlan", () => {
  it("prod Old Meta: 47 open seats, a 1% invite-to-arrival rate is floored at 5% by the planner and the measured need is stated too", () => {
    const a = an({ types: { meta_live: typ(sc()), meta_old: typ(sc({ leads: 344, invited: 257, confirmed: 18, arrived: 3 }), 190), he: typ(sc()) },
      journey: { meta_live: jc(), meta_old: jc({ leads: 344, contacted: 257, invited: 257, confirmed: 18, arrived: 3 }), he: jc() } });
    const p = footfallPlan(a, "meta_old");
    expect(p).toMatchObject({ available: true, openSeats: 47, requisitions: 2, closedRequisitions: 1, target: 47, joinRate: null, pending: 0, expected: 0, gap: 47 });
    expect(p.targetText).toBe("One arrival per open seat, the minimum: too few joins are measured yet (0 joined of 3 arrived).");
    const inv = p.needs.find((n) => n.stage === "invited")!;
    expect(inv).toMatchObject({ base: 257, rateText: "1%", needed: invitesToClose(47, 0, 3 / 257), raw: Math.ceil(47 / (3 / 257)), floored: true });
    expect(inv.neededText).toBe("940");
    expect(inv.note).toBe("The planner never assumes less than 5%, so 940 is a floor; at the measured 1% it is 4,027.");
    expect(p.needs.map((n) => n.stage)).toEqual(["leads", "contacted", "invited", "confirmed"]);
    expect(p.needs.find((n) => n.stage === "confirmed")!).toMatchObject({ base: 18, needed: null, neededText: "Not enough data (18 people)" });
  });
  it("a drive with nobody arrived has no rate to plan from and says so", () => {
    const a = an({ types: { meta_live: typ(sc()), meta_old: typ(sc()), he: typ(sc({ leads: 241, invited: 112, confirmed: 8 }), 105) } });
    const p = footfallPlan(a, "he");
    expect(p.needs.find((n) => n.stage === "invited")).toMatchObject({ rate: 0, needed: null, neededText: "No arrivals yet" });
    expect(p.summary).toContain("47 open seats");
  });
  it("uses the measured join rate and the expected arrivals of people already confirmed", () => {
    const a = an({ openSeats: [seat("a", 10)], types: { meta_live: typ(sc({ leads: 400, invited: 200, confirmed: 100, arrived: 40, joined: 20 }), 20), meta_old: typ(sc()), he: typ(sc()) },
      journey: { meta_live: jc({ leads: 400, contacted: 300, invited: 200, confirmed: 100, arrived: 40 }), meta_old: jc(), he: jc() } });
    const p = footfallPlan(a, "meta_live");
    expect(p.joinRate).toBe(0.5);
    expect(p.target).toBe(20); // 10 seats / 50% of arrivals join
    expect(p.showRate).toBeCloseTo(40 / 60);
    expect(p.pending).toBe(40); // 100 confirmed - 40 arrived - 20 no-show
    expect(p.expected).toBeCloseTo(26.7, 1);
    expect(p.gap).toBe(0);
    expect(p.needs.every((n) => n.needed === 0)).toBe(true);
    expect(p.summary).toBe("To fill 10 open seats, Live Meta needs about 20 arrivals. About 26.7 are expected from people already confirmed, so no more are needed now.");
  });
  it("no open seats, or an older server without open seats", () => {
    expect(footfallPlan(an({ openSeats: [seat("c", 0, "requisition is closed")] }), "he")).toMatchObject({ available: true, openSeats: 0, needs: [] });
    expect(footfallPlan(an({ openSeats: undefined }), "he")).toMatchObject({ available: false, unavailableText: "Open seats are not available from this server yet." });
  });
  it("text table and numbers never show NaN", () => {
    const p = footfallPlan(an({}), "meta_live");
    expect(p.table.columns).toEqual(["Stage", "People in range", "Arrived per person", "Needed to close the gap"]);
    expect(JSON.stringify(p)).not.toContain("NaN");
  });
});
