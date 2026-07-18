import { Route } from "react-router-dom";
import { lazy } from "./lazy";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import WorkforcePageGate from "@/components/security/WorkforcePageGate";

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
const RunningPayrollBreakdown   = lazy(() => import("@/pages/payroll/RunningPayrollBreakdown"));
const HolidayMaster             = lazy(() => import("@/pages/payroll/HolidayMaster"));
const DisbursalManagement       = lazy(() => import("@/pages/payroll/DisbursalManagement"));
const HolidayWorkRequest        = lazy(() => import("@/pages/payroll/HolidayWorkRequest"));
const HolidayWorkApprovals      = lazy(() => import("@/pages/payroll/HolidayWorkApprovals"));
const PayrollValidationScreen   = lazy(() => import("@/pages/payroll/PayrollValidationScreen"));
const NocManagement             = lazy(() => import("@/pages/payroll/NocManagement"));
const BranchPayrollReadiness    = lazy(() => import("@/pages/payroll/BranchPayrollReadiness"));
const PayrollCalendar           = lazy(() => import("@/pages/payroll/PayrollCalendar"));
const PayrollCostSummary        = lazy(() => import("@/pages/payroll/PayrollCostSummary"));
const StatutoryFilingTracker    = lazy(() => import("@/pages/payroll/StatutoryFilingTracker"));
const PayrollAuditTrail         = lazy(() => import("@/pages/payroll/PayrollAuditTrail"));
const PayrollVarianceReport     = lazy(() => import("@/pages/payroll/PayrollVarianceReport"));
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

