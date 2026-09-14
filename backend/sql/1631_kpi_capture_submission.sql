-- 1631_kpi_capture_submission.sql
--
-- Staging store for the open (unauthenticated) KPI capture page at /kpi-capture.
--
-- WHY A STAGING TABLE AND NOT kpi_metric_master DIRECTLY
--   The submit endpoint is deliberately reachable without a session, so anyone with the
--   link can POST to it. Writing straight into kpi_metric_master / kpi_master_config would
--   let an open endpoint mutate live KPI configuration and therefore live scoring. Nothing
--   here is read by any scoring path: rows land as status='submitted' and a human promotes
--   them. Promotion is a separate, authenticated action that does not exist yet by design.
--
-- COLLATION IS EXPLICIT ON PURPOSE
--   On MySQL 8 a bare `CHARSET=utf8mb4` resolves to the SERVER default (utf8mb4_0900_ai_ci
--   on this host), not the database default (utf8mb4_unicode_ci). Comparing two differently
--   collated VARCHARs is a hard ER_CANT_AGGREGATE_2COLLATIONS (1267), not a warning, so a
--   new table that omits COLLATE breaks the first time anyone joins it to employees or
--   cost_centre_master. Migration 1627 exists solely to repair 49 tables that hit this.
--   Both COLLATE clauses below are therefore mandatory, not decoration.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + an INSERT guarded by NOT EXISTS.

CREATE TABLE IF NOT EXISTS kpi_capture_submission (
  id                    CHAR(36)      NOT NULL,

  -- Who submitted. Free text by necessity: the page has no session to read a name from.
  submitter_name        VARCHAR(120)  NOT NULL,
  submitter_email       VARCHAR(190)  NULL,

  -- Scope. The *_id columns are resolved server-side from the dropdown value the browser
  -- sent; they are NULL when the label no longer matches a master row (a cost centre closed
  -- between page load and submit). The *_label columns always hold exactly what the user
  -- picked, so a submission is never lost to a failed lookup.
  cost_centre_id        CHAR(36)      NULL,
  cost_centre_label     VARCHAR(255)  NOT NULL,
  designation_id        CHAR(36)      NULL,
  designation_label     VARCHAR(255)  NOT NULL,

  -- The KPI. Exactly one of (existing_metric_id, new_kpi_name) is meaningful; is_new_kpi
  -- says which, so a reviewer never has to infer it from NULLs.
  is_new_kpi            TINYINT(1)    NOT NULL DEFAULT 0,
  existing_metric_id    CHAR(36)      NULL,
  existing_metric_code  VARCHAR(80)   NULL,
  new_kpi_name          VARCHAR(190)  NULL,
  new_kpi_formula       TEXT          NULL,

  -- How it is measured. Values mirror kpi_metric_master's own vocabulary so promotion is a
  -- copy, not a translation.
  unit                  VARCHAR(24)   NOT NULL,
  direction             VARCHAR(24)   NOT NULL,
  aggregation_method    VARCHAR(24)   NOT NULL,
  measure_frequency     VARCHAR(24)   NOT NULL,

  -- Targets. DECIMAL not FLOAT — these become scoring thresholds.
  target_value          DECIMAL(14,4) NULL,
  min_threshold         DECIMAL(14,4) NULL,
  max_achievement       DECIMAL(9,2)  NULL,
  weightage             DECIMAL(6,2)  NULL,

  data_source           VARCHAR(160)  NOT NULL,
  owner_name            VARCHAR(160)  NOT NULL,
  notes                 TEXT          NULL,

  -- Review lifecycle. Nothing downstream reads these yet; they exist so promotion has
  -- somewhere to record itself rather than needing another migration later.
  status                VARCHAR(16)   NOT NULL DEFAULT 'submitted',
  reviewed_by           CHAR(36)      NULL,
  reviewed_at           DATETIME      NULL,
  review_note           TEXT          NULL,

  -- Abuse forensics for an open endpoint. Truncated at 64 chars to hold IPv6.
  source_ip             VARCHAR(64)   NULL,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_kcs_cost_centre (cost_centre_id),
  KEY idx_kcs_designation (designation_id),
  KEY idx_kcs_status_created (status, created_at),
  KEY idx_kcs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bearer token for the results view. The results page shows client/process names, headcount
-- and targets, so it is NOT on a guessable path — it is /kpi-capture/results/:token and the
-- token is checked here. Kept in a table rather than an env var so it can be rotated with an
-- UPDATE and revoked with active_status=0, without a redeploy.
CREATE TABLE IF NOT EXISTS kpi_capture_access_token (
  id            CHAR(36)      NOT NULL,
  token         VARCHAR(128)  NOT NULL,
  label         VARCHAR(160)  NOT NULL,
  active_status TINYINT(1)    NOT NULL DEFAULT 1,
  last_used_at  DATETIME      NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kcat_token (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO kpi_capture_access_token (id, token, label, active_status)
SELECT 'a5a3dbf0-d007-4aac-8980-7273df7b8c1c',
       '4050bea2dc07dc5d5166c5a43465eecf3c0f86474e4907fd',
       'Initial results link',
       1
WHERE NOT EXISTS (SELECT 1 FROM kpi_capture_access_token WHERE id = 'a5a3dbf0-d007-4aac-8980-7273df7b8c1c');
