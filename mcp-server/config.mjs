/**
 * HRMS MCP Server — Role & Access Configuration
 *
 * ROLES (set HRMS_ROLE in your .env):
 *   viewer      — org structure + headcount only (safe for all staff)
 *   hr          — + attendance, leave, leave balances
 *   recruitment — hr + ATS candidate pipeline
 *   management  — recruitment + KPI + process performance
 *   finance     — management + P&L cost/revenue components
 *   full        — all tables below (no payroll/statutory ever)
 *
 * PAYROLL TABLES ARE NEVER EXPOSED regardless of role.
 */

// ── Tables that are NEVER queryable (payroll, statutory, raw PII vaults) ──
export const BLOCKED_TABLES = new Set([
  'payroll_run',
  'payroll_slip',
  'payroll_head',
  'payroll_component',
  'payroll_calculation',
  'payroll_disbursement',
  'employee_salary',
  'salary_structure',
  'salary_revision',
  'salary_increment',
  'tds_computation',
  'tds_slab',
  'statutory_config',
  'pf_contribution',
  'esic_contribution',
  'gratuity_schedule',
  'full_final_settlement',
  'bank_account',
  'employee_bank_detail',
  'payroll_attendance_conflict_review',
  'ats_candidate_documents',
  'ats_candidate_file',
  'ats_sensitive_action_log',
  'ats_pii_redaction_config',
  'ats_candidate_file_access_audit',
  'ats_bgv_record',
  'ats_bgv_response',
  'ats_bgv_verification',
  'ats_bgv_verification_details',
  'ats_bgv_initiation',
]);

// ── Column names that are always masked in query output ──────────────────
export const PII_COLUMNS = new Set([
  'pan_number',
  'aadhaar_last4',
  'aadhaar_number',
  'bank_account_number',
  'account_number',
  'ifsc_code',
  'personal_phone',
  'personal_email',
  'alternate_mobile',
  'emergency_contact_phone',
  'carrier_mobile',
  'passport_number',
  'voter_id',
  'driving_license',
  'uan_number',
  'esic_number',
  'pf_account_number',
]);

// ── Table allowlist per role ──────────────────────────────────────────────
// Each role gets its own tables PLUS everything in roles listed in `inherits`

const TABLE_SETS = {

  viewer: [
    'employees',
    'branch_master',
    'process_master',
    'process_lob_master',
    'designation_master',
    'department_master',
  ],

  hr: [
    'attendance_daily_record',
    'attendance_exception',
    'attendance_manual_override',
    'attendance_regularization',
    'attendance_reconciliation_record',
    'attendance_rule_config',
    'attendance_state_snapshot',
    'leave_request',
    'leave_type_master',
    'leave_balance_ledger',
    'leave_approval_log',
    'leave_credit_schedule',
    'leave_el_accrual_ledger',
    'leave_holiday_master',
    'leave_policy_config',
    'leave_reversal_log',
    'leave_weekoff_reconciliation_log',
    'employee_exit',
    'exit_checklist',
    'resignation_request',
  ],

  recruitment: [
    'ats_candidate',
    'ats_candidate_stage_log',
    'ats_interview_assignment',
    'ats_interview_result',
    'ats_interview_slot',
    'ats_interview_submission',
    'ats_interviewer_eligibility',
    'ats_offer',
    'ats_offer_approval',
    'ats_recruiter',
    'ats_recruiter_assignment_log',
    'ats_recruiter_hiring_activity',
    'ats_sourcing_channel',
    'ats_onboarding_request',
    'ats_onboarding_tasks',
    'ats_email_log',
    'ats_duplicate_log',
    'ats_queue_token',
    'ats_branch_head_approval',
    'ats_candidate_confirmation',
    'ats_employment_offer',
    'ats_assessment_mapping',
    'ats_assessment_template',
  ],

  management: [
    'kpi_process_assignment',
    'kpi_process_config',
    'kpi_process_template',
    'process_delivery_actual',
    'process_monthly_plan',
    'process_quality_target',
    'process_performance_metrics',
    'process_metric_definition',
    'process_billing_rate',
    'process_configuration',
    'wfm_attendance_session',
    'wfm_process_planning_rule',
    'roster_slot',
    'roster_shift_master',
    'roster_demand',
    // Asset & Material Exit Pass (IT & Admin). NOT employee offboarding —
    // employee_exit / exit_checklist / resignation_request in the hr tier are a
    // different thing entirely; these four track physical items leaving a branch.
    // Placed at management rather than hr because the module is governed by
    // branch heads and admins, and carries destination/carrier/vehicle detail
    // that has no bearing on an HR query.
    'exit_pass_requests',
    'exit_pass_items',
    'exit_pass_approvals',
    'exit_pass_audit_logs',
  ],

  finance: [
    'process_pnl_cost_component',
    'process_revenue_component',
    'process_revenue_daily',
    'process_revenue_rule',
    'process_role_billability',
    'client_billing',
    'process_lob_monthly_plan',
  ],

  full: [],   // inherits all tiers below
};

// Role inheritance chain
const ROLE_INHERITS = {
  viewer:      [],
  hr:          ['viewer'],
  recruitment: ['hr'],
  management:  ['recruitment'],
  finance:     ['management'],
  full:        ['finance'],
};

function resolveAllowedTables(role) {
  const resolved = new Set();
  const visit = (r) => {
    (TABLE_SETS[r] || []).forEach(t => resolved.add(t));
    (ROLE_INHERITS[r] || []).forEach(visit);
  };
  visit(role);
  return resolved;
}

export function getAllowedTables(role = 'viewer') {
  const r = ROLE_INHERITS.hasOwnProperty(role) ? role : 'viewer';
  return resolveAllowedTables(r);
}

export const VALID_ROLES = Object.keys(ROLE_INHERITS);
