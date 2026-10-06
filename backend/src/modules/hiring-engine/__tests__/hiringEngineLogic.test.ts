import { describe, expect, it } from "vitest";
import { normalizeMobile10 } from "../he-phone.js";
import { parseReplyIntent } from "../he-intent.js";
import { checkSendAllowed, istHour } from "../he-guardrails.js";
import { countExpectedWithin, etaMinutes, haversineKm } from "../he-eta.js";
import { rankRequisitions, scoreLead } from "../he-matcher.js";

describe("normalizeMobile10", () => {
  it("strips country code and punctuation", () => {
    expect(normalizeMobile10("+91 98765-43210")).toBe("9876543210");
    expect(normalizeMobile10("919876543210")).toBe("9876543210");
  });
  it("rejects short, landline-style and empty", () => {
    expect(normalizeMobile10("12345")).toBeNull();
    expect(normalizeMobile10("0120 2345678")).toBeNull();
    expect(normalizeMobile10(null)).toBeNull();
  });
});

describe("parseReplyIntent", () => {
  it.each([
    ["1", "confirm"], ["Haan aaunga", "confirm"], ["yes", "confirm"], ["Confirmed!", "confirm"],
    ["2", "reschedule"], ["kal aaunga", "reschedule"], ["nahi aa sakta kal aunga", "reschedule"],
    ["3", "decline"], ["nahi", "decline"], ["interested nahi", "decline"],
    ["STOP", "opt_out"], ["band karo", "opt_out"],
    ["nikal gaya", "on_my_way"], ["on my way", "on_my_way"],
    ["salary kitni hai", "unknown"], ["", "unknown"],
  ])("%s -> %s", (t, e) => expect(parseReplyIntent(t)).toBe(e));
  it("does not read 'nahi' as confirm", () => expect(parseReplyIntent("nahi aaunga")).toBe("decline"));
});

describe("checkSendAllowed", () => {
  // 2026-10-05 11:00 IST = 05:30Z
  const base = { now: new Date("2026-10-05T05:30:00Z"), consent: true, optedOut: false, paused: false, sentToday: 0, lastSentAt: null, requisitionOpen: true };
  it("istHour ignores server tz", () => expect(istHour(base.now)).toBe(11));
  it("allows a clean send", () => expect(checkSendAllowed(base)).toEqual({ ok: true }));
  it("blocks without consent, opt-out, pause, closed req", () => {
    expect(checkSendAllowed({ ...base, consent: false })).toEqual({ ok: false, reason: "no_consent" });
    expect(checkSendAllowed({ ...base, optedOut: true })).toEqual({ ok: false, reason: "opted_out" });
    expect(checkSendAllowed({ ...base, paused: true })).toEqual({ ok: false, reason: "paused" });
    expect(checkSendAllowed({ ...base, requisitionOpen: false })).toEqual({ ok: false, reason: "requisition_closed" });
  });
  it("blocks quiet hours, cap and min gap", () => {
    expect(checkSendAllowed({ ...base, now: new Date("2026-10-05T16:00:00Z") })).toEqual({ ok: false, reason: "quiet_hours" }); // 21:30 IST
    expect(checkSendAllowed({ ...base, sentToday: 2 })).toEqual({ ok: false, reason: "daily_cap" });
    expect(checkSendAllowed({ ...base, lastSentAt: new Date(base.now.getTime() - 30 * 60_000) })).toEqual({ ok: false, reason: "min_gap" });
  });
});

describe("eta", () => {
  it("haversine ~ Noida to Delhi", () => expect(haversineKm(28.5355, 77.391, 28.6139, 77.209)).toBeGreaterThan(18));
  it("etaMinutes rounds up", () => expect(etaMinutes(10)).toBe(37));
  it("counts expected within 30 min, preferring fresh pings", () => {
    const now = new Date("2026-10-05T05:30:00Z");
    const m = (x: number) => new Date(now.getTime() + x * 60_000);
    const n = countExpectedWithin(
      [
        { slotAt: m(120), pingAt: m(-2), etaMin: 15 }, // ping says 13 min away -> counts
        { slotAt: m(10), pingAt: null, etaMin: null }, // slot in window -> counts
        { slotAt: m(10), pingAt: m(-20), etaMin: 5 }, // stale ping ignored, slot counts
        { slotAt: m(90), pingAt: null, etaMin: null }, // too far
      ],
      now,
    );
    expect(n).toBe(3);
  });
});

describe("matcher", () => {
  const req = { id: "A", ageMin: 18, ageMax: 35, minEducationRank: 3, nightShift: true, branchLat: 28.5355, branchLng: 77.391, processName: "Collections" };
  it("hard-fails on age/education/night shift", () => {
    expect(scoreLead({ age: 40 }, req).eligible).toBe(false);
    expect(scoreLead({ age: 25, educationRank: 2 }, req).score).toBe(0);
    expect(scoreLead({ age: 25, educationRank: 3, nightShiftOk: false }, req).eligible).toBe(false);
  });
  it("unknowns stay eligible and are listed", () => {
    const r = scoreLead({}, req);
    expect(r.eligible).toBe(true);
    expect(r.unknown).toEqual(expect.arrayContaining(["age", "education", "night_shift", "distance"]));
  });
  it("lead rejected for A is re-offered where it fits", () => {
    const b = { id: "B", ageMin: 18, ageMax: 45, minEducationRank: 2, nightShift: false };
    const ranked = rankRequisitions({ age: 40, educationRank: 3 }, [req, b]);
    expect(ranked.map((x) => x.req.id)).toEqual(["B"]);
  });
  it("closer branch scores higher", () => {
    const near = scoreLead({ lat: 28.54, lng: 77.39 }, req);
    const far = scoreLead({ lat: 28.9, lng: 77.9 }, req);
    expect(near.score).toBeGreaterThan(far.score);
  });
});

import { isValidCoord, summarizeExpected } from "../he-eta.js";
describe("location helpers", () => {
  it("validates coordinates", () => {
    expect(isValidCoord(28.5, 77.3)).toBe(true);
    expect(isValidCoord(0, 0)).toBe(false);
    expect(isValidCoord(91, 10)).toBe(false);
    expect(isValidCoord("28" as unknown as number, 77)).toBe(false);
  });
  it("summarizes expected / confirmed / live", () => {
    const now = new Date("2026-10-05T05:30:00Z");
    const m = (x: number) => new Date(now.getTime() + x * 60_000);
    expect(summarizeExpected([
      { slotAt: m(10), pingAt: null, etaMin: null, confirmed: true },
      { slotAt: m(120), pingAt: m(-1), etaMin: 12, confirmed: true },
      { slotAt: m(20), pingAt: null, etaMin: null, confirmed: false },
      { slotAt: m(200), pingAt: null, etaMin: null, confirmed: true },
    ], now)).toEqual({ expected: 3, confirmed: 2, live: 1 });
  });
});

describe("quick-reply labels of the approved templates", () => {
  it("maps every T1-T9 button", () => {
    expect(parseReplyIntent("Yes, I'll come")).toBe("confirm");
    expect(parseReplyIntent("Reschedule")).toBe("reschedule");
    expect(parseReplyIntent("Can't come")).toBe("decline");
    expect(parseReplyIntent("Yes, confirmed")).toBe("confirm");
    expect(parseReplyIntent("Yes, this works")).toBe("confirm");
    expect(parseReplyIntent("No, this doesn't work either")).toBe("decline");
    expect(parseReplyIntent("I need a new slot")).toBe("reschedule");
    expect(parseReplyIntent("Not interested")).toBe("decline");
    expect(parseReplyIntent("Skip location")).toBe("skip");
  });
});
