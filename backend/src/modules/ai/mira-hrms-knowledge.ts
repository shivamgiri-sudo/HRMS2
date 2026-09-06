/**
 * Deep HRMS knowledge catalog for Mira.
 *
 * Companion to ai-howto-catalog.ts, which answers "how do I get to X" with a
 * route and a numbered path. This catalog answers the other half — "what does X
 * mean", "how does X work", "why is Y happening" — the business rules behind the
 * screens rather than the way to them.
 *
 * Why a catalog and not the model's own knowledge: COMPANY_SYSTEM_INSTRUCTION
 * forbids answering HRMS questions from general knowledge, and rightly so. A
 * model guessing at PF ceilings or ESIC contribution periods would be confidently
 * wrong about someone's pay. So the rules are stated here, injected as context,
 * and the model's job is reduced to explaining supplied facts in the user's
 * language rather than recalling facts it was never given.
 *
 * ORDER IS PRECEDENCE. findDeepKnowledge() returns the first entry whose aliases
 * match, so specific topical entries come first and the broad navigational
 * `pages_overview` sits near the end. Adding a loosely-worded alias high in this
 * array will quietly shadow every entry below it.
 *
 * Unlike the how-to catalog these entries are NOT role-gated, because none of
 * them contain anyone's data — they describe how the system behaves, which is the
 * same explanation for every employee. Per-user figures still come only from
 * ai-account.service.ts, under its own authorisation.
 */

export interface KnowledgeEntry {
  code: string;
  title: string;
  /** Topical keyword patterns. Any match injects this entry; no how-to gate. */
  aliases: RegExp[];
  /** The context block injected into the system prompt under "### HRMS Context". */
  knowledge: string;
  /** How-to catalog codes worth surfacing alongside this explanation. */
  relatedHowTo?: string[];
}

