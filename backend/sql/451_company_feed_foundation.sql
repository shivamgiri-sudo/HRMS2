-- ============================================================
-- Migration: 451_company_feed_foundation.sql
-- Purpose  : Additive database foundation for the company feed
-- ============================================================

CREATE TABLE IF NOT EXISTS company_posts (
  id char(36) NOT NULL PRIMARY KEY,
  author_user_id char(36) NOT NULL,
  author_employee_id char(36) NOT NULL,
  content_text text NULL,
  status varchar(32) NOT NULL,
  moderation_state varchar(32) NOT NULL DEFAULT 'clean',
  moderation_score decimal(5,2) NULL,
  auto_reject_reason varchar(255) NULL,
  review_notes text NULL,
  submitted_at datetime NULL,
  approved_at datetime NULL,
  approved_by char(36) NULL,
  rejected_at datetime NULL,
  rejected_by char(36) NULL,
  rejection_reason varchar(500) NULL,
  deleted_at datetime NULL,
  deleted_by char(36) NULL,
  active_status tinyint(1) NOT NULL DEFAULT 1,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_company_posts_status CHECK (status IN (
    'draft',
    'pending_approval',
    'borderline_flagged',
    'approved',
    'rejected',
    'auto_rejected',
    'deleted'
  )),
  KEY idx_company_posts_status (status),
  KEY idx_company_posts_author_user (author_user_id),
  KEY idx_company_posts_author_employee (author_employee_id),
  KEY idx_company_posts_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS company_post_media (
  id char(36) NOT NULL PRIMARY KEY,
  post_id char(36) NOT NULL,
  file_id char(36) NOT NULL,
  media_type varchar(32) NOT NULL,
  sort_order int NOT NULL,
  moderation_state varchar(32) NOT NULL DEFAULT 'clean',
  moderation_reason varchar(255) NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active_status tinyint(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_company_post_media_order (post_id, sort_order),
  KEY idx_company_post_media_post (post_id),
  KEY idx_company_post_media_file (file_id),
  KEY idx_company_post_media_active (active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS company_post_creator_access (
  id char(36) NOT NULL PRIMARY KEY,
  employee_id char(36) NOT NULL,
  user_id char(36) NOT NULL,
  active_status tinyint(1) NOT NULL DEFAULT 1,
  granted_by char(36) NULL,
  granted_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_by char(36) NULL,
  revoked_at datetime NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_company_post_creator_access_employee (employee_id),
  KEY idx_company_post_creator_access_user (user_id),
  KEY idx_company_post_creator_access_active (active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS company_post_audit_log (
  id char(36) NOT NULL PRIMARY KEY,
  post_id char(36) NOT NULL,
  action_type varchar(64) NOT NULL,
  actor_user_id char(36) NOT NULL,
  notes_json json NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_company_post_audit_post (post_id),
  KEY idx_company_post_audit_actor (actor_user_id),
  KEY idx_company_post_audit_action (action_type),
  KEY idx_company_post_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
