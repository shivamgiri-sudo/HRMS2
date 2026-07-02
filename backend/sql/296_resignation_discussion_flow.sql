-- Migration 296: Resignation Discussion Flow
-- Creates: resignation_discussion, resignation_discussion_note, retention_offer
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, INSERT IGNORE

CREATE TABLE IF NOT EXISTS resignation_discussion (
  id                   CHAR(36)    NOT NULL,
  exit_request_id      CHAR(36)    NOT NULL,
  discussion_type      VARCHAR(30) NOT NULL COMMENT 'manager/hr/skip_level',
  discussion_date      DATE        DEFAULT NULL,
  discussed_by         CHAR(36)    DEFAULT NULL,
  outcome              VARCHAR(30) NOT NULL DEFAULT 'pending' COMMENT 'pending/retention_offered/withdrawal_agreed/proceeding_with_exit',
  employee_sentiment   VARCHAR(30) DEFAULT NULL,
  remarks              TEXT        DEFAULT NULL,
  next_discussion_date DATE        DEFAULT NULL,
  created_at           DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_exit (exit_request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS resignation_discussion_note (
  id              CHAR(36)   NOT NULL,
  discussion_id   CHAR(36)   NOT NULL,
  note            TEXT       DEFAULT NULL,
  noted_by        CHAR(36)   DEFAULT NULL,
  noted_at        DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_confidential TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_discussion (discussion_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS retention_offer (
  id               CHAR(36)    NOT NULL,
  exit_request_id  CHAR(36)    NOT NULL,
  offered_by       CHAR(36)    DEFAULT NULL,
  offer_date       DATE        DEFAULT NULL,
  offer_type       VARCHAR(50) NOT NULL COMMENT 'salary_hike/role_change/transfer/leave/other',
  offer_details    JSON        DEFAULT NULL,
  employee_response VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/accepted/rejected',
  response_date    DATE        DEFAULT NULL,
  response_remarks TEXT        DEFAULT NULL,
  created_at       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_exit (exit_request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Register page codes
INSERT IGNORE INTO page_catalog (id, page_code, page_name, module, description, active_status)
VALUES
  (UUID(), 'RESIGNATION_MY_REQUEST',        'My Resignation',              'exit', 'Submit and track resignation', 1),
  (UUID(), 'RESIGNATION_COMMAND_CENTER',    'Resignation Command Center',  'exit', 'Manage all resignations with discussion flow', 1);

-- Grant super_admin
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), 'super_admin', page_code, 1, 1, 1, 1, 1, 1
FROM page_catalog WHERE page_code IN ('RESIGNATION_MY_REQUEST','RESIGNATION_COMMAND_CENTER');
