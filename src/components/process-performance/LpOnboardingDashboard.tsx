import { LpCallDashboard } from "./LpCallDashboard";

/**
 * LP Onboarding's real call-performance dashboard -- live aggregates over
 * db_masmis.lp_onboarding_cdr / lp_onboarding_apr, via GET
 * /api/process-performance/lp-onboarding-dashboard. Column-for-column
 * identical schema to LP Feedback's own tables, so this renders through
 * the same shared LpCallDashboard component (see its header comment for
 * the full KPI-to-column mapping and what the reference layout has that
 * this data cannot back).
 */
export function LpOnboardingDashboard() {
  return (
    <LpCallDashboard
      apiPath="/api/process-performance/lp-onboarding-dashboard"
      eyebrow="LP Onboarding · Process Performance"
      title="Onboarding Call Performance"
      unavailableLabel="Unable to load the LP Onboarding dashboard."
    />
  );
}
