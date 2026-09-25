import { describe, expect, it } from "vitest";
import {
  addDays,
  approachingStage,
  expiryAction,
  isValidExtension,
  lowFillStage,
  nextCycleNo,
  percentTimeElapsed,
  type RequisitionSnapshot,
} from "../job-requisition-deadline.rules.js";

const snap = (o: Partial<RequisitionSnapshot> = {}): RequisitionSnapshot => ({
  requested: 20,
  fulfilled: 0,
  validity: "2026-10-10",
  batchEnd: null,
  targetJoining: null,
  startDate: "2026-09-10",
  ...o,
});

describe("expiryAction", () => {
  it("auto-closes a requisition past validity with zero fills", () => {
    expect(
      expiryAction(snap({ validity: "2026-09-24" }), "2026-09-25", null),
    ).toBe("auto_close");
  });
  it("asks HR to decide when partly filled and past validity", () => {
    expect(
      expiryAction(
        snap({ validity: "2026-09-24", fulfilled: 6 }),
        "2026-09-25",
        null,
      ),
    ).toBe("needs_decision");
  });
  it("does nothing on the validity day itself or before", () => {
    expect(
      expiryAction(
        snap({ validity: "2026-09-25", fulfilled: 6 }),
        "2026-09-25",
        null,
      ),
    ).toBe("none");
  });
  it("does nothing while a decision is pending", () => {
    const latest = {
      status: "pending" as const,
      cycleNo: 1,
      reviewAfter: null,
    };
    expect(
      expiryAction(
        snap({ validity: "2026-09-24", fulfilled: 6 }),
        "2026-09-25",
        latest,
      ),
    ).toBe("none");
  });
  it("respects keep-open until the review date, then asks again", () => {
    const latest = {
      status: "kept_open" as const,
      cycleNo: 1,
      reviewAfter: "2026-10-02",
    };
    expect(
      expiryAction(
        snap({ validity: "2026-09-24", fulfilled: 6 }),
        "2026-10-01",
        latest,
      ),
    ).toBe("none");
    expect(
      expiryAction(
        snap({ validity: "2026-09-24", fulfilled: 6 }),
        "2026-10-02",
        latest,
      ),
    ).toBe("needs_decision");
  });
  it("never expires a requisition with no validity", () => {
    expect(expiryAction(snap({ validity: null }), "2026-09-25", null)).toBe(
      "none",
    );
  });
});

describe("nextCycleNo", () => {
  it("starts at 1 and increments", () => {
    expect(nextCycleNo(null)).toBe(1);
    expect(
      nextCycleNo({ status: "kept_open", cycleNo: 2, reviewAfter: null }),
    ).toBe(3);
  });
});

describe("approachingStage", () => {
  it("fires only exactly 3 or 1 days out", () => {
    expect(approachingStage("2026-09-28", "2026-09-25")).toBe(3);
    expect(approachingStage("2026-09-26", "2026-09-25")).toBe(1);
    expect(approachingStage("2026-09-27", "2026-09-25")).toBeNull();
    expect(approachingStage(null, "2026-09-25")).toBeNull();
  });
});

describe("lowFillStage", () => {
  it("flags a requisition far behind the time used", () => {
    // 30-day window, 22 days used (73%): only stage 50 reached; 10% filled is far behind
    expect(
      lowFillStage(
        snap({ fulfilled: 2, validity: "2026-10-10" }),
        "2026-10-02",
      ),
    ).toBe(50);
  });
  it("uses the highest stage reached", () => {
    expect(lowFillStage(snap({ fulfilled: 2 }), "2026-10-08")).toBe(90);
  });
  it("stays quiet when the fill rate keeps pace", () => {
    expect(lowFillStage(snap({ fulfilled: 12 }), "2026-10-02")).toBeNull();
  });
  it("stays quiet before the first stage", () => {
    expect(lowFillStage(snap({ fulfilled: 0 }), "2026-09-15")).toBeNull();
  });
  it("uses the batch start date as the window end when a batch is planned", () => {
    const s = snap({
      batchEnd: "2026-09-30",
      validity: "2026-10-30",
      fulfilled: 1,
    });
    expect(percentTimeElapsed(s, "2026-09-25")).toBeCloseTo(75, 0);
    expect(lowFillStage(s, "2026-09-25")).toBe(75);
  });
});

describe("isValidExtension / addDays", () => {
  it("accepts a future date within 90 days only", () => {
    expect(isValidExtension("2026-09-26", "2026-09-25")).toBe(true);
    expect(isValidExtension("2026-09-25", "2026-09-25")).toBe(false);
    expect(isValidExtension("2027-01-25", "2026-09-25")).toBe(false);
    expect(isValidExtension("not-a-date", "2026-09-25")).toBe(false);
  });
  it("adds days across a month end", () => {
    expect(addDays("2026-09-28", 7)).toBe("2026-10-05");
  });
});
