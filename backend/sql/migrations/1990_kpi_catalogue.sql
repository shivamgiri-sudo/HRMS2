-- Migration 1990: KPI Catalogue - one source of truth for every process KPI.
--
-- Six overlapping KPI models (kpi_template, kpi_master_config, kpi_process_config, kpi_role_template*,
-- kpi_studio_definition, portal_kpi_config) define the same KPIs independently. This adds a catalogue ON TOP of
-- them: one row per (process_key, metric_key) with its formula, source, freshness, target source, rating scale and
-- the roles / departments that see or manage it. Nothing existing is altered or dropped; kpi_studio_definition only
-- gains a nullable catalogue_id link. Purely additive and idempotent (information_schema guards, IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS kpi_rating_scale (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()) COLLATE utf8mb4_unicode_ci,
  scale_key   VARCHAR(50)  NOT NULL COLLATE utf8mb4_unicode_ci,
  scale_name  VARCHAR(120) NOT NULL COLLATE utf8mb4_unicode_ci,
  is_default  TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kpi_rating_scale_key (scale_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kpi_rating_scale_band (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()) COLLATE utf8mb4_unicode_ci,
  scale_id    CHAR(36)     NOT NULL COLLATE utf8mb4_unicode_ci,
  band_label  VARCHAR(30)  NOT NULL COLLATE utf8mb4_unicode_ci,
  min_score   DECIMAL(6,2) NOT NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kpi_rating_band (scale_id, band_label),
  KEY idx_kpi_rating_band_scale (scale_id, min_score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kpi_catalogue (
  id                   CHAR(36)      NOT NULL DEFAULT (UUID()) COLLATE utf8mb4_unicode_ci,
  process_key          VARCHAR(60)   NOT NULL COLLATE utf8mb4_unicode_ci,
  process_name         VARCHAR(160)  NOT NULL COLLATE utf8mb4_unicode_ci,
  process_codes        JSON          NULL,
  metric_key           VARCHAR(80)   NOT NULL COLLATE utf8mb4_unicode_ci,
  metric_name          VARCHAR(160)  NOT NULL COLLATE utf8mb4_unicode_ci,
  metric_code          VARCHAR(50)   NULL COLLATE utf8mb4_unicode_ci,
  theme                VARCHAR(40)   NOT NULL DEFAULT 'operations' COLLATE utf8mb4_unicode_ci,
  family               VARCHAR(20)   NOT NULL DEFAULT 'rate' COLLATE utf8mb4_unicode_ci,
  unit                 VARCHAR(20)   NOT NULL DEFAULT 'count' COLLATE utf8mb4_unicode_ci,
  direction            VARCHAR(20)   NOT NULL DEFAULT 'higher_is_better' COLLATE utf8mb4_unicode_ci,
  grain                VARCHAR(12)   NOT NULL DEFAULT 'both' COLLATE utf8mb4_unicode_ci,
  source_kind          VARCHAR(20)   NOT NULL DEFAULT 'derived' COLLATE utf8mb4_unicode_ci,
  source_ref           VARCHAR(255)  NULL COLLATE utf8mb4_unicode_ci,
  formula              VARCHAR(500)  NULL COLLATE utf8mb4_unicode_ci,
  freshness            VARCHAR(12)   NOT NULL DEFAULT 'daily' COLLATE utf8mb4_unicode_ci,
  dimensions           JSON          NULL,
  has_data             TINYINT(1)    NOT NULL DEFAULT 1,
  target_source        VARCHAR(32)   NOT NULL DEFAULT 'kpi_config' COLLATE utf8mb4_unicode_ci,
  default_target       DECIMAL(18,4) NULL,
  rating_scale_id      CHAR(36)      NULL COLLATE utf8mb4_unicode_ci,
  status               VARCHAR(12)   NOT NULL DEFAULT 'published' COLLATE utf8mb4_unicode_ci,
  legacy_refs          JSON          NULL,
  studio_definition_id CHAR(36)      NULL COLLATE utf8mb4_unicode_ci,
  seeded               TINYINT(1)    NOT NULL DEFAULT 0,
  notes                VARCHAR(500)  NULL COLLATE utf8mb4_unicode_ci,
  created_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kpi_catalogue_process_metric (process_key, metric_key),
  KEY idx_kpi_catalogue_status (status, process_key),
  KEY idx_kpi_catalogue_metric_code (metric_code),
  KEY idx_kpi_catalogue_theme (theme)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kpi_catalogue_role (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) COLLATE utf8mb4_unicode_ci,
  catalogue_id   CHAR(36)     NOT NULL COLLATE utf8mb4_unicode_ci,
  role_key       VARCHAR(60)  NOT NULL COLLATE utf8mb4_unicode_ci,
  department_key VARCHAR(40)  NOT NULL DEFAULT 'operations' COLLATE utf8mb4_unicode_ci,
  access         VARCHAR(10)  NOT NULL DEFAULT 'view' COLLATE utf8mb4_unicode_ci,
  display_order  INT          NOT NULL DEFAULT 100,
  weight         DECIMAL(6,2) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kpi_catalogue_role (catalogue_id, role_key),
  KEY idx_kpi_catalogue_role_role (role_key, department_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kpi_catalogue_conflict (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) COLLATE utf8mb4_unicode_ci,
  conflict_type VARCHAR(40)  NOT NULL COLLATE utf8mb4_unicode_ci,
  process_key   VARCHAR(60)  NULL COLLATE utf8mb4_unicode_ci,
  metric_key    VARCHAR(80)  NULL COLLATE utf8mb4_unicode_ci,
  detail        JSON         NULL,
  resolved      TINYINT(1)   NOT NULL DEFAULT 0,
  detected_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at   DATETIME     NULL,
  PRIMARY KEY (id),
  KEY idx_kpi_catalogue_conflict_open (resolved, conflict_type),
  KEY idx_kpi_catalogue_conflict_key (process_key, metric_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Studio link: nullable, so existing definitions are untouched.
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_studio_definition' AND COLUMN_NAME = 'catalogue_id');
SET @tbl := (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_studio_definition');
SET @ddl := IF(@tbl = 1 AND @has_col = 0,
               'ALTER TABLE kpi_studio_definition ADD COLUMN catalogue_id CHAR(36) NULL COLLATE utf8mb4_unicode_ci',
               'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- One rating scale for the whole app: the S/A/B/C/D bands kpi_rating_config already uses (100/90/75/60/0).
INSERT IGNORE INTO kpi_rating_scale (id, scale_key, scale_name, is_default)
VALUES (UUID(), 'standard_sabcd', 'Standard S/A/B/C/D', 1);

INSERT IGNORE INTO kpi_rating_scale_band (id, scale_id, band_label, min_score, sort_order)
SELECT UUID(), s.id, b.label, b.min_score, b.sort_order
  FROM kpi_rating_scale s
  JOIN (SELECT 'S' AS label, 100 AS min_score, 1 AS sort_order
        UNION ALL SELECT 'A', 90, 2 UNION ALL SELECT 'B', 75, 3
        UNION ALL SELECT 'C', 60, 4 UNION ALL SELECT 'D', 0, 5) b
 WHERE s.scale_key = 'standard_sabcd';
