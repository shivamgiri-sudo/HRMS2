import { describe, expect, it, vi } from "vitest";
import { ttlFor } from "../pnl-read-cache.js";

describe("P&L read cache lifetime", () => {
  it("keeps the running month at 60 s and a finished month at 10 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T08:00:00Z"));
    expect(ttlFor({ period: "2026-10" })).toBe(60_000);
    expect(ttlFor({ period: "2026-09" })).toBe(600_000);
    expect(ttlFor({ period: "2026-04" })).toBe(600_000);
    vi.useRealTimers();
  });
  it("uses the IST month, not the UTC one, around midnight on the 1st", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T19:00:00Z")); // 00:30 IST on 1 October
    expect(ttlFor({ period: "2026-09" })).toBe(600_000);
    expect(ttlFor({ period: "2026-10" })).toBe(60_000);
    vi.useRealTimers();
  });
  it("an explicit lifetime wins, and a read with no period keeps 60 s", () => {
    expect(ttlFor({ period: "2026-04" }, 5_000)).toBe(5_000);
    expect(ttlFor({})).toBe(60_000);
    expect(ttlFor({ period: "not-a-month" })).toBe(60_000);
  });
});
