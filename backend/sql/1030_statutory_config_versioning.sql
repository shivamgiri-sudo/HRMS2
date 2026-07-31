-- Effective-dated statutory configuration.
--
-- WHY
-- ---
-- statutory_config holds one row per key (config_key is UNIQUE) and no read in
-- the codebase filters on its effective_from column. Two consequences, both
-- mandatory to fix before payroll can be called correct:
--
--   1. Two financial years' values cannot coexist. A Finance Act change forces
--      an overwrite of the live row, so from that moment the rates that applied
--      to earlier months are gone.
--   2. A prior month can therefore no longer be recomputed at the rates that
--      were actually applied to it — which is exactly what Form 16 and the
--      quarterly 24Q have to reconcile against. Under s.201(1A) a shortfall
--      carries interest at 1%/month (failure to deduct) or 1.5%/month
--      (deducted, not deposited), and the liability sits with the employer.
--
-- This table makes a rate change a DATA change: insert the new version with its
-- effective_from, leave the old one in place, and every period keeps resolving
-- to the values that were in force for it.
--
-- APPROVAL
-- --------
-- approved_at / approved_by exist because the charter requires TDS to be
-- blocked or pending unless APPROVED effective-dated configuration exists. A
-- row with approved_at NULL is a proposal and is not used for computation.
--
-- ADDITIVE AND UNEXECUTED
-- -----------------------
-- Creates a new table and copies from the existing one. It does not alter or
-- drop statutory_config, so nothing that reads statutory_config today changes
-- behaviour. Not run against any database by this change.

CREATE TABLE IF NOT EXISTS statutory_config_version (
  id             CHAR(36)       NOT NULL DEFAULT (UUID()),
  config_key     VARCHAR(100)   NOT NULL,
  config_value   DECIMAL(15,4)  NOT NULL,

  -- Inclusive start. The row applies to any payroll period whose first day is
  -- on or after this date, until superseded by a later version or closed off.
  effective_from DATE           NOT NULL,
  -- Inclusive end, NULL while current. Set it when a version is superseded so
  -- historical periods keep resolving to the right row.
  effective_to   DATE           NULL,

  -- Unapproved rows are proposals and are never used to compute payroll.
  approved_by    CHAR(36)       NULL,
  approved_at    DATETIME       NULL,

  -- Provenance for audit: "Finance Act 2025", "CBDT circular ...", etc.
  source         VARCHAR(255)   NULL,
  notes          VARCHAR(500)   NULL,

  created_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  -- One value per key per start date. This is the constraint statutory_config
  -- cannot express, and the reason two financial years cannot coexist there.
  UNIQUE KEY uq_scv_key_effective (config_key, effective_from),
  INDEX idx_scv_key_from (config_key, effective_from),
  INDEX idx_scv_approved (approved_at)
);

-- Seed the current live values as the first approved version, so resolution
-- works for existing periods the moment the table exists. INSERT IGNORE keeps
-- this migration idempotent and prevents it overwriting anything already
-- versioned by hand.
--
-- effective_from falls back to 1900-01-01 where statutory_config left it NULL:
-- an unknown start date must resolve for every period rather than none, since
-- these are the values payroll has in fact been using.
--
-- Backfilled rows are marked approved because they ARE what production is
-- computing with today. Treating them as proposals would block every payroll
-- run the moment this table is read.
INSERT IGNORE INTO statutory_config_version
  (id, config_key, config_value, effective_from, effective_to, approved_by, approved_at, source, notes)
SELECT
  UUID(),
  sc.config_key,
  sc.config_value,
  COALESCE(sc.effective_from, '1900-01-01'),
  NULL,
  NULL,
  NOW(),
  'backfill: statutory_config',
  'Seeded from the live statutory_config row when versioning was introduced.'
FROM statutory_config sc
WHERE sc.is_active = 1;
