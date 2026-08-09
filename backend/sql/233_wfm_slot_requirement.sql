-- ============================================================
-- Migration 233: CREATE wfm_slot_requirement
--
-- Per-date, per-process forecast input and calculated HC output.
-- This is the demand signal that feeds both the auto week-off engine
-- and the auto shift allocation engine.
--
-- Slot granularity: configurable — can be a full day (slot_start=00:00,
-- slot_end=23:59) for day-level planning, or 30-min/1-hour blocks
-- for intraday Erlang planning.
--
-- Workflow:
--   1. WFM uploads / enters forecast volumes (forecast_calls, chat_volume, etc.)
--   2. POST /api/wfm/slot-requirements/calculate triggers hcCalculation.service.ts
--   3. Service reads wfm_process_planning_rule for the process/date
--   4. Applies the correct formula (8 workload types)
--   5. Writes required_productive_hc, required_planned_hc, calculation_notes back here
--   6. roster-generation.service.ts reads required_planned_hc to validate coverage
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS wfm_slot_requirement;
-- ============================================================

CREATE TABLE IF NOT EXISTS wfm_slot_requirement (
  id              VARCHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id      VARCHAR(36)    NOT NULL,
  branch_id       VARCHAR(36)    NULL,
  workload_type   VARCHAR(50)    NOT NULL COMMENT 'Same enum as process_master.workload_type',

  requirement_date DATE          NOT NULL,
  slot_start       TIME          NOT NULL DEFAULT '00:00:00' COMMENT 'Start of planning slot (00:00 = full-day)',
  slot_end         TIME          NOT NULL DEFAULT '23:59:00' COMMENT 'End of planning slot',

  -- ── Input: Forecast volumes (only relevant columns populated per workload type) ──
  forecast_calls       INT      NULL COMMENT 'inbound_voice: expected inbound calls',
  chat_volume          INT      NULL COMMENT 'chat: expected chat sessions',
  new_email_volume     INT      NULL COMMENT 'email: new emails expected',
  backlog_volume       INT      NULL COMMENT 'email: existing backlog to clear',
  sla_due_volume       INT      NULL COMMENT 'email: emails at risk of SLA breach',
  case_volume          INT      NULL COMMENT 'backoffice/data_verification: expected cases',
  production_volume    INT      NULL COMMENT 'audit_quality: production volume to sample from',

  -- ── Input: Outbound campaign specific ──────────────────────────────────────
  target_attempts      INT      NULL,
  target_contacts      INT      NULL,
  target_sales         INT      NULL,
  connect_rate_pct     DECIMAL(5,2) NULL COMMENT 'Override for this slot if different from planning rule',
  conversion_rate_pct  DECIMAL(5,2) NULL,

  -- ── Input: Overrides (if NULL, value comes from wfm_process_planning_rule) ─
  aht_seconds_override           INT          NULL,
  shrinkage_pct_override         DECIMAL(5,2) NULL,
  chat_concurrency_override      DECIMAL(5,2) NULL,
  emails_per_agent_hour_override DECIMAL(10,2) NULL,
  cases_per_agent_hour_override  DECIMAL(10,2) NULL,
  audit_sample_pct_override      DECIMAL(5,2) NULL,
  audits_per_qa_hour_override    DECIMAL(10,2) NULL,

  -- ── Output: Calculated HC ──────────────────────────────────────────────────
  required_productive_hc  INT          NULL COMMENT 'Base HC before shrinkage',
  required_planned_hc     INT          NULL COMMENT 'Final planned HC after shrinkage — roster engine uses this',
  required_skill          VARCHAR(255) NULL COMMENT 'Skill/certification required for this slot',
  required_certification  VARCHAR(255) NULL,

  -- ── Calculation metadata ───────────────────────────────────────────────────
  calculation_method   VARCHAR(50)  NULL COMMENT 'Formula applied: erlang_lite / campaign / concurrency / backlog / cases / audit_sample',
  calculation_notes    JSON         NULL COMMENT 'Intermediate values for audit: workload_hours, base_hc, shrinkage_applied, etc.',
  planning_rule_id     VARCHAR(36)  NULL COMMENT 'FK wfm_process_planning_rule.id used for this calculation',

  -- ── Source tracking ────────────────────────────────────────────────────────
  source_type   VARCHAR(50)  NULL COMMENT 'manual | csv_upload | api_push | auto_calculated',
  source_file_id VARCHAR(36) NULL COMMENT 'FK upload_batch.id if from bulk upload',

  -- ── Shortage/excess flags (written by roster engine after generation) ───────
  roster_scheduled_hc  INT NULL COMMENT 'Actual HC scheduled by the roster engine for this slot',
  coverage_delta       INT NULL COMMENT 'roster_scheduled_hc - required_planned_hc (negative = shortage)',
  coverage_status      ENUM('ok','shortage','excess','not_calculated') NOT NULL DEFAULT 'not_calculated',

  created_by    VARCHAR(36)  NULL,
  updated_by    VARCHAR(36)  NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_slot (process_id, requirement_date, slot_start, workload_type),
  INDEX idx_wsr_process_date   (process_id, requirement_date),
  INDEX idx_wsr_coverage       (process_id, requirement_date, coverage_status),
  CONSTRAINT fk_wsr_process FOREIGN KEY (process_id)
    REFERENCES process_master(id) ON DELETE CASCADE,
  CONSTRAINT fk_wsr_branch  FOREIGN KEY (branch_id)
    REFERENCES branch_master(id)  ON DELETE SET NULL,
  CONSTRAINT fk_wsr_rule    FOREIGN KEY (planning_rule_id)
    REFERENCES wfm_process_planning_rule(id) ON DELETE SET NULL

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-slot demand forecast and HC requirement — feeds auto week-off and auto roster engines';

SELECT '233_wfm_slot_requirement.sql applied successfully' AS migration_status;
