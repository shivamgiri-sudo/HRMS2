import { describe, expect, it } from "vitest";
import { callOutcome, classifyDeclineReason, detectLanguage, extractProfileFacts, signalsFromEmailEvent, signalsFromReply, signalsFromVoice } from "../he-signals.js";
import { computeInsight, type InsightInput } from "../he-insight.js";

describe("classifyDeclineReason", () => {
  it.each([
    ["bahut door hai", "distance"], ["salary kam hai", "salary"], ["night shift nahi chalegi", "shift"],
    ["job mil gayi kahin aur", "found_job"], ["abhi busy hu", "timing"], ["interested nahi", "not_looking"],
  ])("%s -> %s", (t, r) => expect(classifyDeclineReason(t)).toBe(r));
  it("null when unclear", () => expect(classifyDeclineReason("ok")).toBeNull());
});

describe("detectLanguage", () => {
  it("devanagari / hinglish / english", () => {
    expect(detectLanguage("हाँ आऊँगा")).toBe("hi");
    expect(detectLanguage("haan kal aaunga")).toBe("hinglish");
    expect(detectLanguage("yes I will come, thanks")).toBe("en");
  });
});

describe("extractProfileFacts", () => {
  it("pincode, years, night shift", () => {
    const f = extractProfileFacts("2 saal experience hai, 201301 mein rehta hu, night shift ok");
    expect(f.map((x) => `${x.key}=${x.value}`)).toEqual(expect.arrayContaining(["experience_years=2", "pincode=201301", "night_shift_ok=yes"]));
  });
});

describe("signalsFromReply", () => {
  it("decline carries reason + language", () => {
    const { intent, signals } = signalsFromReply("nahi, bahut door hai", "whatsapp");
    expect(intent).toBe("decline");
    expect(signals.find((s) => s.key === "decline_reason")?.value).toBe("distance");
    expect(signals.find((s) => s.key === "language")?.value).toBe("hinglish");
  });
  it("unknown reply has low confidence", () => {
    expect(signalsFromReply("salary kitni hai", "whatsapp").signals[0].confidence).toBeLessThan(50);
  });
});

describe("email events", () => {
  it("bounce marks email invalid, click is strong", () => {
    expect(signalsFromEmailEvent("bounced")[0]).toMatchObject({ key: "email_valid", value: "no" });
    expect(signalsFromEmailEvent("clicked", "assessment")[0]).toMatchObject({ key: "link_clicked", value: "assessment", confidence: 95 });
  });
});

describe("voice", () => {
  it("BRD outcome mapping", () => {
    expect(callOutcome({ answered: false })).toBe("NO_ANSWER");
    expect(callOutcome({ answered: false, failedReason: "busy" })).toBe("CALL_FAILED");
    expect(callOutcome({ answered: true, identityConfirmed: "no" })).toBe("WRONG_PERSON_REACHED");
    expect(callOutcome({ answered: true, identityConfirmed: "yes", originalSlotAnswer: "yes" })).toBe("WALKIN_CONFIRMED_YES");
    expect(callOutcome({ answered: true, identityConfirmed: "yes", originalSlotAnswer: "no", offeredSlotAnswer: "yes" })).toBe("WALKIN_RESCHEDULED");
    expect(callOutcome({ answered: true, identityConfirmed: "yes", originalSlotAnswer: "no", offeredSlotAnswer: "no" })).toBe("WALKIN_DECLINED_NEEDS_FOLLOWUP");
  });
  it("stores checkpoints as signals", () => {
    const s = signalsFromVoice({ answered: true, identityConfirmed: "yes", emailReceived: "no", assessmentDone: "reminded", originalSlotAnswer: "yes", durationS: 80, language: "hinglish" });
    expect(s.map((x) => x.key)).toEqual(expect.arrayContaining(["call_outcome", "email_received", "assessment_done", "language", "call_engaged_s"]));
  });
});

const base: InsightInput = { now: new Date("2026-10-05T06:00:00Z"), status: "invited", outbound: [], inboundHoursIst: [], callAttempts: 0, callsAnswered: 0, emailBounced: false, phoneInvalid: false, optedOut: false, confirmedCount: 0, arrivedCount: 0, noShowCount: 0, lastDeclineReason: null, hasLiveLocationConsent: false };
const wa = (o: Partial<InsightInput["outbound"][0]> = {}) => ({ channel: "whatsapp" as const, at: base.now, delivered: true, read: false, replied: false, ...o });

describe("computeInsight next action", () => {
  it("no contact -> invite", () => expect(computeInsight(base).nextAction).toBe("send_invite"));
  it("opted out blocks everything", () => expect(computeInsight({ ...base, optedOut: true, outbound: [wa()] }).nextAction).toBe("none"));
  it("two silent WhatsApps -> voice", () => expect(computeInsight({ ...base, outbound: [wa(), wa()] }).nextAction).toBe("voice_call"));
  it("two unanswered calls -> human", () => expect(computeInsight({ ...base, outbound: [wa()], callAttempts: 2 }).nextAction).toBe("human_call"));
  it("decline reason drives rematch", () => {
    expect(computeInsight({ ...base, status: "declined", lastDeclineReason: "distance" }).nextAction).toBe("rematch_nearer");
    expect(computeInsight({ ...base, status: "declined", lastDeclineReason: "shift" }).nextAction).toBe("rematch_day_shift");
    expect(computeInsight({ ...base, status: "declined", lastDeclineReason: null }).nextAction).toBe("human_call");
  });
  it("no-show once recovers, twice goes dormant", () => {
    expect(computeInsight({ ...base, status: "no_show", noShowCount: 1 }).nextAction).toBe("recovery_message");
    expect(computeInsight({ ...base, status: "no_show", noShowCount: 2 }).nextAction).toBe("dormant_winback_later");
  });
  it("confirmed -> reminders; reliability from no-shows", () => {
    const r = computeInsight({ ...base, status: "confirmed", confirmedCount: 4, noShowCount: 1 });
    expect(r.nextAction).toBe("send_reminder");
    expect(r.reliabilityScore).toBe(75);
  });
  it("best channel + hour from replies", () => {
    const r = computeInsight({ ...base, outbound: [wa({ replied: true }), { channel: "email", at: base.now, delivered: true, read: false, replied: false }], inboundHoursIst: [11, 11, 18] });
    expect(r.bestChannel).toBe("whatsapp");
    expect(r.bestHourIst).toBe(11);
    expect(r.emailValid).toBe(true);
  });
  it("engagement rises with replies, falls with ignored touches", () => {
    const hot = computeInsight({ ...base, outbound: [wa({ replied: true })] }).engagementScore;
    const cold = computeInsight({ ...base, outbound: [wa(), wa(), wa()] }).engagementScore;
    expect(hot).toBeGreaterThan(cold);
  });
  it("invalid phone and no email -> fix contact", () => expect(computeInsight({ ...base, phoneInvalid: true, emailBounced: true }).nextAction).toBe("fix_contact"));
});
