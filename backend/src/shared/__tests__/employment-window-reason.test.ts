import { describe, expect, it } from "vitest";
import { outsideEmploymentReason } from "../employmentWindow.js";

/**
 * WFM email 2026-10-15 ("APR failures", 17 analysts): the rejection report said only "outside the
 * employee's employment period", so the uploader could not tell a training-gap row from an exit.
 */
describe("outsideEmploymentReason", () => {
  it("names the window and the training gap when joined before the salary start date", () => {
    const text = outsideEmploymentReason(
      "2026-10-08",
      [{ from: "2026-10-12", to: null }],
      "2026-10-06",
      "2026-10-12",
    );
    expect(text).toContain("2026-10-08 is outside");
    expect(text).toContain("2026-10-12 to no exit date");
    expect(text).toContain("Joined 2026-10-06 but the salary start date is 2026-10-12");
  });

  it("points at the exit record when the date is after the last working day", () => {
    const text = outsideEmploymentReason("2026-10-20", [{ from: "2026-08-26", to: "2026-08-31" }], "2026-08-26", "2026-08-26");
    expect(text).toContain("The exit date on record is 2026-08-31");
  });

  it("falls back to the plain statement otherwise", () => {
    const text = outsideEmploymentReason("2026-07-01", [{ from: "2026-08-01", to: "2026-09-01" }], null, null);
    expect(text).toBe("2026-07-01 is outside this employee's employment period (2026-08-01 to 2026-09-01); attendance cannot be recorded for it.");
  });
});
