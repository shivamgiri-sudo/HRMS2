import { describe, it, expect } from "vitest";
import { readSwitches, rowTag, pipelineOwnsSends, followupSkipSql, isTestModeRequested } from "../qualified-followup.policy.js";
import {
  decideStop, chooseWaTemplate, nextStepDue, isTransientError, metaErrorCode, afterFailure,
  normaliseQuality, waDailyBudget, dueSlot, DAILY_REPORT_SLOTS, CALL_FILE_SLOTS, maskMobile, followupRef, nextWorkingDayIst,
} from "../qualified-followup.rules.js";

const ist = (s: string) => new Date(`${s}+05:30`);
const none = { optedOut: false, repliedSinceQualified: false, requisitionClosed: null, joined: false, hasMobile: true, hasEmail: true };

describe("readSwitches", () => {
  it("defaults", () => {
    const s = readSwitches({});
    expect(s.mode).toBe("off");
    expect(s.testMode).toBe(false);
    expect(s.callFileTo).toBe("shivam.giri@teammas.in");
    expect(s.waDailyMax).toBe(500);
    expect(s.pausedSources.size).toBe(0);
    expect(s.botSources.size).toBe(0);
  });
  it("ignores unknown sources", () => {
    expect([...readSwitches({ QUAL_FOLLOWUP_PAUSE_SOURCES: "meta_old, bogus" }).pausedSources]).toEqual(["meta_old"]);
  });
  it("test mode", () => {
    const base = { QUAL_FOLLOWUP_MODE: "live", QUAL_FOLLOWUP_TEST_MODE: "true", QUAL_FOLLOWUP_TEST_TO_PHONE: "+91 98765 43210" };
    const ok = readSwitches({ ...base, QUAL_FOLLOWUP_TEST_TO_EMAIL: "o@x.in" });
    expect(ok.testMode).toBe(true);
    expect(ok.testPhone).toBe("9876543210");
    expect(ok.testMisconfigured).toBe(false);
    expect(readSwitches(base).testMisconfigured).toBe(true);
  });
  it("wa max fallback and paused", () => {
    expect(readSwitches({ QUAL_FOLLOWUP_WA_DAILY_MAX: "abc" }).waDailyMax).toBe(500);
    expect(readSwitches({ QUAL_FOLLOWUP_WA_DAILY_MAX: "-3" }).waDailyMax).toBe(500);
    expect(readSwitches({ QUAL_FOLLOWUP_WA_DAILY_MAX: "120" }).waDailyMax).toBe(120);
    expect(readSwitches({ HE_SENDS_PAUSED: "true" }).sendsPaused).toBe(true);
  });
});

describe("test-mode flag parsing fails safe", () => {
  it.each(["true", "TRUE", "1", "yes", " true ", "on", "anything"])("%j asks for test mode", (v) => {
    expect(isTestModeRequested(v)).toBe(true);
    expect(readSwitches({ QUAL_FOLLOWUP_MODE: "live", QUAL_FOLLOWUP_TEST_MODE: v }).testMisconfigured).toBe(true);
    expect(rowTag(readSwitches({ QUAL_FOLLOWUP_MODE: "live", QUAL_FOLLOWUP_TEST_MODE: v }))).toBe("test");
    expect(pipelineOwnsSends({ QUAL_FOLLOWUP_MODE: "live", QUAL_FOLLOWUP_TEST_MODE: v })).toBe(false);
  });
  it.each(["false", "FALSE", " 0 ", "no", "Off", "", undefined])("%j does not", (v) => {
    expect(isTestModeRequested(v)).toBe(false);
    expect(rowTag(readSwitches({ QUAL_FOLLOWUP_MODE: "live", QUAL_FOLLOWUP_TEST_MODE: v }))).toBe("live");
    expect(pipelineOwnsSends({ QUAL_FOLLOWUP_MODE: "live", QUAL_FOLLOWUP_TEST_MODE: v })).toBe(true);
  });
});

