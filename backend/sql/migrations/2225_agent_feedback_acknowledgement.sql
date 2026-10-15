-- 2225_agent_feedback_acknowledgement.sql
--
-- Agents acknowledge the quality-audit feedback shown on their My KPIs dashboard, so managers and
-- QA can see who has read their feedback and when.
--
-- One row per acknowledged audit (an audit belongs to exactly one agent). Rows are insert-only:
-- the application never updates or deletes them, so this table is itself the audit trail of the
-- action (who clicked, when, from where, and what feedback text / score they were shown).
--
-- source_record_id points at db_audit.call_quality_assessment.id (read-only upstream source; no
-- foreign key across databases). Additive and idempotent.

CREATE TABLE IF NOT EXISTS agent_feedback_acknowledgement (
  id                      CHAR(36)        NOT NULL DEFAULT (UUID()),
  source                  VARCHAR(30)     NOT NULL DEFAULT 'quality_audit',
  source_record_id        BIGINT UNSIGNED NOT NULL,
  agent_masid             VARCHAR(20)     NOT NULL,
  employee_id             CHAR(36)        NULL,
  acknowledged_by_user_id VARCHAR(64)     NOT NULL,
  agent_comment           VARCHAR(1000)   NULL,
  feedback_snapshot       TEXT            NULL,
  cq_pct_snapshot         DECIMAL(5,1)    NULL,
  ip_address              VARCHAR(45)     NULL,
  acknowledged_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_feedback_ack_record (source, source_record_id),
  KEY idx_agent_feedback_ack_agent (agent_masid, acknowledged_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
