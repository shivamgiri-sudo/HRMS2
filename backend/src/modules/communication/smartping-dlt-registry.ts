/**
 * SmartPing DLT Registry — TRAI-approved templates for MAS Callnet HRMS.
 * All templates registered under Entity ID: 1001485540000016211
 * Sender ID: Ispark
 *
 * Usage:
 *   import { buildSMS } from './smartping-dlt-registry.js';
 *   const { body, dltContentId } = buildSMS('hrms_login_otp', { otp: '123456', validity: '5' });
 *
 * Variable substitution: each {#var#} placeholder is replaced in order by the
 * values array. The DLT-registered text uses {#var#} as a positional marker.
 */

export interface DLTTemplate {
  key: string;
  name: string;
  dltContentId: string;
  /** Registered template text with {#var#} placeholders */
  registeredText: string;
  /** Number of variables expected */
  variableCount: number;
  /** Human-readable variable names for documentation */
  variableNames: string[];
}

export const SMARTPING_DLT_REGISTRY: Record<string, DLTTemplate> = {

  // ── Auth ──────────────────────────────────────────────────────────────────
  hrms_login_otp: {
    key: 'hrms_login_otp',
    name: 'HRMS Login OTP',
    dltContentId: '1707178351079130369',
    registeredText: 'Your OTP for HRMS login is {#var#}. It is valid for {#var#} minutes. Do not share this OTP with anyone. - Ispark',
    variableCount: 2,
    variableNames: ['otp', 'validity_minutes'],
  },

  candidate_mobile_otp: {
    key: 'candidate_mobile_otp',
    name: 'Candidate Mobile OTP',
    dltContentId: '1707178366416896631',
    registeredText: 'Your OTP for candidate onboarding verification is {#var#}. It is valid for {#var#} minutes. Do not share it with anyone. -Ispark',
    variableCount: 2,
    variableNames: ['otp', 'validity_minutes'],
  },

  password_reset_otp: {
    key: 'password_reset_otp',
    name: 'Password Reset OTP',
    dltContentId: '1707178366429884365',
    registeredText: 'Your OTP to reset your HRMS password is {#var#}. It is valid for {#var#} minutes. Do not share this OTP. -Ispark',
    variableCount: 2,
    variableNames: ['otp', 'validity_minutes'],
  },

  // ── Onboarding ────────────────────────────────────────────────────────────
  hrms_access_created: {
    key: 'hrms_access_created',
    name: 'HRMS Access Created',
    dltContentId: '1707178366457584730',
    registeredText: 'Dear {#var#}, your HRMS access has been created. Please login using your registered mobile number. - Ispark',
    variableCount: 1,
    variableNames: ['name'],
  },

  onboarding_link: {
    key: 'onboarding_link',
    name: 'Onboarding Link',
    dltContentId: '1707178366482564179',
    registeredText: 'Dear {#var#}, your onboarding process has been initiated. Please complete your details using the HRMS onboarding link sent to you. - Ispark',
    variableCount: 1,
    variableNames: ['name'],
  },

  onboarding_submitted: {
    key: 'onboarding_submitted',
    name: 'Onboarding Submitted',
    dltContentId: '1707178366527413781',
    registeredText: 'Dear {#var#}, your onboarding form has been submitted successfully. HR team will review and update you shortly. - Ispark',
    variableCount: 1,
    variableNames: ['name'],
  },

  document_missing: {
    key: 'document_missing',
    name: 'Document Missing',
    dltContentId: '1707178367157854889',
    registeredText: 'Dear {#var#}, your onboarding document {#var#} is missing or incomplete. Please update it in HRMS for further processing. -Ispark',
    variableCount: 2,
    variableNames: ['name', 'document_name'],
  },

  document_rejected: {
    key: 'document_rejected',
    name: 'Document Rejected',
    dltContentId: '1707178367183578560',
    registeredText: 'Dear {#var#}, your submitted document {#var#} could not be accepted due to {#var#}. Please re-upload the correct document in HRMS. -Ispark',
    variableCount: 3,
    variableNames: ['name', 'document_name', 'reason'],
  },

  bgv_initiated: {
    key: 'bgv_initiated',
    name: 'BGV Initiated',
    dltContentId: '1707178367194697089',
    registeredText: 'Dear {#var#}, your background verification has been initiated after submission of onboarding details. You will be updated once completed. - Ispark',
    variableCount: 1,
    variableNames: ['name'],
  },

  bgv_completed: {
    key: 'bgv_completed',
    name: 'BGV Completed',
    dltContentId: '1707178367236440412',
    registeredText: 'Dear {#var#}, your background verification status has been updated as {#var#}. Please contact HR for any clarification. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'status'],
  },

  joining_confirmation: {
    key: 'joining_confirmation',
    name: 'Joining Confirmation',
    dltContentId: '1707178367246173711',
    registeredText: 'Dear {#var#}, your joining formalities are completed. Your date of joining is {#var#}. Please report as per HR instructions. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'doj'],
  },

  // ── Attendance ────────────────────────────────────────────────────────────
  daily_punch_missing: {
    key: 'daily_punch_missing',
    name: 'Daily Punch Missing',
    dltContentId: '1707178367258139272',
    registeredText: 'Dear {#var#}, your attendance punch is missing for {#var#}. Please regularize it in HRMS or contact your reporting manager. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'date'],
  },

  short_attendance: {
    key: 'short_attendance',
    name: 'Short Attendance',
    dltContentId: '1707178367270353517',
    registeredText: 'Dear {#var#}, your attendance is short by {#var#} hours for {#var#}. Please regularize it in HRMS. - Ispark',
    variableCount: 3,
    variableNames: ['name', 'short_hours', 'date'],
  },

  early_logout_alert: {
    key: 'early_logout_alert',
    name: 'Early Logout Alert',
    dltContentId: '1707178367319061715',
    registeredText: 'Dear {#var#}, early logout has been recorded for {#var#}. Please check your attendance in HRMS. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'date'],
  },

  attendance_regularization_submitted: {
    key: 'attendance_regularization_submitted',
    name: 'Attendance Regularization Submitted',
    dltContentId: '1707178367333303583',
    registeredText: 'Dear {#var#}, your attendance regularization request for {#var#} has been submitted and is pending approval. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'date'],
  },

  attendance_regularization_approved: {
    key: 'attendance_regularization_approved',
    name: 'Attendance Regularization Approved',
    dltContentId: '1707178367345248466',
    registeredText: 'Dear {#var#}, your attendance regularization request for {#var#} has been approved. Please check HRMS for details. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'date'],
  },

  attendance_regularization_rejected: {
    key: 'attendance_regularization_rejected',
    name: 'Attendance Regularization Rejected',
    dltContentId: '1707178367417536939',
    registeredText: 'Dear {#var#}, your attendance regularization request for {#var#} has been rejected due to {#var#}. Please check HRMS. - Ispark',
    variableCount: 3,
    variableNames: ['name', 'date', 'reason'],
  },

  apr_biometric_mismatch: {
    key: 'apr_biometric_mismatch',
    name: 'APR Biometric Mismatch',
    dltContentId: '1707178367685980972',
    registeredText: 'Dear {#var#}, mismatch found between APR attendance and biometric attendance for {#var#}. Please review and regularize in HRMS. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'date'],
  },

  // ── Leave ─────────────────────────────────────────────────────────────────
  leave_request_submitted: {
    key: 'leave_request_submitted',
    name: 'Leave Request Submitted',
    dltContentId: '1707178367692812584',
    registeredText: 'Dear {#var#}, your leave request for {#var#} to {#var#} has been submitted and is pending approval. - Ispark',
    variableCount: 3,
    variableNames: ['name', 'from_date', 'to_date'],
  },

  leave_approved: {
    key: 'leave_approved',
    name: 'Leave Approved',
    dltContentId: '1707178367701816121',
    registeredText: 'Dear {#var#}, your leave request for {#var#} to {#var#} has been approved. Please check HRMS for details. - Ispark',
    variableCount: 3,
    variableNames: ['name', 'from_date', 'to_date'],
  },

  leave_balance_alert: {
    key: 'leave_balance_alert',
    name: 'Leave Balance Alert',
    dltContentId: '1707178393179126596',
    registeredText: 'Dear {#var#}, your current leave balance is {#var#} days as on {#var#}. Please check HRMS for details. - Ispark',
    variableCount: 3,
    variableNames: ['name', 'balance_days', 'as_on_date'],
  },

  lwp_alert: {
    key: 'lwp_alert',
    name: 'LWP Alert',
    dltContentId: '1707178393190086763',
    registeredText: 'Dear {#var#}, leave without pay has been marked for {#var#} day or days for the period {#var#}. Please check HRMS. - Ispark',
    variableCount: 3,
    variableNames: ['name', 'lwp_days', 'period'],
  },

  // ── Payroll / Bank ────────────────────────────────────────────────────────
  bank_detail_missing: {
    key: 'bank_detail_missing',
    name: 'Bank Detail Missing',
    dltContentId: '1707178393195896177',
    registeredText: 'Dear {#var#}, your bank account details are missing or incomplete in HRMS. Please update them for payroll processing. - Ispark',
    variableCount: 1,
    variableNames: ['name'],
  },

  bank_update_submitted: {
    key: 'bank_update_submitted',
    name: 'Bank Update Submitted',
    dltContentId: '1707178393200035853',
    registeredText: 'Dear {#var#}, your bank detail update request has been submitted and is pending HR approval. - Ispark',
    variableCount: 1,
    variableNames: ['name'],
  },

  bank_update_approved: {
    key: 'bank_update_approved',
    name: 'Bank Update Approved',
    dltContentId: '1707178393203558364',
    registeredText: 'Dear {#var#}, your bank detail update request has been approved and updated in HRMS. - Ispark',
    variableCount: 1,
    variableNames: ['name'],
  },

  bank_update_rejected: {
    key: 'bank_update_rejected',
    name: 'Bank Update Rejected',
    dltContentId: '1707178393208955787',
    registeredText: 'Dear {#var#}, your bank detail update request has been rejected due to {#var#}. Please check HRMS. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'reason'],
  },

  // ── KYC / Statutory ───────────────────────────────────────────────────────
  pan_update_submitted: {
    key: 'pan_update_submitted',
    name: 'PAN Update Submitted',
    dltContentId: '1707178393211929201',
    registeredText: 'Dear {#var#}, your PAN update request has been submitted and is pending HR approval. - Ispark',
    variableCount: 1,
    variableNames: ['name'],
  },

  aadhaar_update_submitted: {
    key: 'aadhaar_update_submitted',
    name: 'Aadhaar Update Submitted',
    dltContentId: '1707178393214913762',
    registeredText: 'Dear {#var#}, your Aadhaar update request has been submitted and is pending HR approval. - Ispark',
    variableCount: 1,
    variableNames: ['name'],
  },

  uan_pf_update: {
    key: 'uan_pf_update',
    name: 'UAN/PF Update',
    dltContentId: '1707178393218599510',
    registeredText: 'Dear {#var#}, your PF or UAN details have been updated in HRMS. Please check your profile for details. - Ispark',
    variableCount: 1,
    variableNames: ['name'],
  },

  // ── Roster / WFM ──────────────────────────────────────────────────────────
  roster_published: {
    key: 'roster_published',
    name: 'Roster Published',
    dltContentId: '1707178393225691004',
    registeredText: 'Dear {#var#}, your roster for week {#var#} has been published in HRMS. Please check your shift and week-off details. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'week'],
  },

  shift_changed: {
    key: 'shift_changed',
    name: 'Shift Changed',
    dltContentId: '1707178393235756305',
    registeredText: 'Dear {#var#}, your shift for {#var#} has been changed from {#var#} to {#var#}. Please check HRMS for details. - Ispark',
    variableCount: 4,
    variableNames: ['name', 'date', 'old_shift', 'new_shift'],
  },

  week_off_changed: {
    key: 'week_off_changed',
    name: 'Week-Off Changed',
    dltContentId: '1707178393246255846',
    registeredText: 'Dear {#var#}, your week-off for week {#var#} has been changed from {#var#} to {#var#} as per roster requirement. - Ispark',
    variableCount: 4,
    variableNames: ['name', 'week', 'old_day', 'new_day'],
  },

  week_off_preference_submitted: {
    key: 'week_off_preference_submitted',
    name: 'Week-Off Preference Submitted',
    dltContentId: '1707178393252910837',
    registeredText: 'Dear {#var#}, your week-off preference for week {#var#} has been submitted successfully and is pending roster finalization. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'week'],
  },

  week_off_preference_accepted: {
    key: 'week_off_preference_accepted',
    name: 'Week-Off Preference Accepted',
    dltContentId: '1707178393257578056',
    registeredText: 'Dear {#var#}, your week-off preference for week {#var#} has been accepted. Please check your final roster in HRMS. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'week'],
  },

  week_off_preference_adjusted: {
    key: 'week_off_preference_adjusted',
    name: 'Week-Off Preference Adjusted',
    dltContentId: '1707178393262211861',
    registeredText: 'Dear {#var#}, your week-off preference for week {#var#} has been adjusted due to business requirement. Please check HRMS. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'week'],
  },

  // ── Approvals (generic) ───────────────────────────────────────────────────
  approval_pending_manager: {
    key: 'approval_pending_manager',
    name: 'Approval Pending Manager',
    dltContentId: '1707178393273659378',
    registeredText: 'Dear {#var#}, approval is pending for {#var#} request raised by {#var#}. Please review it in HRMS. - Ispark',
    variableCount: 3,
    variableNames: ['manager_name', 'request_type', 'employee_name'],
  },

  request_approved: {
    key: 'request_approved',
    name: 'Request Approved',
    dltContentId: '1707178393281607353',
    registeredText: 'Dear {#var#}, your {#var#} request has been approved by {#var#}. Please check HRMS for details. - Ispark',
    variableCount: 3,
    variableNames: ['name', 'request_type', 'approver_name'],
  },

  // ── Profile ───────────────────────────────────────────────────────────────
  profile_update_submitted: {
    key: 'profile_update_submitted',
    name: 'Profile Update Submitted',
    dltContentId: '1707178393291073747',
    registeredText: 'Dear {#var#}, your profile update request has been submitted and is pending HR approval. - Ispark',
    variableCount: 1,
    variableNames: ['name'],
  },

  profile_update_approved: {
    key: 'profile_update_approved',
    name: 'Profile Update Approved',
    dltContentId: '1707178393294390392',
    registeredText: 'Dear {#var#}, your profile update request has been approved and updated in HRMS. - Ispark',
    variableCount: 1,
    variableNames: ['name'],
  },

  profile_update_rejected: {
    key: 'profile_update_rejected',
    name: 'Profile Update Rejected',
    dltContentId: '1707178393300478910',
    registeredText: 'Dear {#var#}, your profile update request has been rejected due to {#var#}. Please check HRMS. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'reason'],
  },

  // ── HR lifecycle ──────────────────────────────────────────────────────────
  employee_confirmation: {
    key: 'employee_confirmation',
    name: 'Employee Confirmation',
    dltContentId: '1707178393313545581',
    registeredText: 'Dear {#var#}, your employment confirmation status has been updated as {#var#} effective from {#var#}. Please check HRMS. - Ispark',
    variableCount: 3,
    variableNames: ['name', 'status', 'effective_date'],
  },

  transfer_update: {
    key: 'transfer_update',
    name: 'Transfer Update',
    dltContentId: '1707178393329672534',
    registeredText: 'Dear {#var#}, your branch, process, or reporting details have been updated effective {#var#}. Please check HRMS. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'effective_date'],
  },

  separation_initiated: {
    key: 'separation_initiated',
    name: 'Separation Initiated',
    dltContentId: '1707178393332790295',
    registeredText: 'Dear {#var#}, your separation process has been initiated in HRMS. Please complete pending formalities as advised by HR. - Ispark',
    variableCount: 1,
    variableNames: ['name'],
  },

  fnf_status: {
    key: 'fnf_status',
    name: 'FNF Status',
    dltContentId: '1707178393339493395',
    registeredText: 'Dear {#var#}, your full and final settlement status has been updated as {#var#}. Please contact HR for further details. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'status'],
  },

  // ── Helpdesk / Tickets ────────────────────────────────────────────────────
  ticket_created: {
    key: 'ticket_created',
    name: 'Ticket Created',
    dltContentId: '1707178393347617890',
    registeredText: 'Dear {#var#}, your HRMS ticket {#var#} has been created successfully. Current status is {#var#}. - Ispark',
    variableCount: 3,
    variableNames: ['name', 'ticket_id', 'status'],
  },

  ticket_resolved: {
    key: 'ticket_resolved',
    name: 'Ticket Resolved',
    dltContentId: '1707178393352167844',
    registeredText: 'Dear {#var#}, your HRMS ticket {#var#} has been resolved. Please check HRMS for resolution details. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'ticket_id'],
  },

  ticket_reopened: {
    key: 'ticket_reopened',
    name: 'Ticket Reopened',
    dltContentId: '1707178393359938439',
    registeredText: 'Dear {#var#}, your HRMS ticket {#var#} has been reopened and assigned for further review. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'ticket_id'],
  },

  // ── Policy ────────────────────────────────────────────────────────────────
  policy_acknowledgement_pending: {
    key: 'policy_acknowledgement_pending',
    name: 'Policy Acknowledgement Pending',
    dltContentId: '1707178393366406758',
    registeredText: 'Dear {#var#}, acknowledgement for {#var#} policy is pending. Please complete it in HRMS by {#var#}. - Ispark',
    variableCount: 3,
    variableNames: ['name', 'policy_name', 'deadline'],
  },

  policy_acknowledged: {
    key: 'policy_acknowledged',
    name: 'Policy Acknowledged',
    dltContentId: '1707178393372430252',
    registeredText: 'Dear {#var#}, your acknowledgement for {#var#} policy has been recorded successfully in HRMS. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'policy_name'],
  },

  // ── LMS / Training ────────────────────────────────────────────────────────
  training_assigned: {
    key: 'training_assigned',
    name: 'Training Assigned',
    dltContentId: '1707178393378172639',
    registeredText: 'Dear {#var#}, training module {#var#} has been assigned to you in HRMS. Please complete it by {#var#}. - Ispark',
    variableCount: 3,
    variableNames: ['name', 'module_name', 'deadline'],
  },

  training_reminder: {
    key: 'training_reminder',
    name: 'Training Reminder',
    dltContentId: '1707178393384289108',
    registeredText: 'Dear {#var#}, your training module {#var#} is pending. Please complete it by {#var#}. - Ispark',
    variableCount: 3,
    variableNames: ['name', 'module_name', 'deadline'],
  },

  pkt_scheduled: {
    key: 'pkt_scheduled',
    name: 'PKT Scheduled',
    dltContentId: '1707178393391295367',
    registeredText: 'Dear {#var#}, your PKT for {#var#} is scheduled on {#var#}. Please check HRMS for details. - Ispark',
    variableCount: 3,
    variableNames: ['name', 'subject', 'scheduled_date'],
  },

  pkt_result: {
    key: 'pkt_result',
    name: 'PKT Result',
    dltContentId: '1707178393397311672',
    registeredText: 'Dear {#var#}, your PKT result for {#var#} has been updated as {#var#}. Please check HRMS for details. - Ispark',
    variableCount: 3,
    variableNames: ['name', 'subject', 'result'],
  },

  // ── Security / System ─────────────────────────────────────────────────────
  preference_updated: {
    key: 'preference_updated',
    name: 'Preference Updated',
    dltContentId: '1707178393402763728',
    registeredText: 'Dear {#var#}, your HRMS notification preference has been updated successfully on {#var#}. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'date'],
  },

  new_device_login: {
    key: 'new_device_login',
    name: 'New Device Login',
    dltContentId: '1707178393408210979',
    registeredText: 'Dear {#var#}, new login detected in your HRMS account on {#var#}. If this was not you, please contact HR immediately. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'datetime'],
  },

  password_changed: {
    key: 'password_changed',
    name: 'Password Changed',
    dltContentId: '1707178393413685954',
    registeredText: 'Dear {#var#}, your HRMS password was changed successfully on {#var#}. If this was not you, please contact HR immediately. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'datetime'],
  },

  maintenance_notice: {
    key: 'maintenance_notice',
    name: 'Maintenance Notice',
    dltContentId: '1707178393420497774',
    registeredText: 'Dear {#var#}, HRMS will be under maintenance from {#var#} to {#var#}. Services may be temporarily unavailable. - Ispark',
    variableCount: 3,
    variableNames: ['name', 'from_datetime', 'to_datetime'],
  },

  bulk_upload_failed: {
    key: 'bulk_upload_failed',
    name: 'Bulk Upload Failed',
    dltContentId: '1707178393433983201',
    registeredText: 'Dear {#var#}, bulk upload for {#var#} failed due to {#var#}. Please review and upload again in HRMS. - Ispark',
    variableCount: 3,
    variableNames: ['name', 'upload_type', 'reason'],
  },

  // ── Manager summaries ─────────────────────────────────────────────────────
  team_short_attendance: {
    key: 'team_short_attendance',
    name: 'Team Short Attendance',
    dltContentId: '1707178393439674990',
    registeredText: 'Dear {#var#}, {#var#} team member or members have short attendance for {#var#}. Please review in HRMS. - Ispark',
    variableCount: 3,
    variableNames: ['manager_name', 'count', 'date'],
  },

  team_leave_pending: {
    key: 'team_leave_pending',
    name: 'Team Leave Pending',
    dltContentId: '1707178393444595198',
    registeredText: 'Dear {#var#}, {#var#} leave request or requests are pending for your approval in HRMS. Please review. - Ispark',
    variableCount: 2,
    variableNames: ['manager_name', 'count'],
  },

  team_regularization_pending: {
    key: 'team_regularization_pending',
    name: 'Team Regularization Pending',
    dltContentId: '1707178393449101813',
    registeredText: 'Dear {#var#}, {#var#} attendance regularization request or requests are pending for your approval in HRMS. Please review. - Ispark',
    variableCount: 2,
    variableNames: ['manager_name', 'count'],
  },

  payroll_approval_pending: {
    key: 'payroll_approval_pending',
    name: 'Payroll Approval Pending',
    dltContentId: '1707178393453438708',
    registeredText: 'Dear {#var#}, payroll approval for {#var#} is pending at your level. Please review it in HRMS. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'payroll_period'],
  },

  statutory_approval_pending: {
    key: 'statutory_approval_pending',
    name: 'Statutory Approval Pending',
    dltContentId: '1707178393458478617',
    registeredText: 'Dear {#var#}, statutory update request for {#var#} is pending at your level. Please review it in HRMS. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'update_type'],
  },

  candidate_review_pending: {
    key: 'candidate_review_pending',
    name: 'Candidate Review Pending',
    dltContentId: '1707178393463705412',
    registeredText: 'Dear {#var#}, onboarding review for candidate {#var#} is pending at your level. Please review it in HRMS. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'candidate_name'],
  },

  // ── Exit ──────────────────────────────────────────────────────────────────
  exit_clearance_pending: {
    key: 'exit_clearance_pending',
    name: 'Exit Clearance Pending',
    dltContentId: '1707178393468146079',
    registeredText: 'Dear {#var#}, your exit clearance is pending with {#var#}. Please complete the required action in HRMS. - Ispark',
    variableCount: 2,
    variableNames: ['name', 'pending_with'],
  },

  exit_clearance_completed: {
    key: 'exit_clearance_completed',
    name: 'Exit Clearance Completed',
    dltContentId: '1707178393471909710',
    registeredText: 'Dear {#var#}, your exit clearance has been completed successfully. Please contact HR for next steps. - Ispark',
    variableCount: 1,
    variableNames: ['name'],
  },
};

/**
 * Build an SMS payload for a given template key and variable map.
 * Variables are substituted positionally in the order defined by `variableNames`.
 *
 * @example
 *   const { body, dltContentId } = buildSMS('hrms_login_otp', { otp: '123456', validity_minutes: '5' });
 */
export function buildSMS(
  templateKey: string,
  variables: Record<string, string | number>,
): { body: string; dltContentId: string } {
  const tpl = SMARTPING_DLT_REGISTRY[templateKey];
  if (!tpl) {
    throw new Error(`Unknown SmartPing DLT template key: "${templateKey}"`);
  }

  let body = tpl.registeredText;
  for (const varName of tpl.variableNames) {
    const value = variables[varName];
    if (value === undefined || value === null) {
      throw new Error(`Missing variable "${varName}" for SMS template "${templateKey}"`);
    }
    body = body.replace('{#var#}', String(value));
  }

  return { body, dltContentId: tpl.dltContentId };
}

/**
 * List all template keys grouped by domain (for admin UI / autocomplete).
 */
export function listTemplates(): { key: string; name: string; variableNames: string[] }[] {
  return Object.values(SMARTPING_DLT_REGISTRY).map(t => ({
    key: t.key,
    name: t.name,
    variableNames: t.variableNames,
  }));
}
