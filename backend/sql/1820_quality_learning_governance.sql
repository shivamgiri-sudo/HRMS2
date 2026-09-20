-- 1820_quality_learning_governance.sql
--
-- Foundation for QA-triggered training auto-assignment (Quality-Learning Governance).
--
-- WHY
-- ---
-- Owner requirement: when an agent's call quality falls below a configured threshold on a
-- skill dimension, mandatory training must be assigned automatically, tracked against a
-- TAT, and escalated on non-compliance, with a full evidence chain (which calls, which
-- scores, which content) visible to the assignee's manager.
--
-- REUSE, NOT DUPLICATION
-- -----------------------
-- The TAT/escalation engine already exists and already works (tat_matrix_master,
-- escalation_matrix_master, task_tat_instance, task_escalation_log — see
-- 294_tat_escalation_matrix.sql, 1024_tat_escalation_fix_and_seed.sql, 1042/1043 fractional
-- TAT fixes). This migration does NOT create a second TAT/escalation mechanism. It adds:
--
--   skill_category          — what a training gap is called (e.g. "Product Knowledge")
--   qa_trigger_rule         — the detection rule (threshold, pattern, severity, TAT hours)
--   skill_content_mapping   — which LMS content addresses a skill category
--   training_assignment     — the evidence + content record; its TAT/status/escalation
--                             state lives in task_tat_instance via tat_instance_id (FK),
--                             not duplicated here.
--
-- A new task_type, 'quality_coaching_required', is seeded into tat_matrix_master and
-- escalation_matrix_master so the EXISTING tat-escalation.worker.ts (backfill floor, kill
-- switch, per-level dedupe via uq_tel_level) drives notification for this task type with
-- zero new notification code.
--
-- notify_role values below are all present in workforce_role_catalog today: 'team_leader',
-- 'manager', 'qa' — verified against 003_access_control.sql / 1004_role_catalog_names_scope_ui.sql
-- seeds. No new role_key is introduced.
--
-- INDEXING NOTES (perf)
-- ----------------------
-- training_assignment is looked up by (employee_id, skill_category_id, status) on every
-- detector run (dedupe check — "does this employee already have a pending assignment for
-- this skill?") and by (employee_id, status) for the employee/manager dashboard. Both are
-- covered by idx_ta_employee_skill_status below; a query hitting only (employee_id, status)
-- is still a valid left-prefix of that index, so no second index is needed.
-- idx_ta_tat_instance supports the reverse lookup (given a tat_instance_id from the
-- escalation worker, find the training_assignment it belongs to).
--
-- ADDITIVE ONLY. No existing table is altered except the two seed INSERTs into
-- tat_matrix_master / escalation_matrix_master (both INSERT IGNORE against existing unique
-- keys uq_task_branch / uq_escalation_task_level — see verification block at the foot).
--
-- ROLLBACK
--   DELETE FROM escalation_matrix_master WHERE task_type = 'quality_coaching_required';
--   DELETE FROM tat_matrix_master WHERE task_type = 'quality_coaching_required';
--   DROP TABLE IF EXISTS training_assignment;
--   DROP TABLE IF EXISTS skill_content_mapping;
--   DROP TABLE IF EXISTS qa_trigger_rule;
--   DROP TABLE IF EXISTS skill_category;

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- 1. skill_category — what a training gap is called
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skill_category (
  id             CHAR(36)      NOT NULL DEFAULT (UUID()),
  category_code  VARCHAR(50)   NOT NULL,
  category_name  VARCHAR(100)  NOT NULL,
  description    TEXT              NULL,
  -- NULL = applies to all processes. No FK enforced against process_master to allow a
  -- category to be defined before every process has been onboarded to this feature —
  -- consistent with tat_matrix_master.branch_id, which is also an unenforced CHAR(36).
  process_id     CHAR(36)          NULL,
  active_status  TINYINT(1)    NOT NULL DEFAULT 1,
  created_by     CHAR(36)          NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_skill_category_code (category_code),
  KEY idx_skill_category_process (process_id, active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. qa_trigger_rule — the detection rule that turns a QA score pattern into a gap
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qa_trigger_rule (
  id                    CHAR(36)      NOT NULL DEFAULT (UUID()),
  skill_category_id     CHAR(36)      NOT NULL,
  -- 'consecutive': threshold_count consecutive calls below threshold_score.
  -- 'average': mean score over threshold_period_days below threshold_score.
  -- 'single_critical': one call at/below threshold_score is enough (fatal-error class).
  trigger_pattern       ENUM('consecutive','average','single_critical') NOT NULL,
  threshold_score       DECIMAL(5,2)  NOT NULL,
  threshold_count       INT UNSIGNED      NULL,
  threshold_period_days INT UNSIGNED      NULL,
  severity              ENUM('CRITICAL','HIGH','MEDIUM','LOW') NOT NULL DEFAULT 'MEDIUM',
  tat_hours             DECIMAL(6,2)  NOT NULL DEFAULT 24.00 COMMENT 'fractional allowed, matches tat_matrix_master.default_tat_hours',
  block_dialer          TINYINT(1)    NOT NULL DEFAULT 0,
  -- NULL = all processes.
  process_id            CHAR(36)          NULL,
  active_status         TINYINT(1)    NOT NULL DEFAULT 1,
  created_by            CHAR(36)          NULL,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- The detector's hot-path lookup: "give me the active rules for this skill category,
  -- optionally scoped to this process."
  KEY idx_qtr_skill_active (skill_category_id, active_status, process_id),
  CONSTRAINT chk_qtr_threshold_score CHECK (threshold_score >= 0 AND threshold_score <= 100),
  CONSTRAINT chk_qtr_tat_hours_positive CHECK (tat_hours > 0),
  CONSTRAINT fk_qtr_skill_category FOREIGN KEY (skill_category_id)
    REFERENCES skill_category (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. skill_content_mapping — which LMS content addresses a skill category
--
-- lms_content_id is a VARCHAR reference into the EXTERNAL LMS database (lms_mcn /
-- content_master.content_id), not an FK — the two databases are on different pools
-- (see lms.service.ts::getLmsPool) and cannot carry a real foreign key across them.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skill_content_mapping (
  id                 CHAR(36)      NOT NULL DEFAULT (UUID()),
  skill_category_id  CHAR(36)      NOT NULL,
  lms_content_id     VARCHAR(50)   NOT NULL,
  lms_content_name   VARCHAR(255)      NULL COMMENT 'denormalised label, refreshed from LMS on mapping save — avoids a cross-DB join on every read',
  sequence_order     INT UNSIGNED  NOT NULL DEFAULT 1,
  mandatory          TINYINT(1)    NOT NULL DEFAULT 1,
  active_status      TINYINT(1)    NOT NULL DEFAULT 1,
  created_by         CHAR(36)          NULL,
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- One row per (skill, content) — re-mapping the same content to the same skill updates
  -- sequence/mandatory rather than creating a duplicate row.
  UNIQUE KEY uq_scm_skill_content (skill_category_id, lms_content_id),
  KEY idx_scm_skill_active (skill_category_id, active_status, sequence_order),
  CONSTRAINT fk_scm_skill_category FOREIGN KEY (skill_category_id)
    REFERENCES skill_category (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. training_assignment — the evidence + content record
--
-- Deliberately does NOT own deadline/status/dialer-block columns — task_tat_instance
-- (via tat_instance_id) is the single source of truth for TAT/status/escalation level,
-- exactly as every other TAT-tracked entity in this codebase (incentive approvals, exit
-- clearance tasks, payroll sign-offs) references task_tat_instance rather than duplicating
-- its fields.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS training_assignment (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID()),
  employee_id         CHAR(36)      NOT NULL COMMENT 'employees.id',
  skill_category_id   CHAR(36)      NOT NULL,
  trigger_rule_id     CHAR(36)          NULL COMMENT 'qa_trigger_rule.id at time of trigger; nullable for MANUAL/ONBOARDING assignments',
  trigger_type        ENUM('QA_SKILL_GAP','MANUAL','SCHEDULED','ONBOARDING') NOT NULL DEFAULT 'QA_SKILL_GAP',
  -- Array of { source: 'db_audit.call_quality_assessment', call_ref, call_date, score,
  -- dialer_user } — call_ref is NOT a call_quality_assessment primary key (that table has
  -- none we control); it is the best available natural reference (User + CallDate) so the
  -- evidence stays traceable back to the upstream row without an FK across schemas.
  trigger_evidence    JSON              NULL,
  severity            ENUM('CRITICAL','HIGH','MEDIUM','LOW') NOT NULL,
  -- Array of skill_content_mapping.id resolved at assignment time (a later content-mapping
  -- edit must not retroactively change what an already-assigned employee was told to do).
  assigned_content    JSON              NULL,
  -- TAT/status/escalation live on task_tat_instance; this FK is the only place that state
  -- is looked up from. NULL only in the brief window between "gap detected, no content
  -- mapped" (FR2's "no content mapped" alert path, US2.1 scenario 3) and a training admin
  -- resolving it manually — such rows never get a tat_instance_id and are not TAT-tracked.
  tat_instance_id     CHAR(36)          NULL,
  acknowledged_at     DATETIME          NULL,
  completion_score    DECIMAL(5,2)      NULL,
  assigned_by         VARCHAR(50)   NOT NULL DEFAULT 'SYSTEM' COMMENT '''SYSTEM'' or auth_user.id',
  notes               TEXT              NULL,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Detector's dedupe check (US2.1 scenario 2: "no duplicate assignment for same skill
  -- while one is pending") and the employee/manager dashboard's primary read pattern both
  -- filter on employee_id + skill_category_id, optionally + status (status lives on
  -- task_tat_instance, joined via tat_instance_id, so it is not repeated here).
  KEY idx_ta_employee_skill (employee_id, skill_category_id, created_at),
  KEY idx_ta_tat_instance (tat_instance_id),
  KEY idx_ta_skill_category (skill_category_id),
  CONSTRAINT fk_ta_skill_category FOREIGN KEY (skill_category_id)
    REFERENCES skill_category (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ta_trigger_rule FOREIGN KEY (trigger_rule_id)
    REFERENCES qa_trigger_rule (id) ON DELETE SET NULL,
  CONSTRAINT fk_ta_employee FOREIGN KEY (employee_id)
    REFERENCES employees (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 5. Register the new task_type with the EXISTING TAT/escalation engine.
--
--    INSERT IGNORE is genuinely idempotent here: tat_matrix_master has uq_task_branch
--    (task_type, branch_id) since 294, and escalation_matrix_master has
--    uq_escalation_task_level (task_type, escalation_level) since 1043.
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO tat_matrix_master (id, task_type, task_description, default_tat_hours, is_active)
VALUES (UUID(), 'quality_coaching_required', 'QA-triggered mandatory training completion', 24.00, 1);

-- Ladder: L1 at 25% of TAT (owner + team leader nudge), L2 at 75% (manager pulled in),
-- L3 at TAT breach / 100% (QA + branch head, matches PRD's "block dialer" escalation
-- action — actual dialer enforcement is separate integration work, not this migration).
-- Percent-of-TAT is approximated here as fixed hours against the 24h default; a rule with
-- a different tat_hours (e.g. CRITICAL at 4h) still escalates sensibly because
-- trigger_after_hours is measured from due_at, not from a percentage — same mechanics as
-- every other seeded ladder in 1024_tat_escalation_fix_and_seed.sql.
INSERT IGNORE INTO escalation_matrix_master
  (id, task_type, escalation_level, trigger_after_hours, notify_role, escalation_action, is_active, created_at)
VALUES
  (UUID(), 'quality_coaching_required', 1, 0,  'team_leader', 'notify', 1, NOW()),
  (UUID(), 'quality_coaching_required', 2, 12, 'manager',     'notify', 1, NOW()),
  (UUID(), 'quality_coaching_required', 3, 24, 'qa',          'notify', 1, NOW());

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT COUNT(*) FROM tat_matrix_master WHERE task_type = 'quality_coaching_required';
--   -- expect 1
-- SELECT escalation_level, trigger_after_hours, notify_role FROM escalation_matrix_master
--   WHERE task_type = 'quality_coaching_required' ORDER BY escalation_level;
--   -- expect 3 rows: (1,0,team_leader) (2,12,manager) (3,24,qa)
-- SHOW CREATE TABLE training_assignment;
--   -- confirm fk_ta_employee, fk_ta_skill_category, fk_ta_trigger_rule all present
