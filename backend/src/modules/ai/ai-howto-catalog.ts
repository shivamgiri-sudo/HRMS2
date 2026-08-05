/**
 * HRMS How-To Catalog — step-by-step navigation guidance for Mira.
 *
 * Answers "how do I do X in HRMS" with real steps and a real, RBAC-checked
 * deep link, instead of Mira falling through to the external LLM with no
 * HRMS-navigation knowledge at all (see ai-howto.service.ts's header comment
 * for the full root-cause background).
 *
 * Every entry here was verified directly against the live route files and
 * RBAC matrix before being added — not copied from a plan/agent citation
 * without re-checking. Two `auth` modes exist because not every page has a
 * page_code to check:
 *
 * - `page_code`: the page is gated by an entry in backend/src/shared/
 *   rbacPageMatrix.ts, checked live via getAccessMe(userId).pages — the same
 *   source /api/access/pages/my-catalog and ModuleLauncher.tsx already trust.
 * - `static_roles`: the page has no page_code at all (e.g. /leaves — grep
 *   confirms zero entries in src/lib/pageRoutePageCodes.ts for it), so this
 *   mode copies the literal role list from the real backend route guard,
 *   with a `citation` pointing at the exact file:line being mirrored, and is
 *   checked via expandRoles() — the same function requireRole() itself uses,
 *   so this catalog's opinion of "can this role do this" cannot drift from
 *   the API's actual behavior.
 *
 * `route` is always the router-authoritative path (verified against a
 * mounted <Route> in src/config/routes/*.tsx), never page_catalog.page_path
 * — see the page-catalog-route-drift incident referenced in
 * src/tests/page-catalog-route-drift.contract.test.ts for why that
 * distinction matters.
 *
 * Deliberately bounded: this is a first pass over the most common
 * self-service + first-line-manager actions, not an exhaustive sweep of
 * every RBAC-gated action in the app. Loan/advance apply, document
 * download, and grievance submission were investigated and excluded — no
 * confirmed employee-facing page was found for any of the three (loans
 * self-service, standalone document center, and grievance *submission* as
 * opposed to the handling console all came up empty in the routes read this
 * session). Guessing those links would repeat the exact class of bug this
 * catalog exists to fix. Add them once a real page is confirmed.
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
    aliases: [/\bapply\b.*\bleave\b/i, /\braise\b.*\bleave\b/i, /\bleave\s*request\b/i, /\btake\s*leave\b/i],
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
];