export const KNOWLEDGE_CATALOG: KnowledgeEntry[] = [
  {
    code: 'payroll_pf_esic',
    title: 'PF and ESIC computation rules',
    aliases: [
      /\bpf\b/i, /\bprovident\s*fund\b/i, /\besic\b/i,
      /\bemployee\s*state\s*insurance\b/i, /\bepf\b/i, /\beps\b/i,
      /\bpf\s*deducti/i, /\besic\s*deducti/i,
    ],
    knowledge: `
PF (Provident Fund) is computed on "structure gross" — the sum of fixed salary components (basic, HRA, DA, special allowance) defined in the employee's assigned salary structure, NOT on attendance-prorated gross. Incentives, performance bonuses, and one-time payments are excluded from the PF base.

Employee PF contribution: 12% of basic wages. Employer PF contribution: 12% of basic wages, split as 3.67% to EPF (Employee Provident Fund) and 8.33% to EPS (Employee Pension Scheme). EPS is capped at ₹1,250/month when basic exceeds ₹15,000/month — above this ceiling the full 8.33% still goes to EPS but only on a notional ₹15,000 base.

The ₹15,000 threshold is stored in statutory_config (field: pf_wage_ceiling). Payroll is blocked by the system if no approved statutory_config entry exists for the period — the system will show "PF configuration missing" and prevent finalization.

ESIC (Employee State Insurance) applies only when the employee's gross salary is ≤ ₹21,000/month. This threshold is also in statutory_config (field: esic_wage_ceiling). Rates: Employee 0.75%, Employer 3.25% on gross salary. Once an employee's gross crosses ₹21,000 during a contribution period (April–September or October–March), ESIC is switched off for that employee for the remainder of the period — it does not switch back mid-period even if the salary drops. This exemption flag is tracked per employee per period.

UAN (Universal Account Number) is required before PF can be filed. Employees without a UAN appear in the "PF/UAN pending" bulk upload queue. The pf_uan_bulk upload type links UAN numbers to employee records.

On the payslip, "PF" = employee deduction; "Employer PF" is shown separately as a CTC component but not deducted from net pay.
`.trim(),
    relatedHowTo: ['payroll_view_payslip'],
  },

  {
    code: 'payroll_gross_net',
    title: 'Gross vs net salary and component breakdown',
    aliases: [
      /\bgross\s*salary\b/i, /\bnet\s*(salary|pay|take.?home)\b/i,
      /\bsalary\s*(structure|component|breakdown|split)\b/i,
      /\bctc\b/i, /\bcost\s*to\s*company\b/i,
      /\bbasic\s*(salary|pay)\b/i, /\bhra\b/i, /\bspecial\s*allowance\b/i,
      /\bsalary\s*slip\s*(field|column|mean)\b/i,
    ],
    knowledge: `
Salary structure in PeopleOS has three tiers:

STRUCTURE GROSS: Sum of all fixed monthly components — Basic, HRA (House Rent Allowance), DA (Dearness Allowance), Special Allowance, Transport Allowance, Medical Allowance, and any organisation-defined allowances. This is the "contracted" amount before attendance proration. PF and ESIC are computed on structure gross (or the PF-eligible subset), not on actual paid gross.

ATTENDANCE-PRORATED GROSS: Structure gross × (paid_days / total_working_days_in_month). An employee on LWP for 2 of 26 working days receives 24/26 × structure_gross. This is what actually goes into the payslip as "gross earnings."

NET PAY = Attendance-prorated gross + incentives/performance pay − statutory deductions (PF, ESIC, PT, TDS) − other deductions (loans, salary advances, LWP shortfall) + any reimbursements marked as net additions.

LWP (Leave Without Pay) deduction: each LWP day reduces gross by (structure_gross / working_days_in_month). LWP days come from the attendance engine — days marked absent with no approved leave.

Incentives (sales commissions, performance bonuses) are added to net AFTER all statutory deductions — they do not inflate the PF/ESIC base.

Professional Tax (PT) varies by state and is slab-based on gross salary. Slabs are configured per branch state in statutory_config.

On the payslip PDF: "Earnings" section shows all positive components. "Deductions" section shows PF, ESIC, PT, TDS, LWP, loan EMI. "Net Pay" is the amount credited to the bank.
`.trim(),
    relatedHowTo: ['payroll_view_payslip', 'payroll_salary_structure'],
  },

  {
    code: 'attendance_apr_rules',
    title: 'APR attendance, biometric vs APR, absent-when-no-record',
    aliases: [
      /\bapr\b/i, /\bbiometric\b/i, /\battendance\s*source\b/i,
      /\battendance\s*rule\b/i, /\bpunch\b/i, /\bmissing\s*punch\b/i,
      /\bno\s*(attendance|record)\b/i, /\babsent\s*(without|with\s*no)\b/i,
      /\boperations?\s*executive\b/i,
    ],
    knowledge: `
PeopleOS supports two attendance source types per cost centre: BIOMETRIC and APR.

BIOMETRIC mode: attendance is derived from device punch-in/punch-out records. An employee with no punch record gets "missing_punch" status (not automatically absent) — a regularization can be raised for the day.

APR (Attendance Processing Report) mode: attendance is explicitly declared by the cosec/WFM team. An employee in an APR-configured cost centre who has NO APR record for a given day is treated as ABSENT — there is no biometric fallback. This is intentional: Operations Executive roles and designated cost centres where APR is configured require explicit presence attestation. If you see unexpected LWP for an APR employee, check whether the cosec uploaded the APR for that date.

APR validation rule: a row in the APR import counts as "present" only when raw_minutes > 0. A row with 0 minutes is treated as absent regardless of other fields.

The missing_punch gate is biometric-only. APR employees never get missing_punch status — they get either present (APR row with minutes > 0) or absent (no row / row with 0 minutes).

attendance_daily_record.source_type records whether a given day's status came from 'biometric', 'apr', 'leave', 'roster', or 'manual_correction'. The attendance engine runs nightly and re-derives each day's status from the authoritative source for that cost centre.

Regularizations: employees and managers can raise a regularization for any day within the last 90 days. A regularization does not change the source_type — it creates an attendance_regularization row with status 'pending' that the branch head must approve. Only after approval does the attendance_daily_record get updated (is_locked = 1 post-approval).
`.trim(),
    relatedHowTo: ['attendance_regularize', 'attendance_view'],
  },

  {
    code: 'leave_balance_types',
    title: 'Leave types, balances, carry-forward, encashment',
    aliases: [
      /\bleave\s*(balance|quota|credit|entitlement)\b/i,
      /\bcl\b.*\bleave\b|\bleave\b.*\bcl\b/i,
      /\bel\b.*\bleave\b|\bleave\b.*\bel\b/i,
      /\bearned\s*leave\b/i, /\bcasual\s*leave\b/i,
      /\bsick\s*leave\b/i, /\bmaternity\b/i, /\bpl\b.*\bleave\b/i,
      /\bleave\s*carry.?forward\b/i, /\bleave\s*encash\b/i,
      /\bleave\s*laps\b/i, /\bleave\s*expire\b/i,
    ],
    knowledge: `
PeopleOS tracks leave balances in leave_balance per employee per leave type. The leave_balance_ledger records every credit and debit with a reason.

Common leave types in MAS Callnet (from leave_type_master):
- CL (Casual Leave): typically 12/year, monthly or annual credit, generally NOT carry-forward. Lapses at year-end.
- EL / PL (Earned / Privilege Leave): accrues monthly, carry-forward allowed up to a configured cap (commonly 30 days). Encashment possible on resignation/retirement per policy.
- SL (Sick Leave): typically 12/year, not carry-forward, requires medical certificate beyond X days.
- ML (Maternity Leave): fixed statutory quantum (26 weeks for first two children). Managed separately — does not deduct from SL/CL balance.
- LWP (Leave Without Pay): not a balance type; it is what happens when a leave is taken without sufficient balance or without approval.
- DL (Duty Leave): for official work travel/training, does not deduct balance.

Balance is deducted only when the branch head APPROVES the leave request — not when applied. If a leave is rejected, the balance is untouched (nothing was deducted in the first place).

Half-day leave: total_days = 0.5, charged as 0.5 from the balance. The from_date and to_date are the same day.

Carry-forward: controlled by leave_type_master.carry_forward_limit and carry_forward_expiry. Balances above the limit lapse on the configured expiry date (usually 31-March or 31-December). The leave balance sync worker runs these lapses automatically.

Overlap check: two leave requests for the same employee cannot overlap dates. The system rejects a new application if dates conflict with an already-approved leave.
`.trim(),
    relatedHowTo: ['leave_apply', 'leave_balance_view'],
  },

  {
    code: 'wfm_roster_lifecycle',
    title: 'Roster lifecycle: draft, publish, acknowledge, lock, payroll-ready',
    aliases: [
      /\broster\b/i, /\bshift\s*(roster|schedule|plan)\b/i,
      /\broster\s*(status|lifecycle|stage|lock|publish|approve)\b/i,
      /\bweekly\s*roster\b/i, /\bshift\s*assign\b/i,
      /\broster\s*payroll\b/i,
    ],
    knowledge: `
A roster in PeopleOS goes through these stages:

1. DEMAND — WFM creates headcount demand for the week per process/shift.
2. ALLOCATION — Branch Head allocates employees to shifts.
3. DRAFT — Roster is being built; not yet visible to employees; editable.
4. PUBLISHED — Process Manager publishes the roster. Employees can now see their schedule. Post-publication edits require a mandatory reason and are audit-logged.
5. ACKNOWLEDGED — Employee confirms their shift assignment. Required before deployment.
6. ACTIVE — The week is in progress; the roster is the live schedule.
7. LOCKED — Week has ended; roster is locked for payroll input. No further edits.
8. PAYROLL_INPUT_READY — Locked + all attendance reconciled; safe for payroll to consume.

Publication authority: Process Manager for their mapped process. Branch Head cannot publish without Process Manager sign-off.

Post-publication change rule: any change after PUBLISHED status requires: (a) a reason field (minimum 20 chars), (b) notification to affected employee, (c) audit log entry. The reason is stored in roster_change_log.

Employee acknowledgement is mandatory before the roster moves to ACTIVE. An unacknowledged roster is escalated after the configured SLA (usually 24 hours before shift start).

Payroll integration: the payroll engine reads roster_assignment.shift_id to determine planned hours. Overtime = actual_minutes − planned_minutes when actual > planned and dispute_type = 'overtime_worked'. Week-off-worked pay is triggered when the roster has week_off for a day but the employee's attendance_daily_record shows presence.

shift_code in a roster must be a valid code from shift_master (e.g. "GEN", "NIGHT", "MID") — NOT a time string like "10:00am-07:00pm". Entering a time string in the shift_code column is a common upload error that causes "Data too long" errors.
`.trim(),
    relatedHowTo: ['roster_view', 'roster_publish'],
  },

  {
    code: 'bulk_upload_guide',
    title: 'Bulk upload types, common errors, and field rules',
    aliases: [
      /\bbulk\s*upload\b/i, /\bcsv\s*upload\b/i, /\btemplate\s*(upload|download)\b/i,
      /\bupload\s*(error|fail|stuck|slow|pending|status)\b/i,
      /\bbatch\s*(upload|import|status)\b/i,
      /\bimport\s*(employee|leave|attendance|roster|deduction)\b/i,
    ],
    knowledge: `
PeopleOS Bulk Upload Hub supports these upload types:
- ATTENDANCE_REGULARIZATION_BULK: batch regularizations for employees. employee_code, session_date (YYYY-MM-DD or DD-MM-YYYY), requested_status (present/half_day/absent), reason (min 10 chars), optional new_punch_in/new_punch_out (HH:MM). Half-day variants: "half_day", "Half Day", "half-day", "Half_Day" are all accepted.
- LEAVE_APPLICATION_BULK: batch leave applications. employee_code, leave_code (from leave_type_master — e.g. CL, EL, SL), from_date, to_date, total_days, optional reason.
- SHIFT_ROSTER_BULK: batch roster assignments. shift_code must be a code from shift_master (e.g. "GEN") — never a time string.
- REPORTING_MANAGER_UPDATE: batch manager assignments. employee_code, manager_employee_code.
- PF_UAN_BULK: link UAN numbers to employees.
- DEDUCTION_BULK, INCENTIVE_BULK: batch financial adjustments.

Batch lifecycle: validated → import (parallel, grouped by employee) → pending_approval → approved/rejected.

Common errors:
- "employee_code not in master": check if the employee resigned recently — use includeInactive option or confirm code spelling.
- "leave_code not in leave_type_master": verify exact code from the Leave Types admin page. HDCL is not a standard code.
- "shift_code not found": you entered a time string (e.g. "10:00am-07:00pm") instead of a shift code (e.g. "GEN").
- "session_date future date": regularizations cannot be for future dates.
- "reason too short": reason must be at least 10 characters.
- Stuck batch in "importing" state: a server restart may have interrupted the import. Contact admin to reset the batch to "validated" status for retry.

Progress bar: visible while import is running. If you close and reopen the page, the progress bar automatically reconnects to any active import you started.
`.trim(),
    relatedHowTo: ['bulk_upload_att_reg', 'bulk_upload_leave'],
  },

  {
    code: 'exit_fnf_stages',
    title: 'Resignation, exit clearance, and full & final settlement',
    aliases: [
      /\bresign/i, /\bfull\s*[&and]*\s*final\b/i, /\bf\s*[&]\s*f\b/i, /\bfnf\b/i,
      /\bexit\s*(clearance|process|formality|stage)\b/i,
      /\blast\s*(day|working|salary)\b/i, /\bnotice\s*(period|pay)\b/i,
      /\bgratuity\b/i, /\bsettlement\b/i,
    ],
    knowledge: `
Exit process in PeopleOS:

1. RESIGNATION RAISED — Employee raises resignation from "My Profile > Raise Resignation". Sets last_working_date based on notice period.
2. HR REVIEW — HR acknowledges, confirms last_working_date, may negotiate notice period buyout.
3. CLEARANCE — Multi-department clearance: IT (assets returned), Finance (dues cleared), HR (documents collected). Each department signs off separately in exit_clearance_item.
4. F&F CALCULATION — Payroll computes full and final: pending salary (prorated last month), leave encashment (EL balance × per-day rate), notice pay recovery (if notice not served), gratuity (if eligible), bonus arrears.
5. F&F APPROVAL — Finance Head approves the settlement amount.
6. PAYMENT — Bank transfer triggered; employment_status updated to 'resigned'.

Gratuity eligibility: 5 continuous years of service. Amount = (last basic salary / 26) × 15 × years_of_service. Capped at ₹20 lakh (statutory limit). Configured in statutory_config.gratuity_cap.

Provisional flag: F&F records have is_ff_provisional flag. A provisional F&F cannot be marked as final-payable — it requires the Finance Head to explicitly clear the provisional status with an audit reason. This exists to prevent accidental payment of draft settlements.

Notice period recovery: if notice_period_days − days_actually_served > 0, the shortfall is deducted as notice_pay_recovery = (structure_gross / 30) × shortfall_days.

Gratuity is always tax-exempt up to ₹20 lakh under Income Tax Act Section 10(10) — shown separately on the settlement sheet, not included in taxable income.
`.trim(),
    relatedHowTo: ['exit_raise_resignation', 'exit_view_clearance'],
  },

  {
    code: 'rbac_roles',
    title: 'What each role can see and do in PeopleOS',
    aliases: [
      /\brole\b.*\b(access|permission|can\s*see|can\s*do|allowed)\b/i,
      /\b(access|permission)\b.*\brole\b/i,
      /\bwho\s*can\b/i, /\bwhat\s*can\b.*\bsee\b/i,
      /\bbranch\s*head\b/i, /\bprocess\s*manager\b/i, /\bwfm\b.*\brole\b/i,
      /\bhr\s*admin\b/i, /\bsuper\s*admin\b/i, /\bemployee\s*role\b/i,
      /\bpayroll\s*(hr|branch)\b/i,
    ],
    knowledge: `
PeopleOS role hierarchy (role_key values):

super_admin: Full access to everything. Can create/delete users, run migrations, access all financial data, approve any action.

admin / hr_admin: Manage employees, onboarding, documents, salary structures. Cannot approve payroll finalization (payroll_head does that).

recruitment_hr: ATS full access — candidate pipeline, interview scheduling, offer letters. No access to active-employee payroll or attendance.

payroll_hr: Payroll computation, salary structures, bulk payroll run, payslip generation for all branches. Access to PF/ESIC statutory config.

payroll_branch: Payroll read + payroll readiness sign-off for their assigned branch(es). Cannot modify salary structures.

finance_head: Finance module full access — invoices, budgets, GRN, PnL. Approves F&F settlements.

wfm: Roster creation, shift master management, attendance regularization approval, shrinkage reports. Scoped to assigned branch/process.

branch_head: Approves leave, attendance regularizations, roster publication review. Sees all employees in their branch. Cannot access payroll numbers.

process_manager: Roster publication authority for their process. Shift assignment management. Reports for their process.

operations_manager: Operations performance dashboards, quality scores, AHT reports. Read-only attendance.

employee: Own profile, own payslips, own leave balance/history, own attendance, own documents. Cannot see any other employee's data.

client: Client Portal only — their mapped process/LOB performance metrics. No payroll, no attendance individual data, no PII.

Role scoping: roles other than super_admin and admin are scoped to branch_id and/or process_id via user_assignment_scope. A wfm user assigned to NOIDA branch only sees NOIDA roster and attendance.
`.trim(),
  },

  {
    code: 'payroll_lwp',
    title: 'LWP deduction and attendance linkage',
    aliases: [
      /\blwp\b/i, /\bleave\s*without\s*pay\b/i,
      /\blwp\s*(deducti|calculat|value|day)\b/i,
      /\babsent\s*(deducti|salary|pay)\b/i,
      /\bunauthorised\s*(absent|leave)\b/i,
    ],
    knowledge: `
LWP (Leave Without Pay) days are any working days marked as 'absent' in attendance_daily_record without a corresponding approved leave. Each LWP day reduces the employee's gross pay proportionally.

LWP deduction calculation: (structure_gross ÷ working_days_in_month) × lwp_days_count. Working days in the month is the count of non-holiday, non-week-off days — it varies by month and branch holiday calendar.

lwp_value on each attendance_daily_record row: decimal value (0.00 to 1.00). 1.00 = full LWP day. 0.50 = half LWP (half-day absent with no approved leave). These lwp_value entries are summed at payroll computation time.

Sources of LWP:
1. attendance_daily_record.status = 'absent' with no approved leave_request covering that day.
2. Unapproved leave: leave applied but rejected → days become LWP.
3. Half-day absent: attendance shows half-day worked with no leave → 0.5 LWP.

LWP does NOT apply to: public holidays (in branch holiday calendar), declared week-offs (shift_master.week_off_days matching the employee's shift), approved leaves (CL/EL/SL etc.), days before date_of_joining or after last_working_date.

On the payslip: "LWP Days" shows the count. "LWP Deduction" shows the rupee amount deducted. If an employee disputes an LWP, they raise an attendance regularization request — after approval, the attendance_daily_record is updated and the LWP reverses in the next payroll run.
`.trim(),
    relatedHowTo: ['attendance_regularize', 'payroll_view_payslip'],
  },

  {
    code: 'ats_lifecycle',
    title: 'ATS candidate pipeline and recruitment lifecycle',
    aliases: [
      /\bats\b/i, /\bcandidate\b/i, /\brecruitment\b/i, /\bhiring\b/i,
      /\binterview\b/i, /\boffer\s*letter\b/i, /\bonboarding\b/i,
      /\bcandidate\s*to\s*employee\b/i, /\brecruitment\s*(stage|pipeline|status)\b/i,
    ],
    knowledge: `
ATS (Applicant Tracking System) pipeline stages in PeopleOS:

1. SOURCED — Candidate added (via form, recruiter, referral).
2. SCREENING — Recruiter reviews CV, basic telephonic check.
3. APTITUDE — Written/online aptitude test.
4. HR_INTERVIEW — HR round.
5. OPS_INTERVIEW — Operations/process round.
6. DOCUMENT_COLLECTION — Candidate submits required documents (Aadhar, PAN, certificates).
7. OFFER_EXTENDED — Offer letter generated and sent.
8. OFFER_ACCEPTED / OFFER_DECLINED.
9. JOINING — Candidate joins; conversion to employee triggered.
10. DROPPED — Candidate withdrew or was rejected at any stage.

Offer letter: auto-generated from a template when stage moves to OFFER_EXTENDED. Contains: CTC breakdown, designation, joining date, branch. Signed digitally. Document stored in candidate documents.

Candidate-to-employee conversion: when joining is confirmed, the ATS creates an employees record with employment_status = 'active', date_of_joining = joining_date, and maps candidate documents to employee_document. The candidate's ats_candidate.employee_id is set.

Candidate Web Form: public URL for walk-in candidates to self-register. Submissions create ats_candidate records with source = 'web_form'. The recruiter reviews and moves them into the pipeline.

SLA breach alerts: if a candidate stays in one stage beyond the configured SLA (e.g. 5 days in SCREENING), Mira and the recruiter's inbox show a breach notification.

ATS reports available: daily pipeline funnel, stage-wise conversion rates, source-wise yield (how many from referral vs. walk-in vs. portal), time-to-hire by branch and process.
`.trim(),
    relatedHowTo: ['ats_pipeline_view', 'ats_offer_letter'],
  },

  {
    code: 'client_portal_scope',
    title: 'Client Portal — what clients can and cannot see',
    aliases: [
      /\bclient\s*portal\b/i, /\bclient\s*(access|view|login|dashboard)\b/i,
      /\bwhat\s*can\s*client\b/i, /\bclient\s*(data|report|visibility)\b/i,
    ],
    knowledge: `
The Client Portal gives external clients read-only visibility into performance metrics for their contracted process/LOB only. Access is strictly scoped.

What clients CAN see:
- Aggregate headcount for their process (active agents, absent today, on leave).
- Attendance summary (present%, absent%, on-leave%) — aggregate only, no individual names.
- AHT (Average Handle Time), CSAT, quality scores, shrinkage rate — for their mapped LOB.
- Roster compliance — planned vs. actual staffing levels (aggregate, no individual schedules).
- SLA adherence reports for their process.
- Approved LMS readiness summary — what % of their process agents are certified (no individual assessment scores).

What clients CANNOT see (hard-blocked at API level):
- Individual employee names, codes, or any PII.
- Individual attendance records, punch-in/out times, regularization reasons.
- Salary, payroll, PF, bank, or any financial data.
- Leave reasons or types for individuals.
- Roster assignments per employee (only aggregate coverage shown).
- Data from any other client's process.
- Any internal HR, disciplinary, or exit data.

Access control: client users have role = 'client' and their user_assignment_scope is scoped to specific process_id values. Every client-portal API endpoint enforces this scope — there is no way to query another process's data even with a valid token.

Client Portal URL: /portal/<client-slug> — each client gets their own URL after their account is set up by the admin.
`.trim(),
  },

  {
    code: 'attendance_regularization_deep',
    title: 'Attendance regularization — rules, window, approval chain',
    aliases: [
      /\bregulariz/i,
      /\bcorrect\s*(attendance|punch|absent)\b/i,
      /\battendance\s*(correct|fix|amend|change)\b/i,
      /\bwho\s*(can|approves)\s*(regulariz|correct)\b/i,
    ],
    knowledge: `
Attendance regularization allows correcting an employee's attendance record for a past date.

Who can raise: Employee (for their own record), Manager (for their team), WFM/HR (for any employee in their scope). Managers raising on behalf of employees should select "requestedByType: manager".

Lookback window: maximum 90 days from today. Regularizations for dates older than 90 days are rejected at validation.

What can be regularized:
- requested_status: change to 'present', 'half_day', or 'absent'.
- new_punch_in / new_punch_out: correct wrong punch times (HH:MM format).
- dispute_type: 'work_from_home', 'week_off_worked', 'holiday_worked', 'overtime_worked', 'missing_punch'. A week_off_worked or holiday_worked regularization adds that day's pay.

Approval chain: Branch Head approves regularizations for their branch. After approval, wfmService.reviewRegularization() writes the correction into attendance_daily_record (is_locked = 1 after approval). The nightly attendance engine does not overwrite locked records.

Duplicate check: only one regularization can be open (pending) per employee per date. A second submission for the same employee+date is rejected until the first is approved or rejected.

Status field on attendance_regularization: 'pending' → 'approved' / 'rejected'. Approved records update attendance_daily_record. Rejected records are informational only — the original attendance stands.

Bulk regularization: use ATTENDANCE_REGULARIZATION_BULK upload type. The importer calls the same wfmService.submitRegularization() function as the UI form — all the same validation rules apply.
`.trim(),
    relatedHowTo: ['attendance_regularize'],
  },

  {
    // Deliberately ahead of payroll_payslip_fields: "where can I find my payslip"
    // is a navigation question, and payslip_fields' broad /\bpayslip\b/ alias
    // would otherwise answer it with field semantics instead of a location.
    code: 'pages_overview',
    title: 'What information is available on each HRMS page',
    aliases: [
      /\bwhat\s*(is|information|data|available)\s*(on|at|in)\s*(the\s+)?(page|screen|dashboard|module)\b/i,
      /\bwhere\s*(can|do)\s*i\s*(find|see|view|check|get)\b/i,
      /\bwhich\s*(page|section|module|menu)\b/i,
      /\bhrms\s*(page|module|feature|section)\b/i,
      /\bnavigation\b/i, /\bmenu\b.*\b(item|option|list)\b/i,
    ],
    knowledge: `
PeopleOS module and page map:

MY DASHBOARD (/my-dashboard): Personal overview — today's attendance status, leave balance summary, pending tasks (regularizations pending, leave pending approval), upcoming shifts, recent payslips, announcements.

ATTENDANCE (/attendance): Your own monthly attendance calendar. Each date shows: status (present/absent/half-day/leave/week-off/holiday), punch-in time, punch-out time, total hours. Click any date to raise a regularization. Filter by month.

LEAVES (/leaves): Apply for leave, view leave history, check balance by leave type. Shows leave calendar, pending/approved/rejected applications.

PAYROLL / MY PAYSLIPS (/payslips): Download payslips by month. View earnings, deductions, net pay. YTD tax projection.

PROFILE (/profile): Personal details, contact info, documents (Aadhar, PAN, certificates), bank account, emergency contacts, qualifications.

ROSTER / MY SCHEDULE (/my-roster): Current and upcoming week roster. Shift times, week-off days, holiday markers.

WFM DASHBOARD (/wfm/dashboard): For WFM role — headcount demand, roster status across processes, shrinkage trends, attendance risk signals.

HR DASHBOARD (/hr/dashboard): Employee headcount, attrition trends, pending onboarding actions, document expiry alerts.

PAYROLL HR (/payroll-hr/dashboard): Payroll readiness per branch, PF/ESIC compliance, salary structure changes, bulk payroll run status.

ATS / RECRUITMENT (/ats): Candidate pipeline kanban, interview schedule, offer letter queue, joining calendar.

BULK UPLOAD HUB (/bulk-upload): Upload attendance regularizations, leave applications, roster assignments, reporting manager updates, and more. Track batch status, download error reports.

EXIT MANAGEMENT (/exit): Raise resignation, view clearance checklist, track F&F status.

ASSETS (/assets): IT and physical asset assignments, return requests.

CLIENT PORTAL (/portal): For client users — process performance, headcount, quality metrics.

ADMIN (/admin): User management, role assignment, system configuration, migration console, audit logs.
`.trim(),
  },

  {
    code: 'payroll_payslip_fields',
    title: 'Payslip field meanings and layout',
    aliases: [
      /\bpayslip\b/i, /\bsalary\s*slip\b/i,
      /\bpayslip\s*(field|column|section|mean|explain)\b/i,
      /\bwhat\s*(does|is)\s*\w+\s*(on|in)\s*(the\s*)?(payslip|salary\s*slip)\b/i,
      /\bearning\s*(section|column)\b/i,
      /\bdeduction\s*(section|column)\b/i,
    ],
    knowledge: `
PeopleOS payslip layout:

HEADER: Employee code, name, designation, department, branch, PAN, UAN, ESIC number, bank account (masked), pay period (month-year), days_worked, LWP_days.

EARNINGS section:
- Basic: fixed component, basis for PF.
- HRA: House Rent Allowance (typically % of basic, tax-exempt under sec 10(13A) subject to limits).
- DA: Dearness Allowance.
- Special Allowance: balancing component.
- Transport / Medical: fixed statutory allowances.
- Gross Earnings: sum of above after LWP proration.
- Incentives / Performance Pay: added after gross, not subject to PF/ESIC.

DEDUCTIONS section:
- PF (Employee): 12% of PF-eligible basic.
- ESIC (Employee): 0.75% of gross (only if gross ≤ ₹21,000).
- Professional Tax: state-based slab.
- TDS: monthly income tax deduction (projected annual liability ÷ 12).
- LWP Deduction: (gross ÷ working_days) × LWP_days.
- Loan EMI / Salary Advance Recovery: if any active loan deduction.
- Total Deductions: sum of above.

NET PAY = Gross Earnings + Incentives − Total Deductions. This is the bank credit amount.

CTC SECTION (informational, not paid):
- Employer PF: 3.67% + 8.33% split.
- Employer ESIC: 3.25%.
- Gratuity Accrual: monthly provision.
- Total CTC = Net Pay + All employer contributions.

Days Worked = calendar days in month − LWP days − days before DOJ − days after LWD.
`.trim(),
    relatedHowTo: ['payroll_view_payslip', 'payroll_download_payslip'],
  },
];
