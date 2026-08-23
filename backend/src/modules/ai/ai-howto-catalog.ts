/**
 * HRMS How-To Catalog — step-by-step navigation guidance for Mira.
 *
 * Answers "how do I do X in HRMS" with real steps and a real, RBAC-checked
 * deep link. Every entry is verified directly against the live route files
 * (src/config/routes/*.tsx) and role guards before being added.
 *
 * Two auth modes:
 * - `page_code`: gated by rbacPageMatrix.ts, checked live via getAccessMe().
 * - `static_roles`: no page_code; copies literal role list from the route guard,
 *   with a citation, checked via expandRoles() — same as requireRole() itself.
 *
 * `route` is always the router-authoritative path, never page_catalog.page_path.
 *
 * Covers all modules: Payroll, Leave, Attendance, WFM/Roster, ATS/Recruitment,
 * Employee Management, Exit, Performance/KPI, Quality, Operations, Finance/ERP,
 * Assets/Documents, Admin/Platform, Support, LMS. (2026-08-23 full sweep)
 */

export type HowToStatus = 'verified' | 'needs_verification';

export type HowToAuth =
  | { mode: 'page_code'; pageCode: string }
  | { mode: 'static_roles'; roles: string[]; citation: string };

export interface HowToEntry {
  code: string;
  title: string;
  /** Trigger phrases beyond the generic "how do i / how can i / how to / where do i" prefix. */
  aliases: RegExp[];
  steps: string[];
  route: string;
  auth: HowToAuth;
  status: HowToStatus;
  /** Shown instead of steps when the caller's role does not pass `auth`. */
  deniedExplanation: string;
}

