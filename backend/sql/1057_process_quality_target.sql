-- 1057_process_quality_target.sql
--
-- Per-process quality thresholds, with approval and a full change history.
--
-- WHY
-- ---
-- On 2026-08-02 the weekly coaching evaluation looked at 73 quality rows across
-- 41 agents and raised nothing, because NOT ONE of them had a resolved
-- QUALITY_SCORE target and there are zero configured anywhere in
-- kpi_master_config. The trigger declines without a target on purpose: measured
-- quality runs 23.7% to 72.7% across the ten live clients, so a single
-- company-wide bar would condemn entire processes while excusing others.
--
-- kpi_master_config could hold a number, but it holds only one — a target — and
-- coaching needs more than that to be defensible: how far below is a warning,
-- how far is critical, how many audits are enough to judge anybody on, and over
-- what period. Those belong together, versioned together, and approved together.
--
-- WHAT
-- ----
-- process_quality_target        one dated, approved row per process and metric
-- process_quality_target_audit  every change to it, append-only
--
-- Thresholds are stored as PERCENTAGES OF TARGET rather than absolute scores, so
-- one policy ("warn at 90% of target, critical at 75%") reads the same on a
-- process targeting 45 and one targeting 85. That is the same relative rule the
-- coaching trigger already applies.
--
-- ADDITIVE. Two new tables. Nothing existing is altered, and no code reads them
-- until the target service is wired in.
--
-- ROLLBACK
--   DROP TABLE IF EXISTS process_quality_target_audit;
--   DROP TABLE IF EXISTS process_quality_target;

CREATE TABLE IF NOT EXISTS process_quality_target (
  id                    CHAR(36)      NOT NULL,
  process_id            CHAR(36)      NOT NULL,

  -- QUALITY_SCORE today; the column exists so the same governance can cover
  -- FATAL_RATE and any later measure without a second table.
  metric_code           VARCHAR(50)   NOT NULL DEFAULT 'QUALITY_SCORE',

  target_score          DECIMAL(7,4)  NOT NULL,

  -- Percentages OF TARGET, not absolute scores. 90 means "90% of target".
  warning_threshold_pct DECIMAL(7,4)  NOT NULL DEFAULT 90.0000,
  critical_threshold_pct DECIMAL(7,4) NOT NULL DEFAULT 75.0000,

  -- Nobody is coached off one call. Below this many assessed audits in the
  -- period, the employee is reported as insufficient evidence rather than
  -- judged.
  min_audit_count       INT UNSIGNED  NOT NULL DEFAULT 3,

  evaluation_period     ENUM('daily','weekly','monthly') NOT NULL DEFAULT 'weekly',

  effective_from        DATE          NOT NULL,
  effective_to          DATE              NULL,

  -- A target only governs once someone has approved it. Draft rows are visible
  -- in the UI and ignored by the evaluator.
  status                ENUM('draft','active','superseded','retired') NOT NULL DEFAULT 'draft',
  active_status         TINYINT(1)    NOT NULL DEFAULT 1,

  approved_by           CHAR(36)          NULL,
  approved_at           DATETIME          NULL,
  approval_note         VARCHAR(1000)     NULL,

  created_by            CHAR(36)          NULL,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  -- One row per process, metric and start date. Changing a target creates a new
  -- dated row and supersedes the old one, so a score recorded last month can
  -- still be explained by the threshold that governed it.
  UNIQUE KEY uq_pqt_process_metric_from (process_id, metric_code, effective_from),
  KEY idx_pqt_resolution (process_id, metric_code, status, effective_from, effective_to),

  CONSTRAINT chk_pqt_target_positive
    CHECK (target_score > 0 AND target_score <= 100),
  -- Warning must sit above critical or the bands invert and every shortfall
  -- reads as critical.
  CONSTRAINT chk_pqt_bands
    CHECK (warning_threshold_pct > critical_threshold_pct
           AND critical_threshold_pct > 0
           AND warning_threshold_pct <= 100),
  -- A target that judges on a single audit is how coaching becomes noise.
  CONSTRAINT chk_pqt_min_audits
    CHECK (min_audit_count >= 1),

  CONSTRAINT fk_pqt_process FOREIGN KEY (process_id)
    REFERENCES process_master (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only history. Separate from the versioned rows above because those
-- record what the policy WAS; this records who changed it, when, and why —
-- including changes that never took effect, such as a draft that was discarded.
CREATE TABLE IF NOT EXISTS process_quality_target_audit (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  target_id     CHAR(36)      NOT NULL,
  process_id    CHAR(36)      NOT NULL,
  action        ENUM('created','updated','approved','activated','superseded','retired') NOT NULL,
  -- Full before and after, so a change is legible without replaying every row.
  before_json   JSON              NULL,
  after_json    JSON              NULL,
  reason        VARCHAR(1000)     NULL,
  actor_user_id CHAR(36)          NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pqta_target (target_id, created_at),
  KEY idx_pqta_process (process_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
