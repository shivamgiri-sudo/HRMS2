-- Migration 470: Company post engagement (likes/dislikes + comments)
-- Additive only — no existing tables modified except adding columns to company_posts

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
ALTER TABLE company_posts
  ADD COLUMN IF NOT EXISTS like_count    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dislike_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comment_count INT NOT NULL DEFAULT 0;
