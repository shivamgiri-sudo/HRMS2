/**
 * Pure rules for the Coaching Center: which learners need a coach's attention and why.
 * Built on what the LMS sync already brings into HRMS (learner progress, course snapshots, assessment scores).
 */

export interface CoachingRow {
  employeeId: string;
  overdueCourses: number;
  failedAssessments: number;
  attritionRisk: string | null;
  opsHandoverReady: number | null;
  batchNo: string | null;
}

/** Plain-language reasons a learner needs attention, most urgent first. Empty = nothing to act on. */
export function attentionReasons(row: CoachingRow): string[] {
  const reasons: string[] = [];
  if ((row.attritionRisk ?? "").toLowerCase() === "red")
    reasons.push("High attrition risk");
  if (row.overdueCourses > 0)
    reasons.push(
      `${row.overdueCourses} overdue ${row.overdueCourses === 1 ? "course" : "courses"}`,
    );
  if (row.failedAssessments > 0)
    reasons.push(
      `${row.failedAssessments} failed ${row.failedAssessments === 1 ? "assessment" : "assessments"}`,
    );
  // A learner in a batch who is not yet ready for handover is a coaching topic; someone with no batch is not.
  if (row.batchNo && row.opsHandoverReady === 0)
    reasons.push("Not handover-ready");
  return reasons;
}

export function attentionScore(row: CoachingRow): number {
  return (
    ((row.attritionRisk ?? "").toLowerCase() === "red" ? 100 : 0) +
    Math.min(row.overdueCourses, 10) * 5 +
    Math.min(row.failedAssessments, 10) * 4 +
    (row.batchNo && row.opsHandoverReady === 0 ? 3 : 0)
  );
}

/** Most in need of attention first; ties keep their incoming (name) order. */
export function sortByAttention<T extends CoachingRow>(rows: T[]): T[] {
  return rows
    .map((row, index) => ({ row, index, score: attentionScore(row) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.row);
}

/** Assessment results the LMS reports as not passed. */
export function isFailedResult(result: string | null | undefined): boolean {
  const value = String(result ?? "")
    .trim()
    .toLowerCase();
  return value === "fail" || value === "failed";
}
