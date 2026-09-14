-- Migration 236: Add 'manager_rejected_request' to roster_decision_audit.decision_type ENUM
-- Purpose: Correct audit classification for manager reject-request action
-- Risk: LOW — ENUM extension is backward compatible (existing rows unchanged)
-- Rollback: See ROLLBACK section at end

-- ═══════════════════════════════════════════════════════════════════════════════
-- Extend decision_type ENUM to include manager_rejected_request
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE roster_decision_audit
  MODIFY COLUMN decision_type ENUM(
    -- original 6 values (preserved from migration 001)
    'shift_assigned',
    'weekoff_assigned',
    'weekoff_denied',
    'weekoff_waitlisted',
    'shift_frozen',
    'holiday_applied',
    -- values added in migration 229
    'preference_accepted',
    'alternate_assigned',
    'no_preference_auto_assigned',
    'manual_override',
    'manager_realigned',
    'force_approved',
    'hr_override',
    'bulk_upload',
    'escalated_to_hr',
    -- NEW value for migration 236
    'manager_rejected_request'
  ) NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (MySQL 8.0.16+)
-- ═══════════════════════════════════════════════════════════════════════════════
/*
-- WARNING: ENUM rollback requires table rebuild if any rows use 'manager_rejected_request'
-- Safe rollback only if no rows written with new value yet.

ALTER TABLE roster_decision_audit
  MODIFY COLUMN decision_type ENUM(
    'shift_assigned',
    'weekoff_assigned',
    'weekoff_denied',
    'weekoff_waitlisted',
    'shift_frozen',
    'holiday_applied',
    'preference_accepted',
    'alternate_assigned',
    'no_preference_auto_assigned',
    'manual_override',
    'manager_realigned',
    'force_approved',
    'hr_override',
    'bulk_upload',
    'escalated_to_hr'
  ) NOT NULL;

-- If any rows exist with decision_type='manager_rejected_request', rollback will fail.
-- Manual cleanup required:
-- UPDATE roster_decision_audit SET decision_type = 'force_approved'
--  WHERE decision_type = 'manager_rejected_request';
-- Then re-run ALTER TABLE above.
*/
