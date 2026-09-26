-- Migration 1644: Onfido Utilization bulk upload
--
-- Adds the storage + upload-template registration for the "Onfido Utilization" bulk upload
-- feature requested for the Onfido Process Dashboard: a queue-wise (Extraction Queue / POA Queue /
-- Encord / etc.) daily headcount sheet — Approved HC, Required HC, Active HC, Buffer %, Shortfall —
-- uploaded weekly or daily and used to refresh the dashboard directly from the uploaded data.
--
-- SCAFFOLD NOTE: the exact column set below is modelled on the "Queue Wise" panel already shown
-- in the Onfido dashboard mock (Queue / Required HC / Active HC / Buffer % / Shortfall, with
-- "Required HC = Approved HC x 120%" noted alongside it) because the real Onfido Utilization
-- sheet template referenced in the request was never attached to this change. If the real sheet
-- uses different column names or additional columns, this table's columns (and the matching
-- required_columns/optional_columns below) should be adjusted to match it exactly before this
-- goes live — the upload route (onfido-utilization.routes.ts) reads columns by name, so renaming
-- them here and there together is a mechanical, low-risk follow-up.
--
-- Idempotent — CREATE TABLE IF NOT EXISTS + INSERT IGNORE, safe to re-run.
--
-- ROLLBACK
--   DELETE FROM upload_template_master WHERE upload_type_code = 'ONFIDO_UTILIZATION_BULK';
--   DROP TABLE onfido_utilization_upload;

CREATE TABLE IF NOT EXISTS onfido_utilization_upload (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()),
  -- The calendar date this row's headcount snapshot applies to. Daily and weekly uploads both
  -- carry one row per (upload_date, queue_name) — a weekly upload simply submits 7 dates at once.
  upload_date     DATE          NOT NULL,
  queue_name      VARCHAR(100)  NOT NULL,
  approved_hc     INT           NULL,
  required_hc     INT           NULL,
  active_hc       INT           NULL,
  buffer_pct      DECIMAL(6,2)  NULL,
  shortfall       INT           NULL,
  -- Provenance of the batch this row last came from, so a re-upload for the same date/queue is
  -- traceable to which file replaced it (requirement: re-uploading the same date/week must
  -- override the existing row, never create a duplicate).
  upload_batch_id CHAR(36)      NULL,
  uploaded_by     CHAR(36)      NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- The override-not-duplicate contract lives here: one row per (date, queue), enforced by the
  -- database itself so the upload route's ON DUPLICATE KEY UPDATE cannot drift into duplicates
  -- even if a future caller bypasses the route's own dedupe logic.
  UNIQUE KEY uq_ouu_date_queue (upload_date, queue_name),
  KEY idx_ouu_date (upload_date)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Onfido Utilization bulk upload — queue-wise daily HC snapshot (Approved/Required/Active HC, Buffer %, Shortfall) feeding the Onfido dashboard. One row per (upload_date, queue_name); re-upload overrides, never duplicates.';

INSERT IGNORE INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES (
  UUID(),
  'ONFIDO_UTILIZATION_BULK',
  'Onfido Utilization',
  'onfido_utilization_upload',
  'Queue-wise daily headcount snapshot for the Onfido process (Extraction Queue, POA Queue, Encord, etc.) — Approved HC, Required HC, Active HC, Buffer %, Shortfall. Weekly or daily upload; re-uploading the same date and queue replaces the existing row rather than duplicating it. Static values only — no formulas.',
  JSON_ARRAY('upload_date', 'queue_name', 'required_hc', 'active_hc'),
  JSON_ARRAY('approved_hc', 'buffer_pct', 'shortfall'),
  JSON_OBJECT(
    'upload_date', '2026-09-01',
    'queue_name', 'Extraction Queue',
    'approved_hc', '55',
    'required_hc', '66',
    'active_hc', '60',
    'buffer_pct', '9.1',
    'shortfall', '0'
  ),
  1
);

SELECT '1644_onfido_utilization_upload.sql applied successfully' AS migration_status;