export const payrollRouteElements = (
  <>
      <Route path="/payroll" element={<ProtectedRoute><Gate pageCode="PAYROLL"><Payroll /></Gate></ProtectedRoute>} />
      <Route path="/payroll/payslips"       element={<ProtectedRoute><Gate pageCode="PAYROLL_PAYSLIPS"><NativePayslipCenter /></Gate></ProtectedRoute>} />
      <Route path="/payroll/tax-declaration" element={<ProtectedRoute><Gate pageCode="TAX_DECLARATION"><NativeTaxDeclaration /></Gate></ProtectedRoute>} />
      <Route path="/payroll/full-final"     element={<ProtectedRoute><Gate pageCode="FULL_FINAL"><NativeFullFinal /></Gate></ProtectedRoute>} />
      <Route path="/payroll/statutory-config" element={<ProtectedRoute><Gate pageCode="STATUTORY_CONFIG"><NativeStatutoryConfig /></Gate></ProtectedRoute>} />
      <Route path="/payroll/masters"        element={<ProtectedRoute><Gate pageCode="PAYROLL_MASTERS"><NativePayrollMasters /></Gate></ProtectedRoute>} />
      <Route path="/payroll/salary-packages" element={<ProtectedRoute><Gate pageCode="SALARY_PACKAGES"><NativeSalaryPackages /></Gate></ProtectedRoute>} />
      <Route path="/payroll/package-admin"  element={<ProtectedRoute roles={['admin','super_admin','payroll']}><NativeSalaryPackageAdmin /></ProtectedRoute>} />
      <Route path="/payroll/incentives"     element={<ProtectedRoute><Gate pageCode="PAYROLL_INCENTIVES"><NativeIncentives /></Gate></ProtectedRoute>} />
      <Route path="/payroll/overtime"       element={<ProtectedRoute roles={['admin','super_admin','wfm','payroll','payroll_head']}><PayrollOvertimeManagement /></ProtectedRoute>} />
      <Route path="/payroll/disbursal"      element={<ProtectedRoute roles={['super_admin','payroll','finance']}><DisbursalManagement /></ProtectedRoute>} />
      <Route path="/payroll/config-flags"   element={<ProtectedRoute roles={['super_admin','admin','payroll_head','payroll_branch']}><PayrollConfigFlags /></ProtectedRoute>} />
      <Route path="/payroll/recalculation-queue" element={<ProtectedRoute roles={['super_admin','admin','payroll_head','payroll_branch']}><RecalculationQueue /></ProtectedRoute>} />
      <Route path="/payroll/running-breakdown"   element={<ProtectedRoute roles={['super_admin','admin','payroll_head','payroll_branch','wfm','employee']}><RunningPayrollBreakdown /></ProtectedRoute>} />
      <Route path="/payroll/holiday-master"      element={<ProtectedRoute roles={['super_admin','admin','payroll_head','payroll_branch']}><HolidayMaster /></ProtectedRoute>} />
      <Route path="/payroll/holiday-work-requests" element={<ProtectedRoute roles={['super_admin','admin','wfm','payroll_head','payroll_branch']}><HolidayWorkRequest /></ProtectedRoute>} />
      <Route path="/payroll/holiday-work-approvals" element={<ProtectedRoute roles={['super_admin','admin','payroll_head','payroll_branch','wfm']}><HolidayWorkApprovals /></ProtectedRoute>} />
      <Route path="/payroll/validation"          element={<ProtectedRoute roles={['super_admin','payroll_head']}><PayrollValidationScreen /></ProtectedRoute>} />
      <Route path="/payroll/noc"                 element={<ProtectedRoute roles={['super_admin','payroll_head','payroll_branch','payroll','admin']}><NocManagement /></ProtectedRoute>} />
      <Route path="/payroll/branch-readiness"    element={<ProtectedRoute roles={['super_admin','payroll_head','branch_head','payroll_branch','admin','hr','finance','payroll']}><BranchPayrollReadiness /></ProtectedRoute>} />
      <Route path="/payroll/calendar"            element={<ProtectedRoute roles={['super_admin','payroll_head','payroll_branch']}><PayrollCalendar /></ProtectedRoute>} />
      <Route path="/payroll/cost-summary"        element={<ProtectedRoute roles={['super_admin','payroll_head','finance']}><PayrollCostSummary /></ProtectedRoute>} />
      <Route path="/payroll/statutory-filing"    element={<ProtectedRoute roles={['super_admin','payroll_head','finance','admin']}><StatutoryFilingTracker /></ProtectedRoute>} />
      <Route path="/payroll/audit-trail"         element={<ProtectedRoute roles={['super_admin','payroll_head','finance','admin']}><PayrollAuditTrail /></ProtectedRoute>} />
      <Route path="/payroll/variance"            element={<ProtectedRoute roles={['super_admin','payroll_head','finance','admin']}><PayrollVarianceReport /></ProtectedRoute>} />
      <Route path="/payroll/bulk-outputs"        element={<ProtectedRoute roles={['super_admin','payroll_head','admin']}><BulkOutputs /></ProtectedRoute>} />
      <Route path="/payroll/loans"               element={<ProtectedRoute roles={['super_admin','payroll_head','finance','admin','hr','employee']}><LoanManagement /></ProtectedRoute>} />
      <Route path="/payroll/sign-off"            element={<ProtectedRoute roles={['super_admin','payroll_head','finance','ceo','admin']}><PayrollSignOff /></ProtectedRoute>} />
      <Route path="/payroll/salary-certificates" element={<ProtectedRoute roles={['super_admin','payroll_head','finance','admin','hr','employee']}><SalaryCertificate /></ProtectedRoute>} />
      <Route path="/payroll/reimbursements"      element={<ProtectedRoute roles={['super_admin','payroll_head','finance','admin','hr','employee']}><ReimbursementManagement /></ProtectedRoute>} />
      <Route path="/payroll/ho-queues"           element={<ProtectedRoute roles={['super_admin','payroll_head','payroll','finance','hr','admin']}><NativePayrollHOQueues /></ProtectedRoute>} />
      <Route path="/payroll/cheque-validation"   element={<ProtectedRoute roles={['payroll','payroll_head','super_admin','finance']}><NativeChequeNameValidation /></ProtectedRoute>} />
      <Route path="/payroll/epf-compliance"      element={<ProtectedRoute roles={['admin','super_admin','payroll_hr','payroll','hr','manager']}><PayrollEpfCompliancePage /></ProtectedRoute>} />
      <Route path="/payroll/pf-creation-queue"   element={<ProtectedRoute roles={['admin','super_admin','payroll_hr','payroll']}><PfCreationQueuePage /></ProtectedRoute>} />
      <Route path="/payroll/pf-batches"          element={<ProtectedRoute roles={['admin','super_admin','payroll_hr','payroll']}><PfBatchesPage /></ProtectedRoute>} />
      <Route path="/salary-increment"            element={<ProtectedRoute><Gate pageCode="SALARY_INCREMENT"><NativeSalaryIncrement /></Gate></ProtectedRoute>} />
  </>
);
