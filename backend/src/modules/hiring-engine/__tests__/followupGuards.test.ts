import { describe, expect, it } from "vitest";
import {
  checkFollowupGuards, inSendWindow, nextSendWindowOpen, requisitionOpenReason, type GuardFacts, type RequisitionFacts,
} from "../followup-guards.js";

const THU_11 = new Date("2026-10-08T05:30:00Z"); // Thursday 11:00 IST
const OPEN: RequisitionFacts = { approvalStatus: "approved", activeStatus: 1, closedAt: null, requestedHeadcount: 5, fulfilledHeadcount: 0 };
const base: GuardFacts = {
  now: THU_11, step: "whatsapp", transactional: false, firstContact: false,
  killSwitch: false, sourceRunnable: true, sourcePaused: false,
  optedOut: false, requisition: OPEN, journeyEnded: null,
  waUnpromptedToday: 0, lastUnpromptedAt: null, lastCadenceStepAt: null, cadenceStep: false,
  callAttemptsToday: 0, lastCallAt: null,
  waBudgetLeft: 100, branchCapLeft: null, lastFirstContactOtherReqAt: null, hrOverride: false,
  channelAllowed: true, uploadWithoutOptIn: false, uploadWaAllowed: false, templateApproved: true, missingVariables: [],
};
const minAgo = (m: number) => new Date(THU_11.getTime() - m * 60_000);
const daysAgo = (d: number) => new Date(THU_11.getTime() - d * 86_400_000);

