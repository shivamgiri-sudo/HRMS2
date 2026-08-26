-- Migration: 1615_vendor_bank_details.sql
-- Purpose: Give HRMS2 a place to hold vendor payee bank details, behind maker-checker
--          and with the change log the audit control matrix has been asking for.
-- Date: 2026-08-26
--
-- CONTEXT — read this before assuming the columns were simply forgotten.
--
--   Verified live 2026-08-26 against BOTH systems: vendor payee bank details existed
--   in NEITHER.
--     - mas_hrms.vendor_master           1,821 rows, zero bank columns
--     - db_bill.tbl_vendormaster         2,059 rows, zero bank columns  (the live one)
--     - db_bill.vendor_master              526 rows, zero bank columns  (legacy)
--   db_bill's bill_pay_particulars.deposit_bank is OUR OWN paying account
--   ("Stata Bank of India-Power", "ICICI Sim Aanan Vihar") and bank_name is the rail
--   (RTGS/HDFC) — neither is the payee. Every acc_no/IFSC column in db_bill is
--   employee-side, and bank_account_verification_master (8 rows) is keyed on emp_code.
--   Vendor bank coordinates live in Tally only; vendor_master.tally_name is the link.
--
--   So this migration does not "restore" missing data — it INTRODUCES payee bank
--   details, and with them the payment-redirection fraud vector, into HRMS2. That is
--   why the controls below are part of the same migration rather than a follow-up:
--   the audit table must exist before the first row can be written, or there is a
--   window in which a bank account can be set with no record of who set it.
--
-- Collation: every CHAR(36) that references vendor_master.id or auth_user.id is
--   declared utf8mb4_unicode_ci explicitly (both verified live). A new table created
--   under the server default collates utf8mb4_0900_ai_ci and the FK fails with
--   errno 3780.
--
-- Idempotent via information_schema guards rather than CREATE TABLE IF NOT EXISTS +
-- ADD COLUMN IF NOT EXISTS, matching 1614 — this MySQL 8.0.42 rejects the latter at
-- the token.

-- ============================================================================
-- 1. vendor_bank_detail — the bank account a vendor is paid into.
--
--    One row per account version. The current account is status='active'; a
--    superseded one is kept, never updated in place, so the log can point at a real
--    row on both sides of a change.
--
--    The account number is stored ONLY as ciphertext (shared/fieldEncryption.ts,
--    AES-256-GCM) plus a last-4 for display and a blind index for duplicate
--    detection. No plaintext column exists, deliberately: employees.aadhaar_number
--    and pan_number were backfilled to ciphertext while the plaintext columns stayed
--    live, and they are still live today. Not repeating that here.
-- ============================================================================

