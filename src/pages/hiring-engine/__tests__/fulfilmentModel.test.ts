import { describe, expect, it } from "vitest";
import { coveragePct, dayHeadline, dayLabel } from "../fulfilmentModel";

describe("fulfilment model", () => {
  it("caps coverage at 100 and is 100 when nothing is needed", () => {
    expect(coveragePct({ neededLeads: 200, covered: 50 })).toBe(25);
    expect(coveragePct({ neededLeads: 100, covered: 400 })).toBe(100);
    expect(coveragePct({ neededLeads: 0, covered: 0 })).toBe(100);
  });
  it("labels a day and the headline", () => {
    expect(dayLabel("2026-10-12")).toBe("Mon 12 Oct");
    expect(dayHeadline({ date: "2026-10-12", booked: 120, confirmed: 18, expected: 14.9, branches: [] }, "2026-10-11")).toBe("Mon 12 Oct: about 15 expected from 120 booked (18 confirmed).");
    expect(dayHeadline({ date: "2026-10-11", booked: 5, confirmed: 1, expected: 2, branches: [] }, "2026-10-11")).toContain("Today:");
    expect(dayHeadline(null, "2026-10-11")).toBe("No interviews are booked.");
  });
});
