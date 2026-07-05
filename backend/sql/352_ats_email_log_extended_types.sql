-- 352_ats_email_log_extended_types.sql
-- Extend ats_email_log.email_type so newer ATS notifications do not fail logging.

ALTER TABLE ats_email_log
  MODIFY COLUMN email_type ENUM(
    'registration',
    'selected',
    'rejected',
    'rejected_professional',
    'token_sent',
    'offer_review',
    'approved',
    'welcome',
    'recruiter_notification',
    'selection_congratulations',
    'bgv_completion',
    'payroll_hr_notification',
    'branch_head_approval',
    'otp_verification'
  ) NOT NULL;
