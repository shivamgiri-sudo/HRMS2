import { Route } from "react-router-dom";
import { lazy } from "./lazy";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import WorkforcePageGate from "@/components/security/WorkforcePageGate";

const Gate = ({ pageCode, children }: { pageCode: string; children: React.ReactNode }) =>
  <WorkforcePageGate pageCode={pageCode}>{children}</WorkforcePageGate>;

const NativeAppointmentLetterQueue = lazy(() => import("@/pages/NativeAppointmentLetterQueue"));
const NativeStatutoryCompliance     = lazy(() => import("@/pages/NativeStatutoryCompliance"));
const NativeLabourCompliance        = lazy(() => import("@/pages/NativeLabourCompliance"));
const NativeDPDPCompliance          = lazy(() => import("@/pages/NativeDPDPCompliance"));
const NativeComplianceAuditReport   = lazy(() => import("@/pages/NativeComplianceAuditReport"));
const NativeDPDPWithdrawal          = lazy(() => import("@/pages/NativeDPDPWithdrawal"));
const NativeDPDPWithdrawalAdmin     = lazy(() => import("@/pages/NativeDPDPWithdrawalAdmin"));
const NativeITProvisioningTracker   = lazy(() => import("@/pages/NativeITProvisioningTracker"));
const NativeManagerHandoverClearance = lazy(() => import("@/pages/NativeManagerHandoverClearance"));
const NativeHrExitClearance          = lazy(() => import("@/pages/NativeHrExitClearance"));
const NativePayrollExitClearance     = lazy(() => import("@/pages/NativePayrollExitClearance"));
const NativeTrainerExitClearance     = lazy(() => import("@/pages/NativeTrainerExitClearance"));

export const complianceRouteElements = (
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
      <Route path="/provisioning/it"                     element={<ProtectedRoute roles={['it','admin','super_admin','branch_head','branch_it','it_admin','it_head','payroll_hr']}><Gate pageCode="PROVISIONING_IT"><NativeITProvisioningTracker /></Gate></ProtectedRoute>} />
      <Route path="/provisioning/admin"                  element={<ProtectedRoute roles={['branch_admin','hr','admin','super_admin','branch_head','it_head','payroll_hr']}><Gate pageCode="PROVISIONING_ADMIN"><NativeITProvisioningTracker /></Gate></ProtectedRoute>} />
      {/* Was a redirect to the control room, which has no issuance UI. */}
      <Route path="/provisioning/appointment-letter"     element={<ProtectedRoute><NativeAppointmentLetterQueue /></ProtectedRoute>} />

      {/* Exit clearance — dedicated per-role queues, one per exit_clearance_task owner_role
          that has no existing provisioning-style page (manager/hr/payroll/trainer). Admin
          and WFM's own clearance tasks are surfaced as a section on their existing
          /provisioning/admin and /provisioning/wfm-alignment pages instead — see
          NativeITProvisioningTracker.tsx. */}
      <Route path="/provisioning/manager-handover"       element={<ProtectedRoute roles={['manager','admin','hr','super_admin']}><Gate pageCode="PROVISIONING_MANAGER_HANDOVER"><NativeManagerHandoverClearance /></Gate></ProtectedRoute>} />
      <Route path="/provisioning/hr-exit"                element={<ProtectedRoute roles={['hr','admin','super_admin']}><Gate pageCode="PROVISIONING_HR_EXIT"><NativeHrExitClearance /></Gate></ProtectedRoute>} />
      <Route path="/provisioning/payroll-exit"           element={<ProtectedRoute roles={['payroll','hr','admin','super_admin']}><Gate pageCode="PROVISIONING_PAYROLL_EXIT"><NativePayrollExitClearance /></Gate></ProtectedRoute>} />
      <Route path="/provisioning/trainer-exit"           element={<ProtectedRoute roles={['trainer','hr','admin','super_admin']}><Gate pageCode="PROVISIONING_TRAINER_EXIT"><NativeTrainerExitClearance /></Gate></ProtectedRoute>} />
  </>
);
