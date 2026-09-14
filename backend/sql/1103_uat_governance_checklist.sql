-- 1103_uat_governance_checklist.sql
--
-- Phase 2 of the UAT platform: the checklist engine, the record of what the LLM was asked
-- and answered, and effective-dated model pricing.
--
-- Phase 2 is ADVISORY ONLY. Nothing here dispatches work or writes code; it produces a
-- verdict a human reads. The tables exist so that verdict is reproducible six months later,
-- which is the part that cannot be added retrospectively.
--
-- WHY EVALUATIONS PIN A RULE VERSION
--   Checklist rules change. Without recording which version judged an item, "why was this
--   allowed in March" is unanswerable, and the natural (wrong) answer is to re-run today's
--   rules against yesterday's decision. Each evaluation stores the rule version, a hash of
--   the rule text, and the shas of both control-plane files as they were at evaluation time.
--
-- WHY PRICING IS A TABLE AND NOT A CONSTANT
--   Prices change. A constant in code silently rewrites the cost of every historical call the
--   next time it is edited, so a spend report would disagree with itself between deploys.
--   Effective-dated rows mean a call is priced at the rate in force when it was made.
--
-- THE FLOOR IS NOT IN HERE, ON PURPOSE
--   uat_checklist_item holds DB-editable rules only. The code floor lives in
--   uat/protected-paths.json and uat/capability-registry.json, which are deny-tier and
--   change only through a reviewed pull request. is_floor marks the mirrored rows so the UI
--   can show them locked; the engine never reads a DB row to decide a floor verdict, and
--   uat-checklist.service.ts merges with worstOf() so a DB row can only ever make a verdict
--   worse. A test feeds an all-pass rule set against a payroll scan and asserts it is still
--   blocked.
--
-- Idempotent: CREATE ... IF NOT EXISTS throughout; seeds use INSERT IGNORE on unique keys.

START TRANSACTION;

