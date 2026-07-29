-- Migration 419: BPO IT Help Desk Enhancements
-- Additive only. All column additions are guarded with IF NOT EXISTS.
-- ENUM expansion uses prepared-statement guard (same pattern as migration 217).

-- ── 1. New columns on helpdesk_ticket ─────────────────────────────────────────

ALTER TABLE helpdesk_ticket
  ADD COLUMN IF NOT EXISTS it_subcategory   VARCHAR(100)  NULL            COMMENT 'BPO IT sub-type (dialer, network, crm, etc.)',
  ADD COLUMN IF NOT EXISTS downtime_minutes INT           NOT NULL DEFAULT 0 COMMENT 'Agent downtime minutes caused by this ticket',
  ADD COLUMN IF NOT EXISTS affected_seats   INT           NOT NULL DEFAULT 1 COMMENT 'Number of agent seats impacted',
  ADD COLUMN IF NOT EXISTS hold_reason      VARCHAR(500)  NULL            COMMENT 'Reason ticket was put on hold',
  ADD COLUMN IF NOT EXISTS held_at          DATETIME      NULL            COMMENT 'Timestamp when ticket was put on hold';

-- ── 2. Add on_hold to status ENUM ─────────────────────────────────────────────
-- ENUM values cannot use ADD COLUMN IF NOT EXISTS; use prepared statement guard.

SET @col_type = (
  SELECT COLUMN_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'helpdesk_ticket'
    AND COLUMN_NAME  = 'status'
);

SET @sql = IF(
  @col_type NOT LIKE '%on_hold%',
  "ALTER TABLE helpdesk_ticket MODIFY COLUMN status
     ENUM('open','in_progress','pending_info','on_hold','resolved','closed','cancelled')
     NOT NULL DEFAULT 'open'",
  "SELECT 'on_hold already in enum' AS note"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 3. Fix refreshSlaBreachFlags: on_hold tickets must not breach ──────────────
-- No schema change needed; WHERE clause update is in helpdesk-sla.service.ts.

-- ── 4. Knowledge Base article table ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS helpdesk_kb_article (
  id                CHAR(36)       NOT NULL DEFAULT (UUID()),
  title             VARCHAR(500)   NOT NULL,
  category          VARCHAR(100)   NOT NULL DEFAULT 'it',
  it_subcategory    VARCHAR(100)   NULL,
  content           LONGTEXT       NOT NULL,
  tags              VARCHAR(1000)  NULL     COMMENT 'Comma-separated tags for search',
  author_user_id    CHAR(36)       NOT NULL,
  status            ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  view_count        INT            NOT NULL DEFAULT 0,
  helpful_count     INT            NOT NULL DEFAULT 0,
  not_helpful_count INT            NOT NULL DEFAULT 0,
  created_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_kb_category (category, status),
  INDEX idx_kb_status   (status),
  FULLTEXT INDEX idx_kb_fulltext (title, tags)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 5. Knowledge Base feedback table (prevents duplicate votes) ───────────────

CREATE TABLE IF NOT EXISTS helpdesk_kb_feedback (
  id         CHAR(36)    NOT NULL DEFAULT (UUID()),
  article_id CHAR(36)    NOT NULL,
  user_id    CHAR(36)    NOT NULL,
  is_helpful TINYINT(1)  NOT NULL,
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kb_feedback (article_id, user_id),
  INDEX idx_kb_feedback_article (article_id),
  CONSTRAINT fk_kb_feedback_article
    FOREIGN KEY (article_id) REFERENCES helpdesk_kb_article(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 6. Page catalog entries ───────────────────────────────────────────────────

INSERT IGNORE INTO page_catalog (page_code, page_name, description, module, active_status)
VALUES ('HELPDESK_KB', 'Helpdesk Knowledge Base', 'Self-help BPO IT knowledge articles', 'helpdesk', 1);

INSERT IGNORE INTO role_page_access (role_key, page_code)
VALUES
  ('super_admin', 'HELPDESK_KB'),
  ('admin',       'HELPDESK_KB'),
  ('hr',          'HELPDESK_KB'),
  ('it',          'HELPDESK_KB'),
  ('branch_it',   'HELPDESK_KB'),
  ('it_admin',    'HELPDESK_KB'),
  ('manager',     'HELPDESK_KB'),
  ('process_manager', 'HELPDESK_KB'),
  ('employee',    'HELPDESK_KB');
