-- 1104_uat_prompt_governance.sql
--
-- Phase 3: change-type governance and the build prompt.
--
-- Phase 3 STOPS AT A PROMPT. Nothing here dispatches anything. A human reads the generated
-- prompt, decides whether it is any good, and — if they want the change — runs it themselves.
-- That is deliberate: this is where evidence about classification quality and prompt quality
-- gets gathered, before anything is allowed to act on either.
--
-- WHY THE PROMPT IS A ROW AND NOT A STRING PASSED AROUND
--   The prompt is the instruction set a coding agent will eventually act on. If it is
--   assembled on demand, then "what was it told to do" is unanswerable after the fact, and
--   two renders of the same item could differ without anyone noticing. Storing it with its
--   template version, its allowlist and a hash makes the instruction auditable and makes
--   tampering detectable.
--
-- WHY allowed_paths_json IS STORED RATHER THAN RECOMPUTED
--   The allowlist is the security boundary. Recomputing it at use time means the boundary
--   depends on whatever the control plane says THEN, which is not what the approver saw when
--   they approved. Stored, hashed and re-verified — the approver approves a specific list.
--
-- Idempotent. Safe to re-run.

START TRANSACTION;

-- ── Kill switches and tunables ────────────────────────────────────────────────
-- Env vars alone are not enough: changing one needs a deploy, and the moment you most want
-- to stop the pipeline is the moment you least want to deploy. A DB row can be flipped by an
-- operator immediately. Both are checked, and either can veto — never only one.

CREATE TABLE IF NOT EXISTS uat_pipeline_config (
  config_key   VARCHAR(80)  NOT NULL PRIMARY KEY,
  config_value VARCHAR(500) NOT NULL,
  description  VARCHAR(500) NULL,
  updated_by   CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every switch ships OFF. A feature that arrives switched on has decided something on the
-- operator's behalf that only the operator should decide.
INSERT IGNORE INTO uat_pipeline_config (config_key, config_value, description) VALUES
  ('pipeline_enabled',    'false', 'Master switch. When false, no LLM stage runs at all.'),
  ('validator_enabled',   'false', 'Stage 1. Costs money and reaches an external API.'),
  ('prompt_writer_enabled','false','Stage 2. Renders a build prompt for human review.'),
  ('builds_enabled',      'false', 'Phase 4. Dispatches a build. Held behind gates G1-G8.'),
  ('daily_build_cap',     '5',     'Maximum automated builds dispatched per day.'),
  ('max_concurrent_builds','1',    'Builds allowed to run at once.'),
  ('daily_llm_usd_cap',   '25',    'Daily LLM spend ceiling in USD.'),
  ('allowlisted_modules', '',      'Comma-separated module prefixes eligible for automated build. Empty means none.');

-- ── The build prompt ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS uat_build_prompt (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  feedback_id          CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  attempt_no           TINYINT      NOT NULL DEFAULT 1,
  template_version     VARCHAR(20)  NOT NULL,
  -- The rendered prompt. Built from body_redacted only; the raw body has no path here.
  prompt_text          MEDIUMTEXT   NOT NULL,
  prompt_sha256        CHAR(64)     NOT NULL,
  -- The security boundary, as the approver saw it.
  allowed_paths_json   JSON         NOT NULL,
  forbidden_paths_json JSON         NOT NULL,
  mandatory_tests_json JSON         NOT NULL,
  -- Model-generated and later reaches `git switch -c`. Validated server-side against
  -- ^[a-z0-9][a-z0-9-]{0,50}$ before it is stored, and validated AGAIN in CI. Never
  -- sanitised-and-continued: a slug that fails the pattern rejects the whole response.
  branch_slug          VARCHAR(60)  NOT NULL,
  acceptance_criteria_json JSON     NULL,
  rollback_plan        VARCHAR(1000) NULL,
  llm_call_id          CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  -- Approval of THIS prompt, distinct from approving the underlying request. A reviewer can
  -- want the change and still reject the instructions written to produce it.
  approved_by          CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  approved_at          DATETIME     NULL,
  rejected_by          CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  rejected_at          DATETIME     NULL,
  rejection_reason     VARCHAR(1000) NULL,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_uat_prompt (feedback_id, attempt_no),
  INDEX idx_uat_prompt_fb (feedback_id),
  CONSTRAINT fk_uat_prompt_fb FOREIGN KEY (feedback_id)
    REFERENCES uat_feedback(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Who owns a change type ────────────────────────────────────────────────────
-- CG-02 and CG-03: an enhancement needs a product owner, and a policy change additionally
-- needs the owning function. Expressed as data rather than a switch statement so adding a
-- function is a row, not a deploy — and so the console can explain WHO is being waited on.

CREATE TABLE IF NOT EXISTS uat_change_type_policy (
  id             CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  change_type    ENUM('bug','enhancement','policy_change','unclear') NOT NULL,
  required_role  VARCHAR(60) NOT NULL,
  rationale      VARCHAR(500) NOT NULL,
  active_status  TINYINT(1) NOT NULL DEFAULT 1,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_uat_ctp (change_type, required_role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO uat_change_type_policy (id, change_type, required_role, rationale) VALUES
  -- A bug is a restoration of intended behaviour, so the technical reviewer suffices.
  (UUID(),'bug','uat_tech_reviewer','A bug fix restores intended behaviour; a technical reviewer confirms the fix matches the intent.'),
  -- An enhancement changes what the product does, which is a product decision, not a
  -- technical one. Required BEFORE prompt generation, not after.
  (UUID(),'enhancement','uat_product_owner','An enhancement changes what the product does. That is a product decision and it is taken before anything is written.'),
  (UUID(),'enhancement','uat_tech_reviewer','A technical reviewer confirms the change is feasible and additive.'),
  -- A policy change alters an HR outcome for real people. The owning function signs too.
  (UUID(),'policy_change','uat_product_owner','A policy change is also a product change.'),
  (UUID(),'policy_change','uat_domain_owner','A policy change alters an HR outcome for real employees; the owning function signs for it.'),
  (UUID(),'policy_change','uat_tech_reviewer','A technical reviewer confirms the implementation matches the approved policy.'),
  -- `unclear` is not a class that proceeds. The row exists so the gate has something to
  -- point at rather than silently finding no policy and treating that as no requirement.
  (UUID(),'unclear','uat_triage','The change type could not be established. Triage must classify it before anything else happens.');

-- ── Governance columns on the feedback row ────────────────────────────────────
-- Added here rather than in 1095 because they are Phase 3 concepts, and a column that exists
-- for two phases with nothing writing it reads like a feature that silently does nothing.

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'uat_feedback'
              AND COLUMN_NAME = 'change_type_confirmed_by');
SET @s := IF(@c = 0,
  'ALTER TABLE uat_feedback
     ADD COLUMN change_type_confirmed_by CHAR(36) COLLATE utf8mb4_unicode_ci NULL,
     ADD COLUMN change_type_confirmed_at DATETIME NULL',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

COMMIT;

-- Rollback:
--   ALTER TABLE uat_feedback DROP COLUMN change_type_confirmed_by, DROP COLUMN change_type_confirmed_at;
--   DROP TABLE IF EXISTS uat_change_type_policy;
--   DROP TABLE IF EXISTS uat_build_prompt;
--   DROP TABLE IF EXISTS uat_pipeline_config;
-- None existed before this migration.
