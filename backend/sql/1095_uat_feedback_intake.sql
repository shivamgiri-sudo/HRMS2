-- 1095_uat_feedback_intake.sql
--
-- Phase 1 of the UAT Governance + AI-Assisted Change Control platform: structured
-- intake for UAT feedback, its audit spine, attachments, comments, the deterministic
-- static-scan record, the SLA policy table and approver delegation.
--
-- WHY NEW TABLES INSTEAD OF EXTENDING helpdesk_ticket
--   helpdesk_ticket (016_employee_lifecycle.sql) is the obvious candidate and is the
--   wrong one, for three concrete reasons:
--     1. Its `category` and `status` are ENUMs. This lifecycle needs ~18 states, so
--        adopting it would mean a live ALTER of two ENUMs on a populated table that
--        39 endpoints read.
--     2. helpdesk-sla.service.ts recomputes SLA breach flags across ALL tickets on
--        every /api/helpdesk/dashboard hit. UAT rows would silently enter helpdesk
--        SLA dashboards, aging buckets and owner workload — the exact silent-corruption
--        class this platform exists to catch.
--     3. grievance-timeline.contract.test.ts and the helpdesk dashboards assume ticket
--        semantics that do not hold for a build pipeline.
--   What IS reused: the page shape, the routes/service/RBAC file layout, the comment
--   thread concept, and a one-way handoff via uat_feedback.linked_helpdesk_ticket_id
--   for items that turn out to be a support issue rather than a code change.
--
-- COLLATION
--   The server default is utf8mb4_0900_ai_ci but employees.id is utf8mb4_unicode_ci.
--   Every table below declares COLLATE=utf8mb4_unicode_ci and every CHAR(36) column
--   that joins or FKs to employees(id) declares it again at column level. Omitting
--   either produces ER_CANT_AGGREGATE_2COLLATIONS (errno 3780) on the first JOIN,
--   which is a runtime failure a migration test would not catch.
--
-- FOREIGN KEYS
--   Hard FKs only to employees(id) and to uat_feedback(id). Actor, scope and release
--   columns are soft references with indexes, matching how helpdesk_ticket already
--   models assigned_to. Two reasons: an unmapped user genuinely has no branch, so the
--   scope columns must tolerate NULL and orphans; and adding FKs to tables whose
--   collation this migration has not verified is how you get a 3780 at deploy time
--   rather than in review.
--
-- STATUS IS VARCHAR, NOT ENUM
--   Deliberate, and the direct lesson of reason 1 above. The lifecycle will gain states
--   (Phases 4-6 add build_*, deployed_to_uat, retest_*, rollback_*). VARCHAR + an
--   application-level state machine means adding a state is a code change, not an ALTER
--   on a populated table. uat-state-machine.ts is the only writer of this column.
--
-- PRIVACY
--   body_raw holds what the user typed; body_redacted holds the PII-classified,
--   placeholder-substituted version. body_redacted is the ONLY version any LLM or CI
--   job is ever permitted to read (checklist PR-01/PR-02). They are separate columns
--   rather than one mutated column so that redaction is auditable and reversible by an
--   authorised reader, and so a code path that forgets to redact reads NULL rather than
--   silently leaking.
--
-- Idempotent: every CREATE is IF NOT EXISTS; the page_catalog seed is
-- INSERT ... ON DUPLICATE KEY UPDATE on a unique page_code. Safe to re-run.

START TRANSACTION;

