-- 1546_mira_action_audit_log.sql
-- Audit trail for Mira's write-capable actions (currently: filing a leave request on
-- the asking user's own behalf, confirm-before-submit — see mira-leave-action.service.ts).
--
-- Distinct from ai_prompt_audit_log (which stores only a hash of the question, never
-- the actual payload — see ai-conversation.service.ts's header comment) and from
-- manager_raised_request (1545_manager_raised_request.sql — that table is for a
-- MANAGER raising leave for a DIFFERENT employee who must separately consent; this one
-- is for Mira drafting and, on the SAME user's immediate confirmation in the same chat
-- turn, submitting for themselves — no cross-person consent step, so no inbox
-- notification and no separate consent_status machine is needed here).
--
-- One row per lifecycle event (drafted / confirmed / rejected / submitted / failed /
-- cancelled), not one row updated in place — an append-only trail survives a crash
-- between "confirmed" and "submitted" without losing what was asked.

CREATE TABLE IF NOT EXISTS mira_action_audit_log (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id          CHAR(36)     NOT NULL,                 -- auth_user.id of the person chatting with Mira
  employee_id      CHAR(36)     NULL,                     -- resolved employee record, when one exists
  action_type      VARCHAR(30)  NOT NULL,                 -- 'leave_request' today; extensible
  status           VARCHAR(20)  NOT NULL,                 -- drafted | confirmed | rejected | submitted | failed | cancelled
  payload          JSON         NULL,                     -- the drafted action's fields
  guard_reasons    JSON         NULL,                     -- non-empty only when status = 'rejected'
  leave_request_id CHAR(36)     NULL,                     -- leave_request.id once actually submitted
  error_message    TEXT         NULL,                     -- populated only when status = 'failed'
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_maal_user (user_id, created_at),
  INDEX idx_maal_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1546_mira_action_audit_log.sql applied' AS migration_status;

-- Rollback:
--   DROP TABLE IF EXISTS mira_action_audit_log;