describe("checkFollowupGuards order and kinds", () => {
  it("passes when every fact passes", () => expect(checkFollowupGuards(base)).toEqual({ ok: true }));

  it("kill switch wins over STOP", () => {
    expect(checkFollowupGuards({ ...base, killSwitch: true, optedOut: true })).toEqual({ ok: false, reason: "kill_switch", kind: "hold" });
  });

  it("source off and paused hold", () => {
    expect(checkFollowupGuards({ ...base, sourceRunnable: false })).toMatchObject({ ok: false, reason: "source_off", kind: "hold" });
    expect(checkFollowupGuards({ ...base, sourcePaused: true })).toMatchObject({ ok: false, reason: "source_paused", kind: "hold" });
  });

  it("STOP ends the journey even for transactional", () => {
    expect(checkFollowupGuards({ ...base, transactional: true, optedOut: true })).toMatchObject({ ok: false, reason: "opted_out", kind: "end_journey" });
  });

  it("a closed requisition ends the journey", () => {
    expect(checkFollowupGuards({ ...base, requisition: { ...OPEN, approvalStatus: "pending_approval" } })).toMatchObject({ reason: "requisition_closed", kind: "end_journey" });
    expect(checkFollowupGuards({ ...base, requisition: null })).toMatchObject({ reason: "requisition_closed", kind: "end_journey" });
  });

  it("joined / arrived / declined end the journey", () => {
    expect(checkFollowupGuards({ ...base, journeyEnded: "declined" })).toMatchObject({ reason: "journey_ended", kind: "end_journey" });
  });

  it("criteria fail ends stage A, review holds it, stage B ignores both; missing verdict means pass", () => {
    expect(checkFollowupGuards({ ...base, criteriaVerdict: "fail" })).toMatchObject({ reason: "criteria_failed", kind: "end_journey" });
    expect(checkFollowupGuards({ ...base, criteriaVerdict: "review" })).toMatchObject({ reason: "criteria_review", kind: "hold" });
    expect(checkFollowupGuards({ ...base, criteriaVerdict: "fail", stage: "B" })).toEqual({ ok: true });
    expect(checkFollowupGuards({ ...base, criteriaVerdict: null })).toEqual({ ok: true });
    // order: right after requisition_closed
    expect(checkFollowupGuards({ ...base, criteriaVerdict: "fail", requisition: null })).toMatchObject({ reason: "requisition_closed" });
    expect(checkFollowupGuards({ ...base, criteriaVerdict: "fail", journeyEnded: "arrived" })).toMatchObject({ reason: "criteria_failed" });
  });

  it("end date (enforced) skips a stage A step and lets stage B continue", () => {
    const req = { ...OPEN, validityDate: "2026-10-07" };
    expect(checkFollowupGuards({ ...base, requisition: req, endDateEnforced: true })).toMatchObject({ reason: "requisition_end_date", kind: "skip_step" });
    expect(checkFollowupGuards({ ...base, requisition: req, endDateEnforced: true, stage: "B" })).toEqual({ ok: true });
    expect(checkFollowupGuards({ ...base, requisition: req })).toEqual({ ok: true });
  });

  it("Sunday is outside, retryAt Monday 09:00", () => {
    expect(checkFollowupGuards({ ...base, now: new Date("2026-10-11T05:30:00Z") }))
      .toEqual({ ok: false, reason: "outside_window", kind: "hold", retryAt: new Date("2026-10-12T03:30:00Z") });
  });

  it("Saturday 21:00 holds to Monday 09:00", () => {
    expect(checkFollowupGuards({ ...base, now: new Date("2026-10-10T15:30:00Z") })).toMatchObject({ reason: "outside_window", retryAt: new Date("2026-10-12T03:30:00Z") });
  });

  it("transactional T2 at 22:30 passes the window", () => {
    expect(checkFollowupGuards({ ...base, transactional: true, now: new Date("2026-10-08T17:00:00Z") })).toEqual({ ok: true });
  });

  it("cadence step 61 min after the last step passes; unrelated unprompted 61 min after fails person_gap", () => {
    expect(checkFollowupGuards({ ...base, cadenceStep: true, lastCadenceStepAt: minAgo(61), lastUnpromptedAt: minAgo(61) })).toEqual({ ok: true });
    expect(checkFollowupGuards({ ...base, cadenceStep: true, lastCadenceStepAt: minAgo(59) })).toMatchObject({ reason: "person_gap", kind: "hold", retryAt: new Date(THU_11.getTime() + 60_000) });
    expect(checkFollowupGuards({ ...base, lastUnpromptedAt: minAgo(61) })).toMatchObject({ reason: "person_gap", kind: "hold" });
    expect(checkFollowupGuards({ ...base, lastUnpromptedAt: minAgo(121) })).toEqual({ ok: true });
  });

  it("third unprompted WhatsApp today fails person_daily_cap (held to the next day's window)", () => {
    expect(checkFollowupGuards({ ...base, waUnpromptedToday: 2 })).toMatchObject({ reason: "person_daily_cap", kind: "hold", retryAt: new Date("2026-10-09T03:30:00Z") });
    expect(checkFollowupGuards({ ...base, waUnpromptedToday: 2, step: "email" })).toEqual({ ok: true });
    expect(checkFollowupGuards({ ...base, waUnpromptedToday: 2, transactional: true })).toEqual({ ok: true });
  });

  it("two call attempts today or a call within 120 min holds the call", () => {
    expect(checkFollowupGuards({ ...base, step: "call", callAttemptsToday: 2 })).toMatchObject({ reason: "call_attempts", kind: "hold" });
    expect(checkFollowupGuards({ ...base, step: "call", callAttemptsToday: 1, lastCallAt: minAgo(119) })).toMatchObject({ reason: "call_attempts", kind: "hold" });
    expect(checkFollowupGuards({ ...base, step: "call", callAttemptsToday: 1, lastCallAt: minAgo(121) })).toEqual({ ok: true });
  });

  it("budget 0 holds WhatsApp but not email", () => {
    expect(checkFollowupGuards({ ...base, waBudgetLeft: 0 })).toMatchObject({ reason: "wa_budget", kind: "hold" });
    expect(checkFollowupGuards({ ...base, waBudgetLeft: 0, step: "email" })).toEqual({ ok: true });
  });

  it("branch cap 0 holds a first contact, null cap does not apply", () => {
    expect(checkFollowupGuards({ ...base, firstContact: true, branchCapLeft: 0 })).toMatchObject({ reason: "branch_cap", kind: "hold" });
    expect(checkFollowupGuards({ ...base, firstContact: true, branchCapLeft: null })).toEqual({ ok: true });
    expect(checkFollowupGuards({ ...base, firstContact: false, branchCapLeft: 0 })).toEqual({ ok: true });
  });

  it("re-contact hold 6 days 23 h holds; 7 days passes; hrOverride passes", () => {
    const sixD23 = new Date(THU_11.getTime() - (7 * 24 - 1) * 3600_000);
    expect(checkFollowupGuards({ ...base, firstContact: true, lastFirstContactOtherReqAt: sixD23 })).toMatchObject({ reason: "recontact_hold", kind: "hold", retryAt: new Date(THU_11.getTime() + 3600_000) });
    expect(checkFollowupGuards({ ...base, firstContact: true, lastFirstContactOtherReqAt: daysAgo(7) })).toEqual({ ok: true });
    expect(checkFollowupGuards({ ...base, firstContact: true, lastFirstContactOtherReqAt: sixD23, hrOverride: true })).toEqual({ ok: true });
  });

  it("a campaign with the channel off skips the step", () => {
    expect(checkFollowupGuards({ ...base, channelAllowed: false })).toMatchObject({ reason: "channel_off", kind: "skip_step" });
  });

  it("upload row without opt-in skips the WhatsApp step when upload_wa is 0", () => {
    expect(checkFollowupGuards({ ...base, uploadWithoutOptIn: true })).toMatchObject({ reason: "upload_no_wa", kind: "skip_step" });
    expect(checkFollowupGuards({ ...base, uploadWithoutOptIn: true, uploadWaAllowed: true })).toEqual({ ok: true });
    expect(checkFollowupGuards({ ...base, uploadWithoutOptIn: true, step: "email" })).toEqual({ ok: true });
    expect(checkFollowupGuards({ ...base, uploadWithoutOptIn: true, stage: "B", transactional: true })).toEqual({ ok: true });
  });

  it("template not approved and missing variables skip the step with the list", () => {
    expect(checkFollowupGuards({ ...base, templateApproved: false })).toMatchObject({ reason: "template_not_approved", kind: "skip_step" });
    expect(checkFollowupGuards({ ...base, missingVariables: ["slot_time", "branch_address"] }))
      .toEqual({ ok: false, reason: "missing_variables", kind: "skip_step", missing: ["slot_time", "branch_address"] });
  });
});

