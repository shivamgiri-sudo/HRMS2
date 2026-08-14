-- Migration 470: Company post engagement (likes/dislikes + comments)
-- Additive only — no existing tables modified except adding columns to company_posts
--
-- FIXED 2026-08-14: the ADD COLUMN clauses used `IF NOT EXISTS` — MariaDB syntax, rejected by
-- this production MySQL 8.0.42 build with ER_PARSE_ERROR (`CREATE TABLE IF NOT EXISTS` above
-- is standard MySQL and was never the problem). All target tables/columns already exist on
-- production (confirmed via information_schema before this fix) and this file is not yet in
-- MIGRATION_MANIFEST, so this is a syntax-only correction, not a live schema change.
CREATE TABLE IF NOT EXISTS company_post_likes (
  id         CHAR(36)                      NOT NULL,
  post_id    CHAR(36)                      NOT NULL,
  user_id    CHAR(36)                      NOT NULL,
  reaction   ENUM('like','dislike')        NOT NULL DEFAULT 'like',
  created_at DATETIME                      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME                      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_post_user (post_id, user_id),
  KEY idx_post_id (post_id),
  KEY idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS company_post_comments (
  id          CHAR(36)      NOT NULL,
  post_id     CHAR(36)      NOT NULL,
  user_id     CHAR(36)      NOT NULL,
  author_name VARCHAR(120)  NULL,
  author_code VARCHAR(30)   NULL,
  body        TEXT          NOT NULL,
  deleted_at  DATETIME      NULL,
  deleted_by  CHAR(36)      NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_post_id (post_id),
  KEY idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add denormalised counters to company_posts for fast feed queries
SET @c1 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_posts' AND COLUMN_NAME = 'like_count');
SET @sql = IF(@c1 = 0, 'ALTER TABLE company_posts ADD COLUMN like_count INT NOT NULL DEFAULT 0', 'SELECT "like_count already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c2 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_posts' AND COLUMN_NAME = 'dislike_count');
SET @sql = IF(@c2 = 0, 'ALTER TABLE company_posts ADD COLUMN dislike_count INT NOT NULL DEFAULT 0', 'SELECT "dislike_count already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c3 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_posts' AND COLUMN_NAME = 'comment_count');
SET @sql = IF(@c3 = 0, 'ALTER TABLE company_posts ADD COLUMN comment_count INT NOT NULL DEFAULT 0', 'SELECT "comment_count already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
