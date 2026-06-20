-- ============================================================
-- Migration 232: CREATE wfm_process_planning_rule
--
-- Stores per-process HC calculation parameters.
-- One active row per (process_id, workload_type, effective_from).
-- The HC calculation service reads this to determine which formula
-- to apply and what parameters to use.
--
-- Wide table design: columns for all workload types; irrelevant columns
-- are NULL for a given workload_type. This avoids a type-dispatch join.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS wfm_process_planning_rule;
-- ============================================================

CREATE TABLE IF NOT EXISTS wfm_process_planning_rule (
  id              VARCHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id      VARCHAR(36)    NOT NULL,
  branch_id       VARCHAR(36)    NULL     COMMENT 'NULL = applies to all branches of the process',
  workload_type   VARCHAR(50)    NOT NULL COMMENT 'Matches process_master.workload_type; for blended: one row per sub-type',

  effective_from  DATE           NOT NULL,
  effective_to    DATE           NULL     COMMENT 'NULL = currently active',

  -- ── Common fields (all workload types) ──────────────────────────────────
  aht_seconds             INT            NULL   COMMENT 'Average handle/processing time in seconds',
  productivity_per_hour   DECIMAL(10,2)  NULL   COMMENT 'Generic: cases/emails/audits per agent-hour',
  shrinkage_pct           DECIMAL(5,2)   NOT NULL DEFAULT 0.00
                          COMMENT 'Total shrinkage % (leaves + breaks + training + WO). Applied to all HC formulas.',
  occupancy_target_pct    DECIMAL(5,2)   NULL   COMMENT 'Target occupancy %; used by Erlang-C extension',
  sla_target_pct          DECIMAL(5,2)   NULL   COMMENT 'SLA target percentage (e.g. 80.00 for 80%)',
  sla_minutes             INT            NULL   COMMENT 'SLA answer/response window in minutes',

  -- ── Inbound voice ────────────────────────────────────────────────────────
  service_level_target_pct  DECIMAL(5,2) NULL   COMMENT 'e.g. 80% calls answered within X seconds',
  answer_time_seconds       INT          NULL   COMMENT 'Speed of answer target in seconds',
  abandonment_target_pct    DECIMAL(5,2) NULL,

  -- ── Outbound voice ───────────────────────────────────────────────────────
  campaign_target_type    VARCHAR(50)    NULL
    COMMENT 'attempts | contacts | sales | collections | callbacks | appointments',
  target_attempts         INT            NULL,
  target_contacts         INT            NULL,
  target_sales            INT            NULL,
  connect_rate_pct        DECIMAL(5,2)   NULL   COMMENT '% of dials that connect',
  contact_rate_pct        DECIMAL(5,2)   NULL   COMMENT '% of contacts that are right-party',
  conversion_rate_pct     DECIMAL(5,2)   NULL   COMMENT '% of contacts that convert to a sale/payment',
  dialer_mode             VARCHAR(50)    NULL   COMMENT 'predictive | progressive | preview | manual',
  dials_per_agent_hour    DECIMAL(10,2)  NULL   COMMENT 'Expected dials per agent per hour',
  retry_attempts          INT            NULL   COMMENT 'Max retry attempts per record',

  -- ── Chat ─────────────────────────────────────────────────────────────────
  chat_concurrency            DECIMAL(5,2) NULL COMMENT 'Simultaneous chats per agent',
  avg_chat_duration_seconds   INT          NULL,
  first_response_sla_seconds  INT          NULL,

  -- ── Email ─────────────────────────────────────────────────────────────────
  emails_per_agent_hour       DECIMAL(10,2) NULL,
  email_sla_hours             DECIMAL(6,2)  NULL COMMENT 'SLA window for email response',
  backlog_clearance_hours     DECIMAL(6,2)  NULL COMMENT 'Time window to clear backlog',

  -- ── Backoffice / Data verification ────────────────────────────────────────
  cases_per_agent_hour        DECIMAL(10,2) NULL,
  tat_hours                   DECIMAL(6,2)  NULL COMMENT 'Turnaround time target',
  quality_recheck_pct         DECIMAL(5,2)  NULL COMMENT 'Additional QA re-check overhead %',

  -- ── Audit / Quality ───────────────────────────────────────────────────────
  audit_sample_pct            DECIMAL(5,2)  NULL COMMENT '% of production volume that must be audited',
  audits_per_qa_hour          DECIMAL(10,2) NULL,

  -- ── Metadata ──────────────────────────────────────────────────────────────
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  notes         TEXT         NULL     COMMENT 'WFM planner notes for this rule',
  created_by    VARCHAR(36)  NULL,
  updated_by    VARCHAR(36)  NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_wppr_process        (process_id, workload_type, is_active),
  INDEX idx_wppr_effective      (process_id, effective_from, effective_to),
  CONSTRAINT fk_wppr_process FOREIGN KEY (process_id)
    REFERENCES process_master(id) ON DELETE CASCADE,
  CONSTRAINT fk_wppr_branch  FOREIGN KEY (branch_id)
    REFERENCES branch_master(id)  ON DELETE SET NULL

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-process HC calculation parameters; one active row per process/workload_type/effective_from';

SELECT '232_wfm_process_planning_rule.sql applied successfully' AS migration_status;
