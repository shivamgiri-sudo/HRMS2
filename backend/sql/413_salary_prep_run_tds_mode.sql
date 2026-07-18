-- Migration 413: Add tds_mode column to salary_prep_run
-- Enables per-run selection of auto (DB-driven tax engine) vs manual TDS entry.
-- Default 'manual' preserves all existing run behaviour — no data change.
-- DO NOT execute against production without explicit approval.

USE mas_hrms;

ALTER TABLE salary_prep_run
  ADD COLUMN IF NOT EXISTS tds_mode ENUM('auto','manual') NOT NULL DEFAULT 'manual'
    COMMENT 'auto = taxEngineService calculates TDS; manual = salary_run_manual_tds overrides';
