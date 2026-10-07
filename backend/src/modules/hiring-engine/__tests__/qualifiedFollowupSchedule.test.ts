import { describe, it, expect } from "vitest";
import { classifySource, normaliseMobile10, followupMode, withinSendWindow, holdToWindow, dueTimes } from "../qualified-followup.schedule.js";

const ist = (s: string) => new Date(`${s}+05:30`);

describe("classifySource", () => {
  it("maps launch kinds and campaign status", () => {
    for (const k of ["meta", "campaign", "batch"] as const) expect(classifySource({ launchSourceKind: k })).toBe("meta_old");
    expect(classifySource({ launchSourceKind: "pool" })).toBe("he");
    expect(classifySource({ campaignStatus: "active" })).toBe("meta_live");
    expect(classifySource({ campaignStatus: "draft" })).toBe("meta_live");
    expect(classifySource({ campaignStatus: "closed" })).toBe("he");
    expect(classifySource({})).toBe("he");
    expect(classifySource({ launchSourceKind: "campaign", campaignStatus: "active" })).toBe("meta_old");
  });
});

describe("normaliseMobile10", () => {
  it("accepts valid Indian mobiles", () => {
    for (const r of ["+91 98765 43210", "098765 43210", "9876543210"]) expect(normaliseMobile10(r)).toBe("9876543210");
  });
  it("rejects invalid input", () => {
    for (const r of ["12345", "5876543210", "", null, "abc"]) expect(normaliseMobile10(r)).toBeNull();
  });
});

describe("followupMode", () => {
  it("falls back to off", () => {
    for (const v of [undefined, "", "banana", "OFF"]) expect(followupMode({ QUAL_FOLLOWUP_MODE: v } as NodeJS.ProcessEnv)).toBe("off");
  });
  it("reads dry_run and live in any case", () => {
    expect(followupMode({ QUAL_FOLLOWUP_MODE: "dry_run" } as NodeJS.ProcessEnv)).toBe("dry_run");
    expect(followupMode({ QUAL_FOLLOWUP_MODE: "LIVE" } as NodeJS.ProcessEnv)).toBe("live");
  });
});

describe("send window", () => {
  it("is 09:00 to under 20:00 IST", () => {
    expect(withinSendWindow(ist("2026-10-07T08:59:00"))).toBe(false);
    expect(withinSendWindow(ist("2026-10-07T09:00:00"))).toBe(true);
    expect(withinSendWindow(ist("2026-10-07T19:59:00"))).toBe(true);
    expect(withinSendWindow(ist("2026-10-07T20:00:00"))).toBe(false);
  });
  it("holdToWindow", () => {
    expect(holdToWindow(ist("2026-10-07T23:30:00")).getTime()).toBe(ist("2026-10-08T09:00:00").getTime());
    expect(holdToWindow(ist("2026-10-07T08:59:00")).getTime()).toBe(ist("2026-10-07T09:00:00").getTime());
    expect(holdToWindow(ist("2026-10-07T12:00:00")).getTime()).toBe(ist("2026-10-07T12:00:00").getTime());
    expect(holdToWindow(ist("2026-10-07T20:00:00")).getTime()).toBe(ist("2026-10-08T09:00:00").getTime());
  });
});

describe("dueTimes", () => {
  it("holds WhatsApp to the window but never email", () => {
    const a = dueTimes({ qualifiedAt: ist("2026-10-07T23:30:00"), hasEmail: true });
    expect(a.emailDueAt?.getTime()).toBe(ist("2026-10-07T23:30:00").getTime());
    expect(a.waDueAt.getTime()).toBe(ist("2026-10-08T09:00:00").getTime());
    expect(dueTimes({ qualifiedAt: ist("2026-10-07T10:00:00"), hasEmail: true }).waDueAt.getTime()).toBe(ist("2026-10-07T11:00:00").getTime());
    expect(dueTimes({ qualifiedAt: ist("2026-10-07T19:30:00"), hasEmail: true }).waDueAt.getTime()).toBe(ist("2026-10-08T09:00:00").getTime());
    const n = dueTimes({ qualifiedAt: ist("2026-10-07T10:00:00"), hasEmail: false });
    expect(n.emailDueAt).toBeNull();
    expect(n.waDueAt.getTime()).toBe(ist("2026-10-07T10:00:00").getTime());
  });
});
