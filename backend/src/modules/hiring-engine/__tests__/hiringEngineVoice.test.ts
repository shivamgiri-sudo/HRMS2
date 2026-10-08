import { describe, expect, it } from "vitest";
import { buildVoiceSystemPrompt, canPlaceCall, mapVapiEndOfCall, VOICE_RESULT_SCHEMA } from "../he-voice.js";
import { callOutcome } from "../he-signals.js";

const ctx = { candidateName: "Rohit", role: "Telesales Executive", driveDate: "Wed, 16 Sep 2026", slotTime: "10:30 AM", branchAddress: "Trapezoid IT Park, Sector 62, Noida", contactName: "Priya", contactPhone: "9876500000", referenceId: "HE-4821" };

describe("voice prompt", () => {
  const p = buildVoiceSystemPrompt(ctx);
  it("carries the candidate facts and the BRD guardrails", () => {
    expect(p).toContain("Trapezoid IT Park, Sector 62, Noida");
    expect(p).toContain("NEVER discuss the job with anyone who is not confirmed");
    expect(p).toContain("get_next_slot");
    expect(p).toContain("do NOT offer any more slots");
    expect(p).toContain("report_result");
  });
  it("schema requires identity", () => expect(VOICE_RESULT_SCHEMA.required).toContain("identityConfirmed"));
});

describe("mapVapiEndOfCall", () => {
  it("confirmed call", () => {
    const m = mapVapiEndOfCall({ call: { id: "c1", startedAt: "2026-10-05T05:30:00Z", metadata: { leadId: "L", matchId: "M", attempt: 1 } }, endedReason: "customer-ended-call", durationSeconds: 71.4,
      analysis: { structuredData: { identityConfirmed: "yes", emailReceived: "yes", assessmentDone: "reminded", originalSlotAnswer: "yes", language: "hinglish" } } });
    expect(m.result.answered).toBe(true);
    expect(callOutcome(m.result)).toBe("WALKIN_CONFIRMED_YES");
    expect(m.startedAt).toBe("2026-10-05 05:30:00");
    expect(m.leadId).toBe("L");
  });
  it("reschedule accepted / refused", () => {
    const base = { call: { id: "c2" }, endedReason: "assistant-ended-call", durationSeconds: 90 };
    expect(callOutcome(mapVapiEndOfCall({ ...base, analysis: { structuredData: { identityConfirmed: "yes", originalSlotAnswer: "no", offeredSlotAnswer: "yes", declineReason: "timing" } } }).result)).toBe("WALKIN_RESCHEDULED");
    const r = mapVapiEndOfCall({ ...base, analysis: { structuredData: { identityConfirmed: "yes", originalSlotAnswer: "no", offeredSlotAnswer: "no", declineReason: "distance" } } });
    expect(callOutcome(r.result)).toBe("WALKIN_DECLINED_NEEDS_FOLLOWUP");
    expect(r.result.declineReason).toBe("distance");
  });
  it("wrong person", () => expect(callOutcome(mapVapiEndOfCall({ call: { id: "c3" }, endedReason: "customer-ended-call", durationSeconds: 15, analysis: { structuredData: { identityConfirmed: "no" } } }).result)).toBe("WRONG_PERSON_REACHED"));
  it("no answer and failed", () => {
    expect(callOutcome(mapVapiEndOfCall({ call: { id: "c4" }, endedReason: "customer-did-not-answer", durationSeconds: 0 }).result)).toBe("NO_ANSWER");
    const f = mapVapiEndOfCall({ call: { id: "c5" }, endedReason: "twilio-failed-to-connect-call" });
    expect(callOutcome(f.result)).toBe("CALL_FAILED");
    expect(callOutcome(mapVapiEndOfCall({ call: { id: "c6" }, endedReason: "voicemail" }).result)).toBe("NO_ANSWER");
  });
  it("ignores values outside the enum", () => expect(mapVapiEndOfCall({ call: { id: "x" }, durationSeconds: 40, analysis: { structuredData: { identityConfirmed: "yes", declineReason: "weird", emailReceived: "maybe" } } }).result.emailReceived).toBeUndefined());
});

describe("canPlaceCall (BRD retry rule)", () => {
  const now = new Date("2026-10-05T06:00:00Z");
  const base = { attemptsToday: 0, lastAttemptAt: null, now, istHour: 11, hasAnsweredToday: false };
  it("first call ok", () => expect(canPlaceCall(base)).toEqual({ ok: true }));
  it("retry only after 2h, max 2 attempts, daytime, not after answered", () => {
    expect(canPlaceCall({ ...base, attemptsToday: 1, lastAttemptAt: new Date(now.getTime() - 30 * 60_000) })).toEqual({ ok: false, reason: "retry_too_soon" });
    expect(canPlaceCall({ ...base, attemptsToday: 1, lastAttemptAt: new Date(now.getTime() - 130 * 60_000) })).toEqual({ ok: true });
    expect(canPlaceCall({ ...base, attemptsToday: 2 })).toEqual({ ok: false, reason: "max_attempts" });
    expect(canPlaceCall({ ...base, istHour: 21 })).toEqual({ ok: false, reason: "quiet_hours" });
    expect(canPlaceCall({ ...base, hasAnsweredToday: true })).toEqual({ ok: false, reason: "already_reached_today" });
  });
});
