import {
  getLpCallDashboard, currentMonthRange,
  type LpCallDashboardData, type LpCallHeadline, type LpCallServiceRow, type LpCallWeekRow, type LpCallAgentRow,
} from "./lp-call-dashboard.shared.js";

/**
 * Lawyer Panel (LP) Feedback's real call-performance dashboard -- live
 * aggregates over db_masmis.lp_feedback_cdr (9,512 real call records,
 * 2026-09-01 .. 2026-09-04, 8 agents, confirmed live 2026-09-17) and
 * db_masmis.lp_feedback_apr (agent-day productivity report).
 *
 * The actual aggregation logic lives in lp-call-dashboard.shared.ts, shared
 * with LP Onboarding -- see that file's header for the full KPI-to-column
 * mapping, the Shrinkage formula deviation from the reference sheet, and
 * why there's no TL-wise view.
 */

export type { LpCallDashboardData as LpFeedbackDashboardData, LpCallHeadline as LpFeedbackHeadline, LpCallServiceRow as LpFeedbackServiceRow, LpCallWeekRow as LpFeedbackWeekRow, LpCallAgentRow as LpFeedbackAgentRow };
export { currentMonthRange };

export async function getLpFeedbackDashboard(fromInput: string, toInput: string): Promise<LpCallDashboardData> {
  return getLpCallDashboard("lp_feedback", fromInput, toInput);
}
