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

const router = Router();
import type { RoleKey } from "../../platform/policy/index.js";
const RECONCILIATION_ROLES: RoleKey[] = ['super_admin', 'admin', 'hr'];

router.use(requireAuth);
router.use(requireRole(...RECONCILIATION_ROLES));

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

// Summary — all counts in one call (used by dashboard header)
router.get('/summary', h(async (_req, res) => {
  const data = await getReconciliationSummary();
  return res.json({ success: true, data });
}));

// BGV anomalies
router.get('/bgv/auto-approved', h(async (_req, res) => {
  const data = await getBgvAutoApprovedCandidates();
  return res.json({ success: true, data, count: data.length });
}));

router.get('/bgv/clear-without-checks', h(async (_req, res) => {
  const data = await getBgvClearWithoutMandatoryChecks();
  return res.json({ success: true, data, count: data.length });
}));

router.get('/bgv/payroll-without-bgv', h(async (_req, res) => {
  const data = await getBgvPayrollEligibleWithPendingChecks();
  return res.json({ success: true, data, count: data.length });
}));

// Salary anomalies
router.get('/salary/annual-equals-monthly', h(async (_req, res) => {
  const data = await getSalaryAnnualEqualsMonthlyGross();
  return res.json({ success: true, data, count: data.length });
}));

router.get('/salary/joining-before-salary-start', h(async (_req, res) => {
  const data = await getSalaryJoiningAfterSalaryStart();
  return res.json({ success: true, data, count: data.length });
}));

router.get('/salary/duplicate-assignments', h(async (_req, res) => {
  const data = await getDuplicateActiveSalaryAssignments();
  return res.json({ success: true, data, count: data.length });
}));

router.get('/salary/employees-without-salary', h(async (_req, res) => {
  const data = await getEmployeesWithoutSalaryAssignment();
  return res.json({ success: true, data, count: data.length });
}));

// Lifecycle anomalies
router.get('/lifecycle/onboarded-without-employee', h(async (_req, res) => {
  const data = await getCandidatesOnboardedWithoutEmployee();
  return res.json({ success: true, data, count: data.length });
}));

router.get('/lifecycle/offer-approved-no-employee', h(async (_req, res) => {
  const data = await getOfferApprovedWithoutEmployee();
  return res.json({ success: true, data, count: data.length });
}));

router.get('/lifecycle/employee-before-bgv-clear', h(async (_req, res) => {
  const data = await getEmployeesCreatedBeforeBgvClear();
  return res.json({ success: true, data, count: data.length });
}));

router.get('/lifecycle/active-before-joining', h(async (_req, res) => {
  const data = await getEmployeesActiveBeforeJoiningDate();
  return res.json({ success: true, data, count: data.length });
}));

router.get('/lifecycle/employees-without-provisioning', h(async (_req, res) => {
  const data = await getEmployeesCreatedWithoutProvisioning();
  return res.json({ success: true, data, count: data.length });
}));

// Provisioning anomalies
router.get('/provisioning/missing-mandatory-tasks', h(async (_req, res) => {
  const data = await getProvisioningMissingMandatoryTasks();
  return res.json({ success: true, data, count: data.length });
}));

router.get('/provisioning/email-sync-gap', h(async (_req, res) => {
  const data = await getProvisioningOfficialEmailMismatch();
  return res.json({ success: true, data, count: data.length });
}));

router.get('/provisioning/tasks-done-employee-inactive', h(async (_req, res) => {
  const data = await getProvisioningTasksActionedButEmployeeStillInactive();
  return res.json({ success: true, data, count: data.length });
}));

router.get('/provisioning/duplicate-tasks', h(async (_req, res) => {
  const data = await getProvisioningDuplicateTasks();
  return res.json({ success: true, data, count: data.length });
}));

// Duplication
router.get('/duplication/candidate-multiple-employees', h(async (_req, res) => {
  const data = await getMultipleEmployeesForOneCandidate();
  return res.json({ success: true, data, count: data.length });
}));

router.get('/duplication/employee-code-mismatch', h(async (_req, res) => {
  const data = await getEmployeeCodeMismatchBetweenBridgeAndEmployee();
  return res.json({ success: true, data, count: data.length });
}));

export { router as reconciliationRouter };
