/**
 * Reconciliation Routes
 * Base: /api/ats/reconciliation
 * Access: super_admin, admin, hr only
 */

import { Router } from 'express';
import type { Response } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import {
  getReconciliationSummary,
  getScopedProvisioningCounts,
  getBgvAutoApprovedCandidates,
  getBgvClearWithoutMandatoryChecks,
  getBgvPayrollEligibleWithPendingChecks,
  getSalaryAnnualEqualsMonthlyGross,
  getSalaryJoiningAfterSalaryStart,
  getDuplicateActiveSalaryAssignments,
  getEmployeesWithoutSalaryAssignment,
  getCandidatesOnboardedWithoutEmployee,
  getOfferApprovedWithoutEmployee,
  getEmployeesCreatedBeforeBgvClear,
  getEmployeesActiveBeforeJoiningDate,
  getEmployeesCreatedWithoutProvisioning,
  getProvisioningMissingMandatoryTasks,
  getProvisioningOfficialEmailMismatch,
  getProvisioningTasksActionedButEmployeeStillInactive,
  getProvisioningDuplicateTasks,
  getMultipleEmployeesForOneCandidate,
  getEmployeeCodeMismatchBetweenBridgeAndEmployee,
} from './reconciliation.service.js';
import { scopeReconciliationRows } from './reconciliation-scope.js';
import { resolveAtsBranchScope } from './ats-branch-scope.js';
import { buildEmployeeScopeCondition, resolveUserBusinessScope } from '../../shared/enterpriseScope.js';

const router = Router();
import type { RoleKey } from "../../platform/policy/index.js";
const RECONCILIATION_ROLES: RoleKey[] = ['super_admin', 'admin', 'hr'];

router.use(requireAuth);
router.use(requireRole(...RECONCILIATION_ROLES));

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

// Summary — all counts in one call (used by dashboard header)
router.get('/summary', h(async (req, res) => {
  const userId = req.authUser!.id;
  if ((await resolveAtsBranchScope(userId)).orgWide) {
    return res.json({ success: true, data: await getReconciliationSummary() });
  }
  // Branch-scoped caller (hr): the same counts, rebuilt from the branch-filtered section lists.
  const scoped = <T extends Record<string, unknown>>(rows: T[]) => scopeReconciliationRows(userId, rows);
  const emp = buildEmployeeScopeCondition(await resolveUserBusinessScope(userId), {
    employeeId: "e.id", branchId: "e.branch_id", processId: "e.process_id", lobId: "e.lob_id",
    departmentId: "e.department_id", managerEmployeeId: "e.reporting_manager_id",
  });
  const [autoApproved, payrollNoBgv, annualEqMonthly, dupSalary, onboarded, offerNoEmp, activeBefore] = await Promise.all([
    scoped(await getBgvAutoApprovedCandidates()), scoped(await getBgvPayrollEligibleWithPendingChecks()),
    scoped(await getSalaryAnnualEqualsMonthlyGross()), scoped(await getDuplicateActiveSalaryAssignments()),
    scoped(await getCandidatesOnboardedWithoutEmployee()), scoped(await getOfferApprovedWithoutEmployee()),
    scoped(await getEmployeesActiveBeforeJoiningDate()),
  ]);
  const provisioning = await getScopedProvisioningCounts(emp);
  return res.json({ success: true, data: {
    bgv_auto_approved_count: autoApproved.length,
    bgv_payroll_eligible_without_real_bgv: payrollNoBgv.length,
    salary_annual_equals_monthly_count: annualEqMonthly.length,
    employees_with_duplicate_salary: dupSalary.length,
    onboarded_without_employee: onboarded.length,
    offer_approved_no_employee: offerNoEmp.length,
    active_employees_before_joining: activeBefore.length,
    ...provisioning,
  } });
}));

// BGV anomalies
router.get('/bgv/auto-approved', h(async (req, res) => {
  const data = await scopeReconciliationRows(req.authUser!.id, await getBgvAutoApprovedCandidates());
  return res.json({ success: true, data, count: data.length });
}));

router.get('/bgv/clear-without-checks', h(async (req, res) => {
  const data = await scopeReconciliationRows(req.authUser!.id, await getBgvClearWithoutMandatoryChecks());
  return res.json({ success: true, data, count: data.length });
}));

