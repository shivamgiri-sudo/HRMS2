import { LpCallDashboard } from "./LpCallDashboard";

/**
 * LP Onboarding's real call-performance dashboard -- live aggregates over
 * db_masmis.lp_onboarding_cdr / lp_onboarding_apr, via GET
 * /api/process-performance/lp-onboarding-dashboard. Column-for-column
 * identical schema to LP Feedback's own tables, so this renders through
 * the same shared LpCallDashboard component (see its header comment for
 * the full KPI-to-column mapping).
 *
 * Data is genuinely thin right now -- confirmed live 2026-09-17:
 * lp_onboarding_cdr has 8 rows (1-Sep-26 only, 3 agents, 2 service codes),
 * lp_onboarding_apr has 6 rows. Real numbers, just small.
 */
export function LpOnboardingDashboard() {
  return (
    <LpCallDashboard
      apiPath="/api/process-performance/lp-onboarding-dashboard"
      eyebrow="LP Onboarding · Process Performance"
      title="Onboarding Call Performance"
      unavailableLabel="Unable to load the LP Onboarding dashboard."
      tlFootnote="No TL-wise view is shown — neither the uploaded APR nor CDR file for LP Onboarding has a team-lead column."
    />
  );
}
