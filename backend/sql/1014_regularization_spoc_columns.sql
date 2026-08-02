-- Add Branch WFM SPOC tracking columns to attendance_regularization.
-- These preserve manager review details independently of the final WFM SPOC approval.
-- Uses separate ALTER TABLE statements (one per column) for MySQL 8.0 compatibility.

ALTER TABLE attendance_regularization ADD COLUMN manager_reviewer_user_id   CHAR(36) NULL;
ALTER TABLE attendance_regularization ADD COLUMN manager_reviewed_at        DATETIME NULL;
ALTER TABLE attendance_regularization ADD COLUMN manager_review_note        TEXT NULL;
ALTER TABLE attendance_regularization ADD COLUMN assigned_wfm_spoc_user_id  CHAR(36) NULL;
ALTER TABLE attendance_regularization ADD COLUMN assigned_wfm_spoc_at       DATETIME NULL;
ALTER TABLE attendance_regularization ADD COLUMN final_wfm_reviewer_user_id CHAR(36) NULL;
ALTER TABLE attendance_regularization ADD COLUMN final_wfm_reviewed_at      DATETIME NULL;
ALTER TABLE attendance_regularization ADD COLUMN final_wfm_review_note      TEXT NULL;