router.get('/bgv/payroll-without-bgv', h(async (req, res) => {
  const data = await scopeReconciliationRows(req.authUser!.id, await getBgvPayrollEligibleWithPendingChecks());
  return res.json({ success: true, data, count: data.length });
}));

// Salary anomalies
router.get('/salary/annual-equals-monthly', h(async (req, res) => {
  const data = await scopeReconciliationRows(req.authUser!.id, await getSalaryAnnualEqualsMonthlyGross());
  return res.json({ success: true, data, count: data.length });
}));

router.get('/salary/joining-before-salary-start', h(async (req, res) => {
  const data = await scopeReconciliationRows(req.authUser!.id, await getSalaryJoiningAfterSalaryStart());
  return res.json({ success: true, data, count: data.length });
}));

router.get('/salary/duplicate-assignments', h(async (req, res) => {
  const data = await scopeReconciliationRows(req.authUser!.id, await getDuplicateActiveSalaryAssignments());
  return res.json({ success: true, data, count: data.length });
}));

router.get('/salary/employees-without-salary', h(async (req, res) => {
  const data = await scopeReconciliationRows(req.authUser!.id, await getEmployeesWithoutSalaryAssignment());
  return res.json({ success: true, data, count: data.length });
}));

// Lifecycle anomalies
router.get('/lifecycle/onboarded-without-employee', h(async (req, res) => {
  const data = await scopeReconciliationRows(req.authUser!.id, await getCandidatesOnboardedWithoutEmployee());
  return res.json({ success: true, data, count: data.length });
}));

router.get('/lifecycle/offer-approved-no-employee', h(async (req, res) => {
  const data = await scopeReconciliationRows(req.authUser!.id, await getOfferApprovedWithoutEmployee());
  return res.json({ success: true, data, count: data.length });
}));

router.get('/lifecycle/employee-before-bgv-clear', h(async (req, res) => {
  const data = await scopeReconciliationRows(req.authUser!.id, await getEmployeesCreatedBeforeBgvClear());
  return res.json({ success: true, data, count: data.length });
}));

router.get('/lifecycle/active-before-joining', h(async (req, res) => {
  const data = await scopeReconciliationRows(req.authUser!.id, await getEmployeesActiveBeforeJoiningDate());
  return res.json({ success: true, data, count: data.length });
}));

router.get('/lifecycle/employees-without-provisioning', h(async (req, res) => {
  const data = await scopeReconciliationRows(req.authUser!.id, await getEmployeesCreatedWithoutProvisioning());
  return res.json({ success: true, data, count: data.length });
}));

// Provisioning anomalies
router.get('/provisioning/missing-mandatory-tasks', h(async (req, res) => {
  const data = await scopeReconciliationRows(req.authUser!.id, await getProvisioningMissingMandatoryTasks());
  return res.json({ success: true, data, count: data.length });
}));

router.get('/provisioning/email-sync-gap', h(async (req, res) => {
  const data = await scopeReconciliationRows(req.authUser!.id, await getProvisioningOfficialEmailMismatch());
  return res.json({ success: true, data, count: data.length });
}));

router.get('/provisioning/tasks-done-employee-inactive', h(async (req, res) => {
  const data = await scopeReconciliationRows(req.authUser!.id, await getProvisioningTasksActionedButEmployeeStillInactive());
  return res.json({ success: true, data, count: data.length });
}));

router.get('/provisioning/duplicate-tasks', h(async (req, res) => {
  const data = await scopeReconciliationRows(req.authUser!.id, await getProvisioningDuplicateTasks());
  return res.json({ success: true, data, count: data.length });
}));

// Duplication
router.get('/duplication/candidate-multiple-employees', h(async (req, res) => {
  const data = await scopeReconciliationRows(req.authUser!.id, await getMultipleEmployeesForOneCandidate());
  return res.json({ success: true, data, count: data.length });
}));

router.get('/duplication/employee-code-mismatch', h(async (req, res) => {
  const data = await scopeReconciliationRows(req.authUser!.id, await getEmployeeCodeMismatchBetweenBridgeAndEmployee());
  return res.json({ success: true, data, count: data.length });
}));

export { router as reconciliationRouter };