-- ── Core intake ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS uat_feedback (
  id                         CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  feedback_code              VARCHAR(32)   NOT NULL UNIQUE,           -- UAT-000123
  submitted_by_employee_id   CHAR(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  submitted_by_user_id       CHAR(36)      COLLATE utf8mb4_unicode_ci NULL,

  kind                       ENUM('bug','correction','feature','question') NOT NULL,
  change_type                ENUM('bug','enhancement','policy_change','question') NULL,
  severity                   ENUM('low','medium','high','blocker') NOT NULL DEFAULT 'medium',
  priority                   ENUM('p3','p2','p1','p0')             NOT NULL DEFAULT 'p2',

  title                      VARCHAR(300)  NOT NULL,
  body_raw                   TEXT          NOT NULL,                  -- as typed; restricted read
  body_redacted              TEXT          NULL,                      -- the only LLM/CI-visible copy
  pii_classification_json    JSON          NULL,
  expected_behaviour         TEXT          NULL,
  actual_behaviour           TEXT          NULL,
  steps_to_reproduce         TEXT          NULL,

  -- Captured context. page_route/page_code come from the SPA's actual location and are
  -- immutable; module_hint is the user's guess and is advisory only. Server-side impact
  -- resolution stays authoritative, so a user mislabelling a payroll bug as "cosmetic UI"
  -- changes nothing about how it is classified.
  page_route                 VARCHAR(300)  NULL,
  page_code                  VARCHAR(100)  NULL,
  module_hint                VARCHAR(100)  NULL,
  api_path_hint              VARCHAR(300)  NULL,

  -- Release metadata, captured silently by the form. Reproducibility comes free.
  app_version                VARCHAR(50)   NULL,
  frontend_sha               VARCHAR(64)   NULL,
  backend_sha                VARCHAR(64)   NULL,
  environment                VARCHAR(30)   NULL,
  browser                    VARCHAR(120)  NULL,
  device                     VARCHAR(120)  NULL,
  correlation_id             VARCHAR(80)   NULL,
  occurred_at                DATETIME      NULL,

  -- Data scope. The UAT module enforces row scope on itself, not only on generated code:
  -- an admin for Branch A must not see Branch B's screenshots.
  branch_id                  CHAR(36)      COLLATE utf8mb4_unicode_ci NULL,
  process_id                 CHAR(36)      COLLATE utf8mb4_unicode_ci NULL,
  location_id                CHAR(36)      COLLATE utf8mb4_unicode_ci NULL,

  -- Ownership. Kanban status alone is not operational ownership.
  assigned_to                CHAR(36)      COLLATE utf8mb4_unicode_ci NULL,
  domain_owner_id            CHAR(36)      COLLATE utf8mb4_unicode_ci NULL,
  technical_owner_id         CHAR(36)      COLLATE utf8mb4_unicode_ci NULL,
  qa_owner_id                CHAR(36)      COLLATE utf8mb4_unicode_ci NULL,
  target_release_id          CHAR(36)      COLLATE utf8mb4_unicode_ci NULL,
  due_at                     DATETIME      NULL,

  -- Duplicate handling. UAT routinely produces 10-50 reports of one defect.
  duplicate_of_id            CHAR(36)      COLLATE utf8mb4_unicode_ci NULL,
  canonical_issue_id         CHAR(36)      COLLATE utf8mb4_unicode_ci NULL,
  affected_user_count        INT           NOT NULL DEFAULT 1,

  -- Risk, written by the static scan. NULL until scanning completes.
  risk_tier                  ENUM('deny','review','standard','trivial') NULL,
  capability_class           ENUM('DENY','HIGH_REVIEW','REVIEW','STANDARD','TRIVIAL') NULL,

  status                     VARCHAR(40)   NOT NULL DEFAULT 'submitted',
  status_reason              VARCHAR(500)  NULL,
  linked_helpdesk_ticket_id  CHAR(36)      COLLATE utf8mb4_unicode_ci NULL,

  created_at                 DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                 DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                           ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_uat_fb_status      (status),
  INDEX idx_uat_fb_emp         (submitted_by_employee_id),
  INDEX idx_uat_fb_page        (page_code),
  INDEX idx_uat_fb_created     (created_at),
  INDEX idx_uat_fb_scope       (branch_id, process_id),
  INDEX idx_uat_fb_assigned    (assigned_to),
  INDEX idx_uat_fb_dup         (duplicate_of_id),
  INDEX idx_uat_fb_release     (target_release_id),
  INDEX idx_uat_fb_risk        (risk_tier, capability_class),
  INDEX idx_uat_fb_due         (due_at),
  CONSTRAINT fk_uat_fb_emp FOREIGN KEY (submitted_by_employee_id)
    REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Audit spine ───────────────────────────────────────────────────────────────
-- Every status change, scan, approval, LLM call, gate result and error lands here.
-- Kept PII-FREE BY CONSTRUCTION: message is a system-generated summary and detail_json
-- carries identifiers and verdicts, never feedback prose or personal data. That is what
-- lets this table be retained immutably forever while evidence objects elsewhere remain
-- subject to deletion requests — an immutable record that contained PII could not be.

CREATE TABLE IF NOT EXISTS uat_feedback_event (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  feedback_id    CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  event_type     VARCHAR(60)  NOT NULL,   -- state_change | comment | scan | approval | dispatch | gate | error
  from_status    VARCHAR(40)  NULL,
  to_status      VARCHAR(40)  NULL,
  actor_user_id  CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,   -- NULL = system
  actor_kind     ENUM('user','system','llm','ci') NOT NULL DEFAULT 'system',
  detail_json    JSON         NULL,
  message        VARCHAR(1000) NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_uat_ev_fb   (feedback_id, id),
  INDEX idx_uat_ev_type (event_type),
  CONSTRAINT fk_uat_ev_fb FOREIGN KEY (feedback_id)
    REFERENCES uat_feedback(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Attachments ───────────────────────────────────────────────────────────────
-- A screenshot of a payslip or attendance register is exactly the data category this
-- codebase is otherwise careful about. Attachments NEVER leave the HRMS backend: not to
-- an LLM, not to CI, not to a PR, not to an artifact. Served only through signed,
-- short-lived, authorization-checked URLs.
--
-- encryption_key_id enables crypto-shredding: evidence objects are encrypted per-object,
-- so a deletion request destroys the key and the content becomes unrecoverable while the
-- immutable object and its hash chain remain verifiable.

CREATE TABLE IF NOT EXISTS uat_feedback_attachment (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  feedback_id          CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  comment_id           CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  uploaded_by          CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  original_filename    VARCHAR(255) NOT NULL,
  storage_key          VARCHAR(500) NOT NULL,
  redacted_storage_key VARCHAR(500) NULL,
  mime_type            VARCHAR(100) NOT NULL,
  size_bytes           BIGINT       NOT NULL,
  sha256               CHAR(64)     NOT NULL,
  encryption_key_id    VARCHAR(120) NULL,
  malware_scan_status  ENUM('pending','clean','infected','error') NOT NULL DEFAULT 'pending',
  pii_scan_status      ENUM('pending','clean','redacted','error')  NOT NULL DEFAULT 'pending',
  retention_until      DATETIME     NULL,
  -- Soft delete. The ciphertext is unlinked from disk (which destroys the only copy of that
  -- object's data key, so the content is crypto-shredded), but the ROW survives: a deletion
  -- that erases its own evidence is not an auditable deletion. What remains is metadata —
  -- who removed what, and when — never the content.
  deleted_at           DATETIME     NULL,
  deleted_by           CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_uat_att_fb      (feedback_id),
  INDEX idx_uat_att_comment (comment_id),
  INDEX idx_uat_att_scan    (malware_scan_status, pii_scan_status),
  INDEX idx_uat_att_ret     (retention_until),
  INDEX idx_uat_att_live    (feedback_id, deleted_at),
  CONSTRAINT fk_uat_att_fb FOREIGN KEY (feedback_id)
    REFERENCES uat_feedback(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Comments ──────────────────────────────────────────────────────────────────
-- visibility separates an internal triage note from something the reporter reads. A
-- single thread with a flag, rather than two tables, because a reviewer needs to read
-- them interleaved in time order to follow the conversation.

CREATE TABLE IF NOT EXISTS uat_feedback_comment (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  feedback_id       CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  parent_comment_id CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  author_user_id    CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,   -- NULL = system
  actor_kind        ENUM('user','system','llm','ci') NOT NULL DEFAULT 'user',
  visibility        ENUM('internal','reporter_visible') NOT NULL DEFAULT 'internal',
  body              TEXT         NOT NULL,
  mentions_json     JSON         NULL,
  edited_at         DATETIME     NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_uat_cm_fb     (feedback_id, created_at),
  INDEX idx_uat_cm_parent (parent_comment_id),
  CONSTRAINT fk_uat_cm_fb FOREIGN KEY (feedback_id)
    REFERENCES uat_feedback(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Static scan record ────────────────────────────────────────────────────────
-- The deterministic pass that runs BEFORE any LLM call and can terminate the pipeline
-- on its own. risk_tier here is the path-floor verdict; capability_class is the
-- business-capability verdict; effective_risk is max() of the two. Storing all three
-- means a reviewer can see which dimension fired, and protected_hits_json / capability_hits_json
-- record the matched pattern and signal so "why was this blocked" is answerable.

CREATE TABLE IF NOT EXISTS uat_static_scan (
  id                     CHAR(36)  NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  feedback_id            CHAR(36)  COLLATE utf8mb4_unicode_ci NOT NULL,
  scanner_version        VARCHAR(20) NOT NULL,
  paths_sha              CHAR(64)  NULL,   -- sha256 of uat/protected-paths.json at scan time
  registry_sha           CHAR(64)  NULL,   -- sha256 of uat/capability-registry.json at scan time
  impacted_paths_json    JSON      NOT NULL,
  impacted_routes_json   JSON      NOT NULL,
  impacted_modules_json  JSON      NOT NULL,
  protected_hits_json    JSON      NOT NULL,
  capability_hits_json   JSON      NOT NULL,
  reverse_dep_max        INT       NOT NULL DEFAULT 0,
  resolver_mode          ENUM('fast','typescript') NOT NULL DEFAULT 'fast',
  risk_tier              ENUM('deny','review','standard','trivial') NOT NULL,
  capability_class       ENUM('DENY','HIGH_REVIEW','REVIEW','STANDARD','TRIVIAL') NOT NULL,
  effective_risk         ENUM('deny','review','standard','trivial') NOT NULL,
  duration_ms            INT       NULL,
  scanned_at             DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_uat_scan_fb   (feedback_id, scanned_at),
  INDEX idx_uat_scan_risk (effective_risk),
  CONSTRAINT fk_uat_scan_fb FOREIGN KEY (feedback_id)
    REFERENCES uat_feedback(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── SLA policy ────────────────────────────────────────────────────────────────
-- Deterministic severity x priority -> minutes, effective-dated. Aging, overdue flags
-- and escalation all read from here rather than from constants in code, so the business
-- can retune the matrix without a deploy and history stays interpretable.

CREATE TABLE IF NOT EXISTS uat_sla_policy (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  severity             ENUM('low','medium','high','blocker') NOT NULL,
  priority             ENUM('p3','p2','p1','p0')             NOT NULL,
  first_response_mins  INT          NOT NULL,
  triage_mins          INT          NOT NULL,
  resolution_mins      INT          NOT NULL,
  escalation_role      VARCHAR(60)  NULL,
  effective_from       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  effective_to         DATETIME     NULL,
  changed_by           CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  change_reason        VARCHAR(500) NULL,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_uat_sla (severity, priority, effective_from),
  INDEX idx_uat_sla_lookup (severity, priority, effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Approver delegation ───────────────────────────────────────────────────────
-- Resolves the "domain owner is on leave or has exited" deadlock. The validity window is
-- ENFORCED, not advisory: an expired delegation BLOCKS approval rather than silently
-- passing it, which is the failure mode that makes delegation dangerous elsewhere.

CREATE TABLE IF NOT EXISTS uat_approver_delegation (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  capability_key      VARCHAR(60)  NOT NULL,
  required_role       VARCHAR(60)  NOT NULL,
  primary_approver_id CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  backup_approver_id  CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  valid_from          DATETIME     NOT NULL,
  valid_until         DATETIME     NOT NULL,
  delegated_by        CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  reason              VARCHAR(500) NULL,
  revoked_at          DATETIME     NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_uat_deleg_lookup (capability_key, required_role, valid_from, valid_until),
  INDEX idx_uat_deleg_primary (primary_approver_id),
  INDEX idx_uat_deleg_backup  (backup_approver_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Seed: default SLA matrix ──────────────────────────────────────────────────
-- Starting values, deliberately conservative. INSERT IGNORE on the unique key so a
-- re-run does not duplicate and does not clobber a matrix the business has since retuned.

INSERT IGNORE INTO uat_sla_policy
  (id, severity, priority, first_response_mins, triage_mins, resolution_mins, escalation_role, effective_from, change_reason)
VALUES
  (UUID(), 'blocker', 'p0',   30,    60,    480, 'UAT_RELEASE_MANAGER', '2000-01-01 00:00:00', 'Initial default matrix'),
  (UUID(), 'high',    'p1',  120,   240,   1440, 'UAT_APPROVER',        '2000-01-01 00:00:00', 'Initial default matrix'),
  (UUID(), 'medium',  'p2',  480,   960,   4320, 'UAT_TRIAGE',          '2000-01-01 00:00:00', 'Initial default matrix'),
  (UUID(), 'low',     'p3', 1440,  2880,  10080, 'UAT_TRIAGE',          '2000-01-01 00:00:00', 'Initial default matrix');

-- ── Seed: page catalog ────────────────────────────────────────────────────────
-- Makes the four page codes grantable. Grants themselves are NOT issued here: they come
-- from the role matrix that already drives every other page, and issuing ad-hoc grants
-- in a migration would create a second, competing source of truth for who sees what
-- (same reasoning as 604_missing_page_catalog_entries.sql).

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES
  ('UAT_FEEDBACK', 'UAT Feedback', '/uat/feedback', 'uat',
   'Submit UAT feedback: bugs, corrections and requests, with captured page and build context.', 1),
  ('UAT_TRIAGE_CONSOLE', 'UAT Triage Console', '/uat/triage', 'uat',
   'Triage board for UAT feedback: risk verdicts, capability hits, ownership, SLA and lifecycle.', 1),
  ('UAT_CHECKLIST_ADMIN', 'UAT Checklist Administration', '/uat/checklist', 'uat',
   'Governance view of the UAT safety checklist. Code-floor rules are locked and read-only.', 1),
  ('UAT_RELEASE_BOARD', 'UAT Release Board', '/uat/releases', 'uat',
   'Deploy-to-UAT, retest evidence capture, production release, verification and rollback.', 1)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = VALUES(active_status);

COMMIT;

-- Rollback:
--   DELETE FROM page_catalog WHERE page_code IN
--     ('UAT_FEEDBACK','UAT_TRIAGE_CONSOLE','UAT_CHECKLIST_ADMIN','UAT_RELEASE_BOARD');
--   DROP TABLE IF EXISTS uat_approver_delegation;
--   DROP TABLE IF EXISTS uat_sla_policy;
--   DROP TABLE IF EXISTS uat_static_scan;
--   DROP TABLE IF EXISTS uat_feedback_comment;
--   DROP TABLE IF EXISTS uat_feedback_attachment;
--   DROP TABLE IF EXISTS uat_feedback_event;
--   DROP TABLE IF EXISTS uat_feedback;
-- None of these tables or page codes existed before this migration, so the drops restore
-- the prior state exactly. Drop order is reverse-dependency: children before uat_feedback.
