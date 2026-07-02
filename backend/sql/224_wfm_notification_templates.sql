-- Migration 224: WFM / Roster notification template seeds
-- Uses INSERT IGNORE — safe to re-run even if already seeded.
-- All WFM-specific trigger events that the notification dispatcher will fire.

INSERT IGNORE INTO notification_template
  (id, template_code, template_name, trigger_event, audience, channel,
   subject, body_template, sms_template, active_status)
VALUES
-- Roster published: employee receives their week schedule
(UUID(), 'ROSTER_PUBLISHED',
 'Roster Published Notification',
 'roster_cycle_published',
 'employee',
 'both',
 'Your roster for the week of {{week_start}} is now available',
 'Hi {{employee_name}},\n\nYour work schedule for the week of {{week_start}} to {{week_end}} has been published.\n\nPlease log in to the HRMS portal to view your shifts and acknowledge your roster before {{ack_deadline}}.\n\nIf you have any concerns, raise a dispute through the portal.\n\nRegards,\n{{company_name}} WFM Team',
 'Roster for w/o {{week_start}} published. View & acknowledge by {{ack_deadline}}. Login: {{portal_url}}',
 1),

-- Roster acknowledgement reminder: sent 24h before ack_deadline
(UUID(), 'ROSTER_ACK_REMINDER',
 'Roster Acknowledgement Reminder',
 'roster_ack_reminder',
 'employee',
 'both',
 'Action Required: Acknowledge your roster by {{ack_deadline}}',
 'Hi {{employee_name}},\n\nThis is a reminder that your roster for the week of {{week_start}} is still pending acknowledgement.\n\nPlease log in to the portal and acknowledge your schedule before {{ack_deadline}}.\n\nIf you do not acknowledge, your roster will be auto-confirmed.\n\nRegards,\n{{company_name}} WFM Team',
 'Reminder: Acknowledge your week-off {{week_start}} roster by {{ack_deadline}}. Login: {{portal_url}}',
 1),

-- Week-off approved
(UUID(), 'WEEKOFF_APPROVED',
 'Week-Off Request Approved',
 'weekoff_preference_approved',
 'employee',
 'both',
 'Your week-off preference for {{preferred_day_name}} has been approved',
 'Hi {{employee_name}},\n\nGreat news! Your week-off preference for {{preferred_day_name}} has been approved.\n\nThis will be reflected in your upcoming roster.\n\nRegards,\n{{company_name}} WFM Team',
 'Week-off on {{preferred_day_name}} approved. Check your roster on the portal.',
 1),

-- Week-off denied
(UUID(), 'WEEKOFF_DENIED',
 'Week-Off Request Denied',
 'weekoff_preference_denied',
 'employee',
 'both',
 'Your week-off preference for {{preferred_day_name}} could not be accommodated',
 'Hi {{employee_name}},\n\nWe regret to inform you that your week-off preference for {{preferred_day_name}} could not be approved due to process capacity constraints.\n\n{{#if alternate_day_name}}Your alternate day ({{alternate_day_name}}) preference has been noted and will be considered.{{/if}}\n\nFor any queries, please contact your WFM team.\n\nRegards,\n{{company_name}} WFM Team',
 'Week-off on {{preferred_day_name}} denied (capacity full). Contact WFM for details.',
 1),

-- Week-off waitlisted
(UUID(), 'WEEKOFF_WAITLISTED',
 'Week-Off Request Waitlisted',
 'weekoff_preference_waitlisted',
 'employee',
 'email',
 'Your week-off preference for {{preferred_day_name}} is waitlisted (position #{{queue_position}})',
 'Hi {{employee_name}},\n\nYour week-off preference for {{preferred_day_name}} has been received and is currently waitlisted at position #{{queue_position}}.\n\nYou will be notified if a slot becomes available before roster finalisation.\n\nRegards,\n{{company_name}} WFM Team',
 NULL,
 1),

-- Shift changed / override applied post-publish
(UUID(), 'SHIFT_CHANGED',
 'Roster Shift Change Notification',
 'roster_shift_changed',
 'employee',
 'both',
 'Your shift on {{roster_date}} has been updated',
 'Hi {{employee_name}},\n\nPlease note that your shift on {{roster_date}} has been updated:\n\nPrevious: {{old_shift_name}} ({{old_start_time}} – {{old_end_time}})\nNew: {{new_shift_name}} ({{new_start_time}} – {{new_end_time}})\n\nReason: {{change_reason}}\n\nFor any queries, contact your manager or WFM team.\n\nRegards,\n{{company_name}} WFM Team',
 'Shift on {{roster_date}} changed to {{new_shift_name}} ({{new_start_time}}-{{new_end_time}}). Reason: {{change_reason}}',
 1),

-- Roster dispute raised: manager/WFM notified
(UUID(), 'ROSTER_DISPUTE_RAISED',
 'Roster Dispute Raised by Employee',
 'roster_dispute_raised',
 'manager',
 'email',
 'Roster dispute raised by {{employee_name}} for {{roster_date}}',
 'Hi {{manager_name}},\n\n{{employee_name}} ({{employee_code}}) has raised a dispute for their roster assignment on {{roster_date}}.\n\nAssigned Shift: {{shift_name}} ({{start_time}} – {{end_time}})\nDispute Reason: {{dispute_reason}}\n\nPlease review and resolve the dispute from the Manager Review Queue in the HRMS portal.\n\nLink: {{portal_url}}/wfm/manager-review-queue\n\nRegards,\n{{company_name}} WFM System',
 NULL,
 1),

-- Roster dispute resolved: employee notified
(UUID(), 'ROSTER_DISPUTE_RESOLVED',
 'Your Roster Dispute Has Been Resolved',
 'roster_dispute_resolved',
 'employee',
 'both',
 'Your roster dispute for {{roster_date}} has been resolved',
 'Hi {{employee_name}},\n\nYour roster dispute for {{roster_date}} has been reviewed and resolved.\n\nResolution: {{dispute_resolution}}\n\n{{#if shift_changed}}Your shift has been updated to {{new_shift_name}} ({{new_start_time}} – {{new_end_time}}).{{else}}Your original shift assignment has been retained.{{/if}}\n\nFor further queries, contact your WFM team.\n\nRegards,\n{{company_name}} WFM Team',
 'Roster dispute for {{roster_date}} resolved. Check portal for details.',
 1),

-- Regularization approved
(UUID(), 'REGULARIZATION_APPROVED',
 'Attendance Regularization Approved',
 'attendance_regularization_approved',
 'employee',
 'email',
 'Your attendance regularization for {{session_date}} has been approved',
 'Hi {{employee_name}},\n\nYour attendance regularization request for {{session_date}} has been approved by {{reviewer_name}}.\n\nAttendance for that date has been updated accordingly.\n\nRegards,\n{{company_name}} WFM Team',
 NULL,
 1),

-- Regularization rejected
(UUID(), 'REGULARIZATION_REJECTED',
 'Attendance Regularization Rejected',
 'attendance_regularization_rejected',
 'employee',
 'email',
 'Your attendance regularization for {{session_date}} could not be approved',
 'Hi {{employee_name}},\n\nYour attendance regularization request for {{session_date}} has been reviewed and could not be approved.\n\nReviewer Note: {{reviewer_note}}\n\nFor queries, please contact your WFM team.\n\nRegards,\n{{company_name}} WFM Team',
 NULL,
 1);

SELECT '224_wfm_notification_templates.sql applied successfully' AS migration_status;
