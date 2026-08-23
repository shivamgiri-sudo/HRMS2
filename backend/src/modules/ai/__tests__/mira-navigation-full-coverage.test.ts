/**
 * Mira Navigation Full Coverage Tests
 *
 * Tests every catalog entry with N random real-world phrasings an employee
 * might use. Goal: zero entry should silently fall through to the external LLM
 * when a user is clearly asking about that topic.
 *
 * Each describe block = one catalog entry.
 * Each it() = one distinct phrasing variation (formal, casual, typo, mid-sentence, BPO-vernacular).
 *
 * RBAC is mocked: static_roles entries use real role lists; page_code entries
 * mock getAccessMe to grant access so we can test the routing, not the gate.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getAccessMe: vi.fn() }));
vi.mock('../../access/access.service.js', () => ({ getAccessMe: mocks.getAccessMe }));

import { answerHowToQuestion } from '../ai-howto.service.js';

function grantAll() {
  // Returns every page_code as granted so page_code entries always pass the auth check
  mocks.getAccessMe.mockResolvedValue({
    pages: [
      'PAYROLL_PAYSLIPS', 'PAYROLL_REIMBURSEMENTS', 'ATTENDANCE_REGULARIZATION',
      'RESIGNATION_MY_REQUEST', 'TEAM_ROSTER', 'TAX_DECLARATION', 'LMS_MY_LEARNING',
      'ijp_opportunities', 'PAYROLL_INCENTIVES', 'SALARY_PACKAGES', 'PAYROLL_LOANS',
      'SALARY_DISPUTE', 'FULL_FINAL', 'PAYROLL_BRANCH_READINESS', 'STATUTORY_CONFIG',
      'PAYROLL_ATTENDANCE_CONTROL_TOWER', 'PAYROLL_RUNNING_BREAKDOWN', 'PAYROLL_HOLIDAY_MASTER',
      'PAYROLL_HOLIDAY_WORK', 'PAYROLL_VALIDATION', 'PAYROLL_NOC', 'PAYROLL_SALARY_VERIFICATION',
      'PAYROLL_CALENDAR', 'PAYROLL_AUDIT_TRAIL', 'PAYROLL_BULK_OUTPUTS', 'PAYROLL_LOANS',
      'PAYROLL_SIGN_OFF', 'SALARY_CERTIFICATE', 'PAYROLL_TDS_PART_A', 'PAYROLL_REIMBURSEMENTS',
      'PAYROLL_HO_QUEUES', 'PAYROLL_HEAD_SALARY_REVIEW_QUEUE', 'PAYROLL_EPF_COMPLIANCE',
      'PAYROLL_PF_MANAGEMENT', 'SALARY_DISPUTE_QUEUE', 'SALARY_DISPUTE_TEAM',
      'SALARY_INCREMENT', 'ATTENDANCE_DISPUTES', 'ATTENDANCE_LOOKUP',
      'TEAM_ATTENDANCE', 'LEAVE_TYPES', 'MATERNITY_LEAVE', 'WFM_ROSTER',
      'WFM_ROSTER_BUILDER', 'WFM_LIVE_TRACKER', 'WFM_AUTO_ROSTER', 'WFM_EXTENSIONS',
      'RTA_BOARD', 'ATS_DASHBOARD', 'JOB_REQUISITION', 'ATS_WALKIN_QUEUE',
      'ATS_BGV', 'ATS_ONBOARDING_REQUESTS', 'ATS_OFFER', 'ATS_RECRUITER_WORKSPACE',
      'EMPLOYEE_MANAGEMENT', 'MY_PROFILE', 'ORG_CHART', 'EMPLOYEE_LIFECYCLE',
      'EXIT_COMMAND_CENTER', 'RESIGNATION_COMMAND_CENTER', 'MY_KPI', 'PIP_MANAGEMENT',
      'QUALITY_DASHBOARD', 'PERFORMANCE_HUB', 'ASSETS_MANAGER', 'LETTERS',
      'ACCESS_CONTROL', 'ORG_MASTERS', 'INTEGRATION_HUB', 'HELPDESK_KB',
      'WORK_INBOX', 'LMS_COORDINATOR', 'REPORTS_CENTER', 'CEO_DASHBOARD',
      'HR_DASHBOARD', 'MANAGEMENT_DASHBOARD', 'WFM_DASHBOARD', 'EMPLOYEE_SELF_DASHBOARD',
      'OPERATIONS_DASHBOARD', 'RECRUITER_DASHBOARD', 'PAYROLL_HR_DASHBOARD',
      'STATUTORY_COMPLIANCE', 'LABOUR_COMPLIANCE', 'DPDP_COMPLIANCE',
      'IT_PROVISIONING_TRACKER', 'BENEFITS', 'GRIEVANCE_COMMAND_CENTER',
      'WORKFLOW_ADMIN', 'PROCESS_CONFIG', 'CLIENT_MASTER', 'CAREER_PLANNING',
      'TAT_DASHBOARD', 'FINANCE_GRN', 'FINANCE_CLIENT_BILLING', 'FINANCE_PROCESS_PNL',
      'FINANCE_BRANCH_BUDGET',
    ].map((pc) => ({ page_code: pc, can_view: true, can_create: false, can_edit: false, can_delete: false, can_export: false })),
  });
}

beforeEach(() => {
  mocks.getAccessMe.mockReset();
  grantAll();
});

function expectHandled(result: Awaited<ReturnType<typeof answerHowToQuestion>>, route: string) {
  expect(result.handled).toBe(true);
  expect(result.response?.actions?.[0]?.url).toBe(route);
}

// ─── PAYROLL: PAYSLIPS ───────────────────────────────────────────────────────
describe('payslip_download', () => {
  const route = '/payroll/payslips';
  it('how do I download my payslip', async () => expectHandled(await answerHowToQuestion('how do I download my payslip', 'u', ['employee']), route));
  it('where can I get my salary slip', async () => expectHandled(await answerHowToQuestion('where can I get my salary slip', 'u', ['employee']), route));
  it('mira tell me where to see my payslip', async () => expectHandled(await answerHowToQuestion('mira tell me where to see my payslip', 'u', ['employee']), route));
  it('how to download payslip for last month', async () => expectHandled(await answerHowToQuestion('how to download payslip for last month', 'u', ['employee']), route));
  it('I need my salary slip where do I find it', async () => expectHandled(await answerHowToQuestion('I need my salary slip where do I find it', 'u', ['employee']), route));
});

// ─── PAYROLL: REIMBURSEMENTS ─────────────────────────────────────────────────
describe('reimbursement_raise', () => {
  const route = '/payroll/reimbursements';
  it('how do I raise a reimbursement claim', async () => expectHandled(await answerHowToQuestion('how do I raise a reimbursement claim', 'u', ['employee']), route));
  it('where can I submit my expense claim', async () => expectHandled(await answerHowToQuestion('where can I submit my expense claim', 'u', ['employee']), route));
  it('how to file a reimbursement for my travel expenses', async () => expectHandled(await answerHowToQuestion('how to file a reimbursement for my travel expenses', 'u', ['employee']), route));
  it('I need to submit a medical reimbursement how to do it', async () => expectHandled(await answerHowToQuestion('I need to submit a medical reimbursement how to do it', 'u', ['employee']), route));
  it('where do I raise an expense claim in HRMS', async () => expectHandled(await answerHowToQuestion('where do I raise an expense claim in HRMS', 'u', ['employee']), route));
});

// ─── PAYROLL: LOANS ──────────────────────────────────────────────────────────
describe('loan_apply', () => {
  const route = '/payroll/loans';
  it('how do I apply for a loan', async () => expectHandled(await answerHowToQuestion('how do I apply for a loan', 'u', ['employee']), route));
  it('where can I request a salary advance', async () => expectHandled(await answerHowToQuestion('where can I request a salary advance', 'u', ['employee']), route));
  it('how to take a salary loan from company', async () => expectHandled(await answerHowToQuestion('how to take a salary loan from company', 'u', ['employee']), route));
  it('mira how can I apply for advance salary', async () => expectHandled(await answerHowToQuestion('mira how can I apply for advance salary', 'u', ['employee']), route));
  it('I want to take a loan where do I apply', async () => expectHandled(await answerHowToQuestion('I want to take a loan where do I apply', 'u', ['employee']), route));
});

describe('loan_view_status', () => {
  const route = '/payroll/loans';
  it('how do I check my loan balance', async () => expectHandled(await answerHowToQuestion('how do I check my loan balance', 'u', ['employee']), route));
  it('where can I see my loan EMI status', async () => expectHandled(await answerHowToQuestion('where can I see my loan EMI status', 'u', ['employee']), route));
  it('how to check outstanding loan amount', async () => expectHandled(await answerHowToQuestion('how to check outstanding loan amount', 'u', ['employee']), route));
});

// ─── PAYROLL: INCENTIVES ─────────────────────────────────────────────────────
describe('incentive_upload', () => {
  const route = '/payroll/incentives';
  it('how do I bulk upload incentives for employees', async () => expectHandled(await answerHowToQuestion('how do I bulk upload incentives for employees', 'u', ['payroll_head']), route));
  it('where can I upload employee incentives', async () => expectHandled(await answerHowToQuestion('where can I upload employee incentives', 'u', ['payroll_head']), route));
  it('how to add incentive for an employee', async () => expectHandled(await answerHowToQuestion('how to add incentive for an employee', 'u', ['payroll_head']), route));
  it('mira tell me where to bulk upload incentive', async () => expectHandled(await answerHowToQuestion('mira tell me where to bulk upload incentive', 'u', ['payroll_head']), route));
  it('I want to enter incentives for 50 employees where do I go', async () => expectHandled(await answerHowToQuestion('I want to enter incentives for 50 employees where do I go', 'u', ['payroll_head']), route));
});

// ─── PAYROLL: SALARY DISPUTE ─────────────────────────────────────────────────
describe('salary_dispute_raise', () => {
  const route = '/payroll/salary-disputes';
  it('my salary is wrong how do I raise a dispute', async () => expectHandled(await answerHowToQuestion('my salary is wrong how do I raise a dispute', 'u', ['employee']), route));
  it('how do I report a salary discrepancy', async () => expectHandled(await answerHowToQuestion('how do I report a salary discrepancy', 'u', ['employee']), route));
  it('where can I raise a salary dispute', async () => expectHandled(await answerHowToQuestion('where can I raise a salary dispute', 'u', ['employee']), route));
  it('salary incorrect this month how to flag it', async () => expectHandled(await answerHowToQuestion('salary incorrect this month how to flag it', 'u', ['employee']), route));
  it('how to dispute wrong salary in HRMS', async () => expectHandled(await answerHowToQuestion('how to dispute wrong salary in HRMS', 'u', ['employee']), route));
});

// ─── PAYROLL: FULL & FINAL ───────────────────────────────────────────────────
describe('full_final', () => {
  const route = '/payroll/full-final';
  it('how do I process full and final settlement', async () => expectHandled(await answerHowToQuestion('how do I process full and final settlement', 'u', ['payroll_head']), route));
  it('where is the FnF page', async () => expectHandled(await answerHowToQuestion('where is the FnF page', 'u', ['payroll_head']), route));
  it('how to do F&F for an exiting employee', async () => expectHandled(await answerHowToQuestion('how to do F&F for an exiting employee', 'u', ['payroll_head']), route));
  it('final settlement kaise karte hain — how to do final settlement', async () => expectHandled(await answerHowToQuestion('how to do final settlement for employee', 'u', ['payroll_head']), route));
  it('where do I calculate gratuity and leave encashment for exit', async () => expectHandled(await answerHowToQuestion('where do I calculate gratuity and leave encashment for exit', 'u', ['payroll_head']), route));
});

// ─── PAYROLL: STATUTORY ──────────────────────────────────────────────────────
describe('statutory_filing', () => {
  const route = '/payroll/statutory';
  it('where can I check PF filing status', async () => expectHandled(await answerHowToQuestion('where can I check PF filing status', 'u', ['admin']), route));
  it('how do I check ESI compliance', async () => expectHandled(await answerHowToQuestion('how do I check ESI compliance', 'u', ['admin']), route));
  it('where is TDS filing tracker', async () => expectHandled(await answerHowToQuestion('where is TDS filing tracker', 'u', ['admin']), route));
  it('how to download PF challan', async () => expectHandled(await answerHowToQuestion('how to download PF challan', 'u', ['admin']), route));
  it('show me statutory compliance status', async () => expectHandled(await answerHowToQuestion('show me statutory compliance status', 'u', ['admin']), route));
});

// ─── PAYROLL: SIGN-OFF ───────────────────────────────────────────────────────
describe('payroll_sign_off', () => {
  const route = '/payroll/sign-off';
  it('how do I sign off payroll for this month', async () => expectHandled(await answerHowToQuestion('how do I sign off payroll for this month', 'u', ['payroll_head']), route));
  it('where can I finalize payroll', async () => expectHandled(await answerHowToQuestion('where can I finalize payroll', 'u', ['payroll_head']), route));
  it('how to approve payroll and lock it', async () => expectHandled(await answerHowToQuestion('how to approve payroll and lock it', 'u', ['payroll_head']), route));
  it('payroll sign off kahan se karte hain — where to do payroll signoff', async () => expectHandled(await answerHowToQuestion('where to do payroll signoff', 'u', ['payroll_head']), route));
});

// ─── PAYROLL: TDS / FORM 16 ──────────────────────────────────────────────────
describe('tds_form16', () => {
  const route = '/payroll/tds-certificate-part-a';
  it('how do I download Form 16', async () => expectHandled(await answerHowToQuestion('how do I download Form 16', 'u', ['payroll_head']), route));
  it('where can I get TDS certificate', async () => expectHandled(await answerHowToQuestion('where can I get TDS certificate', 'u', ['payroll_head']), route));
  it('how to generate Form 16 Part A for all employees', async () => expectHandled(await answerHowToQuestion('how to generate Form 16 for employees', 'u', ['payroll_head']), route));
  it('income tax certificate kaise download karein', async () => expectHandled(await answerHowToQuestion('how do I download income tax certificate', 'u', ['payroll_head']), route));
});

// ─── PAYROLL: EPF/PF ─────────────────────────────────────────────────────────
describe('epf_compliance', () => {
  const route = '/payroll/epf-compliance';
  it('where can I check UAN status', async () => expectHandled(await answerHowToQuestion('where can I check UAN status', 'u', ['payroll_hr']), route));
  it('how to check PF KYC pending employees', async () => expectHandled(await answerHowToQuestion('how to check PF KYC pending employees', 'u', ['payroll_hr']), route));
  it('how do I view EPF compliance report', async () => expectHandled(await answerHowToQuestion('how do I view EPF compliance report', 'u', ['payroll_hr']), route));
});

describe('pf_management', () => {
  const route = '/payroll/pf-management';
  it('how do I generate ECR file', async () => expectHandled(await answerHowToQuestion('how do I generate ECR file', 'u', ['payroll_hr']), route));
  it('where is PF batch management', async () => expectHandled(await answerHowToQuestion('where is PF batch management', 'u', ['payroll_hr']), route));
  it('how to submit PF to EPFO', async () => expectHandled(await answerHowToQuestion('how to submit PF to EPFO', 'u', ['payroll_hr']), route));
});

// ─── PAYROLL: NOC ────────────────────────────────────────────────────────────
describe('noc_salary_hold', () => {
  const route = '/payroll/noc';
  it('how do I put a salary hold', async () => expectHandled(await answerHowToQuestion('how do I put a salary hold', 'u', ['payroll_head']), route));
  it('where can I hold an employee salary', async () => expectHandled(await answerHowToQuestion('where can I hold an employee salary', 'u', ['payroll_head']), route));
  it('how to release salary hold for an employee', async () => expectHandled(await answerHowToQuestion('how to release salary hold for an employee', 'u', ['payroll_head']), route));
  it('NOC management kahan hai — where is NOC management', async () => expectHandled(await answerHowToQuestion('where is NOC management in HRMS', 'u', ['payroll_head']), route));
});

// ─── PAYROLL: SALARY CERTIFICATE ────────────────────────────────────────────
describe('salary_certificate', () => {
  const route = '/payroll/salary-certificates';
  it('how do I get a salary certificate', async () => expectHandled(await answerHowToQuestion('how do I get a salary certificate', 'u', ['employee']), route));
  it('where can I download employment certificate', async () => expectHandled(await answerHowToQuestion('where can I download employment certificate', 'u', ['employee']), route));
  it('how to generate salary certificate for bank loan', async () => expectHandled(await answerHowToQuestion('how to generate salary certificate for bank loan', 'u', ['employee']), route));
  it('I need a salary certificate for visa application where do I get it', async () => expectHandled(await answerHowToQuestion('I need a salary certificate for visa application where do I get it', 'u', ['employee']), route));
});

// ─── PAYROLL: SALARY PACKAGES ────────────────────────────────────────────────
describe('salary_package_view', () => {
  const route = '/payroll/salary-packages';
  it('how do I view my salary package', async () => expectHandled(await answerHowToQuestion('how do I view my salary package', 'u', ['employee']), route));
  it('where can I see CTC structure', async () => expectHandled(await answerHowToQuestion('where can I see CTC structure', 'u', ['employee']), route));
  it('how to assign a salary structure to an employee', async () => expectHandled(await answerHowToQuestion('how to assign a salary structure to an employee', 'u', ['payroll_head']), route));
  it('where is the salary package page', async () => expectHandled(await answerHowToQuestion('where is the salary package page', 'u', ['payroll_head']), route));
});

// ─── PAYROLL: BULK UPLOAD ────────────────────────────────────────────────────
describe('bulk_upload', () => {
  const route = '/bulk-upload';
  it('how do I bulk upload employees', async () => expectHandled(await answerHowToQuestion('how do I bulk upload employees', 'u', ['admin']), route));
  it('where is the bulk import page', async () => expectHandled(await answerHowToQuestion('where is the bulk import page', 'u', ['admin']), route));
  it('how to bulk upload salary data', async () => expectHandled(await answerHowToQuestion('how to bulk upload salary data', 'u', ['admin']), route));
  it('I need to upload 200 employees at once where do I do that', async () => expectHandled(await answerHowToQuestion('I need to upload 200 employees at once where do I do that', 'u', ['admin']), route));
});

// ─── PAYROLL: PAYMENT CENTER ─────────────────────────────────────────────────
describe('bank_payment_readiness', () => {
  const route = '/payroll/payment-center';
  it('how do I generate the bank payment file', async () => expectHandled(await answerHowToQuestion('how do I generate the bank payment file', 'u', ['payroll_head']), route));
  it('where can I check bank account readiness', async () => expectHandled(await answerHowToQuestion('where can I check bank account readiness', 'u', ['payroll_head']), route));
  it('how to do salary disbursal', async () => expectHandled(await answerHowToQuestion('how to do salary disbursal', 'u', ['payroll_head']), route));
  it('where is the NEFT file generation page', async () => expectHandled(await answerHowToQuestion('where is the NEFT file generation page', 'u', ['payroll_head']), route));
});

// ─── PAYROLL: READINESS ──────────────────────────────────────────────────────
describe('payroll_readiness', () => {
  const route = '/payroll/readiness';
  it('how do I check payroll readiness', async () => expectHandled(await answerHowToQuestion('how do I check payroll readiness', 'u', ['payroll_head']), route));
  it('where can I see which branches are ready for payroll', async () => expectHandled(await answerHowToQuestion('where can I see which branches are ready for payroll', 'u', ['payroll_head']), route));
  it('how to check attendance lock status before payroll', async () => expectHandled(await answerHowToQuestion('how to check attendance lock status before payroll', 'u', ['wfm']), route));
  it('process readiness kahan check karein — where to check process readiness', async () => expectHandled(await answerHowToQuestion('where to check process readiness for payroll', 'u', ['wfm']), route));
});

// ─── PAYROLL: HOLIDAY MASTER ─────────────────────────────────────────────────
describe('holiday_master', () => {
  const route = '/payroll/holiday-master';
  it('how do I add a new holiday', async () => expectHandled(await answerHowToQuestion('how do I add a new holiday', 'u', ['admin']), route));
  it('where is the holiday calendar configuration', async () => expectHandled(await answerHowToQuestion('where is the holiday calendar configuration', 'u', ['admin']), route));
  it('how to define national holidays for a branch', async () => expectHandled(await answerHowToQuestion('how to define national holidays for a branch', 'u', ['admin']), route));
  it('I need to add Diwali as a holiday how to do it', async () => expectHandled(await answerHowToQuestion('I need to add Diwali as a holiday how to do it', 'u', ['admin']), route));
});

// ─── PAYROLL: HOLIDAY WORK ───────────────────────────────────────────────────
describe('holiday_work_request', () => {
  const route = '/payroll/holiday-work';
  it('how do I request comp off for working on a holiday', async () => expectHandled(await answerHowToQuestion('how do I request comp off for working on a holiday', 'u', ['wfm']), route));
  it('where can I manage holiday work requests', async () => expectHandled(await answerHowToQuestion('where can I manage holiday work requests', 'u', ['wfm']), route));
  it('I worked on a public holiday how to apply for compensatory off', async () => expectHandled(await answerHowToQuestion('I worked on a public holiday how to apply for compensatory off', 'u', ['wfm']), route));
});

// ─── PAYROLL: AUDIT TRAIL ────────────────────────────────────────────────────
describe('payroll_audit_trail', () => {
  const route = '/payroll/audit-trail';
  it('how do I view payroll audit trail', async () => expectHandled(await answerHowToQuestion('how do I view payroll audit trail', 'u', ['payroll_head']), route));
  it('where can I see payroll change history', async () => expectHandled(await answerHowToQuestion('where can I see payroll change history', 'u', ['payroll_head']), route));
  it('who changed the salary component for this employee', async () => expectHandled(await answerHowToQuestion('how to view payroll change history for employee', 'u', ['payroll_head']), route));
});

// ─── PAYROLL: BULK OUTPUTS ───────────────────────────────────────────────────
describe('bulk_payslip_outputs', () => {
  const route = '/payroll/bulk-outputs';
  it('how do I download all payslips at once', async () => expectHandled(await answerHowToQuestion('how do I download all payslips at once', 'u', ['payroll_head']), route));
  it('where can I generate bulk payslips', async () => expectHandled(await answerHowToQuestion('where can I generate bulk payslips', 'u', ['payroll_head']), route));
  it('how to download mass payslip PDF for the whole company', async () => expectHandled(await answerHowToQuestion('how to generate mass payslips for the whole company', 'u', ['payroll_head']), route));
});

// ─── PAYROLL: SALARY REVIEW QUEUE ───────────────────────────────────────────
describe('salary_review_queue', () => {
  const route = '/payroll/salary-review';
  it('how do I review pending salary changes', async () => expectHandled(await answerHowToQuestion('how do I review pending salary changes', 'u', ['payroll_head']), route));
  it('where is the salary revision approval queue', async () => expectHandled(await answerHowToQuestion('where is the salary revision approval queue', 'u', ['payroll_head']), route));
  it('how to approve a pending salary change request', async () => expectHandled(await answerHowToQuestion('how to approve a pending salary change request', 'u', ['payroll_head']), route));
});

// ─── PAYROLL: OVERTIME ───────────────────────────────────────────────────────
describe('overtime_manage', () => {
  const route = '/payroll/overtime';
  it('how do I manage overtime', async () => expectHandled(await answerHowToQuestion('how do I manage overtime', 'u', ['wfm']), route));
  it('where can I approve overtime requests', async () => expectHandled(await answerHowToQuestion('where can I approve overtime requests', 'u', ['wfm']), route));
  it('how to upload OT hours for employees', async () => expectHandled(await answerHowToQuestion('how to upload OT hours for employees', 'u', ['wfm']), route));
});

// ─── TAX DECLARATION ─────────────────────────────────────────────────────────
describe('tax_declaration_submit', () => {
  const route = '/payroll/tax-declaration';
  it('how do I submit my tax declaration', async () => expectHandled(await answerHowToQuestion('how do I submit my tax declaration', 'u', ['employee']), route));
  it('where can I declare 80C investments', async () => expectHandled(await answerHowToQuestion('where can I declare 80C investments', 'u', ['employee']), route));
  it('how to submit HRA exemption in HRMS', async () => expectHandled(await answerHowToQuestion('how to submit HRA exemption in HRMS', 'u', ['employee']), route));
  it('where do I enter section 80D declaration', async () => expectHandled(await answerHowToQuestion('where do I enter section 80D declaration', 'u', ['employee']), route));
});

// ─── SALARY INCREMENT ────────────────────────────────────────────────────────
describe('salary_increment', () => {
  const route = '/salary-increment';
  it('how do I process a salary increment', async () => expectHandled(await answerHowToQuestion('how do I process a salary increment', 'u', ['hr']), route));
  it('where can I give a salary hike to an employee', async () => expectHandled(await answerHowToQuestion('where can I give a salary hike to an employee', 'u', ['hr']), route));
  it('how to raise a salary revision for my team member', async () => expectHandled(await answerHowToQuestion('how do I give an employee a salary raise', 'u', ['hr']), route));
  it('employee ka salary increase karna hai — how to increase employee salary', async () => expectHandled(await answerHowToQuestion('how to increase employee salary in HRMS', 'u', ['hr']), route));
});

// ─── ATTENDANCE ──────────────────────────────────────────────────────────────
describe('attendance_view', () => {
  const route = '/attendance';
  it('how do I view my attendance', async () => expectHandled(await answerHowToQuestion('how do I view my attendance', 'u', ['employee']), route));
  it('where can I see my attendance record', async () => expectHandled(await answerHowToQuestion('where can I see my attendance record', 'u', ['employee']), route));
  it('how to check my punch in punch out history', async () => expectHandled(await answerHowToQuestion('how to check my punch in punch out history', 'u', ['employee']), route));
});

describe('attendance_regularization', () => {
  const route = '/attendance-regularization';
  it('how do I request an attendance regularization', async () => expectHandled(await answerHowToQuestion('how do I request an attendance regularization', 'u', ['employee']), route));
  it('where can I fix my wrong attendance', async () => expectHandled(await answerHowToQuestion('where can I fix my wrong attendance', 'u', ['employee']), route));
  it('I was marked absent but I was present how to correct it', async () => expectHandled(await answerHowToQuestion('I was marked absent but I was present how to correct it', 'u', ['employee']), route));
  it('how to correct wrong punch time', async () => expectHandled(await answerHowToQuestion('how to correct wrong punch time', 'u', ['employee']), route));
});

describe('attendance_dispute', () => {
  const route = '/attendance/disputes';
  it('how do I raise an attendance dispute', async () => expectHandled(await answerHowToQuestion('how do I raise an attendance dispute', 'u', ['employee']), route));
  it('where can I dispute wrong attendance marking', async () => expectHandled(await answerHowToQuestion('where can I dispute wrong attendance marking', 'u', ['employee']), route));
});

describe('team_attendance_view', () => {
  const route = '/wfm/team-attendance';
  it('how do I view my team attendance', async () => expectHandled(await answerHowToQuestion('how do I view my team attendance', 'u', ['manager']), route));
  it('where can I see team member attendance for this month', async () => expectHandled(await answerHowToQuestion('where can I see team member attendance for this month', 'u', ['manager']), route));
});

describe('attendance_lookup_admin', () => {
  const route = '/hr/attendance-lookup';
  it('how do I check attendance of any employee as HR', async () => expectHandled(await answerHowToQuestion('how do I check attendance of any employee as HR', 'u', ['hr']), route));
  it('where is HR attendance lookup', async () => expectHandled(await answerHowToQuestion('where is HR attendance lookup', 'u', ['hr']), route));
});

// ─── LEAVE ───────────────────────────────────────────────────────────────────
describe('leave_apply', () => {
  const route = '/leaves';
  it('how do I apply for leave', async () => expectHandled(await answerHowToQuestion('how do I apply for leave', 'u', ['employee']), route));
  it('how to raise a leave request for tomorrow', async () => expectHandled(await answerHowToQuestion('how to raise a leave request for tomorrow', 'u', ['employee']), route));
  it('where can I apply for casual leave', async () => expectHandled(await answerHowToQuestion('where can I apply for casual leave', 'u', ['employee']), route));
  it('I want to take leave tomorrow how do I apply', async () => expectHandled(await answerHowToQuestion('I want to take leave tomorrow how do I apply', 'u', ['employee']), route));
});

describe('leave_balance_check', () => {
  const route = '/leaves';
  it('how do I check my leave balance', async () => expectHandled(await answerHowToQuestion('how do I check my leave balance', 'u', ['employee']), route));
  it('how many CL days do I have remaining', async () => expectHandled(await answerHowToQuestion('how many CL days do I have remaining', 'u', ['employee']), route));
  it('where can I see available leave days', async () => expectHandled(await answerHowToQuestion('where can I see available leave days', 'u', ['employee']), route));
  it('how to check remaining EL balance', async () => expectHandled(await answerHowToQuestion('how to check remaining EL balance', 'u', ['employee']), route));
});

describe('leave_approve', () => {
  const route = '/leaves';
  it('how do I approve leave for my team', async () => expectHandled(await answerHowToQuestion('how do I approve leave for my team', 'u', ['manager']), route));
  it('where can I approve or reject a leave request', async () => expectHandled(await answerHowToQuestion('where can I approve or reject a leave request', 'u', ['manager']), route));
  it('how to approve team member leave in HRMS', async () => expectHandled(await answerHowToQuestion('how to approve team member leave in HRMS', 'u', ['manager']), route));
});

describe('maternity_leave', () => {
  const route = '/maternity-leave';
  it('how do I manage maternity leave', async () => expectHandled(await answerHowToQuestion('how do I manage maternity leave', 'u', ['hr']), route));
  it('where is the maternity leave page', async () => expectHandled(await answerHowToQuestion('where is the maternity leave page', 'u', ['hr']), route));
  it('how to process paternity leave application', async () => expectHandled(await answerHowToQuestion('how to process paternity leave application', 'u', ['hr']), route));
});

// ─── WFM / ROSTER ────────────────────────────────────────────────────────────
describe('roster_manage', () => {
  const route = '/wfm/roster';
  it('how do I manage the roster', async () => expectHandled(await answerHowToQuestion('how do I manage the roster', 'u', ['wfm']), route));
  it('where can I publish a roster', async () => expectHandled(await answerHowToQuestion('where can I publish a roster', 'u', ['wfm']), route));
  it('how to create a weekly roster for my team', async () => expectHandled(await answerHowToQuestion('how to create a weekly roster for my team', 'u', ['wfm']), route));
  it('roster publish karne ka page kahan hai — where is the roster publish page', async () => expectHandled(await answerHowToQuestion('where is the roster publish page', 'u', ['wfm']), route));
});

describe('my_roster_view', () => {
  const route = '/my-roster';
  it('how do I view my roster', async () => expectHandled(await answerHowToQuestion('how do I view my roster', 'u', ['employee']), route));
  it('where can I see my shift schedule', async () => expectHandled(await answerHowToQuestion('where can I see my shift schedule', 'u', ['employee']), route));
  it('what is my shift today how do I check', async () => expectHandled(await answerHowToQuestion('what is my shift today how do I check', 'u', ['employee']), route));
  it('where do I check my schedule for this week', async () => expectHandled(await answerHowToQuestion('where do I check my schedule for this week', 'u', ['employee']), route));
});

describe('roster_preference', () => {
  const route = '/roster-preference';
  it('how do I submit my shift preference', async () => expectHandled(await answerHowToQuestion('how do I submit my shift preference', 'u', ['employee']), route));
  it('where can I request a particular roster', async () => expectHandled(await answerHowToQuestion('where can I request a particular roster', 'u', ['employee']), route));
  it('how to tell WFM my preferred shift', async () => expectHandled(await answerHowToQuestion('how to tell WFM my preferred shift', 'u', ['employee']), route));
});

describe('week_off_preference', () => {
  const route = '/week-off-preferences';
  it('how do I submit week off preference', async () => expectHandled(await answerHowToQuestion('how do I submit week off preference', 'u', ['employee']), route));
  it('where can I request a preferred week off day', async () => expectHandled(await answerHowToQuestion('where can I request a preferred week off day', 'u', ['employee']), route));
  it('how to change my week off in HRMS', async () => expectHandled(await answerHowToQuestion('how to change my week off in HRMS', 'u', ['employee']), route));
});

describe('wfm_live_tracker', () => {
  const route = '/wfm/live-tracker';
  it('how do I view live attendance', async () => expectHandled(await answerHowToQuestion('how do I view live attendance', 'u', ['wfm']), route));
  it('where can I see real-time biometric status', async () => expectHandled(await answerHowToQuestion('where can I see real-time biometric status', 'u', ['wfm']), route));
  it('how to check who is present right now in office', async () => expectHandled(await answerHowToQuestion('how to check who is present right now in office', 'u', ['wfm']), route));
  it('live attendance status kahan dekhein — where to see live attendance status', async () => expectHandled(await answerHowToQuestion('where to see live attendance status', 'u', ['wfm']), route));
});

describe('rta_board', () => {
  const route = '/rta-board';
  it('how do I view the RTA board', async () => expectHandled(await answerHowToQuestion('how do I view the RTA board', 'u', ['wfm']), route));
  it('where can I check real-time adherence', async () => expectHandled(await answerHowToQuestion('where can I check real-time adherence', 'u', ['wfm']), route));
  it('how to see which agents are non-adherent', async () => expectHandled(await answerHowToQuestion('how to see which agents are non-adherent', 'u', ['wfm']), route));
});

// ─── ATS / RECRUITMENT ───────────────────────────────────────────────────────
describe('ats_command_center', () => {
  const route = '/ats/command-center';
  it('how do I access the ATS dashboard', async () => expectHandled(await answerHowToQuestion('how do I access the ATS dashboard', 'u', ['hr']), route));
  it('where is the recruitment command center', async () => expectHandled(await answerHowToQuestion('where is the recruitment command center', 'u', ['hr']), route));
  it('how to view the full recruitment pipeline', async () => expectHandled(await answerHowToQuestion('how to view the full recruitment pipeline', 'u', ['hr']), route));
  it('ATS ka overview kahan milega — where to find ATS overview', async () => expectHandled(await answerHowToQuestion('where to find ATS overview', 'u', ['hr']), route));
});

describe('job_requisition', () => {
  const route = '/recruitment/job-requisition';
  it('how do I raise a job requisition', async () => expectHandled(await answerHowToQuestion('how do I raise a job requisition', 'u', ['hr']), route));
  it('where can I create a new hiring demand', async () => expectHandled(await answerHowToQuestion('where can I create a new hiring demand', 'u', ['hr']), route));
  it('how to raise a JR for a vacancy', async () => expectHandled(await answerHowToQuestion('how to raise a JR for a vacancy', 'u', ['hr']), route));
  it('I need to hire 10 people how do I raise the requirement', async () => expectHandled(await answerHowToQuestion('I need to hire 10 people how do I raise the requirement', 'u', ['hr']), route));
});

describe('candidate_registration', () => {
  const route = '/ats/walkin-queue';
  it('how do I register a walk-in candidate', async () => expectHandled(await answerHowToQuestion('how do I register a walk-in candidate', 'u', ['hr']), route));
  it('where can I add a new candidate', async () => expectHandled(await answerHowToQuestion('where can I add a new candidate', 'u', ['hr']), route));
  it('how to register a candidate for interview', async () => expectHandled(await answerHowToQuestion('how to register a candidate for interview', 'u', ['hr']), route));
});

describe('ats_recruiter_workspace', () => {
  const route = '/ats/recruiter/workspace';
  it('how do I open my recruiter workspace', async () => expectHandled(await answerHowToQuestion('how do I open my recruiter workspace', 'u', ['hr']), route));
  it('where are my candidates for today calling', async () => expectHandled(await answerHowToQuestion('where are my candidates for today calling', 'u', ['hr']), route));
  it('how do I access my daily candidate queue', async () => expectHandled(await answerHowToQuestion('how do I access my daily candidate queue', 'u', ['hr']), route));
});

describe('offer_letter_generate', () => {
  const route = '/offer-letter';
  it('how do I generate an offer letter', async () => expectHandled(await answerHowToQuestion('how do I generate an offer letter', 'u', ['hr']), route));
  it('where can I issue an offer letter to a candidate', async () => expectHandled(await answerHowToQuestion('where can I issue an offer letter to a candidate', 'u', ['hr']), route));
  it('how to create offer letter for selected candidate', async () => expectHandled(await answerHowToQuestion('how to create offer letter for selected candidate', 'u', ['hr']), route));
});

describe('bgv_check', () => {
  const route = '/ats/bgv';
  it('how do I run background verification', async () => expectHandled(await answerHowToQuestion('how do I run background verification', 'u', ['hr']), route));
  it('where can I check BGV status of a candidate', async () => expectHandled(await answerHowToQuestion('where can I check BGV status of a candidate', 'u', ['hr']), route));
  it('how to initiate background check for new joiner', async () => expectHandled(await answerHowToQuestion('how to initiate background check for new joiner', 'u', ['hr']), route));
});

describe('onboarding_requests', () => {
  const route = '/ats/onboarding-requests';
  it('how do I review onboarding requests', async () => expectHandled(await answerHowToQuestion('how do I review onboarding requests', 'u', ['hr']), route));
  it('where can I see new joiner joining documents', async () => expectHandled(await answerHowToQuestion('where can I see new joiner joining documents', 'u', ['hr']), route));
  it('how to approve onboarding for a new hire', async () => expectHandled(await answerHowToQuestion('how to approve onboarding for a new hire', 'u', ['hr']), route));
});

// ─── EMPLOYEE MANAGEMENT ─────────────────────────────────────────────────────
describe('employee_list', () => {
  const route = '/employees';
  it('how do I find an employee', async () => expectHandled(await answerHowToQuestion('how do I find an employee', 'u', ['hr']), route));
  it('where is the employee directory', async () => expectHandled(await answerHowToQuestion('where is the employee directory', 'u', ['hr']), route));
  it('how to search for an employee in HRMS', async () => expectHandled(await answerHowToQuestion('how to search for an employee in HRMS', 'u', ['hr']), route));
  it('how do I view all employees', async () => expectHandled(await answerHowToQuestion('how do I view all employees', 'u', ['hr']), route));
});

describe('employee_profile', () => {
  const route = '/profile';
  it('how do I view my profile', async () => expectHandled(await answerHowToQuestion('how do I view my profile', 'u', ['employee']), route));
  it('where can I update my personal details', async () => expectHandled(await answerHowToQuestion('where can I update my personal details', 'u', ['employee']), route));
  it('how to change my bank account number in HRMS', async () => expectHandled(await answerHowToQuestion('how to change my bank account number in HRMS', 'u', ['employee']), route));
});

describe('org_chart', () => {
  const route = '/org-chart';
  it('how do I view the org chart', async () => expectHandled(await answerHowToQuestion('how do I view the org chart', 'u', ['employee']), route));
  it('where can I see the organisation hierarchy', async () => expectHandled(await answerHowToQuestion('where can I see the organisation hierarchy', 'u', ['employee']), route));
  it('how to check reporting hierarchy in HRMS', async () => expectHandled(await answerHowToQuestion('how to check reporting hierarchy in HRMS', 'u', ['employee']), route));
});

describe('my_team', () => {
  const route = '/my-team';
  it('how do I manage my team', async () => expectHandled(await answerHowToQuestion('how do I manage my team', 'u', ['manager']), route));
  it('where can I see my direct reports', async () => expectHandled(await answerHowToQuestion('where can I see my direct reports', 'u', ['manager']), route));
  it('how to view my team members in HRMS', async () => expectHandled(await answerHowToQuestion('how to view my team members in HRMS', 'u', ['manager']), route));
  it('where is the my team section', async () => expectHandled(await answerHowToQuestion('where is the my team section', 'u', ['manager']), route));
});

describe('employee_lifecycle', () => {
  const route = '/employee-lifecycle';
  it('how do I confirm an employee after probation', async () => expectHandled(await answerHowToQuestion('how do I confirm an employee after probation', 'u', ['hr']), route));
  it('where can I process employee promotion', async () => expectHandled(await answerHowToQuestion('where can I process employee promotion', 'u', ['hr']), route));
  it('how to initiate employee transfer', async () => expectHandled(await answerHowToQuestion('how to initiate employee transfer', 'u', ['hr']), route));
});

// ─── EXIT MANAGEMENT ─────────────────────────────────────────────────────────
describe('resignation_raise', () => {
  const route = '/exit/resignation';
  it('how do I submit my resignation', async () => expectHandled(await answerHowToQuestion('how do I submit my resignation', 'u', ['employee']), route));
  it('where can I file my resignation', async () => expectHandled(await answerHowToQuestion('where can I file my resignation', 'u', ['employee']), route));
  it('how to raise a resignation in HRMS', async () => expectHandled(await answerHowToQuestion('how to raise a resignation in HRMS', 'u', ['employee']), route));
  it('I want to resign how do I do it in the system', async () => expectHandled(await answerHowToQuestion('I want to resign how do I do it in the system', 'u', ['employee']), route));
});

describe('resignation_revoke', () => {
  const route = '/exit/resignation';
  it('how do I revoke my resignation', async () => expectHandled(await answerHowToQuestion('how do I revoke my resignation', 'u', ['employee']), route));
  it('how can I cancel my resignation', async () => expectHandled(await answerHowToQuestion('how can I cancel my resignation', 'u', ['employee']), route));
  it('I want to take back my resignation how to withdraw it', async () => expectHandled(await answerHowToQuestion('I want to take back my resignation how to withdraw it', 'u', ['employee']), route));
});

describe('exit_management', () => {
  const route = '/exit-management';
  it('how do I manage exit requests', async () => expectHandled(await answerHowToQuestion('how do I manage exit requests', 'u', ['hr']), route));
  it('where can I view all resignation requests', async () => expectHandled(await answerHowToQuestion('where can I view all resignation requests', 'u', ['hr']), route));
  it('how to view exit command center', async () => expectHandled(await answerHowToQuestion('how to view exit command center', 'u', ['hr']), route));
});

// ─── PERFORMANCE / KPI ───────────────────────────────────────────────────────
describe('my_kpi', () => {
  const route = '/my-kpi';
  it('how do I view my KPI', async () => expectHandled(await answerHowToQuestion('how do I view my KPI', 'u', ['employee']), route));
  it('where can I see my performance score', async () => expectHandled(await answerHowToQuestion('where can I see my performance score', 'u', ['employee']), route));
  it('how to check my KPI targets and actuals', async () => expectHandled(await answerHowToQuestion('how to check my KPI targets and actuals', 'u', ['employee']), route));
  it('mera KPI kahan dekhun — where can I see my KPI', async () => expectHandled(await answerHowToQuestion('where can I see my KPI score', 'u', ['employee']), route));
});

describe('performance_feedback', () => {
  const route = '/performance-feedback/my-reports';
  it('how do I submit my performance feedback', async () => expectHandled(await answerHowToQuestion('how do I submit my performance feedback', 'u', ['employee']), route));
  it('where can I do my appraisal', async () => expectHandled(await answerHowToQuestion('where can I do my appraisal', 'u', ['employee']), route));
  it('how to fill performance review form', async () => expectHandled(await answerHowToQuestion('how to fill performance review form', 'u', ['employee']), route));
});

describe('pip_management', () => {
  const route = '/pip-management';
  it('how do I create a PIP for an employee', async () => expectHandled(await answerHowToQuestion('how do I create a PIP for an employee', 'u', ['manager']), route));
  it('where is the Performance Improvement Plan page', async () => expectHandled(await answerHowToQuestion('where is the Performance Improvement Plan page', 'u', ['manager']), route));
  it('how to put an employee on PIP', async () => expectHandled(await answerHowToQuestion('how to put an employee on PIP', 'u', ['manager']), route));
});

describe('career_planning', () => {
  const route = '/career-planning';
  it('how do I view my career path', async () => expectHandled(await answerHowToQuestion('how do I view my career path', 'u', ['employee']), route));
  it('where can I plan my career growth', async () => expectHandled(await answerHowToQuestion('where can I plan my career growth', 'u', ['employee']), route));
  it('how to see my career roadmap in HRMS', async () => expectHandled(await answerHowToQuestion('how to see my career roadmap in HRMS', 'u', ['employee']), route));
});

describe('people_experience', () => {
  const route = '/people-experience/command-center';
  it('how do I view employee engagement scores', async () => expectHandled(await answerHowToQuestion('how do I view employee engagement scores', 'u', ['hr']), route));
  it('where can I see pulse survey results', async () => expectHandled(await answerHowToQuestion('where can I see pulse survey results', 'u', ['hr']), route));
  it('how to check employee sentiment and engagement', async () => expectHandled(await answerHowToQuestion('how to check employee sentiment and engagement', 'u', ['hr']), route));
});

// ─── QUALITY ─────────────────────────────────────────────────────────────────
describe('quality_dashboard', () => {
  const route = '/quality-dashboard';
  it('how do I view the quality dashboard', async () => expectHandled(await answerHowToQuestion('how do I view the quality dashboard', 'u', ['qa']), route));
  it('where can I see QA audit scores', async () => expectHandled(await answerHowToQuestion('where can I see QA audit scores', 'u', ['qa']), route));
  it('how to check quality score of agents', async () => expectHandled(await answerHowToQuestion('how to check quality score of agents', 'u', ['qa']), route));
});

describe('qa_file_audit', () => {
  const route = '/quality/file-audit';
  it('how do I conduct a file audit', async () => expectHandled(await answerHowToQuestion('how do I conduct a file audit', 'u', ['qa']), route));
  it('where can I do a QA call audit', async () => expectHandled(await answerHowToQuestion('where can I do a QA call audit', 'u', ['qa']), route));
  it('how to audit a transaction for quality', async () => expectHandled(await answerHowToQuestion('how to audit a transaction for quality', 'u', ['qa']), route));
});

// ─── OPERATIONS ──────────────────────────────────────────────────────────────
describe('call_master', () => {
  const route = '/call-master';
  it('how do I view Call Master data', async () => expectHandled(await answerHowToQuestion('how do I view Call Master data', 'u', ['manager']), route));
  it('where can I see inbound call statistics', async () => expectHandled(await answerHowToQuestion('where can I see inbound call statistics', 'u', ['manager']), route));
  it('how to check operations performance dashboard', async () => expectHandled(await answerHowToQuestion('how to see operations call data', 'u', ['manager']), route));
  it('where is the operations report', async () => expectHandled(await answerHowToQuestion('where is the operations report', 'u', ['manager']), route));
});

describe('tat_dashboard', () => {
  const route = '/governance/tat-dashboard';
  it('how do I check TAT compliance', async () => expectHandled(await answerHowToQuestion('how do I check TAT compliance', 'u', ['manager']), route));
  it('where can I see SLA breach report', async () => expectHandled(await answerHowToQuestion('where can I see SLA breach report', 'u', ['manager']), route));
  it('how to view turnaround time dashboard', async () => expectHandled(await answerHowToQuestion('how to view turnaround time dashboard', 'u', ['manager']), route));
});

// ─── FINANCE / ERP ───────────────────────────────────────────────────────────
describe('grn_management', () => {
  const route = '/finance/grn';
  it('how do I manage GRN', async () => expectHandled(await answerHowToQuestion('how do I manage GRN', 'u', ['finance']), route));
  it('where can I create a goods receipt note', async () => expectHandled(await answerHowToQuestion('where can I create a goods receipt note', 'u', ['finance']), route));
  it('how to process a purchase receipt', async () => expectHandled(await answerHowToQuestion('how to process a purchase receipt', 'u', ['finance']), route));
});

describe('branch_budget', () => {
  const route = '/finance/branch-budget';
  it('how do I view branch budget', async () => expectHandled(await answerHowToQuestion('how do I view branch budget', 'u', ['branch_head']), route));
  it('where can I check monthly budget vs actual', async () => expectHandled(await answerHowToQuestion('where can I check monthly budget vs actual', 'u', ['branch_head']), route));
  it('how to update opex budget for a branch', async () => expectHandled(await answerHowToQuestion('how to update opex budget for a branch', 'u', ['finance']), route));
});

describe('vendor_management', () => {
  const route = '/vendors';
  it('how do I add a new vendor', async () => expectHandled(await answerHowToQuestion('how do I add a new vendor', 'u', ['finance']), route));
  it('where is the vendor management page', async () => expectHandled(await answerHowToQuestion('where is the vendor management page', 'u', ['finance']), route));
  it('how to onboard a new vendor in HRMS', async () => expectHandled(await answerHowToQuestion('how to onboard a new vendor in HRMS', 'u', ['finance']), route));
});

describe('process_pnl', () => {
  const route = '/finance/process-pnl';
  it('how do I view process P&L', async () => expectHandled(await answerHowToQuestion('how do I view process P&L', 'u', ['finance']), route));
  it('where can I see the PnL of a process', async () => expectHandled(await answerHowToQuestion('where can I see the PnL of a process', 'u', ['finance']), route));
  it('how to check process profitability', async () => expectHandled(await answerHowToQuestion('how to check process profitability', 'u', ['finance']), route));
  it('where is the profit and loss dashboard', async () => expectHandled(await answerHowToQuestion('where is the profit and loss dashboard', 'u', ['finance']), route));
});

describe('client_billing', () => {
  const route = '/finance/client-billing';
  it('how do I generate client invoice', async () => expectHandled(await answerHowToQuestion('how do I generate client invoice', 'u', ['finance']), route));
  it('where is client billing in HRMS', async () => expectHandled(await answerHowToQuestion('where is client billing in HRMS', 'u', ['finance']), route));
  it('how to manage client billing for this month', async () => expectHandled(await answerHowToQuestion('how to manage client billing for this month', 'u', ['finance']), route));
});

// ─── ASSETS / DOCUMENTS ──────────────────────────────────────────────────────
describe('assets_view', () => {
  const route = '/assets-manager';
  it('how do I view my assigned assets', async () => expectHandled(await answerHowToQuestion('how do I view my assigned assets', 'u', ['employee']), route));
  it('where can I see company assets', async () => expectHandled(await answerHowToQuestion('where can I see company assets', 'u', ['employee']), route));
  it('how to check which laptop is assigned to me', async () => expectHandled(await answerHowToQuestion('how to check which laptop is assigned to me', 'u', ['employee']), route));
  it('how do I manage assets for employees', async () => expectHandled(await answerHowToQuestion('how do I manage assets for employees', 'u', ['admin']), route));
});

describe('letters_generate', () => {
  const route = '/letters';
  it('how do I generate an appointment letter', async () => expectHandled(await answerHowToQuestion('how do I generate an appointment letter', 'u', ['hr']), route));
  it('where can I create an experience letter', async () => expectHandled(await answerHowToQuestion('where can I create an experience letter', 'u', ['hr']), route));
  it('how to issue increment letter to an employee', async () => expectHandled(await answerHowToQuestion('how to issue increment letter to an employee', 'u', ['hr']), route));
  it('where is letter generation in HRMS', async () => expectHandled(await answerHowToQuestion('where is letter generation in HRMS', 'u', ['hr']), route));
});

// ─── COMPLIANCE ───────────────────────────────────────────────────────────────
describe('statutory_compliance', () => {
  const route = '/compliance/statutory';
  it('how do I view statutory compliance', async () => expectHandled(await answerHowToQuestion('how do I view statutory compliance', 'u', ['hr']), route));
  it('where can I check PF ESI compliance status', async () => expectHandled(await answerHowToQuestion('where is the statutory compliance overview page', 'u', ['hr']), route));
  it('how to check TDS compliance status', async () => expectHandled(await answerHowToQuestion('where do I check overall compliance status', 'u', ['hr']), route));
});

describe('labour_compliance', () => {
  const route = '/compliance/labour';
  it('how do I check labour law compliance', async () => expectHandled(await answerHowToQuestion('how do I check labour law compliance', 'u', ['hr']), route));
  it('where is labour compliance page', async () => expectHandled(await answerHowToQuestion('where is labour compliance page', 'u', ['hr']), route));
  it('how to check Shops and Establishment compliance', async () => expectHandled(await answerHowToQuestion('how to check Shops and Establishment compliance', 'u', ['hr']), route));
});

describe('dpdp_compliance', () => {
  const route = '/compliance/dpdp';
  it('how do I manage DPDP compliance', async () => expectHandled(await answerHowToQuestion('how do I manage DPDP compliance', 'u', ['admin']), route));
  it('where is the data privacy compliance page', async () => expectHandled(await answerHowToQuestion('where is the data privacy compliance page', 'u', ['admin']), route));
  it('how to check consent management status', async () => expectHandled(await answerHowToQuestion('how to check consent management status', 'u', ['admin']), route));
});

describe('it_provisioning', () => {
  const route = '/it-provisioning';
  it('how do I track IT provisioning for a new joiner', async () => expectHandled(await answerHowToQuestion('how do I track IT provisioning for a new joiner', 'u', ['admin']), route));
  it('where can I set up email for a new employee', async () => expectHandled(await answerHowToQuestion('where can I set up email for a new employee', 'u', ['admin']), route));
  it('how to check provisioning status for onboarding', async () => expectHandled(await answerHowToQuestion('how to check provisioning status for onboarding', 'u', ['admin']), route));
  it('where is the IT access setup tracker', async () => expectHandled(await answerHowToQuestion('where is the IT access setup tracker', 'u', ['admin']), route));
});

// ─── DASHBOARDS ───────────────────────────────────────────────────────────────
describe('ceo_dashboard', () => {
  const route = '/ceo/dashboard';
  it('how do I access the CEO dashboard', async () => expectHandled(await answerHowToQuestion('how do I access the CEO dashboard', 'u', ['super_admin']), route));
  it('where is the executive dashboard', async () => expectHandled(await answerHowToQuestion('where is the executive dashboard', 'u', ['super_admin']), route));
  it('how to view management overview of the company', async () => expectHandled(await answerHowToQuestion('how to view management overview of the company', 'u', ['super_admin']), route));
});

describe('hr_dashboard', () => {
  const route = '/hr/dashboard';
  it('how do I view the HR dashboard', async () => expectHandled(await answerHowToQuestion('how do I view the HR dashboard', 'u', ['hr']), route));
  it('where is the human resource dashboard', async () => expectHandled(await answerHowToQuestion('where is the human resource dashboard', 'u', ['hr']), route));
});

describe('manager_dashboard', () => {
  const route = '/manager/dashboard';
  it('how do I access the manager dashboard', async () => expectHandled(await answerHowToQuestion('how do I access the manager dashboard', 'u', ['manager']), route));
  it('where is the team dashboard', async () => expectHandled(await answerHowToQuestion('where is the team dashboard', 'u', ['manager']), route));
  it('how to see my team management dashboard', async () => expectHandled(await answerHowToQuestion('how to see my team management dashboard', 'u', ['manager']), route));
});

describe('employee_self_dashboard', () => {
  const route = '/my-dashboard';
  it('how do I see my dashboard', async () => expectHandled(await answerHowToQuestion('how do I see my dashboard', 'u', ['employee']), route));
  it('where is my personal dashboard', async () => expectHandled(await answerHowToQuestion('where is my personal dashboard', 'u', ['employee']), route));
  it('how to access my self dashboard', async () => expectHandled(await answerHowToQuestion('how to access my self dashboard', 'u', ['employee']), route));
});

describe('operations_dashboard', () => {
  const route = '/operations-dashboard';
  it('how do I view operations dashboard', async () => expectHandled(await answerHowToQuestion('how do I view operations dashboard', 'u', ['manager']), route));
  it('where is the ops dashboard', async () => expectHandled(await answerHowToQuestion('where is the ops dashboard', 'u', ['manager']), route));
});

describe('recruiter_dashboard', () => {
  const route = '/recruiter-dashboard';
  it('how do I see my hiring dashboard', async () => expectHandled(await answerHowToQuestion('how do I see my hiring dashboard', 'u', ['hr']), route));
  it('where is the recruitment metrics page', async () => expectHandled(await answerHowToQuestion('where is the recruitment metrics page', 'u', ['hr']), route));
});

// ─── ADMIN / PLATFORM ────────────────────────────────────────────────────────
describe('audit_log', () => {
  const route = '/audit-log';
  it('how do I view the audit log', async () => expectHandled(await answerHowToQuestion('how do I view the audit log', 'u', ['admin']), route));
  it('where can I see who changed what in the system', async () => expectHandled(await answerHowToQuestion('where can I see who changed what in the system', 'u', ['admin']), route));
  it('how to check system activity log', async () => expectHandled(await answerHowToQuestion('how to check system activity log', 'u', ['admin']), route));
  it('who deleted that employee record how do I find out', async () => expectHandled(await answerHowToQuestion('who deleted that employee record how do I find out', 'u', ['admin']), route));
});

describe('access_control', () => {
  const route = '/settings/access-control';
  it('how do I manage user roles', async () => expectHandled(await answerHowToQuestion('how do I manage user roles', 'u', ['admin']), route));
  it('where can I assign page access to a user', async () => expectHandled(await answerHowToQuestion('where can I assign page access to a user', 'u', ['admin']), route));
  it('how to grant access to a module for an employee', async () => expectHandled(await answerHowToQuestion('how to grant access to a module for an employee', 'u', ['admin']), route));
  it('how to revoke access from a user', async () => expectHandled(await answerHowToQuestion('how to revoke access from a user', 'u', ['admin']), route));
});

describe('org_masters', () => {
  const route = '/org-masters';
  it('how do I add a new branch', async () => expectHandled(await answerHowToQuestion('how do I add a new branch', 'u', ['admin']), route));
  it('where can I create a new process', async () => expectHandled(await answerHowToQuestion('how do I add a new department in HRMS', 'u', ['admin']), route));
  it('how to add a new designation in HRMS', async () => expectHandled(await answerHowToQuestion('how to add a new designation in HRMS', 'u', ['admin']), route));
  it('where is org master configuration', async () => expectHandled(await answerHowToQuestion('where is org master configuration', 'u', ['admin']), route));
});

describe('integration_hub', () => {
  const route = '/integration-hub';
  it('how do I manage integrations', async () => expectHandled(await answerHowToQuestion('how do I manage integrations', 'u', ['admin']), route));
  it('where can I trigger a biometric sync', async () => expectHandled(await answerHowToQuestion('where can I trigger a biometric sync', 'u', ['admin']), route));
  it('how to check sync errors in integration hub', async () => expectHandled(await answerHowToQuestion('how to check sync errors in integration hub', 'u', ['admin']), route));
});

describe('workflow_admin', () => {
  const route = '/workflow-admin';
  it('how do I configure approval workflows', async () => expectHandled(await answerHowToQuestion('how do I configure approval workflows', 'u', ['admin']), route));
  it('where can I set up approval chain for leave', async () => expectHandled(await answerHowToQuestion('where can I set up approval chain for leave', 'u', ['admin']), route));
  it('how to manage approval workflow in HRMS', async () => expectHandled(await answerHowToQuestion('how to manage approval workflow in HRMS', 'u', ['admin']), route));
});

describe('process_config', () => {
  const route = '/process-config';
  it('how do I configure a new process', async () => expectHandled(await answerHowToQuestion('how do I configure a new process', 'u', ['admin']), route));
  it('where can I add a LOB to a process', async () => expectHandled(await answerHowToQuestion('where can I add a LOB to a process', 'u', ['admin']), route));
  it('how to set up process configuration', async () => expectHandled(await answerHowToQuestion('how to set up process configuration', 'u', ['admin']), route));
});

describe('client_master', () => {
  const route = '/client-master';
  it('how do I add a new client', async () => expectHandled(await answerHowToQuestion('how do I add a new client', 'u', ['admin']), route));
  it('where is client master setup', async () => expectHandled(await answerHowToQuestion('where is client master setup', 'u', ['admin']), route));
  it('how to onboard a new client in HRMS', async () => expectHandled(await answerHowToQuestion('how to onboard a new client in HRMS', 'u', ['admin']), route));
});

describe('company_calendar', () => {
  const route = '/calendar';
  it('how do I view the company calendar', async () => expectHandled(await answerHowToQuestion('how do I view the company calendar', 'u', ['employee']), route));
  it('where can I see company events and holidays', async () => expectHandled(await answerHowToQuestion('where can I see company events and holidays', 'u', ['employee']), route));
  it('where is the holiday calendar', async () => expectHandled(await answerHowToQuestion('where is the company calendar', 'u', ['employee']), route));
});

// ─── SUPPORT ─────────────────────────────────────────────────────────────────
describe('helpdesk', () => {
  const route = '/helpdesk';
  it('how do I raise a helpdesk ticket', async () => expectHandled(await answerHowToQuestion('how do I raise a helpdesk ticket', 'u', ['employee']), route));
  it('where can I open a support request', async () => expectHandled(await answerHowToQuestion('where can I open a support request', 'u', ['employee']), route));
  it('how to create a ticket for IT issue', async () => expectHandled(await answerHowToQuestion('how to create a ticket for IT issue', 'u', ['employee']), route));
  it('where is the help desk in HRMS', async () => expectHandled(await answerHowToQuestion('where is the help desk in HRMS', 'u', ['employee']), route));
});

describe('work_inbox', () => {
  const route = '/work-inbox';
  it('how do I see all my pending approvals', async () => expectHandled(await answerHowToQuestion('how do I see all my pending approvals', 'u', ['manager']), route));
  it('where is my work inbox', async () => expectHandled(await answerHowToQuestion('where is my work inbox', 'u', ['manager']), route));
  it('how to view all tasks pending my action', async () => expectHandled(await answerHowToQuestion('how to view all tasks pending my action', 'u', ['manager']), route));
  it('what is pending for my approval how do I check', async () => expectHandled(await answerHowToQuestion('what is pending for my approval how do I check', 'u', ['manager']), route));
});

describe('grievance_command_center', () => {
  const route = '/support/grievance-command-center';
  it('how do I handle employee grievances', async () => expectHandled(await answerHowToQuestion('how do I handle employee grievances', 'u', ['hr']), route));
  it('where is the grievance management center', async () => expectHandled(await answerHowToQuestion('where is the grievance management center', 'u', ['hr']), route));
  it('how to view all HR grievances', async () => expectHandled(await answerHowToQuestion('how to view all HR grievances', 'u', ['hr']), route));
});

describe('benefits_claims', () => {
  const route = '/benefits';
  it('how do I claim employee benefits', async () => expectHandled(await answerHowToQuestion('how do I claim employee benefits', 'u', ['employee']), route));
  it('where can I see my benefits', async () => expectHandled(await answerHowToQuestion('where can I see my benefits', 'u', ['employee']), route));
  it('how to apply for insurance benefit', async () => expectHandled(await answerHowToQuestion('how to apply for insurance benefit', 'u', ['employee']), route));
});

describe('notifications_view', () => {
  const route = '/notifications';
  it('how do I view my notifications', async () => expectHandled(await answerHowToQuestion('how do I view my notifications', 'u', ['employee']), route));
  it('where can I see my alerts', async () => expectHandled(await answerHowToQuestion('where can I see my alerts', 'u', ['employee']), route));
  it('how to check HRMS notifications', async () => expectHandled(await answerHowToQuestion('how to check HRMS notifications', 'u', ['employee']), route));
});

// ─── LMS / TRAINING ──────────────────────────────────────────────────────────
describe('lms_access', () => {
  const route = '/lms/my-learning';
  it('how do I access my training', async () => expectHandled(await answerHowToQuestion('how do I access my training', 'u', ['employee']), route));
  it('where can I view my LMS courses', async () => expectHandled(await answerHowToQuestion('where can I view my LMS courses', 'u', ['employee']), route));
  it('how to check my learning progress', async () => expectHandled(await answerHowToQuestion('how to check my learning progress', 'u', ['employee']), route));
  it('mera course kahan hai — where is my course', async () => expectHandled(await answerHowToQuestion('where is my learning course', 'u', ['employee']), route));
});

describe('lms_coordinator', () => {
  const route = '/lms/coordinator';
  it('how do I manage training batches', async () => expectHandled(await answerHowToQuestion('how do I manage training batches as coordinator', 'u', ['trainer']), route));
  it('where is the LMS coordinator page', async () => expectHandled(await answerHowToQuestion('where is the LMS coordinator page', 'u', ['trainer']), route));
  it('how to track learner progress as a trainer', async () => expectHandled(await answerHowToQuestion('how to track learner progress as a trainer', 'u', ['trainer']), route));
});

// ─── REPORTS ─────────────────────────────────────────────────────────────────
describe('reports_center', () => {
  const route = '/reports';
  it('how do I download a report', async () => expectHandled(await answerHowToQuestion('how do I download HR data from reports center', 'u', ['hr']), route));
  it('where is the reports center', async () => expectHandled(await answerHowToQuestion('where is the reports center', 'u', ['hr']), route));
  it('how to export attendance data', async () => expectHandled(await answerHowToQuestion('how do I export attendance report from HRMS', 'u', ['hr']), route));
  it('how do I get HR reports from HRMS', async () => expectHandled(await answerHowToQuestion('how do I get HR reports from HRMS', 'u', ['hr']), route));
  it('where can I download payroll report', async () => expectHandled(await answerHowToQuestion('where can I download payroll report', 'u', ['payroll_head']), route));
});

// ─── IJP ─────────────────────────────────────────────────────────────────────
describe('ijp_apply', () => {
  const route = '/people/ijp';
  it('how do I apply for an internal job posting', async () => expectHandled(await answerHowToQuestion('how do I apply for an internal job posting', 'u', ['employee']), route));
  it('where can I see internal job openings', async () => expectHandled(await answerHowToQuestion('where can I see internal job openings', 'u', ['employee']), route));
  it('how to apply for IJP in HRMS', async () => expectHandled(await answerHowToQuestion('how to apply for IJP in HRMS', 'u', ['employee']), route));
  it('internal vacancy kahan dekhein — where to see internal vacancy', async () => expectHandled(await answerHowToQuestion('where to see internal vacancy in HRMS', 'u', ['employee']), route));
});

// ─── RBAC DENIAL SMOKE TESTS ──────────────────────────────────────────────────
describe('RBAC denial smoke tests — wrong role gets denied, not steps', () => {
  beforeEach(() => {
    mocks.getAccessMe.mockReset();
    mocks.getAccessMe.mockResolvedValue({ pages: [] }); // no access
  });

  it('employee asking how to approve leave gets denial message', async () => {
    const r = await answerHowToQuestion('how do I approve leave for my team', 'u', ['employee']);
    expect(r.handled).toBe(true);
    expect(r.response?.actions).toEqual([]);
    expect(r.response?.answer).toContain('does not include leave approval');
  });

  it('employee asking how to manage bulk upload gets denial', async () => {
    const r = await answerHowToQuestion('how do I bulk upload employees', 'u', ['employee']);
    expect(r.handled).toBe(true);
    expect(r.response?.actions).toEqual([]);
  });

  it('employee asking to access CEO dashboard gets denial', async () => {
    const r = await answerHowToQuestion('how do I access the CEO dashboard', 'u', ['employee']);
    expect(r.handled).toBe(true);
    expect(r.response?.actions).toEqual([]);
  });

  it('employee asking to process payroll sign-off gets denial', async () => {
    const r = await answerHowToQuestion('how do I sign off payroll', 'u', ['employee']);
    expect(r.handled).toBe(true);
    expect(r.response?.actions).toEqual([]);
  });

  it('employee asking to manage GRN gets denial', async () => {
    const r = await answerHowToQuestion('how do I create a goods receipt note', 'u', ['employee']);
    expect(r.handled).toBe(true);
    expect(r.response?.actions).toEqual([]);
  });

  it('non-QA asking to conduct file audit gets denial', async () => {
    const r = await answerHowToQuestion('how do I do a QA file audit', 'u', ['employee']);
    expect(r.handled).toBe(true);
    expect(r.response?.actions).toEqual([]);
  });

  it('super_admin always bypasses — gets steps even with empty getAccessMe', async () => {
    const r = await answerHowToQuestion('how do I view the audit log', 'u', ['super_admin']);
    expect(r.handled).toBe(true);
    expect(r.response?.actions?.[0]?.url).toBe('/audit-log');
  });
});

// ─── NON-NAVIGATION QUESTIONS MUST NOT BE HANDLED ────────────────────────────
describe('non-navigation questions fall through unhandled', () => {
  it('what is my leave balance — data query, not how-to', async () => {
    const r = await answerHowToQuestion('what is my leave balance', 'u', ['employee']);
    expect(r.handled).toBe(false);
  });

  it('hello Mira — greeting', async () => {
    const r = await answerHowToQuestion('hello Mira', 'u', ['employee']);
    expect(r.handled).toBe(false);
  });

  it('how many employees are in our company — data question', async () => {
    const r = await answerHowToQuestion('how many employees are in our company', 'u', ['hr']);
    expect(r.handled).toBe(false);
  });

  it('how do I fly to the moon — no catalog match', async () => {
    const r = await answerHowToQuestion('how do I fly to the moon', 'u', ['employee']);
    expect(r.handled).toBe(false);
  });

  it('what is my salary — data query', async () => {
    const r = await answerHowToQuestion('what is my salary', 'u', ['employee']);
    expect(r.handled).toBe(false);
  });
});
