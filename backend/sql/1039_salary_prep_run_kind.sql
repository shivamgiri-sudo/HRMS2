-- 1039_salary_prep_run_kind.sql
--
-- Gives salary_prep_run a way to say what a run *is*, so two runs for one month can be
-- distinguished instead of looking like duplicates of each other.
--
-- Why this is needed. salary_prep_run has carried
-- uq_run_month_branch_process UNIQUE (run_month, branch_filter, process_filter) since it
-- was created, and it is genuinely UNIQUE — but all 66 production runs have both filter
-- columns NULL, and MySQL treats NULL as distinct from NULL, so any number of
-- (month, NULL, NULL) rows insert freely. The constraint has never once fired.
--
-- scripts/payroll-run-scope-uniqueness.sql fixes that with sentinel-folded columns. It
-- cannot be applied yet, because one month legitimately holds two full-company runs:
--
--   2026-03  3ebd0ab6  FINALIZED  1,140 lines  ₹2.17 Cr  NOIDA, NOIDA-2,
--                                                        AHMEDABAD-JALDARSHAN, HEAD OFFICE
--   2026-03  5469fa7d  approved     226 lines  ₹20.4 L   Delhi Office, KARNAL,
--                                                        AHEMDABAD HOUSE, MOHALI,
--                                                        HYDERABAD, JAIPUR, MEERUT
--
-- Zero employee overlap and disjoint branch sets: these are two different populations, not
-- one payroll run twice. A month+scope unique key would reject the pair and force one of
-- them to be deleted. run_kind is the missing dimension that lets both stand.
--
-- (2026-07 was a true duplicate — the test-auto-gen run's 1,288 employees were a perfect
-- subset of the real run's 1,467 — and was purged and archived on 2026-07-31. 2026-03 is
-- now the only month holding two runs.)
--
-- Deliberately additive only. This adds the column and backfills every existing row to
-- 'regular', which changes no behaviour: nothing reads run_kind yet, and no constraint is
-- created here. Classifying 5469fa7d and applying the unique key are separate, explicit
-- steps — see the bottom of this file.
--
-- Safe to re-run.

SET @has_kind := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'salary_prep_run'
     AND COLUMN_NAME = 'run_kind'
);
SET @sql := IF(@has_kind = 0,
  "ALTER TABLE salary_prep_run
     ADD COLUMN run_kind ENUM('regular','legacy_import','supplementary','offcycle')
       NOT NULL DEFAULT 'regular'
       COMMENT 'What this run is. regular = the month''s operational payroll. legacy_import = historical data brought in from a prior system. supplementary = an additional run for the same month. offcycle = paid outside the normal cycle.'
       AFTER run_month",
  'SELECT "run_kind already present" AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Lookup path for "the regular run for month X", which is what every report means when it
-- asks for a month's payroll.
SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'salary_prep_run'
     AND INDEX_NAME = 'idx_spr_month_kind'
);
SET @sql := IF(@has_idx = 0,
  'CREATE INDEX idx_spr_month_kind ON salary_prep_run (run_month, run_kind)',
  'SELECT "idx_spr_month_kind already present" AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification
-- ─────────────────────────────────────────────────────────────────────────────
SELECT run_kind, COUNT(*) AS runs FROM salary_prep_run GROUP BY run_kind;

-- Months still holding more than one run of the same kind. These are what the unique key
-- in scripts/payroll-run-scope-uniqueness.sql would reject.
SELECT run_month,
       run_kind,
       COUNT(*) AS runs,
       GROUP_CONCAT(id ORDER BY created_at) AS run_ids
  FROM salary_prep_run
 GROUP BY run_month, run_kind
HAVING COUNT(*) > 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- NOT RUN HERE — the classification decision
-- ─────────────────────────────────────────────────────────────────────────────
-- The evidence that 5469fa7d is a legacy import rather than March's operational payroll:
--   * 172 of its 226 employees are inactive; date_of_joining spans 2005–2015
--   * its branches (Delhi Office, KARNAL, AHEMDABAD HOUSE, MOHALI, HYDERABAD, JAIPUR,
--     MEERUT) appear in no other run and are not current operating branches
--   * present_days exceeds working_days on its lines, which no real calculation produces
--   * the operational run for the same month, 3ebd0ab6, covers 1,140 of the 1,152 active
--     employees in the three current branches
--
-- Against it: the run carries one payroll_disbursement row, so money was moved against it
-- at some point. 12 of the 66 runs carry exactly one such row, so this looks like a batch
-- marker rather than a per-employee payment, but that is inference, not proof.
--
-- Payroll owns this call, not a migration. Once decided:
--
--   UPDATE salary_prep_run SET run_kind = 'legacy_import'
--    WHERE id = '5469fa7d-6592-11f1-adb1-00155d0ab410';
--
-- then run scripts/payroll-run-scope-uniqueness.sql, whose Step 0 will confirm nothing is
-- left blocking.
