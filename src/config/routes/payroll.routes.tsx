import { Route, Navigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { lazy } from "./lazy";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import WorkforcePageGate from "@/components/security/WorkforcePageGate";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { PayslipViewer } from "@/components/profile/PayslipViewer";

const Gate = ({ pageCode, children }: { pageCode: string; children: React.ReactNode }) =>
  <WorkforcePageGate pageCode={pageCode}>{children}</WorkforcePageGate>;

const Payroll                   = lazy(() => import("@/pages/Payroll"));
const NativePayslipCenter       = lazy(() => import("@/pages/NativePayslipCenter"));
const NativeTaxDeclaration      = lazy(() => import("@/pages/NativeTaxDeclaration"));
const NativeFullFinal           = lazy(() => import("@/pages/NativeFullFinal"));
const NativeStatutoryConfig     = lazy(() => import("@/pages/NativeStatutoryConfig"));
const NativePayrollMasters      = lazy(() => import("@/pages/NativePayrollMasters"));
const NativeSalaryPackages      = lazy(() => import("@/pages/NativeSalaryPackages"));
const NativeSalaryPackageAdmin  = lazy(() => import("@/pages/NativeSalaryPackageAdmin"));
const NativeIncentives          = lazy(() => import("@/pages/NativeIncentives"));
const PayrollOvertimeManagement = lazy(() => import("@/pages/PayrollOvertimeManagement"));
const PayrollConfigFlags        = lazy(() => import("@/pages/payroll/PayrollConfigFlags"));
const RecalculationQueue        = lazy(() => import("@/pages/payroll/RecalculationQueue"));
const AttendanceControlTower    = lazy(() => import("@/pages/payroll/AttendanceControlTower"));
const RunningPayrollBreakdown   = lazy(() => import("@/pages/payroll/RunningPayrollBreakdown"));
const HolidayMaster             = lazy(() => import("@/pages/payroll/HolidayMaster"));
const DisbursalManagement       = lazy(() => import("@/pages/payroll/DisbursalManagement"));
const HolidayWorkRequest        = lazy(() => import("@/pages/payroll/HolidayWorkRequest"));
const HolidayWorkApprovals      = lazy(() => import("@/pages/payroll/HolidayWorkApprovals"));
const PayrollValidationScreen   = lazy(() => import("@/pages/payroll/PayrollValidationScreen"));
const NocManagement             = lazy(() => import("@/pages/payroll/NocManagement"));
const BranchPayrollReadiness    = lazy(() => import("@/pages/payroll/BranchPayrollReadiness"));
const ProcessPayrollReadiness   = lazy(() => import("@/pages/payroll/ProcessPayrollReadiness"));
const PayrollCalendar           = lazy(() => import("@/pages/payroll/PayrollCalendar"));
// PayrollCostSummary moved into ReportsHub — route redirects to hub
const StatutoryFilingTracker    = lazy(() => import("@/pages/payroll/StatutoryFilingTracker"));
const PayrollAuditTrail         = lazy(() => import("@/pages/payroll/PayrollAuditTrail"));
// PayrollVarianceReport moved into ReportsHub — route redirects to hub
const BulkOutputs               = lazy(() => import("@/pages/payroll/BulkOutputs"));
const LoanManagement            = lazy(() => import("@/pages/payroll/LoanManagement"));
const PayrollSignOff            = lazy(() => import("@/pages/payroll/PayrollSignOff"));
const SalaryCertificate         = lazy(() => import("@/pages/payroll/SalaryCertificate"));
const ReimbursementManagement   = lazy(() => import("@/pages/payroll/ReimbursementManagement"));
const PayrollEpfCompliancePage  = lazy(() => import("@/pages/PayrollEpfCompliancePage"));
const PfCreationQueuePage       = lazy(() => import("@/pages/payroll/PfCreationQueuePage"));
const PfBatchesPage             = lazy(() => import("@/pages/payroll/PfBatchesPage"));
const NativePayrollHOQueues     = lazy(() => import("@/pages/NativePayrollHOQueues"));
const NativeChequeNameValidation = lazy(() => import("@/pages/NativeChequeNameValidation"));
const NativeSalaryIncrement     = lazy(() => import("@/pages/NativeSalaryIncrement"));
const HolidayWork               = lazy(() => import("@/pages/payroll/HolidayWork"));
const PfManagement              = lazy(() => import("@/pages/payroll/PfManagement"));

/**
 * Roles entitled to the org-wide admin Payslip Center. Everyone else — including
 * the CEO — gets their own payslip.
 *
 * This mirrors the roles the backend actually authorises for payslip data
 * (payroll-lines.compat.routes.ts and payroll.secure.routes.ts). It is NOT a
 * security boundary: the API enforces that. It stops the UI offering a console
 * whose every request would 403, which is what produced the CEO UAT finding —
 * an "Access denied. Required: admin or hr or finance or payroll" banner painted
 * over a fully populated payroll run history.
 */
const PAYSLIP_CENTER_ROLES = [
  "super_admin", "admin", "hr", "hr_head",
  "finance", "finance_head", "accounts_head",
  "payroll", "payroll_head", "payroll_branch", "payroll_hr", "payroll_admin",
];

function PayslipCenterRoute() {
  const { roleKeys, employeeId, employeeName, employeeCode } = useWorkforceAccess();

  // Dispatch on payroll entitlement, not on primaryRole === "employee".
  // The old test sent anyone whose primary role was not literally "employee" to
  // the admin console — so a CEO, a trainer or a team leader all landed on an
  // org-wide payroll screen instead of their own payslip.
  const canSeePayslipCenter = roleKeys.some((role) => PAYSLIP_CENTER_ROLES.includes(role));

  if (!canSeePayslipCenter && employeeId) {
    return (
      <DashboardLayout>
        <PayslipViewer
          employeeId={employeeId}
          employeeName={employeeName ?? ""}
          employeeCode={employeeCode ?? ""}
        />
      </DashboardLayout>
    );
  }
  return <NativePayslipCenter />;
}

export const payrollRouteElements = (
  <>
      <Route path="/payroll" element={<ProtectedRoute><Gate pageCode="PAYROLL"><Payroll /></Gate></ProtectedRoute>} />
      <Route path="/payroll/payslips"       element={<ProtectedRoute><PayslipCenterRoute /></ProtectedRoute>} />
      <Route path="/payroll/tax-declaration" element={<ProtectedRoute><Gate pageCode="TAX_DECLARATION"><NativeTaxDeclaration /></Gate></ProtectedRoute>} />
      <Route path="/payroll/full-final"     element={<ProtectedRoute><Gate pageCode="FULL_FINAL"><NativeFullFinal /></Gate></ProtectedRoute>} />
      <Route path="/payroll/statutory-config" element={<ProtectedRoute><Gate pageCode="STATUTORY_CONFIG"><NativeStatutoryConfig /></Gate></ProtectedRoute>} />
      <Route path="/payroll/masters"        element={<ProtectedRoute><Gate pageCode="PAYROLL_MASTERS"><NativePayrollMasters /></Gate></ProtectedRoute>} />
      <Route path="/payroll/salary-packages" element={<ProtectedRoute><Gate pageCode="SALARY_PACKAGES"><NativeSalaryPackages /></Gate></ProtectedRoute>} />
      <Route path="/payroll/package-admin"  element={<ProtectedRoute roles={['admin','super_admin','payroll']}><NativeSalaryPackageAdmin /></ProtectedRoute>} />
      <Route path="/payroll/incentives"     element={<ProtectedRoute><Gate pageCode="PAYROLL_INCENTIVES"><NativeIncentives /></Gate></ProtectedRoute>} />
      <Route path="/payroll/overtime"       element={<ProtectedRoute roles={['admin','super_admin','wfm','payroll','payroll_head']}><PayrollOvertimeManagement /></ProtectedRoute>} />
      <Route path="/payroll/disbursal"      element={<ProtectedRoute roles={['super_admin','payroll','payroll_head','finance']}><DisbursalManagement /></ProtectedRoute>} />
      <Route path="/payroll/config-flags"   element={<ProtectedRoute roles={['super_admin','admin','payroll_head','payroll_branch']}><PayrollConfigFlags /></ProtectedRoute>} />
      <Route path="/payroll/recalculation-queue" element={<ProtectedRoute roles={['super_admin','admin','payroll_head','payroll_branch']}><RecalculationQueue /></ProtectedRoute>} />
      <Route path="/payroll/attendance-control-tower" element={<ProtectedRoute roles={['super_admin','admin','payroll_head','payroll_branch','payroll','hr','wfm','branch_head']}><AttendanceControlTower /></ProtectedRoute>} />
      <Route path="/payroll/running-breakdown"   element={<ProtectedRoute roles={['super_admin','admin','payroll_head','payroll_branch','wfm','employee']}><RunningPayrollBreakdown /></ProtectedRoute>} />
      <Route path="/payroll/holiday-master"      element={<ProtectedRoute roles={['super_admin','admin','payroll_head','payroll_branch']}><HolidayMaster /></ProtectedRoute>} />
      <Route path="/payroll/holiday-work"           element={<ProtectedRoute roles={['super_admin','admin','wfm','payroll_head','payroll_branch']}><HolidayWork /></ProtectedRoute>} />
      <Route path="/payroll/holiday-work-requests"  element={<Navigate to="/payroll/holiday-work" replace />} />
      <Route path="/payroll/holiday-work-approvals" element={<Navigate to="/payroll/holiday-work?tab=approvals" replace />} />
      <Route path="/payroll/validation"          element={<ProtectedRoute roles={['super_admin','payroll_head']}><PayrollValidationScreen /></ProtectedRoute>} />
      <Route path="/payroll/noc"                 element={<ProtectedRoute roles={['super_admin','payroll_head','payroll_branch','payroll','admin']}><NocManagement /></ProtectedRoute>} />
      <Route path="/payroll/branch-readiness"    element={<ProtectedRoute roles={['super_admin','payroll_head','branch_head','payroll_branch','admin','hr','finance','payroll']}><BranchPayrollReadiness /></ProtectedRoute>} />
      <Route path="/payroll/process-readiness"  element={<ProtectedRoute roles={['super_admin','payroll_head','branch_head','payroll_branch','admin','hr','finance','payroll','process_manager','wfm']}><ProcessPayrollReadiness /></ProtectedRoute>} />
      <Route path="/payroll/calendar"            element={<ProtectedRoute roles={['super_admin','payroll_head','payroll_branch']}><PayrollCalendar /></ProtectedRoute>} />
      <Route path="/payroll/cost-summary"        element={<Navigate to="/reports?view=library&report=payroll-cost-summary" replace />} />
      <Route path="/payroll/statutory-filing"    element={<ProtectedRoute roles={['super_admin','payroll_head','finance','admin']}><StatutoryFilingTracker /></ProtectedRoute>} />
      <Route path="/payroll/audit-trail"         element={<ProtectedRoute roles={['super_admin','payroll_head','finance','admin']}><PayrollAuditTrail /></ProtectedRoute>} />
      <Route path="/payroll/variance"            element={<Navigate to="/reports?view=library&report=payroll-variance" replace />} />
      <Route path="/payroll/bulk-outputs"        element={<ProtectedRoute roles={['super_admin','payroll_head','admin']}><BulkOutputs /></ProtectedRoute>} />
      <Route path="/payroll/loans"               element={<ProtectedRoute roles={['super_admin','payroll_head','finance','admin','hr','employee']}><LoanManagement /></ProtectedRoute>} />
      <Route path="/payroll/sign-off"            element={<ProtectedRoute roles={['super_admin','payroll_head','finance','ceo','admin']}><PayrollSignOff /></ProtectedRoute>} />
      <Route path="/payroll/salary-certificates" element={<ProtectedRoute roles={['super_admin','payroll_head','finance','admin','hr','employee']}><SalaryCertificate /></ProtectedRoute>} />
      <Route path="/payroll/reimbursements"      element={<ProtectedRoute roles={['super_admin','payroll_head','finance','admin','hr','employee']}><ReimbursementManagement /></ProtectedRoute>} />
      <Route path="/payroll/ho-queues"           element={<ProtectedRoute roles={['super_admin','payroll_head','payroll','finance','hr','admin']}><NativePayrollHOQueues /></ProtectedRoute>} />
      <Route path="/payroll/cheque-validation"   element={<Navigate to="/payroll/ho-queues" replace />} />
      <Route path="/payroll/epf-compliance"      element={<ProtectedRoute roles={['admin','super_admin','payroll_hr','payroll','hr','manager']}><PayrollEpfCompliancePage /></ProtectedRoute>} />
      <Route path="/payroll/pf-management"       element={<ProtectedRoute roles={['admin','super_admin','payroll_hr','payroll']}><PfManagement /></ProtectedRoute>} />
      <Route path="/payroll/pf-creation-queue"   element={<Navigate to="/payroll/pf-management" replace />} />
      <Route path="/payroll/pf-batches"          element={<Navigate to="/payroll/pf-management?tab=batches" replace />} />
      <Route path="/salary-increment"            element={<ProtectedRoute><Gate pageCode="SALARY_INCREMENT"><DashboardLayout><NativeSalaryIncrement /></DashboardLayout></Gate></ProtectedRoute>} />
  </>
);
