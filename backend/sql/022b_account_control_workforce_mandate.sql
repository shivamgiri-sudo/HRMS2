-- 022_account_control_workforce_mandate.sql
-- Demo Package: Account Control, Workforce Mandate and Capacity Planning.
-- Additive only. Do not execute on production without explicit approval.
USE mas_hrms;

-- ---------------------------------------------------------------------------
-- account_control_log
-- Tracks admin-initiated account lifecycle actions (password resets, locks, etc.)
-- metadata_json stores token hash refs or partial refs — NEVER plaintext passwords.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_control_log (
  id            CHAR(36)      NOT NULL,
  user_id       CHAR(36)      NOT NULL COMMENT 'employee user_id from Supabase/MySQL',
  action        ENUM(
                  'password_reset_requested',
                  'password_reset_sent',
                  'password_reset_completed',
                  'force_change_set',
                  'account_locked',
                  'account_unlocked',
                  'account_disabled',
                  'account_enabled',
                  'session_revoked'
                )             NOT NULL,
  initiated_by  CHAR(36)      NOT NULL COMMENT 'admin user_id who performed the action',
  ip_address    VARCHAR(45)   NULL,
  reason        TEXT          NULL,
  metadata_json JSON          NULL COMMENT 'token hash / partial ref — never plaintext password',
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_acl_user_id  (user_id),
  INDEX idx_acl_action   (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Audit trail for admin-initiated account control actions';

-- ---------------------------------------------------------------------------
-- workforce_mandate
-- Defines headcount targets per client / process / branch / LOB / role-group.
-- Required HC is derived from mandated_hc plus buffer percentages.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workforce_mandate (
  id                    CHAR(36)       NOT NULL,
  client_id             CHAR(36)       NULL COMMENT 'client reference; NULL = internal',
  process_id            CHAR(36)       NULL COMMENT 'FK process_master.id',
  branch_id             CHAR(36)       NULL COMMENT 'FK branch_master.id',
  lob                   VARCHAR(100)   NULL COMMENT 'line of business',
  role_group            VARCHAR(100)   NULL COMMENT 'e.g. inbound_agents, outbound_agents, support',
  hc_type               ENUM('production','support') NOT NULL DEFAULT 'production',
  mandated_hc           INT            NOT NULL DEFAULT 0,
  buffer_pct            DECIMAL(5,2)   NOT NULL DEFAULT 10.00,
  shrinkage_pct         DECIMAL(5,2)   NOT NULL DEFAULT 15.00,
  attrition_buffer_pct  DECIMAL(5,2)   NOT NULL DEFAULT 5.00,
  training_buffer_pct   DECIMAL(5,2)   NOT NULL DEFAULT 5.00,
  effective_from        DATE           NOT NULL,
  effective_to          DATE           NULL,
  active_status         TINYINT(1)     NOT NULL DEFAULT 1,
  created_by            CHAR(36)       NOT NULL,
  created_at            DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_wm_process_branch_role_eff (process_id, branch_id, role_group, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-process/branch headcount mandates with buffer and shrinkage parameters';

-- ---------------------------------------------------------------------------
-- support_role_ratio
-- Ratio rules that determine how many support staff are required relative to
-- production headcount (agents, TLs, batches, or trainees).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_role_ratio (
  id            CHAR(36)      NOT NULL,
  process_id    CHAR(36)      NULL COMMENT 'FK process_master.id; NULL = global default',
  branch_id     CHAR(36)      NULL COMMENT 'FK branch_master.id; NULL = all branches',
  support_role  VARCHAR(100)  NOT NULL
                  COMMENT 'team_leader|qa|rtm_rta|sme|am|trainer|wfm|mis|hr|it',
  ratio_type    ENUM(
                  'per_agents',
                  'per_tl',
                  'per_batch',
                  'per_trainee_count'
                )             NOT NULL,
  ratio_value   DECIMAL(6,2)  NOT NULL COMMENT '15 = 1 support per 15 agents',
  effective_from DATE         NOT NULL,
  effective_to   DATE         NULL,
  active_status  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Ratio rules mapping support roles to production headcount or batch sizes';
