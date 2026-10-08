import { describe, expect, it } from "vitest";
import { dueTimes } from "../qualified-followup.schedule.js";
import {
  assessmentText, chooseWaTemplate, d1SendAt, noShowDueAt, reinviteAllowed, REINVITE_MAX_30D, REINVITE_MIN_DAYS, t4SendAt,
} from "../qualified-followup.cadence.js";

const ist = (s: string) => new Date(`${s}+05:30`);

describe("dueTimes (D3 window for email too, D4 60 min gap)", () => {
  it("enrolled Thu 23:30 IST: email Fri 09:00, WA Fri 10:00", () => {
    expect(dueTimes({ enrolledAt: new Date("2026-10-08T18:00:00Z"), hasEmail: true }))
      .toEqual({ emailDueAt: new Date("2026-10-09T03:30:00Z"), waDueAt: new Date("2026-10-09T04:30:00Z") });
  });
  it("enrolled 08:59 IST, no email: WA 09:00", () => {
    expect(dueTimes({ enrolledAt: new Date("2026-10-08T03:29:00Z"), hasEmail: false }))
      .toEqual({ emailDueAt: null, waDueAt: new Date("2026-10-08T03:30:00Z") });
  });
  it("enrolled Sat 19:30 IST: email now, WA Monday 09:00", () => {
    expect(dueTimes({ enrolledAt: new Date("2026-10-10T14:00:00Z"), hasEmail: true }))
      .toEqual({ emailDueAt: new Date("2026-10-10T14:00:00Z"), waDueAt: new Date("2026-10-12T03:30:00Z") });
  });
  it("enrolled Sunday 12:00: email Monday 09:00, WA Monday 10:00", () => {
    expect(dueTimes({ enrolledAt: ist("2026-10-11T12:00:00"), hasEmail: true }))
      .toEqual({ emailDueAt: ist("2026-10-12T09:00:00"), waDueAt: ist("2026-10-12T10:00:00") });
  });
  it("enrolled Thu 11:00: email now, WA 12:00", () => {
    expect(dueTimes({ enrolledAt: ist("2026-10-08T11:00:00"), hasEmail: true })).toEqual({ emailDueAt: ist("2026-10-08T11:00:00"), waDueAt: ist("2026-10-08T12:00:00") });
  });
});

describe("chooseWaTemplate (one meaning for every source)", () => {
  it("booked with address -> T1 whatever the source and without a BMI link", () => {
    expect(chooseWaTemplate({ booked: true, hasBranchAddress: true, reinvite: false, t12Approved: false })).toEqual({ key: "he_walkin_invite", missing: [] });
  });
  it("not booked -> T8 with missing slot; booked without address -> T8 with branch_address", () => {
    expect(chooseWaTemplate({ booked: false, hasBranchAddress: true, reinvite: false, t12Approved: false })).toEqual({ key: "he_winback", missing: ["slot"] });
    expect(chooseWaTemplate({ booked: true, hasBranchAddress: false, reinvite: false, t12Approved: false })).toEqual({ key: "he_winback", missing: ["branch_address"] });
  });
  it("re-invite -> T12 when approved, else T8", () => {
    expect(chooseWaTemplate({ booked: true, hasBranchAddress: true, reinvite: true, t12Approved: true })).toEqual({ key: "he_reinvite", missing: [] });
    expect(chooseWaTemplate({ booked: true, hasBranchAddress: true, reinvite: true, t12Approved: false })).toEqual({ key: "he_winback", missing: [] });
    expect(chooseWaTemplate({ booked: false, hasBranchAddress: true, reinvite: true, t12Approved: true })).toEqual({ key: "he_winback", missing: ["slot"] });
  });
  it("assessment text is the BMI link or 'given at the branch'", () => {
    expect(assessmentText(null)).toBe("given at the branch");
    expect(assessmentText("  ")).toBe("given at the branch");
    expect(assessmentText("https://bmi.test/x")).toBe("https://bmi.test/x");
  });
});

