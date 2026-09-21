-- 1832_attendance_mismatch_escalation.sql
--
-- WFM -> reporting-manager escalation of an attendance mismatch (attendance_daily_record row).
-- The manager records a recommendation; WFM/HR still makes the final resolution through
-- PATCH /api/wfm/mismatches/:id/resolve, which closes the open escalation.
--
-- Additive only. No foreign keys on purpose: employees.id / attendance_daily_record.id are
-- utf8mb4_unicode_ci and a bare CHARSET=utf8mb4 would resolve to utf8mb4_0900_ai_ci and be
-- rejected (see migration 1028). COLLATE is spelled out.
--
-- NOT registered in MIGRATION_MANIFEST: adding it there applies it to the live DB on the next
-- boot. Register only once the owner approves applying it. Until then the routes tolerate the
-- table being absent (ER_NO_SUCH_TABLE -> 503 "not yet enabled").

CREATE TABLE IF NOT EXISTS attendance_mismatch_escalation (
  id                        CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  adr_id                    CHAR(36)      NOT NULL COMMENT 'attendance_daily_record.id',
  employee_id               CHAR(36)      NOT NULL,
  record_date               DATE          NOT NULL,
  level                     TINYINT       NOT NULL DEFAULT 1 COMMENT '1 = reporting manager, 2 = skip-level',
  escalated_by_user_id      CHAR(36)      NOT NULL,
  escalated_by_role         VARCHAR(50)   NULL,
  escalated_to_employee_id  CHAR(36)      NOT NULL,
  escalated_to_user_id      CHAR(36)      NOT NULL,
  escalation_note           VARCHAR(500)  NULL,
  status                    VARCHAR(20)   NOT NULL DEFAULT 'pending' COMMENT 'pending | recommended | superseded | resolved',
  due_at                    DATETIME      NOT NULL,
  recommended_status        VARCHAR(30)   NULL,
  recommendation_note       VARCHAR(500)  NULL,
  responded_at              DATETIME      NULL,
  created_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ame_adr (adr_id, status),
  INDEX idx_ame_to_user (escalated_to_user_id, status),
  INDEX idx_ame_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1832_attendance_mismatch_escalation.sql applied' AS migration_status;
