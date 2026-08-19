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
const BudgetConsolidationPage      = lazy(() => import("@/pages/finance/BudgetConsolidationPage"));
const SalaryVoucherPage      = lazy(() => import("@/pages/finance/SalaryVoucherPage"));
const ProcessPnlPage               = lazy(() => import("@/pages/finance/ProcessPnlPage"));
const ProcessPnlDetailPage         = lazy(() => import("@/pages/finance/ProcessPnlDetailPage"));
const ProcessPnlConfigurationPage  = lazy(() => import("@/pages/finance/ProcessPnlConfigurationPage"));
const ProcessLobManagementPage     = lazy(() => import("@/pages/finance/ProcessLobManagementPage"));
const BillabilitySeatCostPage      = lazy(() => import("@/pages/finance/BillabilitySeatCostPage"));
const PnlPeriodClosePage           = lazy(() => import("@/pages/finance/PnlPeriodClosePage"));
const MyExpenses                   = lazy(() => import("@/pages/expenses/MyExpenses"));
const NewExpenseClaim              = lazy(() => import("@/pages/expenses/NewExpenseClaim"));
const ExpenseApprovals             = lazy(() => import("@/pages/expenses/ExpenseApprovals"));
const FinanceQueue                 = lazy(() => import("@/pages/expenses/FinanceQueue"));
const ExpenseReports               = lazy(() => import("@/pages/expenses/ExpenseReports"));
const CostCentreManagementPage     = lazy(() => import("@/pages/finance/CostCentreManagementPage"));
const ClientBillingWorkspacePage   = lazy(() => import("@/pages/finance/ClientBillingWorkspacePage"));

const financeRoles = ['super_admin','admin','finance','finance_head','accounts_head','payroll_head'] as const;
// Branch roles raise GRNs — the backend already grants them GRN write access and
// scopes every read to their own branch. They are deliberately absent from
// GRN_REVIEW_ROLES, so they can submit but never approve.
const grnRoles: string[] = [...financeRoles, 'branch_admin', 'branch_head'];
const pnlRoles     = ['super_admin','admin','ceo','coo','finance','finance_head','accounts_head','payroll_head'] as const;
const budgetConsolidationRoles = ['super_admin','admin','ceo','coo','finance_head','accounts_head'] as const;
const costCentreRoles = ['super_admin','admin','finance','finance_head','accounts_head','branch_head','branch_admin'] as const;
// Must stay identical to the grant in backend/sql/1066_billability_page_access.sql and to
// BILLABILITY_ROLES in backend/src/modules/process-pnl/billability.routes.ts.
const billabilityRoles = ['super_admin','finance','payroll_head','payroll_branch'] as const;
// Must stay identical to ALLOWED_ROLES in backend/src/modules/client-billing/client-billing.routes.ts
// and to the grant in backend/sql/migrations/1303_client_billing_page_access.sql.
const clientBillingRoles = ['super_admin','admin','finance','finance_head','accounts_head'] as const;

