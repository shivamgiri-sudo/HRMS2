-- ============================================================
-- Migration: 1064_celebration_post_type.sql
-- Purpose  : Add post_type and is_system_post to company_posts
--            for auto birthday / work-anniversary feed posts.
--            Also allow author_employee_id to be NULL so system-
--            generated posts don't require a human employee-author.
-- Safe to re-run: all statements use IF NOT EXISTS / IGNORE guards.
--
-- FIXED 2026-08-14: `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` are MariaDB
-- syntax, rejected by this production MySQL 8.0.42 build with ER_PARSE_ERROR — the "Safe to
-- re-run" claim above was true in intent but not in practice on this server. All three columns
-- and both indexes already exist on production (confirmed via information_schema before this
-- fix; this file is recorded success=1 since 2026-08-03), so this is a no-op guard rewrite.
-- ============================================================

-- Add post_type column (default 'user' keeps all existing rows unchanged)
SET @c1 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_posts' AND COLUMN_NAME = 'post_type');
SET @sql = IF(@c1 = 0, 'ALTER TABLE company_posts ADD COLUMN post_type VARCHAR(32) NOT NULL DEFAULT ''user''', 'SELECT "post_type already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c2 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_posts' AND COLUMN_NAME = 'is_system_post');
SET @sql = IF(@c2 = 0, 'ALTER TABLE company_posts ADD COLUMN is_system_post TINYINT(1) NOT NULL DEFAULT 0', 'SELECT "is_system_post already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c3 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_posts' AND COLUMN_NAME = 'celebrated_employee_id');
SET @sql = IF(@c3 = 0, 'ALTER TABLE company_posts ADD COLUMN celebrated_employee_id CHAR(36) NULL', 'SELECT "celebrated_employee_id already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Allow author_employee_id to be NULL for system posts
ALTER TABLE company_posts
  MODIFY COLUMN author_employee_id CHAR(36) NULL;

-- Index for feed queries filtering by type
SET @i1 = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_posts' AND INDEX_NAME = 'idx_company_posts_type');
SET @sql = IF(@i1 = 0, 'ALTER TABLE company_posts ADD INDEX idx_company_posts_type (post_type)', 'SELECT "idx_company_posts_type already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index for finding posts about a specific employee (e.g. "my birthday posts")
SET @i2 = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_posts' AND INDEX_NAME = 'idx_company_posts_celebrated');
SET @sql = IF(@i2 = 0, 'ALTER TABLE company_posts ADD INDEX idx_company_posts_celebrated (celebrated_employee_id)', 'SELECT "idx_company_posts_celebrated already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
