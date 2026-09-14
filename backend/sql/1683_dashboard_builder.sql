-- Dashboard Builder: dashboards somebody assembles, rather than ones a
-- developer ships.
--
-- Deliberately separate from the existing dashboards module. That module serves
-- FIXED dashboards keyed by a dashboardCode, chosen per role, with its own
-- drilldowns and root-cause views; it is read-only by design and stays
-- untouched. Its dashboard_metric_catalog is a developer-curated list. This is
-- the other thing: a person picks metrics that already exist and arranges them.
--
-- The metrics come from what KPI Studio and the process registry already
-- define, so nothing here re-invents sources, formulas or grain. A widget only
-- says WHICH metric, HOW to draw it and WHERE it sits.
--
-- Names are prefixed builder_ so neither system can be mistaken for the other
-- in a query six months from now.

CREATE TABLE IF NOT EXISTS builder_dashboard (
  id             CHAR(36)     NOT NULL,
  name           VARCHAR(120) NOT NULL,
  description    TEXT             NULL,
  -- Optional: a dashboard about one client process. NULL means it spans
  -- whatever its widgets reference, still bounded per viewer by scope.
  process_id     CHAR(36)         NULL,
  owner_user_id  CHAR(36)         NULL,
  -- Comma-separated role keys that may VIEW it. Empty/NULL means owner-only.
  -- Row scope is still applied per request; this only decides who may open it.
  visible_roles  VARCHAR(500)     NULL,
  active_status  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_builder_dashboard_owner (owner_user_id),
  KEY idx_builder_dashboard_process (process_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS builder_dashboard_widget (
  id             CHAR(36)     NOT NULL,
  dashboard_id   CHAR(36)     NOT NULL,
  title          VARCHAR(160)     NULL,
  -- How to draw it. 'table' and 'kpi_tile' need no axis; the rest are charts.
  widget_type    ENUM('kpi_tile','line','bar','pie','table') NOT NULL DEFAULT 'kpi_tile',
  -- Which store the number comes from. Both already exist and both already
  -- return an explicit no-data state rather than a zero.
  metric_source  ENUM('kpi_daily_actual','process_metric_actual') NOT NULL DEFAULT 'process_metric_actual',
  -- metric_code for kpi_daily_actual; metric_key for process_metric_actual.
  metric_key     VARCHAR(64)  NOT NULL,
  -- Overrides the dashboard's process for this widget only.
  process_id     CHAR(36)         NULL,
  -- 'last_7_days' | 'last_30_days' | 'this_month' | 'last_month'. Resolved at
  -- read time, never stored as literal dates, so a saved dashboard does not
  -- silently freeze on the day it was built.
  date_range     VARCHAR(32)  NOT NULL DEFAULT 'this_month',
  -- 12-column grid. width 1-12, height in rows; position orders them.
  grid_width     TINYINT      NOT NULL DEFAULT 6,
  grid_height    TINYINT      NOT NULL DEFAULT 1,
  position       SMALLINT     NOT NULL DEFAULT 0,
  -- Per-chart extras (target line, colour, number format). Optional by design:
  -- a widget must render sensibly with none of it set.
  config_json    JSON             NULL,
  active_status  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_builder_widget_dashboard (dashboard_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status) VALUES
  (UUID(), 'DASHBOARD_BUILDER', 'Dashboard Builder', '/dashboard-builder', 'Performance', 1);

-- Building a dashboard is not a sensitive act in itself — every number on it is
-- still scope-filtered per viewer — so viewing is wide and creating is the
-- ops/quality/management set that already configures metrics.
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status) VALUES
  (UUID(), 'super_admin',        'DASHBOARD_BUILDER', 1, 1, 1, 1, 1, 1),
  (UUID(), 'admin',              'DASHBOARD_BUILDER', 1, 1, 1, 1, 1, 1),
  (UUID(), 'ceo',                'DASHBOARD_BUILDER', 1, 1, 1, 0, 1, 1),
  (UUID(), 'coo',                'DASHBOARD_BUILDER', 1, 1, 1, 0, 1, 1),
  (UUID(), 'manager',            'DASHBOARD_BUILDER', 1, 1, 1, 0, 1, 1),
  (UUID(), 'process_manager',    'DASHBOARD_BUILDER', 1, 1, 1, 0, 1, 1),
  (UUID(), 'operations_manager', 'DASHBOARD_BUILDER', 1, 1, 1, 0, 1, 1),
  (UUID(), 'branch_head',        'DASHBOARD_BUILDER', 1, 1, 1, 0, 1, 1),
  (UUID(), 'qa',                 'DASHBOARD_BUILDER', 1, 1, 1, 0, 0, 1),
  (UUID(), 'quality_analyst',    'DASHBOARD_BUILDER', 1, 0, 0, 0, 0, 1),
  (UUID(), 'tq_head',            'DASHBOARD_BUILDER', 1, 1, 1, 0, 1, 1),
  (UUID(), 'hr',                 'DASHBOARD_BUILDER', 1, 0, 0, 0, 0, 1),
  (UUID(), 'team_leader',        'DASHBOARD_BUILDER', 1, 0, 0, 0, 0, 1);
