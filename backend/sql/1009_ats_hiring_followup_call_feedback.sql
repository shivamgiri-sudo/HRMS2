-- Migration 1009: Follow-up call feedback columns on ats_recruiter_hiring_activity
-- Stores the outcome of the actual follow-up call in the same row as the entry.

ALTER TABLE ats_recruiter_hiring_activity
  ADD COLUMN followup_call_done      TINYINT(1)   NOT NULL DEFAULT 0    AFTER followup_reason,
  ADD COLUMN followup_call_date      DATE         NULL                   AFTER followup_call_done,
  ADD COLUMN followup_call_outcome   VARCHAR(100) NULL                   AFTER followup_call_date,
  ADD COLUMN followup_call_notes     TEXT         NULL                   AFTER followup_call_outcome,
  ADD COLUMN followup_rescheduled_to DATE         NULL                   AFTER followup_call_notes;

CREATE INDEX idx_arha_followup_call
  ON ats_recruiter_hiring_activity (followup_call_done, followup_call_date);
