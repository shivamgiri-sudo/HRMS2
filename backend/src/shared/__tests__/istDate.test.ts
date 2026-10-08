import { describe, expect, it } from "vitest";
import { getBusinessDateIST, getCurrentDateIST, getGeneratedAtIST } from "../istDate.js";

describe("istDate", () => {
  it("normal time: business date is yesterday in IST", () => {
    // 2026-08-19 12:00:00 UTC == 2026-08-19 17:30 IST
    const now = new Date("2026-08-19T12:00:00.000Z");
    expect(getCurrentDateIST(now)).toBe("2026-08-19");
    expect(getBusinessDateIST(now)).toBe("2026-08-18");
  });

  it("near-midnight IST: just before IST midnight still resolves to the correct D-1 day", () => {
    // 2026-08-19 18:29:00 UTC == 2026-08-19 23:59 IST (one minute before IST midnight)
    const now = new Date("2026-08-19T18:29:00.000Z");
    expect(getCurrentDateIST(now)).toBe("2026-08-19");
    expect(getBusinessDateIST(now)).toBe("2026-08-18");

    // 2026-08-19 18:30:00 UTC == 2026-08-20 00:00 IST (exactly IST midnight)
    const justAfter = new Date("2026-08-19T18:30:00.000Z");
    expect(getCurrentDateIST(justAfter)).toBe("2026-08-20");
    expect(getBusinessDateIST(justAfter)).toBe("2026-08-19");
  });

  it("UTC date differs from IST date: a run just after UTC midnight is still the previous IST evening", () => {
    // 2026-08-19 00:10:00 UTC == 2026-08-19 05:40 IST — same calendar day here, but
    // 2026-08-18 19:00:00 UTC == 2026-08-19 00:30 IST is the case that actually flips:
    // UTC day is the 18th, IST day is already the 19th.
    const now = new Date("2026-08-18T19:00:00.000Z");
    expect(now.getUTCDate()).toBe(18);
    expect(getCurrentDateIST(now)).toBe("2026-08-19");
    expect(getBusinessDateIST(now)).toBe("2026-08-18");
  });

  it("getGeneratedAtIST renders a human-readable IST timestamp", () => {
    const now = new Date("2026-08-19T03:35:00.000Z"); // 09:05 IST
    expect(getGeneratedAtIST(now)).toBe("19 Aug 2026, 9:05 AM IST");
  });
});
