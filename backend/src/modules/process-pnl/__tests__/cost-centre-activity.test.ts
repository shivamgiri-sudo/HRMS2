import { describe, expect, it } from "vitest";
import { activityWindow, ACTIVITY_WINDOW_MONTHS } from "../cost-centre-activity.service.js";

/**
 * The window the activity rule looks back over.
 *
 * Worth its own test because the obvious implementation — decrementing the month number as a
 * string — silently produces "2026-00" in January and drops a month from every year boundary,
 * which would mark a cost centre inactive purely because of the calendar.
 */
describe("activityWindow", () => {
  it("returns the trailing three months, ending inclusive", () => {
    expect(activityWindow("2026-08")).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("rolls back across a year boundary", () => {
    expect(activityWindow("2026-01")).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(activityWindow("2026-02")).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  it("honours a custom window length", () => {
    expect(activityWindow("2026-08", 1)).toEqual(["2026-08"]);
    expect(activityWindow("2026-03", 6)).toEqual(
      ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"],
    );
  });

  it("returns nothing for a malformed period rather than guessing", () => {
    // Better an empty window — which classifies nobody — than a plausible wrong one that
    // would mark every cost centre inactive on a typo.
    expect(activityWindow("")).toEqual([]);
    expect(activityWindow("2026")).toEqual([]);
    expect(activityWindow("2026-13-01")).toEqual([]);
  });

  it("defaults to three months, as agreed with the business", () => {
    expect(ACTIVITY_WINDOW_MONTHS).toBe(3);
    expect(activityWindow("2026-08")).toHaveLength(3);
  });
});