describe("requisitionOpenReason (D8)", () => {
  it("pending approval is closed", () => {
    expect(requisitionOpenReason({ approvalStatus: "pending", activeStatus: 1, closedAt: null, requestedHeadcount: 5, fulfilledHeadcount: 0 })).toBe("requisition is not approved");
  });
  it("approved, active, 0 of 5 is open", () => expect(requisitionOpenReason(OPEN)).toBeNull());
  it("approved, 5 of 5 is full", () => expect(requisitionOpenReason({ ...OPEN, fulfilledHeadcount: 5 })).toBe("all seats in this batch are filled"));
  it("inactive and closed keep the screener's wording", () => {
    expect(requisitionOpenReason({ ...OPEN, activeStatus: 0 })).toBe("requisition is inactive");
    expect(requisitionOpenReason({ ...OPEN, closedAt: "2026-10-01 10:00:00" })).toBe("requisition is closed");
  });
  it("no requisition is closed", () => expect(requisitionOpenReason(null)).toBe("requisition not found"));
  it("end date counts only when enforced", () => {
    const r = { ...OPEN, validityDate: "2026-10-07" };
    expect(requisitionOpenReason(r, { now: THU_11 })).toBeNull();
    expect(requisitionOpenReason(r, { now: THU_11, endDateEnforced: true })).toBe("requisition end date passed");
    expect(requisitionOpenReason({ ...OPEN, validityDate: "2026-10-08" }, { now: THU_11, endDateEnforced: true })).toBeNull();
  });
});

describe("window (IST, Mon-Sat 09:00-20:00)", () => {
  it("19:59:59 IST inside, 20:00:00 outside, 08:59:59 outside", () => {
    expect(inSendWindow(new Date("2026-10-08T14:29:59Z"))).toBe(true);
    expect(inSendWindow(new Date("2026-10-08T14:30:00Z"))).toBe(false);
    expect(inSendWindow(new Date("2026-10-08T03:29:59Z"))).toBe(false);
    expect(inSendWindow(new Date("2026-10-08T03:30:00Z"))).toBe(true);
  });
  it("Sunday is never inside", () => expect(inSendWindow(new Date("2026-10-11T05:30:00Z"))).toBe(false));
  it("next open: 08:00 Thu -> 09:00 Thu; Thu 20:30 -> Fri 09:00; Sat 21:00 -> Mon 09:00; Sun 08:00 -> Mon 09:00", () => {
    expect(nextSendWindowOpen(new Date("2026-10-08T02:30:00Z"))).toEqual(new Date("2026-10-08T03:30:00Z"));
    expect(nextSendWindowOpen(new Date("2026-10-08T15:00:00Z"))).toEqual(new Date("2026-10-09T03:30:00Z"));
    expect(nextSendWindowOpen(new Date("2026-10-10T15:30:00Z"))).toEqual(new Date("2026-10-12T03:30:00Z"));
    expect(nextSendWindowOpen(new Date("2026-10-11T02:30:00Z"))).toEqual(new Date("2026-10-12T03:30:00Z"));
  });
  it("is independent of the server time zone (UTC midnight edge)", () => {
    // 2026-10-09 23:59 UTC = Sat 05:29 IST -> Sat 09:00 IST
    expect(nextSendWindowOpen(new Date("2026-10-09T23:59:00Z"))).toEqual(new Date("2026-10-10T03:30:00Z"));
  });
});
