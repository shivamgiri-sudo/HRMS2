-- 429_finance_saved_views.sql
-- Branch Budget foundation (PR 9): per-user saved grid-matrix views (pinned columns, filters).
-- Additive. No prior "saved view" concept exists anywhere in this app.

CREATE TABLE IF NOT EXISTS finance_saved_view (
  id           CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id      CHAR(36) NOT NULL,
  module_key   VARCHAR(60) NOT NULL,
  view_name    VARCHAR(120) NOT NULL,
  config_json  JSON NOT NULL,
  is_default   TINYINT(1) NOT NULL DEFAULT 0,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_saved_view_user_module_name (user_id, module_key, view_name),
  INDEX idx_saved_view_user_module (user_id, module_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
