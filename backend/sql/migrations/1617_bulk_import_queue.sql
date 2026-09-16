-- Migration 1617: Bulk import job queue
--
-- Moves bulk import execution off the API process and into hrms-workers.
-- The API enqueues a job here and returns 202; the worker polls this table,
-- claims one job at a time, and runs dispatchImport.
--
-- batch_status on upload_batch remains 'importing' for the full duration so
-- the existing status-polling UI requires no changes.

CREATE TABLE IF NOT EXISTS bulk_import_queue (
  id            VARCHAR(36)  NOT NULL,
  batch_id      VARCHAR(60)  NOT NULL,
  rpc_name      VARCHAR(120) NOT NULL,
  user_id       VARCHAR(36)  NOT NULL,
  queued_at     DATETIME     NOT NULL DEFAULT NOW(),
  claimed_at    DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_batch (batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
