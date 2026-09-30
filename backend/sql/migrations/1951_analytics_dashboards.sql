-- Migration 1951: Dashboard Studio storage. A dashboard owns widgets (each one a catalogue query + visual settings + grid
-- layout) and can be shared with a role, branch, process or single user. Additive: new tables only, no seeds, no ALTER.

CREATE TABLE IF NOT EXISTS analytics_dashboard (
  id              CHAR(36)     NOT NULL,
  name            VARCHAR(128) NOT NULL,
  description     VARCHAR(500) NULL,
  owner_user_id   CHAR(36)     NOT NULL,
  home_branch_id  CHAR(36)     NULL,
  home_process_id CHAR(36)     NULL,
  theme           VARCHAR(32)  NOT NULL DEFAULT 'light',
  settings_json   JSON         NULL,
  is_template     TINYINT      NOT NULL DEFAULT 0,
  active_status   TINYINT      NOT NULL DEFAULT 1,
  version         INT          NOT NULL DEFAULT 1,
  created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_analytics_dashboard_owner (owner_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS analytics_widget (
  id            CHAR(36)     NOT NULL,
  dashboard_id  CHAR(36)     NOT NULL,
  widget_type   VARCHAR(32)  NOT NULL,
  title         VARCHAR(160) NULL,
  subtitle      VARCHAR(255) NULL,
  query_json    JSON         NULL,
  viz_json      JSON         NULL,
  layout_json   JSON         NULL,
  sort_order    INT          NOT NULL DEFAULT 0,
  active_status TINYINT      NOT NULL DEFAULT 1,
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_analytics_widget_dashboard (dashboard_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS analytics_dashboard_share (
  id              CHAR(36)    NOT NULL,
  dashboard_id    CHAR(36)    NOT NULL,
  principal_type  ENUM('role','branch','process','user') NOT NULL,
  principal_value VARCHAR(64) NOT NULL,
  permission      ENUM('view','edit') NOT NULL DEFAULT 'view',
  created_by      CHAR(36)    NULL,
  created_at      DATETIME    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_analytics_dashboard_share (dashboard_id, principal_type, principal_value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
