import { Route, Navigate } from "react-router-dom";
import { lazy } from "./lazy";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import WorkforcePageGate from "@/components/security/WorkforcePageGate";

const Gate = ({ pageCode, children }: { pageCode: string; children: React.ReactNode }) =>
  <WorkforcePageGate pageCode={pageCode}>{children}</WorkforcePageGate>;

const NativeERP                    = lazy(() => import("@/pages/NativeERP"));
const NativeVendorManagement       = lazy(() => import("@/pages/NativeVendorManagement"));
const NativeProcurementPage        = lazy(() => import("@/pages/NativeProcurementPage"));
const NativeVendorPaymentTracking  = lazy(() => import("@/pages/NativeVendorPaymentTracking"));
const NativeGRNManagement          = lazy(() => import("@/pages/NativeGRNManagement"));
const BranchBudgetManagementPage   = lazy(() => import("@/pages/finance/BranchBudgetManagementPage"));
const ProcessPnlPage               = lazy(() => import("@/pages/finance/ProcessPnlPage"));
const ProcessPnlDetailPage         = lazy(() => import("@/pages/finance/ProcessPnlDetailPage"));
const ProcessPnlConfigurationPage  = lazy(() => import("@/pages/finance/ProcessPnlConfigurationPage"));
const PnlPeriodClosePage           = lazy(() => import("@/pages/finance/PnlPeriodClosePage"));
const MyExpenses                   = lazy(() => import("@/pages/expenses/MyExpenses"));
const NewExpenseClaim              = lazy(() => import("@/pages/expenses/NewExpenseClaim"));
const ExpenseApprovals             = lazy(() => import("@/pages/expenses/ExpenseApprovals"));
const FinanceQueue                 = lazy(() => import("@/pages/expenses/FinanceQueue"));
const ExpenseReports               = lazy(() => import("@/pages/expenses/ExpenseReports"));

const financeRoles = ['super_admin','admin','finance','finance_head','accounts_head','payroll_head'] as const;
const pnlRoles     = ['super_admin','admin','ceo','coo','finance','finance_head','accounts_head','payroll_head'] as const;

export const financeRouteElements = (
  <>
      {/* ERP / Vendors / Procurement */}
      <Route path="/erp"        element={<ProtectedRoute><Gate pageCode="ERP"><NativeERP /></Gate></ProtectedRoute>} />
      <Route path="/vendors"    element={<ProtectedRoute roles={['admin','super_admin','finance','manager']}><Gate pageCode="VENDOR_MANAGEMENT"><NativeVendorManagement /></Gate></ProtectedRoute>} />
      <Route path="/procurement" element={<ProtectedRoute><Gate pageCode="PROCUREMENT"><NativeProcurementPage /></Gate></ProtectedRoute>} />

      {/* Finance */}
      <Route path="/finance/vendor-payment-tracking" element={<ProtectedRoute roles={financeRoles}><NativeVendorPaymentTracking /></ProtectedRoute>} />
      <Route path="/finance/grn"                     element={<ProtectedRoute roles={financeRoles}><NativeGRNManagement /></ProtectedRoute>} />
      <Route path="/finance/branch-budget"           element={<ProtectedRoute roles={['super_admin','admin','branch_admin','branch_head','finance','finance_head','accounts_head']}><BranchBudgetManagementPage /></ProtectedRoute>} />
      <Route path="/finance/process-pnl"             element={<ProtectedRoute roles={pnlRoles}><ProcessPnlPage /></ProtectedRoute>} />
      <Route path="/finance/process-pnl/configuration" element={<ProtectedRoute roles={pnlRoles}><ProcessPnlConfigurationPage /></ProtectedRoute>} />
      <Route path="/finance/process-pnl/period-close"  element={<ProtectedRoute roles={pnlRoles}><PnlPeriodClosePage /></ProtectedRoute>} />
      <Route path="/finance/process-pnl/:processId"    element={<ProtectedRoute roles={pnlRoles}><ProcessPnlDetailPage /></ProtectedRoute>} />

      {/* Expenses */}
      <Route path="/expenses"              element={<ProtectedRoute><MyExpenses /></ProtectedRoute>} />
      <Route path="/expenses/new"          element={<ProtectedRoute><NewExpenseClaim /></ProtectedRoute>} />
      <Route path="/expenses/new/:claimId" element={<ProtectedRoute><NewExpenseClaim /></ProtectedRoute>} />
      <Route path="/expenses/approvals"    element={<ProtectedRoute><ExpenseApprovals /></ProtectedRoute>} />
      <Route path="/expenses/finance"      element={<ProtectedRoute roles={['super_admin','admin','finance','finance_head','accounts_head']}><FinanceQueue /></ProtectedRoute>} />
      <Route path="/expenses/reports"      element={<ProtectedRoute roles={['super_admin','admin','finance','finance_head','accounts_head']}><ExpenseReports /></ProtectedRoute>} />
      <Route path="/expenses/:claimId"     element={<ProtectedRoute><NewExpenseClaim /></ProtectedRoute>} />

      {/* Legacy redirects */}
      <Route path="/master-reports" element={<Navigate to="/reports" replace />} />
      <Route path="/advanced-reports" element={<Navigate to="/reports" replace />} />
      <Route path="/reports/enterprise" element={<Navigate to="/reports" replace />} />
  </>
);
