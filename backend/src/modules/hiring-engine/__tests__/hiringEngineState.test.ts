import { describe, expect, it } from "vitest";
import { planFromCallOutcome, planFromReply } from "../he-state.js";

describe("planFromReply", () => {
  it("confirm", () => expect(planFromReply("invited", "confirm", 0)).toMatchObject({ leadStatus: "confirmed", matchState: "confirmed" }));
  it("opt-out wins even from terminal and revokes consent", () => {
    expect(planFromReply("arrived", "opt_out", 0)).toMatchObject({ leadStatus: "opted_out", revokeConsent: true });
  });
  it("terminal never regresses", () => expect(planFromReply("arrived", "confirm", 0).leadStatus).toBeNull());
  it("first reschedule offers a slot", () => expect(planFromReply("invited", "reschedule", 0)).toMatchObject({ offerSlot: true, humanHandoff: false }));
  it("second decline of an offer goes to a human, no more slots", () => {
    expect(planFromReply("interested", "reschedule", 1)).toMatchObject({ offerSlot: false, humanHandoff: true, leadStatus: "declined" });
    expect(planFromReply("interested", "decline", 1).humanHandoff).toBe(true);
  });
  it("plain decline", () => expect(planFromReply("invited", "decline", 0)).toMatchObject({ leadStatus: "declined", humanHandoff: false }));
  it("unknown leaves state", () => expect(planFromReply("invited", "unknown", 0).leadStatus).toBeNull());
});

describe("planFromCallOutcome", () => {
  it("maps BRD outcomes", () => {
    expect(planFromCallOutcome("invited", "WALKIN_CONFIRMED_YES").leadStatus).toBe("confirmed");
    expect(planFromCallOutcome("invited", "WALKIN_RESCHEDULED").leadStatus).toBe("rescheduled");
    expect(planFromCallOutcome("invited", "WALKIN_DECLINED_NEEDS_FOLLOWUP")).toMatchObject({ leadStatus: "declined", humanHandoff: true });
    expect(planFromCallOutcome("invited", "WRONG_PERSON_REACHED").leadStatus).toBeNull();
    expect(planFromCallOutcome("new", "NO_ANSWER").leadStatus).toBe("contacted");
  });
  it("terminal ignored", () => expect(planFromCallOutcome("joined", "WALKIN_DECLINED_NEEDS_FOLLOWUP").leadStatus).toBeNull());
});
