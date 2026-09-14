-- Migration 1040: Social Feed Integration ("MAS Connect")
-- Stores platform configs and cached posts for the company social media feed.
-- No per-employee token tables: interactions use "Open on platform" deep-links.

CREATE TABLE IF NOT EXISTS social_platform_config (
  id                VARCHAR(36)  NOT NULL,
  platform          ENUM('facebook','instagram','youtube') NOT NULL,
  page_id           VARCHAR(255) NOT NULL COMMENT 'FB page ID / IG user ID / YT channel ID',
  access_token      TEXT         NULL     COMMENT 'AES-256-GCM encrypted long-lived token',
  token_expiry      DATETIME     NULL     COMMENT 'NULL for YouTube RSS (no token needed)',
  enabled           TINYINT(1)   NOT NULL DEFAULT 1,
  last_synced_at    DATETIME     NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_platform (platform)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS social_feed_post (
  id               VARCHAR(36)   NOT NULL,
  platform         ENUM('facebook','instagram','youtube') NOT NULL,
  platform_post_id VARCHAR(255)  NOT NULL,
  content_text     TEXT          NULL,
  media_url        VARCHAR(1000) NULL     COMMENT 'Image or video thumbnail URL',
  post_url         VARCHAR(1000) NOT NULL COMMENT 'Deep link to open on the platform',
  like_count       INT           NOT NULL DEFAULT 0,
  comment_count    INT           NOT NULL DEFAULT 0,
  published_at     DATETIME      NULL,
  fetched_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active        TINYINT(1)    NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_platform_post (platform_post_id),
  INDEX idx_platform_pub (platform, published_at DESC),
  INDEX idx_active_pub (is_active, published_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
