import { describe, expect, it } from "vitest";
import { istDateKey, istWeekStartKey } from "../atsFullParity.service.js";

/**
 * Command Center FTD/WTD/MTD boundaries. The old code used UTC dates and a Sunday-first week in SQL while the daily
 * branch report is IST and Monday-first, so the same candidate was in different periods depending on the code path.
 */
describe("IST period boundaries", () => {
  it("uses the IST calendar day, not the UTC day", () => {
    // 20:00 UTC on the 29th is 01:30 IST on the 30th
    expect(istDateKey(new Date("2026-09-29T20:00:00Z"))).toBe("2026-09-30");
    expect(istDateKey(new Date("2026-09-29T17:00:00Z"))).toBe("2026-09-29");
  });

  it("starts the week on Monday", () => {
    expect(istWeekStartKey(new Date("2026-09-30T06:00:00Z"))).toBe(
      "2026-09-28",
    ); // Wednesday
    expect(istWeekStartKey(new Date("2026-09-28T06:00:00Z"))).toBe(
      "2026-09-28",
    ); // Monday itself
    expect(istWeekStartKey(new Date("2026-09-27T06:00:00Z"))).toBe(
      "2026-09-21",
    ); // Sunday belongs to the week that began the 21st
  });

  it("gives the week start of the IST day, so late-Sunday UTC is already Monday IST", () => {
    expect(istWeekStartKey(new Date("2026-09-27T20:00:00Z"))).toBe(
      "2026-09-28",
    );
  });

  it("can start the week in the previous month", () => {
    expect(istWeekStartKey(new Date("2026-10-01T06:00:00Z"))).toBe(
      "2026-09-28",
    );
  });
});
