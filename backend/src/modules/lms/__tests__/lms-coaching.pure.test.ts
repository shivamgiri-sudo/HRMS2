import { describe, expect, it } from "vitest";
import {
  attentionReasons,
  attentionScore,
  isFailedResult,
  sortByAttention,
  type CoachingRow,
} from "../lms-coaching.pure";

const row = (over: Partial<CoachingRow> = {}): CoachingRow => ({
  employeeId: "e1",
  overdueCourses: 0,
  failedAssessments: 0,
  attritionRisk: null,
  opsHandoverReady: null,
  batchNo: null,
  ...over,
});

describe("attentionReasons", () => {
  it("is empty for a learner with nothing to act on", () => {
    expect(attentionReasons(row())).toEqual([]);
  });

  it("lists reasons most urgent first, in plain language", () => {
    expect(
      attentionReasons(
        row({
          attritionRisk: "red",
          overdueCourses: 2,
          failedAssessments: 1,
          batchNo: "B1",
          opsHandoverReady: 0,
        }),
      ),
    ).toEqual([
      "High attrition risk",
      "2 overdue courses",
      "1 failed assessment",
      "Not handover-ready",
    ]);
  });

  it("does not call someone with no batch not-ready", () => {
    expect(
      attentionReasons(row({ opsHandoverReady: 0, batchNo: null })),
    ).toEqual([]);
  });
});

describe("sortByAttention", () => {
  it("puts high-risk and overdue learners first and keeps ties in order", () => {
    const rows = [
      row({ employeeId: "a" }),
      row({ employeeId: "b", overdueCourses: 3 }),
      row({ employeeId: "c", attritionRisk: "red" }),
      row({ employeeId: "d" }),
    ];
    expect(sortByAttention(rows).map((r) => r.employeeId)).toEqual([
      "c",
      "b",
      "a",
      "d",
    ]);
  });

  it("caps the influence of a very long overdue list", () => {
    expect(attentionScore(row({ overdueCourses: 500 }))).toBe(50);
  });
});

describe("isFailedResult", () => {
  it("recognises fail spellings only", () => {
    expect(isFailedResult("Fail")).toBe(true);
    expect(isFailedResult(" failed ")).toBe(true);
    expect(isFailedResult("Pass")).toBe(false);
    expect(isFailedResult(null)).toBe(false);
  });
});