describe("rowTag / pipelineOwnsSends / skip sql", () => {
  it("rowTag", () => {
    expect(rowTag(readSwitches({}))).toBeNull();
    expect(rowTag(readSwitches({ QUAL_FOLLOWUP_MODE: "dry_run" }))).toBe("dry_run");
    expect(rowTag(readSwitches({ QUAL_FOLLOWUP_MODE: "live" }))).toBe("live");
    expect(rowTag(readSwitches({ QUAL_FOLLOWUP_MODE: "live", QUAL_FOLLOWUP_TEST_MODE: "true" }))).toBe("test");
  });
  it("pipelineOwnsSends", () => {
    expect(pipelineOwnsSends({})).toBe(false);
    expect(pipelineOwnsSends({ QUAL_FOLLOWUP_MODE: "dry_run" })).toBe(false);
    expect(pipelineOwnsSends({ QUAL_FOLLOWUP_MODE: "live", QUAL_FOLLOWUP_TEST_MODE: "true" })).toBe(false);
    expect(pipelineOwnsSends({ QUAL_FOLLOWUP_MODE: "live" })).toBe(true);
  });
  it("followupSkipSql", () => {
    const a = { mobileExpr: "l.mobile10", requisitionExpr: "m.requisition_id" };
    expect(followupSkipSql(a, {})).toBe("");
    const q = followupSkipSql(a, { QUAL_FOLLOWUP_MODE: "live" });
    expect(q.startsWith(" AND NOT EXISTS")).toBe(true);
    for (const frag of ["qf.mobile10 = l.mobile10 COLLATE utf8mb4_unicode_ci", "qf.requisition_id = m.requisition_id", "qf.stopped_reason IS NULL", "mode_at_enqueue = 'live'"]) expect(q).toContain(frag);
  });
});

describe("decideStop", () => {
  it("order", () => {
    expect(decideStop(none)).toBeNull();
    expect(decideStop({ ...none, optedOut: true, repliedSinceQualified: true })).toBe("opted_out");
    expect(decideStop({ ...none, repliedSinceQualified: true })).toBe("replied");
    expect(decideStop({ ...none, requisitionClosed: "requisition is closed" })).toBe("requisition_closed");
    expect(decideStop({ ...none, joined: true })).toBe("joined");
    expect(decideStop({ ...none, hasMobile: false, hasEmail: false })).toBe("no_contact_details");
  });
});

describe("chooseWaTemplate", () => {
  it("cases", () => {
    expect(chooseWaTemplate({ sourceType: "meta_live", hasSlot: true, hasBranchAddress: true, hasBmiLink: true })).toEqual({ key: "he_walkin_invite", missing: [] });
    expect(chooseWaTemplate({ sourceType: "meta_live", hasSlot: true, hasBranchAddress: true, hasBmiLink: false })).toEqual({ key: "he_winback", missing: ["bmi_link"] });
    expect(chooseWaTemplate({ sourceType: "meta_old", hasSlot: false, hasBranchAddress: false, hasBmiLink: false })).toEqual({ key: "he_winback", missing: ["slot", "branch_address", "bmi_link"] });
    expect(chooseWaTemplate({ sourceType: "he", hasSlot: true, hasBranchAddress: true, hasBmiLink: false })).toEqual({ key: "he_walkin_invite", missing: [] });
    expect(chooseWaTemplate({ sourceType: "he", hasSlot: false, hasBranchAddress: true, hasBmiLink: false }).missing).toEqual(["slot"]);
  });
});

describe("nextStepDue", () => {
  it.each([
    ["2026-10-07T10:00:00", "2026-10-07T11:00:00"],
    ["2026-10-07T19:30:00", "2026-10-08T09:00:00"],
    ["2026-10-07T18:59:00", "2026-10-07T19:59:00"],
    ["2026-10-07T19:10:00", "2026-10-08T09:00:00"],
    ["2026-10-07T23:30:00", "2026-10-08T09:00:00"],
  ])("%s -> %s", (a, b) => {
    expect(nextStepDue(ist(a)).getTime()).toBe(ist(b).getTime());
  });
});