-- ── Checklist definitions ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS uat_checklist_item (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  item_key       VARCHAR(60)  NOT NULL UNIQUE,          -- BR-01, DI-03, ...
  category       ENUM('blast_radius','data_integrity','security_rbac','regression',
                      'compliance','ux','operational','change_governance','privacy',
                      'performance','accessibility','observability','release_safety') NOT NULL,
  statement      VARCHAR(500) NOT NULL,
  evidence_spec  VARCHAR(500) NOT NULL,                 -- what satisfies it
  evaluator      ENUM('static','llm','human','hybrid') NOT NULL,
  failure_mode   ENUM('block','warn') NOT NULL,
  -- Mirrors a code-floor rule. The engine does not consult these rows to reach a floor
  -- verdict; the flag exists so the admin UI can render them locked and explain why.
  is_floor       TINYINT(1)   NOT NULL DEFAULT 0,
  rule_version   INT          NOT NULL DEFAULT 1,
  active_status  TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order     INT          NOT NULL DEFAULT 100,
  created_by     CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  updated_by     CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  change_reason  VARCHAR(500) NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_uat_ci_cat   (category, sort_order),
  INDEX idx_uat_ci_floor (is_floor, active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Per-item evaluation results ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS uat_checklist_evaluation (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  feedback_id          CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  item_key             VARCHAR(60)  NOT NULL,
  verdict              ENUM('pass','fail','warn','not_applicable','undetermined') NOT NULL,
  -- Which layer produced it. 'floor' and 'capability' are authoritative; 'db' is additive
  -- and can only make a verdict worse.
  source               ENUM('floor','capability','static','llm','human','db') NOT NULL,
  evidence             TEXT         NULL,
  confidence           DECIMAL(4,3) NULL,               -- LLM self-reported, advisory only
  llm_call_id          CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  decided_by           CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  -- Reproducibility: exactly which rules judged this, as they were at the time.
  rule_version         INT          NULL,
  rule_snapshot_sha256 CHAR(64)     NULL,
  paths_sha            CHAR(64)     NULL,
  registry_sha         CHAR(64)     NULL,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_uat_eval (feedback_id, item_key),
  INDEX idx_uat_eval_fb      (feedback_id),
  INDEX idx_uat_eval_verdict (verdict),
  CONSTRAINT fk_uat_eval_fb FOREIGN KEY (feedback_id)
    REFERENCES uat_feedback(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Capability hits, promoted out of the scan JSON ────────────────────────────
-- uat_static_scan already stores these as JSON for the scan record. This table exists so
-- "how often does the leave-accrual capability fire, and on which signal" is a query rather
-- than a JSON scan across every row — the input to tuning the registry from real data.

CREATE TABLE IF NOT EXISTS uat_capability_hit (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  feedback_id    CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  scan_id        CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  capability_key VARCHAR(60)  NOT NULL,
  capability_class ENUM('DENY','HIGH_REVIEW','REVIEW','STANDARD','TRIVIAL') NOT NULL,
  match_signal   ENUM('path','table','keyword') NOT NULL,
  matched_token  VARCHAR(300) NOT NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_uat_caphit_fb   (feedback_id),
  INDEX idx_uat_caphit_key  (capability_key, capability_class),
  INDEX idx_uat_caphit_sig  (match_signal),
  CONSTRAINT fk_uat_caphit_fb FOREIGN KEY (feedback_id)
    REFERENCES uat_feedback(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── LLM call log ──────────────────────────────────────────────────────────────
-- prompt_sha256 alone cannot explain why the model answered differently six months later:
-- the model version, the effort setting and the prompt template all move independently.
-- All three are recorded, plus the registry sha the prompt was built from.
--
-- response_json holds the VALIDATED payload only. Raw prose is not stored: the request was
-- built from body_redacted, and keeping an unvalidated blob would be a second, unaudited
-- copy of it.

CREATE TABLE IF NOT EXISTS uat_llm_call (
  id                     CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  feedback_id            CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  stage                  ENUM('validator','prompt_writer','repair') NOT NULL,
  provider_key           VARCHAR(50)  NOT NULL,
  model_id               VARCHAR(100) NOT NULL,
  model_version          VARCHAR(100) NULL,             -- what the API said it actually used
  effort                 VARCHAR(20)  NULL,
  max_tokens             INT          NULL,
  prompt_template_version VARCHAR(20) NOT NULL,
  registry_sha           CHAR(64)     NULL,
  prompt_sha256          CHAR(64)     NOT NULL,
  response_sha256        CHAR(64)     NULL,
  attempt_no             TINYINT      NOT NULL DEFAULT 1,
  schema_valid           TINYINT(1)   NOT NULL DEFAULT 0,
  stop_reason            VARCHAR(40)  NULL,             -- end_turn | refusal | max_tokens
  refusal_category       VARCHAR(60)  NULL,
  input_tokens           INT          NULL,
  output_tokens          INT          NULL,
  cache_read_tokens      INT          NULL,
  cost_usd_micros        BIGINT       NULL,
  pricing_version_id     CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  latency_ms             INT          NULL,
  error_message          VARCHAR(1000) NULL,
  response_json          JSON         NULL,
  created_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_uat_llm_fb      (feedback_id, created_at),
  INDEX idx_uat_llm_stage   (stage, created_at),
  INDEX idx_uat_llm_created (created_at),
  CONSTRAINT fk_uat_llm_fb FOREIGN KEY (feedback_id)
    REFERENCES uat_feedback(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Model pricing, effective-dated ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS uat_model_pricing (
  id                     CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  provider_key           VARCHAR(50)   NOT NULL,
  model_id               VARCHAR(100)  NOT NULL,
  input_usd_per_mtok     DECIMAL(10,4) NOT NULL,
  output_usd_per_mtok    DECIMAL(10,4) NOT NULL,
  cache_read_multiplier  DECIMAL(6,4)  NOT NULL DEFAULT 0.1000,
  effective_from         DATETIME      NOT NULL,
  effective_to           DATETIME      NULL,
  changed_by             CHAR(36)      COLLATE utf8mb4_unicode_ci NULL,
  change_reason          VARCHAR(500)  NULL,
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_uat_price (provider_key, model_id, effective_from),
  INDEX idx_uat_price_lookup (provider_key, model_id, effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Published list price at the time of writing. effective_from is deliberately far in the
-- past so the very first call resolves a rate rather than falling through to "unpriced".
INSERT IGNORE INTO uat_model_pricing
  (id, provider_key, model_id, input_usd_per_mtok, output_usd_per_mtok,
   cache_read_multiplier, effective_from, change_reason)
VALUES
  (UUID(), 'claude', 'claude-opus-5',   5.0000, 25.0000, 0.1000, '2000-01-01 00:00:00',
   'Initial list price'),
  (UUID(), 'claude', 'claude-sonnet-5', 3.0000, 15.0000, 0.1000, '2000-01-01 00:00:00',
   'Initial list price');

-- ── Durable job queue ─────────────────────────────────────────────────────────
-- Validation is an outbound call to an external API that can take a minute and can fail
-- halfway. Doing it inside the submit request would make a UAT user watch a spinner and
-- would lose the work entirely on a restart, which in this codebase means the item sits in
-- `validating` forever with nobody aware.
--
-- Leasing rather than a status flag: `leased_until` in the past is automatically reclaimable,
-- so a worker killed mid-job releases its work by the clock rather than by a cleanup routine
-- that itself has to survive the crash.
--
-- idempotency_key is UNIQUE and is how a double submit becomes one job. It is the mechanism,
-- not a backstop.

CREATE TABLE IF NOT EXISTS uat_job (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  job_type        ENUM('validate','checklist','prompt_write','dispatch','reconcile') NOT NULL,
  feedback_id     CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  payload_json    JSON         NULL,
  state           ENUM('queued','leased','done','failed','dead') NOT NULL DEFAULT 'queued',
  idempotency_key VARCHAR(190) NOT NULL,
  lease_owner     VARCHAR(120) NULL,
  leased_until    DATETIME     NULL,
  attempts        TINYINT      NOT NULL DEFAULT 0,
  max_attempts    TINYINT      NOT NULL DEFAULT 3,
  run_after       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error      VARCHAR(1000) NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_uat_job_idem (idempotency_key),
  INDEX idx_uat_job_claim (state, run_after, leased_until),
  INDEX idx_uat_job_fb    (feedback_id),
  CONSTRAINT fk_uat_job_fb FOREIGN KEY (feedback_id)
    REFERENCES uat_feedback(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Checklist seed ────────────────────────────────────────────────────────────
-- Mirrors of the code-floor items, marked is_floor = 1. They are here so the admin UI can
-- list and explain every gate in one place; the engine still reaches its floor verdict from
-- the JSON files, never from these rows.

INSERT IGNORE INTO uat_checklist_item
  (id, item_key, category, statement, evidence_spec, evaluator, failure_mode, is_floor, sort_order)
VALUES
  (UUID(),'BR-01','blast_radius','No candidate file matches a deny-tier protected pattern','Static scan protected_hits contains no deny entries','static','block',1,10),
  (UUID(),'BR-02','blast_radius','Every review-tier hit has a named human approver on record','uat_approval row decided for the required role','hybrid','block',1,20),
  (UUID(),'BR-02b','blast_radius','Every capability at REVIEW or above has its required approver roles satisfied','One decided uat_approval per required role','hybrid','block',1,25),
  (UUID(),'BR-03','blast_radius','Change touches at most 6 source files and 2 backend modules','Static scan impacted path and module counts','static','warn',0,30),
  (UUID(),'BR-04','blast_radius','No candidate file is imported by more than 25 other modules','Reverse-dependency fan-in','static','warn',0,40),
  (UUID(),'BR-05','blast_radius','The change is additive: nothing exported, routed or migrated is removed','LLM declares removals empty; CI re-checks with the deletion guard','hybrid','block',1,50),
  (UUID(),'BR-06','blast_radius','Creates no second source of truth for a domain owned elsewhere','LLM answer plus capability ownership','llm','block',1,60),
  (UUID(),'BR-07','blast_radius','No new npm dependency','package.json and lockfile unchanged in the diff','static','block',1,70),
  (UUID(),'DI-01','data_integrity','No DDL: adds no migration and edits none','Diff touches no backend/sql and no manifest entry','static','block',1,100),
  (UUID(),'DI-02','data_integrity','No runtime CREATE TABLE or ALTER is introduced','Diff scan for DDL in TypeScript','static','block',1,110),
  (UUID(),'DI-05','data_integrity','No UPDATE or DELETE without a WHERE, and no unbounded bulk write','Diff scan','static','block',1,120),
  (UUID(),'DI-06','data_integrity','No silent fallback that could render a fabricated metric','Diff scan plus LLM review','hybrid','block',1,130),
  (UUID(),'SR-01','security_rbac','No middleware, auth, RBAC matrix or scope guard is touched','Deny-tier path match','static','block',1,200),
  (UUID(),'SR-02','security_rbac','Every new API route declares requireAuth and an explicit requireRole','Static check on diffed routers','static','block',1,210),
  (UUID(),'SR-04','security_rbac','No payroll, salary, bank, statutory or tax field on a non-payroll endpoint','LLM field review plus deny-word scan','hybrid','block',1,220),
  (UUID(),'SR-05','security_rbac','Row scope is enforced at query level, not only in the UI','LLM confirms; reviewer confirms','hybrid','block',1,230),
  (UUID(),'CS-01','compliance','No change to TDS slabs, PF/ESIC rates, gratuity formula, LWP basis or F&F logic','Deny tier plus keyword scan','static','block',1,300),
  (UUID(),'CS-03','compliance','No DPDP-relevant personal data is newly exposed, logged or exported','LLM field review against redaction categories','llm','block',1,310),
  (UUID(),'CS-04','compliance','No change to the deployed LMS or LMS-owned domains','Capability match plus LLM','hybrid','block',1,320),
  (UUID(),'CG-01','change_governance','change_type is classified as bug, enhancement or policy_change','LLM classification, undetermined treated as fail','llm','block',0,400),
  (UUID(),'PR-01','privacy','Body and attachments are PII-classified and redacted before any LLM call','pii_classification_json present on the feedback row','static','block',1,500),
  (UUID(),'PR-02','privacy','No raw feedback text, screenshot or attachment leaves the backend','Structural: no export path exists','static','block',1,510),
  (UUID(),'OP-03','operational','Failure is loud: no swallowed catch on a new critical path','Diff scan plus LLM review','hybrid','block',0,600),
  (UUID(),'OP-04','operational','Revertible by reverting one commit, with no data migration','LLM declares a rollback plan','llm','block',0,610);

COMMIT;

-- Rollback:
--   DROP TABLE IF EXISTS uat_model_pricing;
--   DROP TABLE IF EXISTS uat_llm_call;
--   DROP TABLE IF EXISTS uat_capability_hit;
--   DROP TABLE IF EXISTS uat_checklist_evaluation;
--   DROP TABLE IF EXISTS uat_checklist_item;
-- None existed before this migration. uat_llm_call, uat_capability_hit and
-- uat_checklist_evaluation FK to uat_feedback (1095), so drop them before that table if
-- unwinding both.
