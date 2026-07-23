-- Migration 528: Add handover workflow columns to job_requisition
-- Additive only — no existing columns modified

ALTER TABLE job_requisition
  ADD COLUMN handover_status ENUM('not_ready', 'ready', 'handed_over') NOT NULL DEFAULT 'not_ready' AFTER fulfillment_percentage,
  ADD COLUMN handover_at DATETIME NULL AFTER handover_status,
  ADD COLUMN handover_by VARCHAR(36) NULL AFTER handover_at,
  ADD COLUMN handover_notes TEXT NULL AFTER handover_by;
