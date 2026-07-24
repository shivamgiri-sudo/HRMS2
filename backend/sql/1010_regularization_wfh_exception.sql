-- Migration 1010: Add work_from_home to attendance_regularization.dispute_type ENUM
-- and ensure WFH reason is seeded in attendance_reason_master

ALTER TABLE attendance_regularization
  MODIFY COLUMN dispute_type ENUM(
    'missing_punch',
    'wrong_punch',
    'late_mark_dispute',
    'early_logout_dispute',
    'half_day_dispute',
    'absent_wrongly_marked',
    'week_off_worked',
    'holiday_worked',
    'shift_mismatch',
    'cosec_sync_issue',
    'manual_punch_correction',
    'work_from_home'
  ) NULL;

-- Ensure WFH reason code exists and is active
INSERT IGNORE INTO attendance_reason_master (code, label, allowed_for, active)
VALUES ('WFH_NOT_CAPTURED', 'Work from Home attendance not captured', 'both', 1);

-- Update label if row already exists with old label
UPDATE attendance_reason_master
SET label = 'Work from Home attendance not captured', active = 1
WHERE code = 'WFH_NOT_CAPTURED';
