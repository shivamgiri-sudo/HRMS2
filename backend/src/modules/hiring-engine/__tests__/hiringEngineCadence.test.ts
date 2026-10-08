import { describe, expect, it } from "vitest";
import { nextCadenceStep, type CadenceFacts } from "../he-cadence.js";

const t0 = new Date("2026-10-06T05:00:00Z");
const at = (min: number) => new Date(t0.getTime() + min * 60_000);
const base: CadenceFacts = { now: t0, gapMin: 60, canEmail: true, waConsent: true, emailSentAt: null, waSentAt: null, voiceAt: null, repliedAfterFirstTouch: false, quietHours: false };
const f = (o: Partial<CadenceFacts>) => ({ ...base, ...o });

describe("cadence: email -> whatsapp -> bot call, 60 min apart", () => {
  it("starts with email", () => expect(nextCadenceStep(base).step).toBe("email"));
  it("waits the gap, then whatsapp", () => {
    expect(nextCadenceStep(f({ emailSentAt: t0, now: at(30) }))).toMatchObject({ step: null, reason: "waiting_gap_after_email" });
    expect(nextCadenceStep(f({ emailSentAt: t0, now: at(60) })).step).toBe("whatsapp");
  });
  it("waits the gap after whatsapp, then calls", () => {
    expect(nextCadenceStep(f({ emailSentAt: t0, waSentAt: at(60), now: at(100) })).reason).toBe("waiting_gap_after_whatsapp");
    expect(nextCadenceStep(f({ emailSentAt: t0, waSentAt: at(60), now: at(120) })).step).toBe("voice");
  });
  it("no email: whatsapp first, call an hour later", () => {
    expect(nextCadenceStep(f({ canEmail: false })).step).toBe("whatsapp");
    expect(nextCadenceStep(f({ canEmail: false, waSentAt: t0, now: at(61) })).step).toBe("voice");
  });
  it("no consent: email only, then stops", () => {
    expect(nextCadenceStep(f({ waConsent: false, emailSentAt: t0, now: at(90) }))).toMatchObject({ step: null, reason: "no_whatsapp_consent" });
    expect(nextCadenceStep(f({ waConsent: false, canEmail: false })).reason).toBe("no_channel");
  });
  it("a reply or quiet hours stops everything; finished sequence stays finished", () => {
    expect(nextCadenceStep(f({ repliedAfterFirstTouch: true, emailSentAt: t0, now: at(90) })).reason).toBe("replied");
    expect(nextCadenceStep(f({ quietHours: true })).reason).toBe("quiet_hours");
    expect(nextCadenceStep(f({ emailSentAt: t0, waSentAt: at(60), voiceAt: at(120), now: at(300) })).reason).toBe("sequence_complete");
  });
});

describe("best hour", () => {
  // t0 = 05:00Z = 10:30 IST
  it("waits for a later best hour when the slot allows, otherwise goes now", () => {
    const slotFar = new Date(t0.getTime() + 48 * 3600_000);
    expect(nextCadenceStep(f({ emailSentAt: at(-60), bestHourIst: 17, slotAt: slotFar })).reason).toBe("waiting_best_hour");
    expect(nextCadenceStep(f({ emailSentAt: at(-60), bestHourIst: 17, slotAt: new Date(t0.getTime() + 6 * 3600_000) })).step).toBe("whatsapp");
    expect(nextCadenceStep(f({ emailSentAt: at(-60), bestHourIst: 11, slotAt: slotFar })).step).toBe("whatsapp");
    expect(nextCadenceStep(f({ emailSentAt: at(-60), bestHourIst: null })).step).toBe("whatsapp");
  });
});
