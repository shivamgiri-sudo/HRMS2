-- 1106_uat_build_run.sql
--
-- Phase 4: the automated build, held behind gates G1-G8.
--
-- ⚠ THE TABLES SHIP; THE FEATURE DOES NOT.
--   Every switch that could dispatch a build is already OFF (1104), and this migration does
--   not turn any of them on. The schema exists so the code that reads it can be written,
--   reviewed and tested now, while enabling it remains a deliberate operator action taken
--   only after the eight gates are demonstrably true — the leaked credentials rotated, the
--   repository made private, OIDC trust proven with a real token, and the rest.
--
--   Shipping the schema without the switches is the opposite of the half-shipped shape this
--   codebase keeps producing. There the config existed and the call sites did not, so a
--   feature looked present and did nothing. Here the mechanism is complete and inert, and
--   `uat_gate_status` records exactly why.
--
-- WHY EVIDENCE IS A TABLE OF HASHES AND NOT A BLOB
--   Prompts, patches and session logs are employee-derived text. They live in private object
--   storage encrypted with a per-object data key; this table holds the key id and the hash.
--   A deletion request destroys the key — crypto-shredding — so the object stays immutable
--   and the hash chain stays verifiable while the content becomes unrecoverable. That is how
--   "WORM retention" and "a deletion request purges evidence" are both true at once.
--
-- WHY THE GATE RESULT IS HASHED
--   Job C emits gates.json and Job D reports it. If Job D could report a result Job C did not
--   produce, the trust split between them would be decorative. gates_sha256 is computed by C
--   and re-checked at the callback, so D can only relay.
--
-- Idempotent. Safe to re-run.

START TRANSACTION;