SET @t = (SELECT COUNT(*) FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vendor_bank_detail');

SET @sql = IF(@t = 0, '
CREATE TABLE vendor_bank_detail (
  id                          CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  vendor_id                   CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  account_holder_name         VARCHAR(255) NULL,
  account_number_encrypted    TEXT NOT NULL,
  account_number_last4        VARCHAR(4)  NOT NULL,
  account_number_blind_index  VARCHAR(64) NULL,
  ifsc                        VARCHAR(11) NOT NULL,
  bank_name                   VARCHAR(255) NULL,
  branch_name                 VARCHAR(255) NULL,
  status                      ENUM(''active'',''superseded'') NOT NULL DEFAULT ''active'',
  effective_from              DATETIME NOT NULL,
  superseded_at               DATETIME NULL,
  created_by                  CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_vbd_vendor_status (vendor_id, status),
  KEY idx_vbd_blind (account_number_blind_index),
  CONSTRAINT fk_vbd_vendor FOREIGN KEY (vendor_id) REFERENCES vendor_master (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  'SELECT ''vendor_bank_detail already exists'' AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================================
-- 2. vendor_bank_change_request — maker-checker.
--
--    Nobody changes a payee account alone. A Finance Head or Accounts Head RAISES
--    the change; a DIFFERENT user holding either role APPROVES it. Only approval
--    writes vendor_bank_detail. This is the same separation of duties the helpdesk
--    module had to be retrofitted with, and the reason the control matrix flags
--    vendor bank changes as a fraud vector in the first place.
--
--    The proposed account number is encrypted at rest here too — a pending request
--    is just as sensitive as a live one.
-- ============================================================================

SET @t = (SELECT COUNT(*) FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vendor_bank_change_request');

SET @sql = IF(@t = 0, '
CREATE TABLE vendor_bank_change_request (
  id                          CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  vendor_id                   CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  action                      ENUM(''create'',''update'') NOT NULL,
  previous_detail_id          CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  account_holder_name         VARCHAR(255) NULL,
  account_number_encrypted    TEXT NOT NULL,
  account_number_last4        VARCHAR(4)  NOT NULL,
  account_number_blind_index  VARCHAR(64) NULL,
  ifsc                        VARCHAR(11) NOT NULL,
  bank_name                   VARCHAR(255) NULL,
  branch_name                 VARCHAR(255) NULL,
  status                      ENUM(''pending'',''approved'',''rejected'',''cancelled'') NOT NULL DEFAULT ''pending'',
  reason                      TEXT NULL,
  requested_by                CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  requested_by_role           VARCHAR(64) NULL,
  requested_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by                  CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  decided_by_role             VARCHAR(64) NULL,
  decided_at                  DATETIME NULL,
  decision_reason             TEXT NULL,
  created_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_vbcr_vendor (vendor_id, status),
  KEY idx_vbcr_status (status, requested_at),
  CONSTRAINT fk_vbcr_vendor FOREIGN KEY (vendor_id) REFERENCES vendor_master (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  'SELECT ''vendor_bank_change_request already exists'' AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================================
-- 3. vendor_bank_detail_log — the control the report-coverage analysis named as
--    missing ("vendor bank-change log"). It was unbuildable before this migration
--    because there was no vendor bank field in either database to observe.
--
--    Records the ATTEMPT, not just the success: a rejected request and a cancelled
--    one are both written here. A log that only holds approved changes cannot answer
--    "who tried to redirect this vendor's payments", which is the question that
--    matters.
--
--    Only last-4 and IFSC are logged in the clear. The full account number stays in
--    vendor_bank_detail as ciphertext — an audit table is the wrong place to make it
--    readable, since audit tables are the ones exported to reviewers.
-- ============================================================================

SET @t = (SELECT COUNT(*) FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vendor_bank_detail_log');

SET @sql = IF(@t = 0, '
CREATE TABLE vendor_bank_detail_log (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  vendor_id            CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  change_request_id    CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  bank_detail_id       CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  action               ENUM(''requested'',''approved'',''rejected'',''cancelled'',''viewed'') NOT NULL,
  old_account_last4    VARCHAR(4)  NULL,
  old_ifsc             VARCHAR(11) NULL,
  new_account_last4    VARCHAR(4)  NULL,
  new_ifsc             VARCHAR(11) NULL,
  actor_user_id        CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  actor_role           VARCHAR(64) NULL,
  reason               TEXT NULL,
  ip_address           VARCHAR(64) NULL,
  user_agent           VARCHAR(512) NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_vbdl_vendor (vendor_id, created_at),
  KEY idx_vbdl_actor (actor_user_id, created_at),
  KEY idx_vbdl_action (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  'SELECT ''vendor_bank_detail_log already exists'' AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================================
-- 4. Page catalog + role grants.
--
--    Granted to finance_head and accounts_head only. NOT to 'admin' or
--    'super_admin': hasOrgWideScope() already lets admin through org-wide checks
--    without a scope row, and a payee bank account is exactly the thing that should
--    not inherit access from a general-purpose administrative role.
-- ============================================================================

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
SELECT 'VENDOR_BANK_DETAILS', 'Vendor Bank Details', '/finance/vendor-bank-details', 'finance',
       'Maker-checker maintenance of vendor payee bank accounts', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'VENDOR_BANK_DETAILS');

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT r.role_key, 'VENDOR_BANK_DETAILS', 1, 1, 1, 0, 0, 1
  FROM (SELECT 'finance_head' AS role_key UNION ALL SELECT 'accounts_head') r
 WHERE NOT EXISTS (
   SELECT 1 FROM role_page_access rpa
    WHERE rpa.role_key = r.role_key AND rpa.page_code = 'VENDOR_BANK_DETAILS'
 );
