import { describe, expect, it } from "vitest";
import { buildBranchPlan, expectedShows, addCalendarDays, type BranchSeats } from "../he-branch-plan.js";

const seat = (o: Partial<BranchSeats> = {}): BranchSeats => ({ branch: "A", requisitions: 1, requested: 20, target: 26, joined: 6, pendingSelected: 4, joinsLeft: 20, ...o });
const base = {
  today: "2026-10-12",
  history: [{ branch: "A", uniqueLeads: 1000, walkins: 400, selected: 200, joined: 120 }],
  pace: [{ branch: "A", walkinsInWindow: 150, joinedInWindow: 30, windowDays: 30 }],
  booked: [], spendByBranch: { A: 15000 },
};

describe("buildBranchPlan", () => {
  it("walks the funnel backwards from joins left to walk-ins, days and cost", () => {
    const [r] = buildBranchPlan({ ...base, seats: [seat()] }).rows;
    // s2j ~ 0.6, w2s ~ 0.5 (smoothed toward the same base so ~ equal to raw)
    expect(r.expectedFromPending).toBe(Math.round(4 * r.rates.selectedToJoined));
    expect(r.selectionsNeeded).toBe(Math.ceil((20 - r.expectedFromPending) / r.rates.selectedToJoined));
    expect(r.walkinsNeeded).toBe(Math.ceil(r.selectionsNeeded / r.rates.walkinToSelected));
    expect(r.walkinsPerDay).toBe(5);
    expect(r.daysToTarget).toBe(Math.ceil(r.walkinsToBring / 5));
    expect(r.targetDate).toBe(addCalendarDays("2026-10-12", r.daysToTarget!));
    expect(r.cost.perWalkin).toBe(100);
    expect(r.cost.toTarget).toBe(r.walkinsToBring * 100);
  });

  it("booked shows reduce what still has to be brought, never below zero", () => {
    const p = buildBranchPlan({ ...base, seats: [seat()], booked: [{ branch: "A", invited: 1000, confirmed: 1000 }] });
    expect(p.rows[0].walkinsToBring).toBe(0);
    expect(p.rows[0].status).toBe("covered");
    expect(p.rows[0].daysToTarget).toBe(0);
  });

  it("flags a branch with no observed pace instead of inventing a timeline", () => {
    const r = buildBranchPlan({ ...base, pace: [], seats: [seat()] }).rows[0];
    expect(r.daysToTarget).toBeNull();
    expect(r.status).toBe("no_pace");
  });

  it("marks at risk when days to target exceed the deadline", () => {
    const r = buildBranchPlan({ ...base, seats: [seat()], deadlineDays: 2 }).rows[0];
    expect(r.status).toBe("at_risk");
  });

  it("overrides drive the what-if: better conversion means fewer walk-ins", () => {
    const a = buildBranchPlan({ ...base, seats: [seat()] }).rows[0];
    const b = buildBranchPlan({ ...base, seats: [seat()], overrides: { walkinToSelected: 0.9 } }).rows[0];
    expect(b.walkinsNeeded).toBeLessThan(a.walkinsNeeded);
    expect(b.rates.source).toBe("override");
  });

  it("cost is null without spend rather than zero", () => {
    const r = buildBranchPlan({ ...base, spendByBranch: {}, seats: [seat()] }).rows[0];
    expect(r.cost.toTarget).toBeNull();
  });

  it("a branch with no history falls back to the all-branch rates", () => {
    const p = buildBranchPlan({ ...base, seats: [seat({ branch: "NEW" })] });
    expect(p.rows[0].rates.source).toBe("all-branches");
  });

  it("expectedShows uses the engine's base show-up rates", () => {
    expect(expectedShows({ branch: "A", invited: 10, confirmed: 10 })).toBe(Math.round(10 * 0.3 + 10 * 0.55));
    expect(expectedShows(undefined)).toBe(0);
  });
});
