/**
 * NOC Certificate — clearance workspace page.
 *
 * Thin routing wrapper around NocClearanceChain (components/payroll/NocClearanceChain.tsx),
 * which does all the real work. This file exists only to give that component a DashboardLayout
 * shell and to resolve `canOverride` from the caller's own roles, mirroring the backend's own
 * override gate (noc-case.routes.ts: payroll_head, plus super_admin via hasAnyRole's built-in
 * grant) so the button's visibility never drifts from what the server will actually allow.
 */

import { DashboardLayout } from "../../components/layout/DashboardLayout";
import { useWorkforceAccess } from "../../hooks/useUserRole";
import NocClearanceChain from "../../components/payroll/NocClearanceChain";

export default function NocClearanceWorkspace() {
  const { hasAnyRole, isResolved } = useWorkforceAccess();
  const canOverride = isResolved && hasAnyRole("payroll_head", "super_admin");

  return (
    <DashboardLayout>
      <NocClearanceChain canOverride={canOverride} />
    </DashboardLayout>
  );
}
