/**
 * Unified HR Onboarding Hub — dispatch entry point.
 *
 * Navigating to /ats/onboarding lands here and immediately redirects to the
 * Requests tab. Each of the four onboarding sections is a full page at its own
 * URL; this hub exists so the nav link can point at a single stable address
 * rather than choosing an arbitrary sub-page.
 */
import { Navigate } from "react-router-dom";

export default function NativeHROnboardingHub() {
  return <Navigate to="/ats/onboarding-requests" replace />;
}
