import { describe, expect, it } from "vitest";
import { checkFollowupGuards, emailWindowOverride, type GuardFacts } from "../followup-guards.js";

const night = new Date("2026-10-15T15:30:00Z"); // 21:00 IST
const base = (o: Partial<GuardFacts> = {}): GuardFacts => ({
  now: night, step: "email", transactional: false, firstContact: true, killSwitch: false, sourceRunnable: true, sourcePaused: false, optedOut: false,
  requisition: { approvalStatus: "approved", activeStatus: 1, closedAt: null, requestedHeadcount: 10, fulfilledHeadcount: 0 }, journeyEnded: null,
  waUnpromptedToday: 0, lastUnpromptedAt: null, lastCadenceStepAt: null, cadenceStep: true, callAttemptsToday: 0, lastCallAt: null, waBudgetLeft: 10,
  branchCapLeft: null, lastFirstContactOtherReqAt: null, hrOverride: false, channelAllowed: true, uploadWithoutOptIn: false, uploadWaAllowed: true,
  templateApproved: true, missingVariables: [], ...o,
});

describe("email window override", () => {
  const env = { FOLLOWUP_EMAIL_WINDOW_OVERRIDE_UNTIL: "2026-10-15T18:00:00Z" } as NodeJS.ProcessEnv;
  it("is on only before the instant, and off when unset or malformed", () => {
    expect(emailWindowOverride(night, env)).toBe(true);
    expect(emailWindowOverride(new Date("2026-10-15T18:00:01Z"), env)).toBe(false);
    expect(emailWindowOverride(night, {} as NodeJS.ProcessEnv)).toBe(false);
    expect(emailWindowOverride(night, { FOLLOWUP_EMAIL_WINDOW_OVERRIDE_UNTIL: "tomorrow" } as NodeJS.ProcessEnv)).toBe(false);
  });
  it("without the override a night email is held", () => {
    expect(checkFollowupGuards(base())).toMatchObject({ ok: false, reason: "outside_window" });
  });
  it("with it on: email passes, WhatsApp keeps the window, opt-out still ends the journey", () => {
    process.env.FOLLOWUP_EMAIL_WINDOW_OVERRIDE_UNTIL = "2026-10-15T18:00:00Z";
    try {
      expect(checkFollowupGuards(base())).toMatchObject({ ok: true });
      expect(checkFollowupGuards(base({ step: "whatsapp" }))).toMatchObject({ ok: false, reason: "outside_window" });
      expect(checkFollowupGuards(base({ optedOut: true }))).toMatchObject({ ok: false, reason: "opted_out" });
    } finally { delete process.env.FOLLOWUP_EMAIL_WINDOW_OVERRIDE_UNTIL; }
  });
});
