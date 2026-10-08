import { describe, it, expect } from "vitest";
import { evaluateRehire, type RehireFacts } from "../rehireEligibility.js";

const base: RehireFacts = {
  hasExitRecord: true,
  exitType: "voluntary",
  exitSubType: "resignation",
  exitReasonCategory: "better_opportunity",
  legacyStatusText: null,
  disciplinaryFlag: false,
  blockLifted: false,
  gapDays: 10,
  priorRejoinCount: 0,
  totalAbscondingExits: 0,
  openClearanceCase: false,
  assetsUnreturned: false,
  ffAlreadyPaid: false,
};
const f = (o: Partial<RehireFacts>): RehireFacts => ({ ...base, ...o });
const codes = (r: ReturnType<typeof evaluateRehire>) => r.reasons.map((x) => x.code);

describe("evaluateRehire", () => {
  it("clean resignation within the gap is eligible", () => {
    const r = evaluateRehire(base);
    expect(r.status).toBe("eligible");
    expect(r.reasons).toEqual([]);
  });

  it.each([
    [{ exitSubType: "termination", exitType: "involuntary" }, "TERMINATED"],
    [{ exitReasonCategory: "termination_misconduct" }, "MISCONDUCT"],
    [{ exitReasonCategory: "performance_action" }, "PERFORMANCE_ACTION"],
    [{ disciplinaryFlag: true }, "DISCIPLINARY_FLAG"],
  ])("blocks %j", (o, code) => {
    const r = evaluateRehire(f(o as Partial<RehireFacts>));
    expect(r.status).toBe("blocked");
    expect(codes(r)).toContain(code);
  });

  it("a super_admin lift clears the disciplinary block", () => {
    expect(evaluateRehire(f({ disciplinaryFlag: true, blockLifted: true })).status).toBe("eligible");
  });

  it("a super_admin lift does NOT clear a termination", () => {
    const r = evaluateRehire(f({ exitSubType: "termination", blockLifted: true }));
    expect(r.status).toBe("blocked");
  });

  it("blocks legacy 'Terminated - Misconduct' status text when no exit record exists", () => {
    const r = evaluateRehire(f({ hasExitRecord: false, exitSubType: null, exitType: null, exitReasonCategory: null, legacyStatusText: "Terminated - Misconduct" }));
    expect(r.status).toBe("blocked");
  });

  it("legacy row with no usable signal is review, never eligible", () => {
    const r = evaluateRehire(f({ hasExitRecord: false, exitSubType: null, exitType: null, exitReasonCategory: null, legacyStatusText: "Resigned" }));
    expect(r.status).toBe("review");
    expect(codes(r)).toContain("NO_EXIT_SIGNAL");
  });

  it("first absconding is review and demands the acknowledgement", () => {
    const r = evaluateRehire(f({ exitSubType: "absconding", exitType: "involuntary", totalAbscondingExits: 1 }));
    expect(r.status).toBe("review");
    expect(r.requiresAbscondingAck).toBe(true);
  });

  it("abandonment is treated like absconding", () => {
    expect(evaluateRehire(f({ exitSubType: "abandonment", totalAbscondingExits: 1 })).requiresAbscondingAck).toBe(true);
  });

  it("a second absconding is blocked", () => {
    const r = evaluateRehire(f({ exitSubType: "absconding", totalAbscondingExits: 2 }));
    expect(r.status).toBe("blocked");
    expect(codes(r)).toContain("REPEAT_ABSCONDING");
  });

  it("absconding with a disciplinary flag is blocked", () => {
    expect(evaluateRehire(f({ exitSubType: "absconding", totalAbscondingExits: 1, disciplinaryFlag: true })).status).toBe("blocked");
  });

  it("gap over 30 days requires fresh onboarding", () => {
    const r = evaluateRehire(f({ gapDays: 31 }));
    expect(r.status).toBe("blocked");
    expect(r.requiresFreshOnboarding).toBe(true);
    expect(codes(r)).toContain("GAP_EXCEEDS_30");
  });

  it("gap of exactly 30 days is allowed", () => {
    expect(evaluateRehire(f({ gapDays: 30 })).requiresFreshOnboarding).toBe(false);
  });

  it("a negative gap (rejoin date before exit date) is blocked as invalid", () => {
    expect(codes(evaluateRehire(f({ gapDays: -1 })))).toContain("REJOIN_BEFORE_EXIT");
  });

  it.each([
    [{ openClearanceCase: true }, "OPEN_CLEARANCE"],
    [{ assetsUnreturned: true }, "ASSETS_UNRETURNED"],
    [{ ffAlreadyPaid: true }, "FF_ALREADY_PAID"],
    [{ priorRejoinCount: 1 }, "PREVIOUS_REJOIN"],
  ])("flags %j as review", (o, code) => {
    const r = evaluateRehire(f(o as Partial<RehireFacts>));
    expect(r.status).toBe("review");
    expect(codes(r)).toContain(code);
  });

  it("blocked wins over review", () => {
    expect(evaluateRehire(f({ exitSubType: "termination", assetsUnreturned: true })).status).toBe("blocked");
  });
});
