-- Migration 406: Secure Document Vault — upload inventory and short-lived download tokens
-- Charter: additive only; no existing columns removed; safe to run multiple times (IF NOT EXISTS)
-- Do NOT execute on production without user approval.

-- ============================================================
-- 1. Upload inventory
-- Every file written via POST /api/files/upload must insert one
-- row here. UUID filename in the DB links to the physical file.
-- ============================================================
CREATE TABLE IF NOT EXISTS document_vault_inventory (
  id                CHAR(36)      NOT NULL DEFAULT (UUID()),
  uploaded_by_user  CHAR(36)      NOT NULL,         -- user_master.id of uploader
  category          VARCHAR(64)   NOT NULL,         -- matches uploads/ sub-directory
  stored_filename   VARCHAR(255)  NOT NULL,         -- UUID filename on disk
  original_filename VARCHAR(512)  NOT NULL,
  mime_type         VARCHAR(128)  NULL,
  file_size_bytes   INT UNSIGNED  NOT NULL DEFAULT 0,
  sha256_hash       CHAR(64)      NULL,             -- hex-encoded, for tamper detection
  access_level      ENUM('public','internal','pii','payroll','confidential')
                                  NOT NULL DEFAULT 'internal',
  owner_employee_id CHAR(36)      NULL,             -- employee this doc belongs to (if known)
  owner_candidate_id CHAR(36)     NULL,             -- candidate this doc belongs to (if known)
  is_soft_deleted   TINYINT(1)    NOT NULL DEFAULT 0,
  deleted_at        DATETIME      NULL,
  deleted_by        CHAR(36)      NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vault_stored_filename (stored_filename),
  INDEX idx_vault_uploader (uploaded_by_user),
  INDEX idx_vault_owner_emp (owner_employee_id),
  INDEX idx_vault_owner_cand (owner_candidate_id),
  INDEX idx_vault_category_deleted (category, is_soft_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 2. Short-lived download tokens
-- Used to generate time-limited, single-use or limited-use
-- download links for documents (employee self-service,
-- manager-on-behalf-of, payslip download, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS document_download_token (
  id            CHAR(36)      NOT NULL DEFAULT (UUID()),
  token_hash    CHAR(64)      NOT NULL,             -- SHA-256 of the raw token
  vault_item_id CHAR(36)      NOT NULL,             -- → document_vault_inventory.id
  issued_to     CHAR(36)      NULL,                 -- user_master.id (NULL for candidate links)
  issued_for    CHAR(36)      NULL,                 -- employee/candidate the link is about
  purpose       VARCHAR(128)  NOT NULL DEFAULT 'download',
  max_uses      SMALLINT      NOT NULL DEFAULT 1,
  use_count     SMALLINT      NOT NULL DEFAULT 0,
  expires_at    DATETIME      NOT NULL,
  revoked_at    DATETIME      NULL,
  last_used_at  DATETIME      NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ddt_token_hash (token_hash),
  INDEX idx_ddt_vault_item (vault_item_id),
  INDEX idx_ddt_issued_to (issued_to),
  INDEX idx_ddt_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 3. Document access audit log
-- One row per access attempt (allowed or denied) to any
-- document served via /api/files/:category/:filename
-- ============================================================
CREATE TABLE IF NOT EXISTS document_access_log (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  vault_item_id CHAR(36)        NULL,   -- NULL if file not in inventory (legacy untracked)
  stored_path   VARCHAR(512)    NOT NULL,
  actor_user_id CHAR(36)        NULL,
  actor_type    VARCHAR(32)     NOT NULL DEFAULT 'employee',
  action        ENUM('view','download','delete') NOT NULL DEFAULT 'view',
  access_result ENUM('allowed','denied')         NOT NULL,
  denial_reason VARCHAR(255)    NULL,
  ip_address    VARCHAR(64)     NULL,
  user_agent    VARCHAR(512)    NULL,
  token_id      CHAR(36)        NULL,   -- if served via download token
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_dal_vault_item (vault_item_id),
  INDEX idx_dal_actor (actor_user_id),
  INDEX idx_dal_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
