-- Migration 1941: config-driven Process Dashboard. A process registers ONE source APR table plus a column_map (canonical field -> that
-- table's column) and gets drill-down dashboards for its CATEGORY (sales | support_inbound | outbound | collections) with no code change.
-- See backend/src/modules/process-dashboard. The source table is only ever read (SELECT, READ ONLY transaction, schema whitelist
-- db_masmis / mas_hrms, identifiers verified against information_schema).
--
-- Auto-provisioning: the app inserts an 'unconfigured', enabled=0 row per process (ensureProcessDashboardConfig, from cost-centre sync and the
-- cost-centre-process-resolver worker). There is deliberately NO backfill here for existing process_master rows: ~130 empty 'unconfigured'
-- rows would be noise; they appear as each process gets a cost centre, or when an admin configures it.
--
-- ADDITIVE ONLY: one new table, two page codes with role access (INSERT IGNORE), and one DISABLED config row for SBI_CARD.

CREATE TABLE IF NOT EXISTS process_dashboard_config (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  process_id       CHAR(36)     NOT NULL,
  category         ENUM('sales','support_inbound','outbound','collections','unconfigured') NOT NULL DEFAULT 'unconfigured',
  label            VARCHAR(120)     NULL,
  apr_schema       VARCHAR(64)      NULL,
  apr_table        VARCHAR(64)      NULL,
  -- {"agent_code":"emp_id","date":"report_date",...}: canonical field -> source column.
  column_map       JSON             NULL,
  time_unit        ENUM('sec','day_fraction','hhmmss') NOT NULL DEFAULT 'sec',
  -- {"column":"process_id","value":"..."} when the table holds several processes.
  process_filter   JSON             NULL,
  refresh_seconds  INT          NOT NULL DEFAULT 60,
  enabled          TINYINT(1)   NOT NULL DEFAULT 0,
  configured_by    CHAR(36)         NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pdc_process (process_id),
  KEY idx_pdc_enabled (enabled, category),
  CONSTRAINT fk_pdc_process FOREIGN KEY (process_id) REFERENCES process_master (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status) VALUES
  (UUID(), 'PROCESS_DASHBOARD',       'Process Dashboard',       '/performance/process-dashboard',       'Performance', 1),
  (UUID(), 'PROCESS_DASHBOARD_ADMIN', 'Process Dashboard Setup', '/performance/process-dashboard-admin', 'Performance', 1);

-- Viewers: same set as PROCESS_KPI_DASHBOARD (sql/1676).
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status) VALUES
  (UUID(), 'super_admin',        'PROCESS_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'admin',              'PROCESS_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'ceo',                'PROCESS_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'coo',                'PROCESS_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'manager',            'PROCESS_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'process_manager',    'PROCESS_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'operations_manager', 'PROCESS_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'branch_head',        'PROCESS_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'qa',                 'PROCESS_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'quality_analyst',    'PROCESS_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'tq_head',            'PROCESS_DASHBOARD', 1, 0, 0, 0, 0, 1);

-- Setup page: admins who can register a process data source (the API itself allows admin / process_manager / operations_manager, plus super_admin).
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status) VALUES
  (UUID(), 'super_admin',        'PROCESS_DASHBOARD_ADMIN', 1, 1, 1, 0, 0, 1),
  (UUID(), 'admin',              'PROCESS_DASHBOARD_ADMIN', 1, 1, 1, 0, 0, 1),
  (UUID(), 'ceo',                'PROCESS_DASHBOARD_ADMIN', 1, 0, 0, 0, 0, 1),
  (UUID(), 'coo',                'PROCESS_DASHBOARD_ADMIN', 1, 0, 0, 0, 0, 1),
  (UUID(), 'process_manager',    'PROCESS_DASHBOARD_ADMIN', 1, 1, 1, 0, 0, 1),
  (UUID(), 'operations_manager', 'PROCESS_DASHBOARD_ADMIN', 1, 1, 1, 0, 0, 1);

-- SBI_CARD is the first 'collections' instance, mapped onto mas_hrms.sbi_card_agent_mis (sql/1932). It stays DISABLED: SBI Card keeps its bespoke
-- dashboard (/api/process-performance/sbi-card-dashboard); an admin flips enabled=1 (or re-maps) from the setup page when they want this one too.
-- Only written when the table exists and the process has no real configuration yet, so re-running never overwrites an admin's work.
INSERT IGNORE INTO process_dashboard_config
  (id, process_id, category, label, apr_schema, apr_table, column_map, time_unit, process_filter, refresh_seconds, enabled)
SELECT UUID(), pm.id, 'unconfigured', pm.process_name, NULL, NULL, NULL, 'sec', NULL, 60, 0
  FROM process_master pm
 WHERE pm.process_code = 'SBI_CARD'
   AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'sbi_card_agent_mis');

UPDATE process_dashboard_config c
  JOIN process_master pm ON pm.id = c.process_id AND pm.process_code = 'SBI_CARD'
   SET c.category = 'collections', c.label = 'SBI Card Collections', c.apr_schema = 'mas_hrms', c.apr_table = 'sbi_card_agent_mis',
       c.column_map = JSON_OBJECT('agent_code', 'employee_id', 'date', 'report_date', 'agent_name', 'agent_name', 'tl_name', 'team_leader',
                                  'calls', 'calls', 'connected', 'contacts', 'ptp', 'ptp', 'amount', 'amt_collected'),
       c.time_unit = 'sec', c.process_filter = JSON_OBJECT('column', 'process_id', 'value', pm.id), c.enabled = 0
 WHERE c.category = 'unconfigured' AND c.apr_table IS NULL;
