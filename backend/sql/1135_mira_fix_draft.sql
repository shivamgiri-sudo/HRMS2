-- 1135_mira_fix_draft.sql
--
-- Adds mira_fix_draft, the missing second half of the Mira issue-triage pipeline.
--
-- WHY
--
-- mira-issue-triage.service.ts (see work_item_audit_log rows written by it) only ever
-- produces a diagnosis: a root-cause hypothesis and a suggested next step, explicitly
-- logged as "an AI-generated hypothesis for human review, not an applied fix." Nothing
-- downstream of that ever generates a real code change, and nothing pushes or deploys
-- anything. Reported live 2026-08-13: a super_admin looking at a triaged complaint asked
-- "what execution happened after that prompt by engine to rectify that issue" and there
-- was no answer, because that stage was never built.
--
-- This table is the record for that stage: one row per AI-drafted fix attempt against a
-- triaged work_item, carrying the diff itself, why it was accepted or auto-rejected by
-- the server-side deny-list, who reviewed it, and what happened when they clicked deploy.
-- Every field a human or an auditor would need to reconstruct "what did the engine
-- propose, and what actually shipped" lives on this one row.
--
-- Deliberately no code here calls this table yet — see mira-fix-draft.service.ts (Phase
-- 1: schema + service + deny-list, flag OFF; Phase 2: live adversarial validation before
-- the deploy route is ever reachable). This migration is additive and inert on its own.
--
-- SHAPE
--
-- Same collation as work_item (utf8mb4_unicode_ci), explicit rather than inherited from
-- the server default, because work_item_id will be joined against work_item.id and a
-- mismatched default (utf8mb4_0900_ai_ci) throws ER_CANT_AGGREGATE_2COLLATIONS on the
-- first join, exactly as documented for employee_reimbursement_claim (migration 1038).
--
-- No FK constraint on work_item_id, matching work_item's own style (it indexes
-- assigned_to_user_id rather than constraining it) — indexed instead, for the same
-- lookup pattern without coupling migration order.

CREATE TABLE IF NOT EXISTS mira_fix_draft (
  id                  CHAR(36)      NOT NULL,
  work_item_id        CHAR(36)      NOT NULL,
  status              VARCHAR(20)   NOT NULL DEFAULT 'drafted',
  diagnosis_category  VARCHAR(50)   DEFAULT NULL,
  target_files        TEXT          DEFAULT NULL,
  diff_text           MEDIUMTEXT    NOT NULL,
  model               VARCHAR(100)  DEFAULT NULL,
  safety_flags        TEXT          DEFAULT NULL,
  rejected_reason     VARCHAR(500)  DEFAULT NULL,
  reviewed_by         CHAR(36)      DEFAULT NULL,
  reviewed_at         DATETIME      DEFAULT NULL,
  test_output         MEDIUMTEXT    DEFAULT NULL,
  commit_sha          CHAR(40)      DEFAULT NULL,
  deployed_at         DATETIME      DEFAULT NULL,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_mfd_work_item (work_item_id),
  INDEX idx_mfd_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