export const HOWTO_CATALOG: HowToEntry[] = [
  {
    code: 'leave_apply',
    title: 'Apply for leave',
    // The bare /\bleave\s*request\b/i alias below is deliberately excluded
    // from matching when approve/reject/deny wording is also present.
    // "How can I approve my team member leave request?" matched it before
    // this fix — leave_apply is registered before leave_approve, and
    // Array.find() returns the first alias match, so a manager asking how
    // to approve leave got steps for applying for their own leave instead.
    // Same shadow-risk this file already calls out for resignation_raise
    // below; fixed the same way (tighten the generic alias), not by
    // reordering the array.
    aliases: [
      /\bapply\b.*\bleave\b/i,
      /\braise\b.*\bleave\b/i,
      /\btake\s*leave\b/i,
      /^(?!.*\b(?:approv|reject|deny|denying|denied)\w*\b).*\bleave\s*request\b/i,
    ],
    steps: [
      '1. Go to Leaves.',
      '2. Click "Apply for Leave".',
      '3. Pick the leave type, start and end dates, and add a reason.',
      '4. Submit — it goes to your reporting manager (or HR/admin) for approval.',
    ],
    route: '/leaves',
    // /leaves has no page_code in pageRoutePageCodes.ts (confirmed by grep) —
    // it is open to any authenticated employee (self-service + approval share
    // one page), matching the route's own gate (ProtectedRoute with no roles
    // prop, workforce.routes.tsx:74).
    auth: { mode: 'static_roles', roles: [], citation: 'src/config/routes/workforce.routes.tsx:74 (no roles prop — open to any authenticated employee)' },
    status: 'verified',
    deniedExplanation: 'Every employee can apply for their own leave.',
  },
  {
    code: 'leave_approve',
    title: 'Approve or reject a team leave request',
    aliases: [/\bapprove\b.*\bleave\b/i, /\breject\b.*\bleave\b/i, /\bleave\b.*\bapprov/i],
    steps: [
      '1. Go to Leaves.',
      '2. Pending requests from your team show Approve/Reject actions on each row.',
      '3. Review the request and click Approve or Reject.',
    ],
    route: '/leaves',
    auth: {
      mode: 'static_roles',
      roles: ['admin', 'hr', 'manager'],
      citation: 'backend/src/modules/leave/leave.routes.ts:155 (requireRole("admin","hr","manager") on PATCH /api/leave/requests/:id/review) + src/pages/Leaves.tsx canApproveLeaves check',
    },
    status: 'verified',
    deniedExplanation: 'Your role does not include leave approval — that is handled by your reporting manager, HR, or an admin.',
  },
  {
    code: 'payslip_download',
    title: 'Download your payslip',
    aliases: [/\bpayslip\b/i, /\bsalary\s*slip\b/i],
    steps: [
      '1. Go to Payroll → Payslips.',
      '2. Pick the month you need.',
      '3. Click Download to get the PDF.',
    ],
    route: '/payroll/payslips',
    auth: { mode: 'page_code', pageCode: 'PAYROLL_PAYSLIPS' }, // COMMON_USER_PAGE_CODES — every employee has this
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the payslip page.',
  },
  {
    code: 'reimbursement_raise',
    title: 'Raise a reimbursement claim',
    aliases: [/\b(raise|submit|file)\b.*\b(reimbursement|expense|claim)\b/i],
    steps: [
      '1. Go to Payroll → Reimbursements.',
      '2. Click "New Claim".',
      '3. Select the claim type, enter the amount and month, and attach any bills.',
      '4. Submit — it goes to your approver for review.',
    ],
    // '/expenses/new' is only a redirect shim to this canonical route.
    route: '/payroll/reimbursements',
    auth: { mode: 'page_code', pageCode: 'PAYROLL_REIMBURSEMENTS' }, // confirmed in employee role's grant list, rbacPageMatrix.ts
    status: 'verified',
    deniedExplanation: 'Your role does not have access to reimbursement claims.',
  },
  {
    code: 'reimbursement_approve',
    title: 'Approve a reimbursement claim',
    aliases: [/\bapprove\b.*\b(reimbursement|expense|claim)\b/i],
    steps: [
      '1. Go to Payroll → Reimbursements.',
      '2. Open the pending claim from your team.',
      '3. Review the amount and attachments, then Approve or Reject.',
    ],
    route: '/payroll/reimbursements',
    // '/expenses/approvals' is only a redirect shim to this same canonical
    // route — approval is gated narrower than the page-view grant.
    auth: {
      mode: 'static_roles',
      roles: ['admin', 'hr', 'payroll_head', 'finance', 'super_admin'],
      citation: 'backend/src/modules/payroll/reimbursements.routes.ts:73,91 (APPROVER_ROLES on the approval endpoint — note "manager" is NOT included here, unlike leave approval)',
    },
    status: 'verified',
    deniedExplanation: 'Your role does not include reimbursement approval — that is handled by HR, payroll, finance, or an admin (note: team managers do not approve reimbursements, unlike leave).',
  },
  {
    code: 'attendance_regularization',
    title: 'Request an attendance regularization',
    aliases: [/\bregulari[sz]/i, /\bfix\b.*\battendance\b/i, /\bcorrect\b.*\b(punch|attendance)\b/i],
    steps: [
      '1. Go to Attendance Regularization.',
      '2. Pick the date with the missing/incorrect punch.',
      '3. Enter the correct in/out time and a reason.',
      '4. Submit for your manager/HR to approve.',
    ],
    route: '/attendance-regularization',
    auth: { mode: 'page_code', pageCode: 'ATTENDANCE_REGULARIZATION' }, // COMMON_USER_PAGE_CODES
    status: 'verified',
    deniedExplanation: 'Your role does not have access to attendance regularization requests.',
  },
  {
    code: 'resignation_raise',
    title: 'Submit your resignation',
    // Deliberately no bare /resignation/i alias — that would also match
    // "how do I approve a resignation" and, since this entry appears earlier
    // in the array than resignation_approve, .find() would shadow it with
    // the wrong entry (verified live by a failing RBAC cross-check test
    // before this fix).
    aliases: [/\b(submit|raise|file)\b.*\bresign/i],
    steps: [
      '1. Go to Exit → My Resignation.',
      '2. Click "Submit Resignation".',
      '3. Enter your last working day and reason, then submit for approval.',
    ],
    route: '/exit/resignation',
    auth: { mode: 'page_code', pageCode: 'RESIGNATION_MY_REQUEST' }, // COMMON_USER_PAGE_CODES
    status: 'verified',
    deniedExplanation: 'Your role does not have access to submitting a resignation here.',
  },
  {
    code: 'resignation_approve',
    title: 'Approve a resignation',
    aliases: [/\bapprove\b.*\bresign/i],
    steps: [
      '1. Go to Exit → Resignation Command Center.',
      '2. Open the pending resignation from your team.',
      '3. Review and approve, or send it back with comments.',
    ],
    route: '/exit/resignation-command-center',
    auth: { mode: 'page_code', pageCode: 'RESIGNATION_COMMAND_CENTER' }, // hr, branch_hr roles (rbacPageMatrix.ts)
    status: 'verified',
    deniedExplanation: 'Your role does not include resignation approval — that is handled by HR.',
  },
  {
    code: 'team_roster_view',
    title: "View your team's roster",
    aliases: [/\broster\b/i, /\bteam\b.*\bschedule\b/i],
    steps: [
      '1. Go to My Team.',
      '2. The roster tab shows shifts, week-offs, and holidays for your team.',
    ],
    route: '/my-team',
    auth: { mode: 'page_code', pageCode: 'TEAM_ROSTER' }, // wfm, branch_wfm roles (rbacPageMatrix.ts)
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the team roster view.',
  },
  {
    code: 'tax_declaration_submit',
    title: 'Submit your tax declaration',
    aliases: [/\btax\s*declaration\b/i, /\b(80c|hra|section\s*80)\b/i],
    steps: [
      '1. Go to Payroll → Tax Declaration.',
      '2. Enter your investment declarations and HRA/exemption details.',
      '3. Submit for the current financial year.',
    ],
    route: '/payroll/tax-declaration',
    auth: { mode: 'page_code', pageCode: 'TAX_DECLARATION' }, // COMMON_USER_PAGE_CODES — every employee
    status: 'verified',
    deniedExplanation: 'Your role does not have access to tax declaration.',
  },
  {
    code: 'lms_access',
    title: 'Access your training',
    aliases: [/\b(lms|training|course|learning)\b/i],
    steps: [
      '1. Go to Learning → My Learning.',
      '2. Your assigned courses, modules and progress are shown there.',
    ],
    route: '/lms/my-learning',
    // NativeLMSMyLearning.tsx is a wrapper (<LmsPortalFrame portal="trainee" />)
    // embedding the externally-deployed LMS — per CLAUDE.md's LMS Integration
    // Rule, HRMS integrates, does not rebuild, LMS operations. Phrased as
    // "access", not "enroll" — enrollment happens inside the external system.
    auth: { mode: 'page_code', pageCode: 'LMS_MY_LEARNING' }, // COMMON_USER_PAGE_CODES
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the LMS learning page.',
  },
  {
    code: 'ijp_apply',
    title: 'Apply to an internal job posting',
    aliases: [/\b(ijp|internal job|internal opening|internal vacanc)/i],
    steps: [
      '1. Go to People → Internal Job Postings.',
      '2. Browse open internal roles and click Apply on the one you want.',
    ],
    route: '/people/ijp',
    // Structurally different from every other page_code entry here:
    // 'ijp_opportunities' is absent from rbacPageMatrix.ts entirely (grepped,
    // zero hits) — the real grant is a DB-seeded role_page_access row
    // (backend/sql/570_ijp_module.sql:176-181, roles employee/team_leader/tl/
    // trainer/qa, can_view=1), read live via the same getAccessMe() call every
    // page_code entry already uses. Also: page_catalog's own seed row for this
    // code (570_ijp_module.sql:161) has page_path = '/ijp/opportunities' —
    // NOT the real mounted route. The route above is the router-authoritative
    // path (src/config/routes/people.routes.tsx:124), confirmed directly
    // against the actual <Route>, not copied from page_catalog — this is
    // exactly the class of drift the route-drift guard test exists to catch.
    // Excluded from the generic rbacPageMatrix cross-check sweep in
    // ai-howto.service.test.ts for the same reason — it has its own dedicated
    // test block instead, citing this migration as the source of truth.
    auth: { mode: 'page_code', pageCode: 'ijp_opportunities' },
    status: 'verified',
    deniedExplanation: 'Internal job postings are not currently available for your role.',
  },

  // ─── PAYROLL — LOANS ────────────────────────────────────────────────────────
  {
    code: 'loan_apply',
    title: 'Apply for a salary loan or advance',
    aliases: [/\b(apply|request|take)\b.*\b(loan|advance|salary advance)\b/i, /\b(loan|salary advance)\b.*\b(apply|request|how)\b/i],
    steps: [
      '1. Go to Payroll → Loans.',
      '2. Click "New Loan Request".',
      '3. Select the loan type, enter the amount and preferred repayment months.',
      '4. Submit — it goes to Payroll/Finance for approval.',
    ],
    route: '/payroll/loans',
    auth: { mode: 'static_roles', roles: ['super_admin', 'payroll_head', 'finance', 'admin', 'hr', 'employee'], citation: 'src/config/routes/payroll.routes.tsx (ProtectedRoute roles on /payroll/loans)' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the Loans page. Only employees, HR, Finance, Payroll Head and Admins can access it.',
  },
  {
    code: 'loan_view_status',
    title: 'Check loan or advance status',
    aliases: [/\b(check|view|see|track)\b.*\b(loan|advance)\b.*\b(status|balance|outstanding|emi)\b/i, /\bloan\s*(status|balance|emi)\b/i],
    steps: [
      '1. Go to Payroll → Loans.',
      '2. Your active loans and EMI schedule are listed there.',
      '3. Click any loan to see the full repayment schedule and outstanding balance.',
    ],
    route: '/payroll/loans',
    auth: { mode: 'static_roles', roles: ['super_admin', 'payroll_head', 'finance', 'admin', 'hr', 'employee'], citation: 'src/config/routes/payroll.routes.tsx (ProtectedRoute roles on /payroll/loans)' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the Loans page.',
  },

  // ─── PAYROLL — SALARY DISPUTE ───────────────────────────────────────────────
  {
    code: 'salary_dispute_raise',
    title: 'Raise a salary dispute',
    aliases: [/\b(raise|report|flag|dispute)\b.*\b(salary|pay|payroll)\b.*\b(wrong|issue|discrepancy|dispute|error)\b/i, /\bsalary\s*dispute\b/i, /\bwrong\s*salary\b/i, /\bsalary\s*(wrong|incorrect|missing)\b/i],
    steps: [
      '1. Go to Payroll → Salary Disputes.',
      '2. Click "Raise New Dispute".',
      '3. Describe the discrepancy — month, expected vs actual amount.',
      '4. Submit — it goes to the payroll team for review.',
    ],
    route: '/payroll/salary-disputes',
    auth: { mode: 'static_roles', roles: ['employee', 'super_admin', 'admin', 'hr', 'hr_admin'], citation: 'src/config/routes/payroll.routes.tsx (ProtectedRoute roles on /payroll/salary-disputes)' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to raise salary disputes. This is available to employees and HR/Admin.',
  },

  // ─── PAYROLL — INCENTIVES ────────────────────────────────────────────────────
  {
    code: 'incentive_upload',
    title: 'Upload or manage employee incentives',
    aliases: [/\b(upload|bulk\s*upload|add|enter)\b.*\bincentive\b/i, /\bincentive\b.*\b(upload|bulk|manage|add)\b/i, /\bhow.*incentive.*employee\b/i, /\bbulk.*incentive\b/i],
    steps: [
      '1. Go to Payroll → Incentives.',
      '2. Click "Upload Incentives" or "Add Incentive" for individual entries.',
      '3. For bulk upload: download the template, fill in employee codes and amounts, and upload the sheet.',
      '4. Review the preview and confirm to apply for the selected payroll month.',
    ],
    route: '/payroll/incentives',
    auth: { mode: 'page_code', pageCode: 'PAYROLL_INCENTIVES' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the Incentives page. Contact your payroll administrator.',
  },

  // ─── PAYROLL — OVERTIME ─────────────────────────────────────────────────────
  {
    code: 'overtime_manage',
    title: 'Manage or approve overtime',
    aliases: [/\bovertime\b/i, /\b\bot\b.*\b(approve|manage|upload|entry)\b/i],
    steps: [
      '1. Go to Payroll → Overtime.',
      '2. View pending OT requests from your team or upload OT hours in bulk.',
      '3. Approve or reject individual entries.',
    ],
    route: '/payroll/overtime',
    auth: { mode: 'static_roles', roles: ['admin', 'super_admin', 'wfm', 'payroll', 'payroll_head'], citation: 'src/config/routes/payroll.routes.tsx (ProtectedRoute roles on /payroll/overtime)' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Overtime management. Access is for WFM, Payroll, and Admins.',
  },

  // ─── PAYROLL — SALARY CERTIFICATE ───────────────────────────────────────────
  {
    code: 'salary_certificate',
    title: 'Get a salary or employment certificate',
    aliases: [/\b(salary|employment)\s*certificate\b/i, /\bcertificate\b.*\b(salary|employment|income)\b/i],
    steps: [
      '1. Go to Payroll → Salary Certificates.',
      '2. Select the certificate type (salary / employment / experience).',
      '3. Choose the period, click Generate and download the PDF.',
    ],
    route: '/payroll/salary-certificates',
    auth: { mode: 'static_roles', roles: ['super_admin', 'payroll_head', 'finance', 'admin', 'hr', 'employee'], citation: 'src/config/routes/payroll.routes.tsx (ProtectedRoute roles on /payroll/salary-certificates)' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Salary Certificates.',
  },

  // ─── PAYROLL — FULL & FINAL ─────────────────────────────────────────────────
  {
    code: 'full_final',
    title: 'Process full and final settlement',
    aliases: [/\bfull\s*(and|&)\s*final\b/i, /\bf&f\b/i, /\bfnf\b/i, /\bfinal\s*settlement\b/i, /\bfull\s*final\s*settlement\b/i],
    steps: [
      '1. Go to Payroll → Full & Final.',
      '2. Search for the exiting employee.',
      '3. Review and enter gratuity, leave encashment, notice recovery, and advances.',
      '4. Confirm and submit for approval.',
    ],
    route: '/payroll/full-final',
    auth: { mode: 'page_code', pageCode: 'FULL_FINAL' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Full & Final Settlement. This is handled by Payroll/HR/Finance.',
  },

  // ─── PAYROLL — BULK UPLOAD ───────────────────────────────────────────────────
  {
    code: 'bulk_upload',
    title: 'Bulk upload employee data',
    aliases: [/\bbulk\s*(upload|import)\b/i, /\bupload\b.*\b(employee|salary|attendance)\b.*\bbulk\b/i],
    steps: [
      '1. Go to Bulk Upload (from the main menu or Admin section).',
      '2. Select the data type — employees, salary, attendance, incentives, etc.',
      '3. Download the template, fill it in, and upload.',
      '4. Review the validation summary and confirm.',
    ],
    route: '/bulk-upload',
    auth: { mode: 'static_roles', roles: ['admin', 'hr', 'super_admin', 'wfm', 'payroll', 'payroll_hr'], citation: 'src/config/routes/platform.routes.tsx (ProtectedRoute roles on /bulk-upload)' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Bulk Upload. Contact HR, Payroll, or an Admin.',
  },

  // ─── PAYROLL — PAYMENT CENTER ────────────────────────────────────────────────
  {
    code: 'bank_payment_readiness',
    title: 'Check bank account readiness and generate payment file',
    aliases: [/\bbank\s*(file|readiness|payment)\b/i, /\bneft\b.*\bfile\b/i, /\b(generate|create)\b.*\bpayment\s*file\b/i, /\bdisburs/i],
    steps: [
      '1. Go to Payroll → Payment Center.',
      '2. The Bank tab shows employee bank account validation status.',
      '3. Fix any failed accounts, then switch to the Disbursal tab.',
      '4. Generate the NEFT/bank file for the selected payroll month.',
    ],
    route: '/payroll/payment-center',
    auth: { mode: 'static_roles', roles: ['super_admin', 'admin', 'payroll_head', 'payroll', 'finance', 'finance_head', 'hr', 'branch_head'], citation: 'src/config/routes/payroll.routes.tsx (ProtectedRoute roles on /payroll/payment-center)' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the Payment Center. This is for Payroll Head, Finance, and Admins.',
  },

  // ─── PAYROLL — READINESS ─────────────────────────────────────────────────────
  {
    code: 'payroll_readiness',
    title: 'Check payroll readiness status',
    aliases: [/\bpayroll\s*readiness\b/i, /\b(branch|process)\b.*\breadiness\b/i, /\breadiness\b.*\bpayroll\b/i, /\b(attendance lock|leave finali)\b/i],
    steps: [
      '1. Go to Payroll → Readiness Dashboard.',
      '2. Select Branch or Process view to check attendance lock, leave finalization, and regularization status.',
      '3. Green = ready, Amber/Red = items still pending before payroll can run.',
    ],
    route: '/payroll/readiness',
    auth: { mode: 'static_roles', roles: ['super_admin', 'payroll_head', 'branch_head', 'payroll_branch', 'admin', 'hr', 'finance', 'payroll', 'process_manager', 'wfm'], citation: 'src/config/routes/payroll.routes.tsx (ProtectedRoute roles on /payroll/readiness)' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Payroll Readiness Dashboard.',
  },

  // ─── PAYROLL — STATUTORY CENTER ──────────────────────────────────────────────
  {
    code: 'statutory_filing',
    title: 'Track PF, ESI, PT or TDS statutory filing',
    aliases: [/\b(pf|esi|pt|tds)\b.*\b(filing|status|due|compliance)\b/i, /\bstatutory\s*(filing|compliance)\b/i, /\bchallan\b/i],
    steps: [
      '1. Go to Payroll → Statutory Center.',
      '2. The Filing tab shows PF/ESI/PT/TDS filing status, due dates, and outstanding amounts.',
      '3. Click any row to see details or download the challan.',
      '4. Switch to the Config tab (Super Admin only) to update statutory rates.',
    ],
    route: '/payroll/statutory',
    auth: { mode: 'static_roles', roles: ['super_admin', 'payroll_head', 'finance', 'admin'], citation: 'src/config/routes/payroll.routes.tsx (ProtectedRoute roles on /payroll/statutory)' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the Statutory Center. This is for Super Admin, Payroll Head, Finance, and Admin.',
  },

  // ─── PAYROLL — SALARY PACKAGES ───────────────────────────────────────────────
  {
    code: 'salary_package_view',
    title: 'View or assign salary packages',
    aliases: [/\bsalary\s*package\b/i, /\bctc\s*(structure|package|breakdown)\b/i, /\b(assign|view|edit)\b.*\bsalary\s*(structure|package)\b/i],
    steps: [
      '1. Go to Payroll → Salary Packages.',
      '2. Search for an employee to view their current CTC and salary structure breakdown.',
      '3. To assign or change a package, use the Admin tab (Payroll Head/Admin only).',
    ],
    route: '/payroll/salary-packages',
    auth: { mode: 'page_code', pageCode: 'SALARY_PACKAGES' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Salary Packages.',
  },

  // ─── ATTENDANCE ──────────────────────────────────────────────────────────────
  {
    code: 'attendance_view',
    title: 'View your attendance',
    aliases: [/\b(view|check|see|my)\b.*\battendance\b/i, /\battendance\b.*\b(history|record|log)\b/i],
    steps: [
      '1. Go to Attendance.',
      '2. Your monthly attendance calendar is shown with present, absent, half-day, and leave markers.',
      '3. Click any date to see the exact in/out punch times.',
    ],
    route: '/attendance',
    auth: { mode: 'static_roles', roles: [], citation: 'src/config/routes/workforce.routes.tsx (ProtectedRoute with no roles — any authenticated employee)' },
    status: 'verified',
    deniedExplanation: 'Every employee can view their own attendance.',
  },
  {
    code: 'attendance_dispute',
    title: 'Raise an attendance dispute',
    aliases: [/\battendance\s*dispute\b/i, /\bwrong\s*attendance\b/i, /\bmark\s*absent\s*wrong/i],
    steps: [
      '1. Go to Attendance → Disputes.',
      '2. Click "Raise Dispute" for the date in question.',
      '3. Select the correct status and add a reason.',
      '4. Submit for HR/Manager review.',
    ],
    route: '/attendance/disputes',
    auth: { mode: 'page_code', pageCode: 'ATTENDANCE_DISPUTES' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Attendance Disputes.',
  },

  // ─── LEAVE — BALANCE ─────────────────────────────────────────────────────────
  {
    code: 'leave_balance_check',
    title: 'Check your leave balance',
    aliases: [/\bleave\s*balance\b/i, /\bhow\s*many\s*(days|leave)\b/i, /\b(remaining|available)\s*(leave|days)\b/i],
    steps: [
      '1. Go to Leaves.',
      '2. Your leave balance for all leave types (CL, EL, ML, LWP, etc.) is shown at the top of the page.',
    ],
    route: '/leaves',
    auth: { mode: 'static_roles', roles: [], citation: 'src/config/routes/workforce.routes.tsx:74 (open to any authenticated employee)' },
    status: 'verified',
    deniedExplanation: 'Every employee can check their own leave balance.',
  },

  // ─── WFM / ROSTER ────────────────────────────────────────────────────────────
  {
    code: 'roster_manage',
    title: 'View or manage the roster',
    aliases: [/\b(view|manage|publish|create|edit)\b.*\broster\b/i, /\broster\b.*\b(view|manage|publish)\b/i],
    steps: [
      '1. Go to WFM → Roster.',
      '2. Select the branch, process, and week to view or edit shifts.',
      '3. Drag-and-drop to change shifts or use Bulk Assign for the whole team.',
      '4. Click Publish when the roster is ready — employees will be notified.',
    ],
    route: '/wfm/roster',
    auth: { mode: 'page_code', pageCode: 'WFM_ROSTER' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the Roster page. This is for WFM, Process Managers, and Branch Heads.',
  },
  {
    code: 'my_roster_view',
    title: 'View my own shift schedule',
    aliases: [/\bmy\s*roster\b/i, /\bmy\s*(shift|schedule)\b/i, /\b(when|what)\b.*\b(shift|my roster|my schedule)\b/i],
    steps: [
      '1. Go to My Roster.',
      '2. Your upcoming shifts, week-offs, and holidays for the month are displayed.',
    ],
    route: '/my-roster',
    auth: { mode: 'static_roles', roles: [], citation: 'src/config/routes/workforce.routes.tsx (ProtectedRoute with no roles on /my-roster — any employee)' },
    status: 'verified',
    deniedExplanation: 'Every employee can view their own roster.',
  },
  {
    code: 'roster_preference',
    title: 'Submit shift or roster preferences',
    aliases: [/\broster\s*preference\b/i, /\bshift\s*preference\b/i, /\b(preferred|request)\b.*\b(shift|roster)\b/i],
    steps: [
      '1. Go to Roster Preference.',
      '2. Select your preferred shifts and week-off days.',
      '3. Submit — WFM will consider your preferences during roster creation.',
    ],
    route: '/roster-preference',
    auth: { mode: 'page_code', pageCode: 'WFM_ROSTER' },
    status: 'verified',
    deniedExplanation: 'You do not have access to submit roster preferences.',
  },
  {
    code: 'wfm_live_tracker',
    title: 'View live attendance and biometric status',
    aliases: [/\blive\s*(tracker|attendance|biometric)\b/i, /\bbiometric\s*(live|status|command)\b/i, /\bwho\s*is\s*(present|in)\b/i, /\blive\s*status\b/i],
    steps: [
      '1. Go to WFM → Live Tracker.',
      '2. See real-time punch-in/out status by branch and process.',
      '3. Use filters to drill down by shift, process, or individual employee.',
    ],
    route: '/wfm/live-tracker',
    auth: { mode: 'page_code', pageCode: 'WFM_LIVE_TRACKER' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the Live Tracker. This is for WFM and Branch Heads.',
  },

  // ─── ATS / RECRUITMENT ───────────────────────────────────────────────────────
  {
    code: 'ats_command_center',
    title: 'Access the ATS / Recruitment Command Center',
    aliases: [/\b(ats|recruitment)\b.*\b(dashboard|command|center|overview)\b/i, /\brecruitment\s*(pipeline|overview)\b/i],
    steps: [
      '1. Go to ATS → Command Center.',
      '2. See the full hiring pipeline — sourced, screened, interviewed, offered, joined.',
      '3. Click any stage to drill into candidate cards.',
    ],
    route: '/ats/command-center',
    auth: { mode: 'page_code', pageCode: 'ATS_DASHBOARD' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the ATS Command Center.',
  },
  {
    code: 'job_requisition',
    title: 'Raise a job requisition or hiring demand',
    aliases: [/\b(raise|create|add)\b.*\b(job\s*requisition|jr|hiring\s*demand|vacancy)\b/i, /\bjob\s*requisition\b/i, /\bhiring\s*demand\b/i],
    steps: [
      '1. Go to Recruitment → Job Requisition.',
      '2. Click "New Requisition".',
      '3. Fill in role, count, branch, process, target date, and justification.',
      '4. Submit for approval by the Branch Head.',
    ],
    route: '/recruitment/job-requisition',
    auth: { mode: 'page_code', pageCode: 'JOB_REQUISITION' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Job Requisitions.',
  },
  {
    code: 'candidate_registration',
    title: 'Register a new candidate for walk-in or interview',
    aliases: [/\bregister\b.*\bcandidate\b/i, /\bcandidate\s*registration\b/i, /\bwalk.?in\b.*\bregister\b/i],
    steps: [
      '1. Go to ATS → Walk-in Queue.',
      '2. Click "Register Candidate".',
      '3. Fill in name, phone, source, and role applied for.',
      '4. The candidate enters the pipeline at the screening stage.',
    ],
    route: '/ats/walkin-queue',
    auth: { mode: 'page_code', pageCode: 'ATS_WALKIN_QUEUE' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the Walk-in Queue.',
  },
  {
    code: 'offer_letter_generate',
    title: 'Generate an offer letter',
    aliases: [/\boffer\s*letter\b/i, /\b(generate|create|issue)\b.*\boffer\b/i],
    steps: [
      '1. Go to Offer Letter (from ATS menu).',
      '2. Search for the candidate.',
      '3. Fill in CTC, joining date, and role details.',
      '4. Preview and generate the offer letter PDF.',
    ],
    route: '/offer-letter',
    auth: { mode: 'page_code', pageCode: 'ATS_OFFER' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Offer Letter generation.',
  },
  {
    code: 'bgv_check',
    title: 'Run or check background verification (BGV)',
    aliases: [/\bbgv\b/i, /\bbackground\s*(check|verification)\b/i],
    steps: [
      '1. Go to ATS → BGV Verification Center.',
      '2. Search for a candidate or new joinee.',
      '3. Initiate BGV or check the status of an in-progress verification.',
    ],
    route: '/ats/bgv',
    auth: { mode: 'page_code', pageCode: 'ATS_BGV' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to BGV management.',
  },
  {
    code: 'onboarding_requests',
    title: 'Review onboarding requests for new joiners',
    aliases: [/\bonboarding\s*request\b/i, /\bnew\s*joiner\b.*\bonboard/i, /\bjoining\s*document\b/i],
    steps: [
      '1. Go to ATS → Onboarding Requests.',
      '2. See all candidates who have accepted offers and are pending document collection and system activation.',
      '3. Review documents, approve, or push back to the candidate.',
    ],
    route: '/ats/onboarding-requests',
    auth: { mode: 'page_code', pageCode: 'ATS_ONBOARDING_REQUESTS' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Onboarding Requests.',
  },

  // ─── EMPLOYEE MANAGEMENT ─────────────────────────────────────────────────────
  {
    code: 'employee_list',
    title: 'View the employee directory',
    aliases: [/\b(employee\s*list|employee\s*directory|all\s*employees)\b/i, /\b(search|find)\b.*\bemployee\b/i],
    steps: [
      '1. Go to Employees.',
      '2. Search by name, code, branch, or process.',
      '3. Click any employee card to see their full profile.',
    ],
    route: '/employees',
    auth: { mode: 'page_code', pageCode: 'EMPLOYEE_MANAGEMENT' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the Employee Directory.',
  },
  {
    code: 'employee_profile',
    title: 'View your own profile',
    aliases: [/\bmy\s*profile\b/i, /\b(view|edit|update)\b.*\b(my\s*)?(profile|personal\s*details)\b/i],
    steps: [
      '1. Click your avatar at the top right and select My Profile, or go to Profile.',
      '2. Update personal details, bank account, emergency contact, and documents from there.',
    ],
    route: '/profile',
    auth: { mode: 'page_code', pageCode: 'MY_PROFILE' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the Profile page.',
  },
  {
    code: 'org_chart',
    title: 'View the organisation chart',
    aliases: [/\borg\s*chart\b/i, /\borganisation\s*(chart|tree|structure)\b/i, /\breporting\s*hierarchy\b/i],
    steps: [
      '1. Go to Org Chart.',
      '2. The hierarchy is displayed from CEO down to employees.',
      '3. Click any node to expand and see their team.',
    ],
    route: '/org-chart',
    auth: { mode: 'page_code', pageCode: 'ORG_CHART' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the Org Chart.',
  },
  {
    code: 'employee_lifecycle',
    title: 'Manage employee lifecycle — confirmation, promotion, transfer',
    aliases: [/\b(confirmation|probation|promote|promotion|transfer)\b.*\bemployee\b/i, /\bemployee\s*lifecycle\b/i],
    steps: [
      '1. Go to Employee Lifecycle.',
      '2. See employees due for confirmation, upcoming promotions, and pending transfers.',
      '3. Take actions — confirm, promote, or initiate a transfer.',
    ],
    route: '/employee-lifecycle',
    auth: { mode: 'page_code', pageCode: 'EMPLOYEE_LIFECYCLE' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Employee Lifecycle management.',
  },

  // ─── EXIT MANAGEMENT ─────────────────────────────────────────────────────────
  {
    code: 'exit_management',
    title: 'Manage exit requests and resignation approvals',
    aliases: [/\bexit\s*(management|request|command)\b/i, /\b(manage|view)\b.*\b(resignation|exit)\b.*\b(list|request|all)\b/i],
    steps: [
      '1. Go to Exit Management.',
      '2. See all exit requests — submitted, under manager review, accepted, notice serving.',
      '3. Click any request to take action — accept, manage clearance, process F&F.',
    ],
    route: '/exit-management',
    auth: { mode: 'page_code', pageCode: 'EXIT_COMMAND_CENTER' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Exit Management.',
  },
  {
    code: 'resignation_revoke',
    title: 'Revoke or cancel a resignation',
    aliases: [/\b(revoke|cancel|withdraw|take\s*back)\b.*\bresign/i],
    steps: [
      '1. Go to Exit → My Resignation.',
      '2. Your active resignation is shown. Click "Revoke" or "Withdraw".',
      '3. Add a reason (optional) and confirm — you return to active status.',
    ],
    route: '/exit/resignation',
    auth: { mode: 'page_code', pageCode: 'RESIGNATION_MY_REQUEST' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the My Resignation page.',
  },

  // ─── PERFORMANCE / KPI ───────────────────────────────────────────────────────
  {
    code: 'my_kpi',
    title: 'View my KPI performance',
    aliases: [/\bmy\s*kpi\b/i, /\bkpi\b.*\b(my|score|performance|target)\b/i],
    steps: [
      '1. Go to My KPI.',
      '2. Your daily/weekly/monthly KPI scores and targets are shown.',
      '3. Compare actual vs target and see trend charts.',
    ],
    route: '/my-kpi',
    auth: { mode: 'page_code', pageCode: 'MY_KPI' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the My KPI page.',
  },
  {
    code: 'performance_feedback',
    title: 'Submit or view performance feedback / appraisal',
    aliases: [/\bperformance\s*(feedback|review|appraisal)\b/i, /\b(submit|give|view)\b.*\b(feedback|appraisal)\b/i],
    steps: [
      '1. Go to Performance → My Reports.',
      '2. Open the active feedback form for the current cycle.',
      '3. Rate and comment on each KPI/competency, then submit.',
    ],
    route: '/performance-feedback/my-reports',
    auth: { mode: 'static_roles', roles: [], citation: 'src/config/routes/performance.routes.tsx (ProtectedRoute with no roles — any authenticated employee)' },
    status: 'verified',
    deniedExplanation: 'Every employee can access performance feedback.',
  },
  {
    code: 'pip_management',
    title: 'Create or manage a Performance Improvement Plan (PIP)',
    aliases: [/\bpip\b/i, /\bperformance\s*improvement\s*plan\b/i],
    steps: [
      '1. Go to PIP Management.',
      '2. Create or view active PIPs for your team members.',
      '3. Track weekly milestones and update the outcome.',
    ],
    route: '/pip-management',
    auth: { mode: 'static_roles', roles: ['admin', 'hr', 'super_admin', 'manager'], citation: 'src/config/routes/performance.routes.tsx (ProtectedRoute roles on /pip-management)' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to PIP Management. This is for Managers, HR, and Admin.',
  },

  // ─── QUALITY ─────────────────────────────────────────────────────────────────
  {
    code: 'quality_dashboard',
    title: 'View the quality dashboard',
    aliases: [/\bquality\s*(dashboard|score|audit)\b/i, /\bqa\s*(dashboard|score)\b/i],
    steps: [
      '1. Go to Quality Dashboard.',
      '2. See audit scores by agent, process, and date range.',
      '3. Drill down into individual audit forms and scores.',
    ],
    route: '/quality-dashboard',
    auth: { mode: 'page_code', pageCode: 'QUALITY_DASHBOARD' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the Quality Dashboard.',
  },
  {
    code: 'qa_file_audit',
    title: 'Conduct a QA file or call audit',
    aliases: [/\b(file|call)\s*audit\b/i, /\bconduct\b.*\b(audit|qa)\b/i, /\bqa\s*file\b/i],
    steps: [
      '1. Go to Quality → File Audit.',
      '2. Select the agent and the call/file to audit.',
      '3. Fill in the QA form scores and comments, then submit.',
    ],
    route: '/quality/file-audit',
    auth: { mode: 'static_roles', roles: ['super_admin', 'admin', 'qa', 'quality_analyst', 'tq_head'], citation: 'src/config/routes/performance.routes.tsx (ProtectedRoute roles on /quality/file-audit)' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to QA File Audit. This is for QA Analysts and QA Heads.',
  },

  // ─── OPERATIONS ──────────────────────────────────────────────────────────────
  {
    code: 'call_master',
    title: 'View Call Master or operations performance data',
    aliases: [/\bcall\s*master\b/i, /\b(inbound|outbound)\s*(call|report|data)\b/i, /\boperations\s*(dashboard|data|performance|report)\b/i],
    steps: [
      '1. Go to Call Master.',
      '2. See real-time and historical call data by process, campaign, and agent.',
      '3. Use Call Master → Inbound for inbound-specific metrics.',
    ],
    route: '/call-master',
    auth: { mode: 'static_roles', roles: ['super_admin', 'admin', 'ceo', 'manager', 'process_manager', 'operations_manager', 'qa', 'quality_analyst'], citation: 'src/config/routes/performance.routes.tsx (ProtectedRoute roles on /call-master)' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Call Master. This is for Managers, Operations, QA, and above.',
  },

  // ─── FINANCE / ERP ───────────────────────────────────────────────────────────
  {
    code: 'grn_management',
    title: 'Manage GRN (Goods Receipt Notes)',
    aliases: [/\bgrn\b/i, /\bgoods\s*receipt\b/i, /\bpurchase\s*receipt\b/i],
    steps: [
      '1. Go to Finance → GRN.',
      '2. Create a new GRN against a purchase order, or view existing GRNs.',
      '3. Attach the invoice and confirm receipt.',
    ],
    route: '/finance/grn',
    auth: { mode: 'page_code', pageCode: 'FINANCE_GRN' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to GRN Management.',
  },
  {
    code: 'branch_budget',
    title: 'View or manage branch budget',
    aliases: [/\bbranch\s*budget\b/i, /\bbudget\b.*\b(branch|monthly|annual)\b/i, /\bopex\b/i],
    steps: [
      '1. Go to Finance → Branch Budget.',
      '2. Select the branch and month to view actual vs budgeted spend.',
      '3. Admins and Finance Heads can update budget figures from here.',
    ],
    route: '/finance/branch-budget',
    auth: { mode: 'static_roles', roles: ['super_admin', 'admin', 'branch_admin', 'branch_head', 'finance', 'finance_head', 'accounts_head'], citation: 'src/config/routes/finance.routes.tsx (ProtectedRoute roles on /finance/branch-budget)' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Branch Budget. This is for Branch Heads, Finance, and Admins.',
  },
  {
    code: 'vendor_management',
    title: 'Manage vendors',
    aliases: [/\bvendor\b.*\b(manage|add|list|view|onboard)\b/i, /\b(add|create|view|onboard)\b.*\bvendor\b/i],
    steps: [
      '1. Go to Vendors.',
      '2. View the vendor directory or click "Add Vendor" to onboard a new vendor.',
      '3. Attach required documents (PAN, GST, bank) and save.',
    ],
    route: '/vendors',
    auth: { mode: 'static_roles', roles: ['admin', 'super_admin', 'finance', 'manager'], citation: 'src/config/routes/finance.routes.tsx (ProtectedRoute roles on /vendors)' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Vendor Management.',
  },
  {
    code: 'process_pnl',
    title: 'View process P&L (Profit & Loss)',
    aliases: [/\bp&l\b/i, /\bpnl\b/i, /\bprofit\s*(and|&)?\s*loss\b/i, /\bprocess\s*profitability\b/i],
    steps: [
      '1. Go to Finance → Process P&L.',
      '2. Select a process to see revenue, cost, and margin breakdown.',
      '3. Drill down by LOB or period for more detail.',
    ],
    route: '/finance/process-pnl',
    auth: { mode: 'page_code', pageCode: 'FINANCE_PROCESS_PNL' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Process P&L. This is restricted to Finance, CEO, and Senior Management.',
  },
  {
    code: 'client_billing',
    title: 'Manage client billing and invoicing',
    aliases: [/\bclient\s*billing\b/i, /\b(invoice|bill)\b.*\bclient\b/i, /\bclient\s*invoice\b/i],
    steps: [
      '1. Go to Finance → Client Billing.',
      '2. Select the client and billing period.',
      '3. Review headcount, billing rates, and generate the invoice.',
    ],
    route: '/finance/client-billing',
    auth: { mode: 'page_code', pageCode: 'FINANCE_CLIENT_BILLING' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Client Billing.',
  },

  // ─── ASSETS / DOCUMENTS ──────────────────────────────────────────────────────
  {
    code: 'assets_view',
    title: 'View or manage company assets',
    aliases: [/\b(view|manage|check)\b.*\basset\b/i, /\basset\b.*\b(list|assigned|return)\b/i, /\bmy\s*assets\b/i, /\blaptop|headset|id\s*card\b/i],
    steps: [
      '1. Go to Assets Manager.',
      '2. See all assets assigned to you or your team.',
      '3. Raise a return request or report an issue from here.',
    ],
    route: '/assets-manager',
    auth: { mode: 'page_code', pageCode: 'ASSETS_MANAGER' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Asset Management.',
  },
  {
    code: 'letters_generate',
    title: 'Generate or view official HR letters',
    aliases: [/\b(generate|create|view|issue)\b.*\bletter\b/i, /\bappointment\s*letter\b/i, /\bexperience\s*letter\b/i, /\bincrement\s*letter\b/i],
    steps: [
      '1. Go to Letters.',
      '2. Select the letter type (appointment, increment, experience, warning, etc.).',
      '3. Fill in the employee and details, preview, and generate the signed PDF.',
    ],
    route: '/letters',
    auth: { mode: 'page_code', pageCode: 'LETTERS' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to letter generation.',
  },

  // ─── ADMIN / PLATFORM ────────────────────────────────────────────────────────
  {
    code: 'audit_log',
    title: 'View system audit log',
    aliases: [/\baudit\s*log\b/i, /\bwho\s*(changed|modified|deleted)\b/i, /\bsystem\s*(log|activity)\b/i],
    steps: [
      '1. Go to Audit Log.',
      '2. Filter by module, user, date range, or action type.',
      '3. Each row shows what was changed, by whom, and when.',
    ],
    route: '/audit-log',
    auth: { mode: 'static_roles', roles: ['admin', 'super_admin', 'hr', 'payroll_head', 'wfm'], citation: 'src/config/routes/platform.routes.tsx (ProtectedRoute roles on /audit-log)' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the Audit Log.',
  },
  {
    code: 'access_control',
    title: 'Manage user roles and page access',
    aliases: [/\b(role|access|permission)\b.*\b(manage|assign|change|control)\b/i, /\b(grant|revoke)\b.*\baccess\b/i, /\baccess\s*control\b/i, /\buser\s*role\b/i],
    steps: [
      '1. Go to Settings → Access Control.',
      '2. Search for a user and assign or remove roles.',
      '3. For page-level gating, go to Super Admin → Page Access.',
    ],
    route: '/settings/access-control',
    auth: { mode: 'page_code', pageCode: 'ACCESS_CONTROL' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Access Control. Contact your Super Admin.',
  },
  {
    code: 'org_masters',
    title: 'Manage organisation masters — branches, processes, designations',
    aliases: [/\borg\s*master\b/i, /\b(branch|process|designation|department)\b.*\b(master|config|add|create)\b/i, /\badd\s*(new\s*)?(branch|process|designation)\b/i],
    steps: [
      '1. Go to Org Masters.',
      '2. Navigate to the relevant section: Branch, Process, Designation, Department, etc.',
      '3. Add, edit, or deactivate records.',
    ],
    route: '/org-masters',
    auth: { mode: 'page_code', pageCode: 'ORG_MASTERS' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Org Masters.',
  },
  {
    code: 'integration_hub',
    title: 'Manage integrations and data sync',
    aliases: [/\bintegration\s*hub\b/i, /\b(sync|connect|integration)\b.*\b(biometric|source|external)\b/i, /\bbiometric\s*sync\b/i],
    steps: [
      '1. Go to Integration Hub.',
      '2. See all connected systems (biometric, Call Master, LMS, etc.).',
      '3. Trigger a manual sync or check sync error logs.',
    ],
    route: '/integration-hub',
    auth: { mode: 'page_code', pageCode: 'INTEGRATION_HUB' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the Integration Hub.',
  },

  // ─── SUPPORT / HELPDESK ──────────────────────────────────────────────────────
  {
    code: 'helpdesk',
    title: 'Raise a helpdesk ticket or browse the knowledge base',
    aliases: [/\b(helpdesk|help\s*desk|support\s*ticket)\b/i, /\b(raise|create|open)\b.*\bticket\b/i, /\bsupport\s*request\b/i],
    steps: [
      '1. Go to Helpdesk.',
      '2. Browse articles or click "Raise Ticket".',
      '3. Describe your issue, select the category, and submit.',
    ],
    route: '/helpdesk',
    auth: { mode: 'page_code', pageCode: 'HELPDESK_KB' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the Helpdesk.',
  },
  {
    code: 'work_inbox',
    title: 'View all pending approvals and tasks',
    aliases: [/\bwork\s*inbox\b/i, /\bpending\s*(approval|task|action)\b/i, /\bmy\s*(tasks|approvals|inbox|pending)\b/i, /\bwhat\s*(is|are)\s*(pending|waiting)\b/i],
    steps: [
      '1. Go to Work Inbox.',
      '2. All items pending your action are listed — leaves, regularizations, exits, reimbursements, etc.',
      '3. Click any item to review and act on it directly.',
    ],
    route: '/work-inbox',
    auth: { mode: 'page_code', pageCode: 'WORK_INBOX' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to Work Inbox.',
  },

  // ─── LMS / TRAINING ──────────────────────────────────────────────────────────
  {
    code: 'lms_coordinator',
    title: 'Manage training batches as LMS coordinator',
    aliases: [/\b(lms|training)\b.*\b(coordinator|manage\s*batch|batch\s*manage)\b/i, /\bcoordinator\b.*\b(training|lms)\b/i, /\bbatch\s*(manage|training)\b/i],
    steps: [
      '1. Go to Learning → Coordinator.',
      '2. See your assigned training batches, learner progress, and MCQ scores.',
      '3. Manage batch attendance and flag at-risk learners.',
    ],
    route: '/lms/coordinator',
    auth: { mode: 'page_code', pageCode: 'LMS_COORDINATOR' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the LMS Coordinator view. This is for Trainers and Training Coordinators.',
  },

  // ─── REPORTS ─────────────────────────────────────────────────────────────────
  {
    code: 'reports_center',
    title: 'Access reports and download data',
    aliases: [/\b(reports?|reporting)\s*(center|section|page)?\b/i, /\b(download|export)\b.*\b(report|data)\b/i, /\bhr\s*reports?\b/i, /\bpayroll\s*report\b/i],
    steps: [
      '1. Go to Reports.',
      '2. Browse by category — Payroll, Attendance, Leave, Employee, etc.',
      '3. Select a report, set filters (date range, branch, process), and click Download.',
    ],
    route: '/reports',
    auth: { mode: 'page_code', pageCode: 'REPORTS_CENTER' },
    status: 'verified',
    deniedExplanation: 'Your role does not have access to the Reports Center.',
  },
];