-- ── Build runs ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS uat_build_run (
  id                 CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  feedback_id        CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  prompt_id          CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  attempt_no         TINYINT      NOT NULL DEFAULT 1,
  state              ENUM('queued','dispatched','running','gates_passed','gates_failed',
                          'pr_open','merged','abandoned') NOT NULL DEFAULT 'queued',
  branch_name        VARCHAR(80)  NULL,
  gh_workflow_run_id BIGINT       NULL,
  gh_run_attempt     INT          NULL,
  -- Evidence lives in private backend object storage, never in an Actions artifact.
  -- actions/upload-artifact is world-readable on a public repository and stays readable
  -- after the repository is made private, so the patch, the prompt and the session log all
  -- move over scoped credentials instead.
  patch_storage_key  VARCHAR(300) NULL,
  patch_sha256       CHAR(64)     NULL,
  head_sha           CHAR(40)     NULL,
  -- The verified SHA. RS-03 re-checks that merge_sha equals this at merge time: CI proving
  -- the generated commit passed says nothing about a commit pushed onto the PR afterwards.
  verified_sha       CHAR(40)     NULL,
  merge_sha          CHAR(40)     NULL,
  gates_json         JSON         NULL,
  gates_sha256       CHAR(64)     NULL,
  pr_url             VARCHAR(300) NULL,
  -- A guardrail breach is not a test failure. It means the path gate or deletion guard
  -- rejected the patch, which is never retried and is surfaced on /api/uat/health.
  guardrail_breach   TINYINT(1)   NOT NULL DEFAULT 0,
  failure_stage      VARCHAR(60)  NULL,
  failure_message    VARCHAR(1000) NULL,
  dispatched_by      CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  dispatched_at      DATETIME     NULL,
  completed_at       DATETIME     NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_uat_build (feedback_id, attempt_no),
  INDEX idx_uat_build_state (state, created_at),
  INDEX idx_uat_build_ghrun (gh_workflow_run_id),
  CONSTRAINT fk_uat_build_fb FOREIGN KEY (feedback_id)
    REFERENCES uat_feedback(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Callback ledger ───────────────────────────────────────────────────────────
-- Idempotency for the CI callbacks. A legitimate GitHub retry after a network ambiguity must
-- succeed rather than fail closed, and a replayed callback must not record a second result.
-- The unique key is (build_run, run_attempt, gates_sha256): the same attempt reporting the
-- same gate result is the same event, however many times it arrives.

CREATE TABLE IF NOT EXISTS uat_build_callback (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  build_run_id    CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  callback_kind   ENUM('evidence','result') NOT NULL,
  run_attempt     INT          NOT NULL,
  gates_sha256    CHAR(64)     NULL,
  -- Claims from the verified OIDC token, so a disputed callback can be traced to the exact
  -- workflow run and ref that made it.
  oidc_repository VARCHAR(200) NULL,
  oidc_job_ref    VARCHAR(400) NULL,
  oidc_sha        CHAR(40)     NULL,
  received_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_uat_cb (build_run_id, callback_kind, run_attempt, gates_sha256),
  INDEX idx_uat_cb_run (build_run_id),
  CONSTRAINT fk_uat_cb_run FOREIGN KEY (build_run_id)
    REFERENCES uat_build_run(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Evidence objects ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS uat_evidence_object (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  feedback_id       CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  build_run_id      CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  kind              ENUM('prompt','patch','session_log','gates','retest_attachment') NOT NULL,
  storage_key       VARCHAR(300) NOT NULL,
  sha256            CHAR(64)     NOT NULL,
  byte_size         BIGINT       NOT NULL DEFAULT 0,
  -- Per-object data key. Destroying it crypto-shreds the content while the row, its hash and
  -- the audit trail survive — which is what lets WORM retention and a deletion request
  -- coexist instead of contradicting each other.
  encryption_key_id VARCHAR(120) NULL,
  key_destroyed_at  DATETIME     NULL,
  retention_until   DATETIME     NULL,
  -- Set when a verification pass finds the stored bytes no longer hash to sha256. Surfaced
  -- on /api/uat/health: silent tamper detection that nobody looks at is not detection.
  integrity_failed_at DATETIME   NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_uat_evidence (storage_key),
  INDEX idx_uat_evobj_fb  (feedback_id, kind),
  INDEX idx_uat_evobj_run (build_run_id),
  INDEX idx_uat_evobj_ret (retention_until),
  CONSTRAINT fk_uat_evobj_fb FOREIGN KEY (feedback_id)
    REFERENCES uat_feedback(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Gate status ───────────────────────────────────────────────────────────────
-- G1-G8, as data. Dispatch reads this table and refuses while any gate is unmet, so the hold
-- is enforced by the running system rather than by everyone remembering the plan.
--
-- Every gate ships UNMET. Marking one met requires a named person and evidence, because
-- these are assertions about infrastructure that this codebase cannot verify for itself —
-- it cannot tell whether the repository is private or whether a password was rotated.

CREATE TABLE IF NOT EXISTS uat_gate_status (
  gate_key      VARCHAR(10)  NOT NULL PRIMARY KEY,
  title         VARCHAR(200) NOT NULL,
  requirement   VARCHAR(1000) NOT NULL,
  met           TINYINT(1)   NOT NULL DEFAULT 0,
  evidence      VARCHAR(1000) NULL,
  attested_by   CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  attested_at   DATETIME     NULL,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO uat_gate_status (gate_key, title, requirement) VALUES
  ('G1','Leaked credentials remediated',
   'Database and SSH credentials rotated. Secrets purged from git history, not merely deleted in HEAD. MySQL 3306 and SSH 22 no longer reachable from the internet. A scan confirms no live secret in any tracked file or historical commit.'),
  ('G2','Repository is private',
   'A hard requirement, not a recommendation. Automated AI development against a public repository is not authorised: Actions logs and artifacts are world-readable, so every structural control is load-bearing rather than defence in depth.'),
  ('G3','OIDC trust binding proven with a real token',
   'A captured token''s claims are contract-tested against exactly what the backend accepts: iss, aud, repository, repository_owner, repository_visibility, job_workflow_ref (exact path and ref), workflow_ref, ref, event_name, run_id, run_attempt, sha. A token from a fork, a pull_request event, or any other ref is rejected.'),
  ('G4','Runner-to-backend connectivity proven end to end',
   'A real exchange from a GitHub-hosted runner reaches /api/uat-internal/ and no other backend route is newly reachable.'),
  ('G5','Write authority separated from code execution',
   'The four-job split is implemented and verified: no job that executes repository or generated code holds GitHub write, HRMS write, or the ability to request an OIDC token.'),
  ('G6','Egress restricted and sandbox credential-isolated',
   'The Claude sandbox reaches the Anthropic API and nothing else. No HRMS host, no GitHub API, and no OIDC request variables present in its environment.'),
  ('G7','Branch protection and CODEOWNERS live',
   'Required checks re-run on every PR HEAD SHA. Domain owners required on capability-covered paths. Admin bypass disabled where possible.'),
  ('G8','Negative and red-team tests pass',
   'All eight workflow verification scenarios pass, including: a payroll path in the allowlist fails before the test phase; a patch modifying a guard script is rejected by the origin/main copy of that guard; a hand-written payroll commit pushed onto an open pipeline PR blocks the merge; and five adversarial items stop at scan_blocked with zero rows in uat_llm_call.');

COMMIT;

-- Rollback:
--   DROP TABLE IF EXISTS uat_gate_status;
--   DROP TABLE IF EXISTS uat_evidence_object;
--   DROP TABLE IF EXISTS uat_build_callback;
--   DROP TABLE IF EXISTS uat_build_run;
-- None existed before this migration. uat_build_callback and uat_evidence_object reference
-- uat_build_run, so drop them first.
