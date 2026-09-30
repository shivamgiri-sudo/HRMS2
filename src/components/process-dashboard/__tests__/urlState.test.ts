import { describe, expect, it } from "vitest";
import { defaultState, detectPreset, parseUrlState, presetRange, serializeUrlState } from "../urlState";

const NOW = new Date(2026, 8, 30); // 30 Sep 2026 (local)

describe("presetRange", () => {
  it("computes every preset", () => {
    expect(presetRange("today", NOW)).toEqual({ from: "2026-09-30", to: "2026-09-30" });
    expect(presetRange("yesterday", NOW)).toEqual({ from: "2026-09-29", to: "2026-09-29" });
    expect(presetRange("7d", NOW)).toEqual({ from: "2026-09-24", to: "2026-09-30" });
    expect(presetRange("mtd", NOW)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("lastmonth", NOW)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });
  it("handles January rollover", () => {
    expect(presetRange("lastmonth", new Date(2026, 0, 15))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
  it("detects the active preset", () => {
    expect(detectPreset("2026-09-01", "2026-09-30", NOW)).toBe("mtd");
    expect(detectPreset("2026-09-02", "2026-09-30", NOW)).toBeNull();
  });
});

describe("parseUrlState", () => {
  it("falls back to month-to-date for empty or garbage input", () => {
    const s = parseUrlState(new URLSearchParams("from=nope&to=2026-13-40"), NOW);
    expect(s.from).toBe("2026-09-01"); expect(s.to).toBe("2026-09-30");
  });
  it("swaps an inverted range and sanitises fields", () => {
    const s = parseUrlState(new URLSearchParams("from=2026-09-20&to=2026-09-10&page=-3&dir=asc&day=2026-02-31"), NOW);
    expect(s.from).toBe("2026-09-10"); expect(s.to).toBe("2026-09-20");
    expect(s.page).toBe(1); expect(s.dir).toBe("asc"); expect(s.day).toBe("");
  });
});

describe("serializeUrlState", () => {
  it("omits defaults so links stay short", () => {
    expect(serializeUrlState(defaultState(NOW), new URLSearchParams(), NOW).toString()).toBe("");
  });
  it("round-trips a full state", () => {
    const s = { ...defaultState(NOW), from: "2026-09-10", to: "2026-09-12", tl: "A B", lob: "X", q: "ravi", agent: "E1", day: "2026-09-11", metric: "calls", sort: "calls", dir: "asc" as const, page: 3 };
    expect(parseUrlState(serializeUrlState(s, new URLSearchParams(), NOW), NOW)).toEqual(s);
  });
  it("keeps unrelated params (e.g. ?process= on the Operations page) and removes cleared ones", () => {
    const base = new URLSearchParams("process=abc&view=sales&agent=E1");
    const out = serializeUrlState({ ...defaultState(NOW), agent: "" }, base, NOW);
    expect(out.get("process")).toBe("abc"); expect(out.get("view")).toBe("sales"); expect(out.has("agent")).toBe(false);
  });
});