export const financeRouteElements = (
  <>
      {/* ERP / Vendors / Procurement */}
      <Route path="/erp"        element={<ProtectedRoute><Gate pageCode="ERP"><NativeERP /></Gate></ProtectedRoute>} />
      <Route path="/vendors"    element={<ProtectedRoute roles={['admin','super_admin','finance','manager']}><Gate pageCode="VENDOR_MANAGEMENT"><NativeVendorManagement /></Gate></ProtectedRoute>} />
      <Route path="/procurement" element={<ProtectedRoute><Gate pageCode="PROCUREMENT"><NativeProcurementPage /></Gate></ProtectedRoute>} />

      {/* Finance */}
      <Route path="/finance/vendor-payment-tracking" element={<ProtectedRoute roles={financeRoles}><Gate pageCode="FINANCE_VENDOR_PAYMENTS"><NativeVendorPaymentTracking /></Gate></ProtectedRoute>} />
      <Route path="/finance/grn"                     element={<ProtectedRoute roles={grnRoles}><Gate pageCode="FINANCE_GRN"><NativeGRNManagement /></Gate></ProtectedRoute>} />
      {/* Roles match migration 1104's grants and the API's VOUCHER_ROLES exactly. A salary
          voucher renders a whole branch payroll, so this stays narrower than the GRN set. */}
      <Route path="/finance/salary-voucher"          element={<ProtectedRoute roles={['super_admin','finance_head','payroll_hr']}><Gate pageCode="FINANCE_SALARY_VOUCHER"><SalaryVoucherPage /></Gate></ProtectedRoute>} />
      <Route path="/finance/branch-budget"           element={<ProtectedRoute roles={['super_admin','admin','branch_admin','branch_head','finance','finance_head','accounts_head']}><Gate pageCode="FINANCE_BRANCH_BUDGET"><BranchBudgetManagementPage /></Gate></ProtectedRoute>} />
      <Route path="/finance/budget-consolidation"    element={<ProtectedRoute roles={budgetConsolidationRoles}><Gate pageCode="FINANCE_BUDGET_CONSOLIDATION"><BudgetConsolidationPage /></Gate></ProtectedRoute>} />
      <Route path="/finance/cost-centres"            element={<ProtectedRoute roles={costCentreRoles}><Gate pageCode="FINANCE_COST_CENTRES"><CostCentreManagementPage /></Gate></ProtectedRoute>} />
      {/* Roles match ALLOWED_ROLES in client-billing.routes.ts and the grant in migration
          1303 exactly — the frontend gate must never show a page the API would 403 on. */}
      <Route path="/finance/client-billing"          element={<ProtectedRoute roles={clientBillingRoles}><Gate pageCode="FINANCE_CLIENT_BILLING"><ClientBillingWorkspacePage /></Gate></ProtectedRoute>} />
      {/* Roles here match the grant issued in migration 1064 exactly. If they drift, the page
          either 403s for someone who was granted it, or shows for someone the API will refuse. */}
      <Route path="/finance/billability"             element={<ProtectedRoute roles={billabilityRoles}><Gate pageCode="FINANCE_BILLABILITY_SEAT_COST"><BillabilitySeatCostPage /></Gate></ProtectedRoute>} />
      <Route path="/finance/process-pnl"             element={<ProtectedRoute roles={pnlRoles}><Gate pageCode="FINANCE_PROCESS_PNL"><ProcessPnlPage /></Gate></ProtectedRoute>} />
      <Route path="/finance/process-pnl/configuration" element={<ProtectedRoute roles={pnlRoles}><Gate pageCode="FINANCE_PNL_CONFIG"><ProcessPnlConfigurationPage /></Gate></ProtectedRoute>} />
      <Route path="/finance/process-pnl/lobs"          element={<ProtectedRoute roles={pnlRoles}><Gate pageCode="FINANCE_PNL_LOBS"><ProcessLobManagementPage /></Gate></ProtectedRoute>} />
      <Route path="/finance/process-pnl/period-close"  element={<ProtectedRoute roles={pnlRoles}><Gate pageCode="FINANCE_PNL_PERIOD_CLOSE"><PnlPeriodClosePage /></Gate></ProtectedRoute>} />
      <Route path="/finance/process-pnl/:processId"    element={<ProtectedRoute roles={pnlRoles}><Gate pageCode="FINANCE_PROCESS_PNL"><ProcessPnlDetailPage /></Gate></ProtectedRoute>} />

      {/*
        Expenses — RETIRED, redirected to the working reimbursement flow.

        Every route here was non-functional for every user. The backend module
        (backend/src/modules/expenses/*) queries `expense_claims`, `expense_items`,
        `expense_approvals` and `expense_payments` — none of which exist in
        mas_hrms. Their creating migration, sql/migrations/099_create_expense_tables.sql,
        never ran and cannot: it sits in a directory the migration runner does not
        resolve, it is absent from MIGRATION_MANIFEST, and it declares
        `employee_id INT` with a foreign key to employees(id), which is CHAR(36) —
        an FK MySQL cannot create. Verified live on 31-Jul-2026: every endpoint
        returns "Table 'mas_hrms.expense_claims' doesn't exist".

        The fix is NOT to run 099. process-pnl.service.ts computes
        directNonPeopleCost from `expense_claims` behind `tableExists()` guards
        that are currently false; creating the table would flip them true and
        silently move directCost, contributionMargin and operatingProfit on every
        process with no code change.

        Repointing at the live `expense_claim` (singular) was also rejected: it is
        the migrated db_bill finance ledger (5,634 rows, ~₹12.5 Cr, mostly vendor
        bills), it is already owned by the ERP Expenses tab, and its flat
        CHAR(36) shape is incompatible with this module's INT/claim+items model.

        /payroll/reimbursements is the surviving employee-claim implementation:
        self-service create, submit, approve, reject and delete over
        employee_reimbursement_claim, which the module provisions itself.

        The page components are deliberately left on disk rather than deleted, so
        this is reversible if the module is ever rebuilt against a real schema.
      */}
      <Route path="/expenses"              element={<Navigate to="/payroll/reimbursements" replace />} />
      <Route path="/expenses/new"          element={<Navigate to="/payroll/reimbursements" replace />} />
      <Route path="/expenses/new/:claimId" element={<Navigate to="/payroll/reimbursements" replace />} />
      <Route path="/expenses/approvals"    element={<Navigate to="/payroll/reimbursements" replace />} />
      <Route path="/expenses/finance"      element={<Navigate to="/payroll/reimbursements" replace />} />
      <Route path="/expenses/reports"      element={<Navigate to="/payroll/reimbursements" replace />} />
      <Route path="/expenses/:claimId"     element={<Navigate to="/payroll/reimbursements" replace />} />

      {/* Legacy redirects */}
      <Route path="/master-reports" element={<Navigate to="/reports" replace />} />
      <Route path="/advanced-reports" element={<Navigate to="/reports" replace />} />
      <Route path="/reports/enterprise" element={<Navigate to="/reports" replace />} />
  </>
);
