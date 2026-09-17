import {
  getLpCallDashboard, currentMonthRange,
  type LpCallDashboardData, type LpCallHeadline, type LpCallServiceRow, type LpCallWeekRow, type LpCallAgentRow,
} from "./lp-call-dashboard.shared.js";

/**
 * LP Onboarding's real call-performance dashboard -- live aggregates over
 * db_masmis.lp_onboarding_cdr / lp_onboarding_apr, column-for-column
 * identical schema to LP Feedback's own tables (confirmed via SHOW
 * COLUMNS). Data is genuinely thin right now -- confirmed live
 * 2026-09-17: lp_onboarding_cdr has 8 rows (1-Sep-26 only, 3 agents, 2
 * service codes), lp_onboarding_apr has 6 rows. Real numbers, just small.
 *
 * See lp-call-dashboard.shared.ts (shared with LP Feedback) for the full
 * KPI-to-column mapping and the Shrinkage formula note.
 */

export type { LpCallDashboardData as LpOnboardingDashboardData, LpCallHeadline as LpOnboardingHeadline, LpCallServiceRow as LpOnboardingServiceRow, LpCallWeekRow as LpOnboardingWeekRow, LpCallAgentRow as LpOnboardingAgentRow };
export { currentMonthRange };

export async function getLpOnboardingDashboard(fromInput: string, toInput: string): Promise<LpCallDashboardData> {
  return getLpCallDashboard("lp_onboarding", fromInput, toInput);
}
