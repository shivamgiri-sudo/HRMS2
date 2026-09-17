import { LpCallDashboard } from "./LpCallDashboard";

/**
 * Lawyer Panel Feedback's real call-performance dashboard -- live
 * aggregates over db_masmis.lp_feedback_cdr / lp_feedback_apr, via GET
 * /api/process-performance/lp-feedback-dashboard. Rendering lives in the
 * shared LpCallDashboard (see its header comment for the full KPI-to-
 * column mapping) -- LP Onboarding uses the exact same component against
 * its own identically-shaped tables.
 */
export function LpFeedbackDashboard() {
  return (
    <LpCallDashboard
      apiPath="/api/process-performance/lp-feedback-dashboard"
      eyebrow="Lawyer Panel · Process Performance"
      title="Feedback Call Performance"
      unavailableLabel="Unable to load the Lawyer Panel Feedback dashboard."
      tlFootnote="No TL-wise view is shown — neither the uploaded APR nor CDR file for Lawyer Panel Feedback has a team-lead column."
    />
  );
}
