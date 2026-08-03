-- ============================================================
-- Migration: 1064_celebration_post_type.sql
-- Purpose  : Add post_type and is_system_post to company_posts
--            for auto birthday / work-anniversary feed posts.
--            Also allow author_employee_id to be NULL so system-
--            generated posts don't require a human employee-author.
-- Safe to re-run: all statements use IF NOT EXISTS / IGNORE guards.
-- ============================================================

-- Add post_type column (default 'user' keeps all existing rows unchanged)
ALTER TABLE company_posts
  ADD COLUMN IF NOT EXISTS post_type VARCHAR(32) NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS is_system_post TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS celebrated_employee_id CHAR(36) NULL;

-- Allow author_employee_id to be NULL for system posts
ALTER TABLE company_posts
  MODIFY COLUMN author_employee_id CHAR(36) NULL;

-- Index for feed queries filtering by type
CREATE INDEX IF NOT EXISTS idx_company_posts_type
  ON company_posts (post_type);

-- Index for finding posts about a specific employee (e.g. "my birthday posts")
CREATE INDEX IF NOT EXISTS idx_company_posts_celebrated
  ON company_posts (celebrated_employee_id);
