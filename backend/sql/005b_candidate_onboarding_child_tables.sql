-- 005b_candidate_onboarding_child_tables.sql
--
-- Creates four candidate-onboarding child tables that no migration has ever created.
--
-- WHY THIS EXISTS
--
-- candidate_onboarding_experience, candidate_onboarding_qualification,
-- candidate_onboarding_bank_detail and candidate_onboarding_document are ALTERed by eight
-- migrations, read by twenty-five backend source files, and defined nowhere in sql/.
-- Production has them — they were created outside the migration chain at some point — so
-- nothing has ever noticed. On a database built from the manifest they simply do not exist,
-- and every migration that touches them died until each reference was guarded.
--
-- Guarding stopped the chain halting. It did not give the tables a schema, so on a fresh
-- database the onboarding features silently have nowhere to write. This closes that.
--
-- THE SHAPE IS INFERRED, AND THAT MATTERS
--
-- Production's real definition could not be read: no production SQL is authorised for this
-- work. The columns below come from two sources that ARE in the repository —
--
--   * what the application reads, e.g. bgv-readiness.service.ts joins
--     candidate_onboarding_experience on candidate_id and reads employer_name,
--     experience_year and to_date; the qualification list orders by year_of_passing
--   * what the later ALTERs assume, via their AFTER clauses
--
-- Everything else those migrations add is left to them; they run after this file and are
-- already guarded, so a column defined here and added again is skipped, and a column only
-- they know about still arrives.
--
-- RECONCILE BEFORE RELYING ON THIS. One `SHOW CREATE TABLE` per table from production will
-- confirm or correct it in a single message. Until then, treat a fresh database as having
-- these tables approximately, not identically.
--
-- SAFE FOR PRODUCTION BY CONSTRUCTION. Every statement is CREATE TABLE IF NOT EXISTS, so on
-- a database that already has them this file does nothing at all — it cannot alter, widen or
-- reorder an existing table. And production never runs migrations (SKIP_MIGRATIONS=true).
--
-- Placed at 005b so it runs after 004_ats.sql, which creates the ats_candidate parent, and
-- long before 200 — the earliest migration that ALTERs any of them.

-- ─────────────────────────────────────────────────────────────────────────────
-- Prior employment. Read by the BGV readiness check.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_onboarding_experience (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id      CHAR(36)     NOT NULL,
  employer_name     VARCHAR(255)     NULL,
  designation       VARCHAR(255)     NULL,
  experience_year   DECIMAL(5,2)     NULL COMMENT 'Years at this employer',
  -- Migration 361 widens working_experience to VARCHAR(50) for longer UI labels, so it must
  -- exist here and must start narrower than that or 361 becomes a no-op that hides a
  -- regression. VARCHAR(20) is the width the label set outgrew.
  working_experience VARCHAR(20)     NULL COMMENT 'Free-text experience band shown in the UI',
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_coe_candidate (candidate_id),
  CONSTRAINT fk_coe_candidate FOREIGN KEY (candidate_id) REFERENCES ats_candidate (id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Education. The list query orders by year_of_passing, so it is not optional.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_onboarding_qualification (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id        CHAR(36)     NOT NULL,
  qualification_level VARCHAR(100)     NULL COMMENT '10th | 12th | graduate | postgraduate',
  year_of_passing     SMALLINT         NULL,
  percentage          DECIMAL(5,2)     NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_coq_candidate (candidate_id),
  INDEX idx_coq_year (candidate_id, year_of_passing),
  CONSTRAINT fk_coq_candidate FOREIGN KEY (candidate_id) REFERENCES ats_candidate (id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Bank details. One row per candidate — the service reads it with LIMIT 1.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_onboarding_bank_detail (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id         CHAR(36)     NOT NULL,
  account_holder_name  VARCHAR(255)     NULL,
  account_number       VARCHAR(64)      NULL,
  ifsc_code            VARCHAR(20)      NULL,
  bank_name            VARCHAR(255)     NULL,
  bank_branch_name     VARCHAR(255)     NULL,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cobd_candidate (candidate_id),
  CONSTRAINT fk_cobd_candidate FOREIGN KEY (candidate_id) REFERENCES ats_candidate (id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Uploaded documents. document_status is required: 272 positions name_match_status
-- immediately after it, and the joining control room filters on it.
-- deleted_at is a soft-delete marker the document list already filters on.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_onboarding_document (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id     CHAR(36)     NOT NULL,
  doc_type         VARCHAR(100)     NULL,
  doc_name         VARCHAR(255)     NULL,
  doc_category     VARCHAR(100)     NULL,
  document_status  VARCHAR(40)  NOT NULL DEFAULT 'pending',
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at       DATETIME         NULL,
  INDEX idx_cod_candidate (candidate_id),
  INDEX idx_cod_status (candidate_id, document_status),
  CONSTRAINT fk_cod_candidate FOREIGN KEY (candidate_id) REFERENCES ats_candidate (id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
SELECT TABLE_NAME, TABLE_COLLATION
  FROM INFORMATION_SCHEMA.TABLES
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME IN ('candidate_onboarding_experience','candidate_onboarding_qualification',
                      'candidate_onboarding_bank_detail','candidate_onboarding_document')
 ORDER BY TABLE_NAME;
-- EXPECT: 4 rows, all utf8mb4_unicode_ci. No charset is declared above, so each inherits the
-- database default — which is what keeps the foreign keys into ats_candidate valid.