describe("errors and retry", () => {
  it("isTransientError", () => {
    for (const t of ["Request failed: ETIMEDOUT", "HTTP 503", "(#130429) Rate limit hit"]) expect(isTransientError(t)).toBe(true);
    for (const t of ["(#132018) issue with the parameters", "(#131026) Message undeliverable", null]) expect(isTransientError(t)).toBe(false);
  });
  it("metaErrorCode", () => {
    expect(metaErrorCode("(#132018) issue")).toBe("132018");
    expect(metaErrorCode("HTTP 401")).toBe("HTTP 401");
    expect(metaErrorCode("boom")).toBe("other");
  });
  it("afterFailure", () => {
    const t = new Date("2026-10-07T10:00:00Z");
    const a = afterFailure(0, "ETIMEDOUT", t);
    expect(a.status).toBeNull();
    expect(a.attempts).toBe(1);
    expect(a.retryAt!.getTime()).toBe(t.getTime() + 15 * 60_000);
    expect(afterFailure(1, "ETIMEDOUT", t).retryAt!.getTime()).toBe(t.getTime() + 30 * 60_000);
    expect(afterFailure(2, "ETIMEDOUT", t)).toEqual({ status: "failed", attempts: 3, retryAt: null });
    expect(afterFailure(0, "(#132018) x", t).status).toBe("failed");
  });
});

describe("quality", () => {
  it("normalise and budget", () => {
    expect(normaliseQuality("high")).toBe("GREEN");
    expect(normaliseQuality("MEDIUM")).toBe("YELLOW");
    expect(normaliseQuality("RED")).toBe("RED");
    expect(normaliseQuality(undefined)).toBe("UNKNOWN");
    expect(waDailyBudget("GREEN", 500)).toBe(500);
    expect(waDailyBudget("YELLOW", 500)).toBe(250);
    expect(waDailyBudget("UNKNOWN", 500)).toBe(250);
    expect(waDailyBudget(null, 500)).toBe(250);
    expect(waDailyBudget("RED", 500)).toBe(0);
  });
});

describe("dueSlot", () => {
  it("cases", () => {
    expect(dueSlot(ist("2026-10-07T10:03:00"), CALL_FILE_SLOTS, new Set())).toBe("2026-10-07 10:00");
    expect(dueSlot(ist("2026-10-07T10:03:00"), CALL_FILE_SLOTS, new Set(["2026-10-07 10:00"]))).toBeNull();
    expect(dueSlot(ist("2026-10-07T09:59:00"), CALL_FILE_SLOTS, new Set())).toBeNull();
    expect(dueSlot(ist("2026-10-07T12:01:00"), CALL_FILE_SLOTS, new Set())).toBe("2026-10-07 12:00");
    expect(dueSlot(ist("2026-10-07T20:01:00"), CALL_FILE_SLOTS, new Set())).toBeNull();
    expect(dueSlot(ist("2026-10-07T14:00:00"), CALL_FILE_SLOTS, new Set())).toBe("2026-10-07 14:00");
    expect(dueSlot(ist("2026-10-07T08:31:00"), DAILY_REPORT_SLOTS, new Set())).toBe("2026-10-07 08:30");
  });
});

describe("misc", () => {
  it("mask, ref, working day", () => {
    expect(maskMobile("9876543210")).toBe("xxxxxx3210");
    expect(maskMobile(null)).toBe("xxxxxx");
    expect(maskMobile("12")).toBe("xxxxxx");
    expect(followupRef("0f1e2d3c-aaaa-bbbb-cccc-000000000000")).toBe("QF-0F1E2D3C");
    expect(nextWorkingDayIst(ist("2026-10-10T12:00:00"))).toBe("2026-10-12");
    expect(nextWorkingDayIst(ist("2026-10-07T12:00:00"))).toBe("2026-10-08");
  });
});
