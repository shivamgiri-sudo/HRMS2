-- ============================================================
-- Migration: 1068_celebration_post_type.sql (supersedes 1064)
-- Purpose  : Add post_type and is_system_post to company_posts
--            for auto birthday / work-anniversary feed posts.
--            Also allow author_employee_id to be NULL so system-
--            generated posts don't require a human employee-author.
-- History  : 1064 used ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT
--            EXISTS, which this server's MySQL rejects with a syntax
--            error ("near 'IF NOT EXISTS post_type VARCHAR(32) ...'").
--            Ran it directly against production to confirm, and it
--            failed atomically (parse-time error, nothing applied).
--            Same fix as migration 436/438's precedent: remove the
--            broken filename from the manifest rather than fight its
--            now-poisoned schema_migrations row, and supersede with a
--            corrected migration under a new number. 1064 is kept on
--            disk for history only.
-- Safe to re-run: every statement is guarded, either via
--            INFORMATION_SCHEMA + PREPARE/EXECUTE or plain idempotent
--            MODIFY COLUMN.
-- ============================================================

-- Add post_type column (default 'user' keeps all existing rows unchanged)
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='company_posts' AND column_name='post_type')=0,
  'ALTER TABLE company_posts ADD COLUMN post_type VARCHAR(32) NOT NULL DEFAULT ''user''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='company_posts' AND column_name='is_system_post')=0,
  'ALTER TABLE company_posts ADD COLUMN is_system_post TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='company_posts' AND column_name='celebrated_employee_id')=0,
  'ALTER TABLE company_posts ADD COLUMN celebrated_employee_id CHAR(36) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Allow author_employee_id to be NULL for system posts. MODIFY COLUMN is naturally
-- idempotent (re-running with the same target definition is a no-op), unlike ADD COLUMN.
ALTER TABLE company_posts
  MODIFY COLUMN author_employee_id CHAR(36) NULL;

-- Index for feed queries filtering by type
SET @sql = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='company_posts' AND index_name='idx_company_posts_type')=0,
  'CREATE INDEX idx_company_posts_type ON company_posts (post_type)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index for finding posts about a specific employee (e.g. "my birthday posts")
SET @sql = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='company_posts' AND index_name='idx_company_posts_celebrated')=0,
  'CREATE INDEX idx_company_posts_celebrated ON company_posts (celebrated_employee_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