describe("stage B timing", () => {
  it("d1SendAt: Tue 10:00 slot = Mon 10:00; Mon 10:00 slot = Sat 19:00 IST", () => {
    expect(d1SendAt(ist("2026-10-13T10:00:00"))).toEqual(ist("2026-10-12T10:00:00"));
    expect(d1SendAt(new Date("2026-10-12T04:30:00Z"))).toEqual(new Date("2026-10-10T13:30:00Z"));
  });
  it("d1SendAt: Tue 08:30 slot = Mon 19:00 (24 h before is before 09:00)", () => {
    expect(d1SendAt(ist("2026-10-13T08:30:00"))).toEqual(ist("2026-10-12T19:00:00"));
  });
  it("t4SendAt: 10:30 slot = 09:00 same day; 14:00 slot = 12:00; 11:00 slot = 09:00", () => {
    expect(t4SendAt(ist("2026-10-09T10:30:00"))).toEqual(ist("2026-10-09T09:00:00"));
    expect(t4SendAt(ist("2026-10-09T14:00:00"))).toEqual(ist("2026-10-09T12:00:00"));
    expect(t4SendAt(ist("2026-10-09T11:00:00"))).toEqual(ist("2026-10-09T09:00:00"));
  });
  it("noShowDueAt: 18:30 slot = next Mon-Sat 09:00 (20:30 is outside); Saturday 18:30 = Monday 09:00; 14:00 = 16:00", () => {
    expect(noShowDueAt(ist("2026-10-08T18:30:00"))).toEqual(ist("2026-10-09T09:00:00"));
    expect(noShowDueAt(ist("2026-10-10T18:30:00"))).toEqual(ist("2026-10-12T09:00:00"));
    expect(noShowDueAt(ist("2026-10-08T14:00:00"))).toEqual(ist("2026-10-08T16:00:00"));
  });
});

describe("reinviteAllowed (D7)", () => {
  const now = ist("2026-10-20T11:00:00");
  const ok = { now, lastFirstContactAt: ist("2026-10-10T11:00:00"), reinvites30d: 0, approaches30d: 1, noShowsForRequisition: 0, declined: false, optedOut: false, hrOverride: false };
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
  it("constants", () => { expect(REINVITE_MIN_DAYS).toBe(7); expect(REINVITE_MAX_30D).toBe(2); });
  it("passes after 7 days with room", () => {
    expect(reinviteAllowed(ok)).toEqual({ ok: true });
    expect(reinviteAllowed({ ...ok, lastFirstContactAt: daysAgo(7) })).toEqual({ ok: true });
  });
  it("6 days -> too_soon; 7 days, 2 re-invites -> reinvite_cap", () => {
    expect(reinviteAllowed({ ...ok, lastFirstContactAt: daysAgo(6) })).toEqual({ ok: false, reason: "too_soon" });
    expect(reinviteAllowed({ ...ok, lastFirstContactAt: daysAgo(7), reinvites30d: 2 })).toEqual({ ok: false, reason: "reinvite_cap" });
  });
  it("6 approaches -> approach_cap; 3 no-shows -> no_show_cap; declined; opted_out", () => {
    expect(reinviteAllowed({ ...ok, approaches30d: 6 })).toEqual({ ok: false, reason: "approach_cap" });
    expect(reinviteAllowed({ ...ok, noShowsForRequisition: 3 })).toEqual({ ok: false, reason: "no_show_cap" });
    expect(reinviteAllowed({ ...ok, declined: true })).toEqual({ ok: false, reason: "declined" });
    expect(reinviteAllowed({ ...ok, optedOut: true, declined: true })).toEqual({ ok: false, reason: "opted_out" });
  });
  it("hrOverride lifts too_soon and reinvite_cap only", () => {
    expect(reinviteAllowed({ ...ok, lastFirstContactAt: daysAgo(1), reinvites30d: 2, hrOverride: true })).toEqual({ ok: true });
    expect(reinviteAllowed({ ...ok, approaches30d: 6, hrOverride: true })).toEqual({ ok: false, reason: "approach_cap" });
    expect(reinviteAllowed({ ...ok, noShowsForRequisition: 3, hrOverride: true })).toEqual({ ok: false, reason: "no_show_cap" });
    expect(reinviteAllowed({ ...ok, declined: true, hrOverride: true })).toEqual({ ok: false, reason: "declined" });
  });
});
