import { Route } from "react-router-dom";
import { lazy } from "./lazy";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import WorkforcePageGate from "@/components/security/WorkforcePageGate";

const Gate = ({ pageCode, children }: { pageCode: string; children: React.ReactNode }) =>
  <WorkforcePageGate pageCode={pageCode}>{children}</WorkforcePageGate>;

const NativeStatutoryCompliance     = lazy(() => import("@/pages/NativeStatutoryCompliance"));
const NativeLabourCompliance        = lazy(() => import("@/pages/NativeLabourCompliance"));
const NativeDPDPCompliance          = lazy(() => import("@/pages/NativeDPDPCompliance"));
const NativeComplianceAuditReport   = lazy(() => import("@/pages/NativeComplianceAuditReport"));
const NativeDPDPWithdrawal          = lazy(() => import("@/pages/NativeDPDPWithdrawal"));
const NativeDPDPWithdrawalAdmin     = lazy(() => import("@/pages/NativeDPDPWithdrawalAdmin"));
const NativeITProvisioningTracker   = lazy(() => import("@/pages/NativeITProvisioningTracker"));

export function ComplianceRoutes() {
  return (
    <>
      {/* Statutory / Labour / DPDP */}
      <Route path="/compliance/statutory"    element={<ProtectedRoute><Gate pageCode="STATUTORY_COMPLIANCE"><NativeStatutoryCompliance /></Gate></ProtectedRoute>} />
      <Route path="/compliance/labour"       element={<ProtectedRoute><Gate pageCode="LABOUR_COMPLIANCE"><NativeLabourCompliance /></Gate></ProtectedRoute>} />
      <Route path="/compliance/dpdp"         element={<ProtectedRoute><Gate pageCode="DPDP_COMPLIANCE"><NativeDPDPCompliance /></Gate></ProtectedRoute>} />
      <Route path="/compliance/audit-report" element={<ProtectedRoute roles={['admin','hr','super_admin']}><NativeComplianceAuditReport /></ProtectedRoute>} />

      {/* DPDP withdrawal */}
      <Route path="/privacy/dpdp-withdrawal"             element={<ProtectedRoute><Gate pageCode="DPDP_WITHDRAWAL"><NativeDPDPWithdrawal /></Gate></ProtectedRoute>} />
      <Route path="/compliance/dpdp-withdrawal-admin"    element={<ProtectedRoute><Gate pageCode="DPDP_WITHDRAWAL_ADMIN"><NativeDPDPWithdrawalAdmin /></Gate></ProtectedRoute>} />

      {/* IT Provisioning — role-scoped views */}
      <Route path="/it-provisioning"                     element={<ProtectedRoute><Gate pageCode="IT_PROVISIONING_TRACKER"><NativeITProvisioningTracker /></Gate></ProtectedRoute>} />
      <Route path="/provisioning/wfm-alignment"          element={<ProtectedRoute roles={['wfm','admin','super_admin']}><Gate pageCode="PROVISIONING_WFM_ALIGNMENT"><NativeITProvisioningTracker /></Gate></ProtectedRoute>} />
      <Route path="/provisioning/it"                     element={<ProtectedRoute roles={['it','admin','super_admin']}><Gate pageCode="PROVISIONING_IT"><NativeITProvisioningTracker /></Gate></ProtectedRoute>} />
      <Route path="/provisioning/admin"                  element={<ProtectedRoute roles={['branch_admin','hr','admin','super_admin']}><Gate pageCode="PROVISIONING_ADMIN"><NativeITProvisioningTracker /></Gate></ProtectedRoute>} />
      <Route path="/provisioning/appointment-letter"     element={<ProtectedRoute roles={['hr','admin','super_admin']}><Gate pageCode="PROVISIONING_APPOINTMENT_LETTER"><NativeITProvisioningTracker /></Gate></ProtectedRoute>} />
    </>
  );
}
