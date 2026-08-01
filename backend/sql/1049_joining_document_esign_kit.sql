-- One signing session covering every joining document.
--
-- Today each document is signed separately: 6 documents means 6 emails, 6
-- provider sessions and 6 billed eSign calls per joiner, and the employee runs
-- the same journey six times. The provider cannot help: /eSignWithURL takes
-- exactly one multipart `file` and its response carries a singular esignDetails
-- with one file_name, so multi-document-per-call is impossible. Merging the
-- documents into one PDF is the only route to a single call.
--
-- The existing tables cannot express this. Both
-- employee_joining_document_public_token.checklist_id and
-- employee_document_esign_transaction.checklist_id are NOT NULL foreign keys, so
-- one token and one transaction can each belong to exactly one document. Rather
-- than relax those constraints - which every existing reader depends on - the
-- kit satisfies them with an ANCHOR checklist row and keeps the real fan-out in
-- a join table.
--
-- Purely additive. The per-document flow is untouched and keeps working for
-- anyone already mid-signature.

CREATE TABLE IF NOT EXISTS employee_joining_esign_kit (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id         CHAR(36)     NOT NULL,
  candidate_id        CHAR(36)     NULL,

  -- Satisfies the NOT NULL FKs on the token and transaction rows.
  anchor_checklist_id CHAR(36)     NOT NULL,

  kit_version         VARCHAR(20)  NOT NULL DEFAULT 'v1',
  -- queued | assembling | ready | sent | signed | failed | blocked | superseded
  status              VARCHAR(40)  NOT NULL DEFAULT 'queued',
  blocked_reason      VARCHAR(120) NULL,

  document_count      INT          NOT NULL DEFAULT 0,
  total_pages         INT          NOT NULL DEFAULT 0,
  kit_file_id         CHAR(36)     NULL,
  signed_file_id      CHAR(36)     NULL,
  kit_sha256          VARCHAR(64)  NULL,

  -- Whitespace held clear at the foot of every page. The provider stamps the
  -- signature at Rect [425,100,545,160] on the last page, measured from a real
  -- signed contract, so this must clear 160 - the 120 originally planned would
  -- still have been overlapped.
  reserved_band_pt    DECIMAL(6,2) NOT NULL DEFAULT 180.00,
  -- Where the signature actually landed, checked after retrieval so a future
  -- provider change surfaces as an alert rather than a silently wrong document.
  signature_placement_json JSON    NULL,

  trigger_source      VARCHAR(40)  NOT NULL DEFAULT 'manual',

  -- NULLs compare distinct in MySQL, so this permits unlimited closed kits but
  -- only one open kit per employee.
  open_marker         CHAR(1)      NULL,

  created_by          CHAR(36)     NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at             DATETIME     NULL,
  completed_at        DATETIME     NULL,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_ejek_employee_open (employee_id, open_marker),
  INDEX idx_ejek_employee (employee_id),
  INDEX idx_ejek_status (status),
  CONSTRAINT fk_ejek_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_ejek_anchor FOREIGN KEY (anchor_checklist_id)
    REFERENCES employee_joining_document_checklist(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Which documents are in the kit, and where each one sits inside the merged PDF.
CREATE TABLE IF NOT EXISTS employee_joining_esign_kit_item (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  kit_id          CHAR(36)     NOT NULL,
  checklist_id    CHAR(36)     NOT NULL,
  document_code   VARCHAR(100) NOT NULL,
  document_name   VARCHAR(255) NULL,
  sort_order      INT          NOT NULL DEFAULT 0,
  source_file_id  CHAR(36)     NULL,
  source_sha256   VARCHAR(64)  NULL,
  page_from       INT          NOT NULL,
  page_to         INT          NOT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ejeki_kit_checklist (kit_id, checklist_id),
  INDEX idx_ejeki_checklist (checklist_id),
  CONSTRAINT fk_ejeki_kit FOREIGN KEY (kit_id)
    REFERENCES employee_joining_esign_kit(id) ON DELETE CASCADE,
  CONSTRAINT fk_ejeki_checklist FOREIGN KEY (checklist_id)
    REFERENCES employee_joining_document_checklist(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Let a transaction and a token belong to a kit. Nullable, so every existing
-- per-document row stays valid and the webhook can tell the two apart.
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_document_esign_transaction'
      AND COLUMN_NAME = 'kit_id') = 0,
  'ALTER TABLE employee_document_esign_transaction
     ADD COLUMN kit_id CHAR(36) NULL AFTER checklist_id,
     ADD COLUMN scope VARCHAR(20) NOT NULL DEFAULT ''document'' AFTER kit_id,
     ADD INDEX idx_edet_kit (kit_id)',
  'SELECT ''employee_document_esign_transaction.kit_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_joining_document_public_token'
      AND COLUMN_NAME = 'kit_id') = 0,
  'ALTER TABLE employee_joining_document_public_token
     ADD COLUMN kit_id CHAR(36) NULL AFTER checklist_id,
     ADD INDEX idx_ejdpt_kit (kit_id)',
  'SELECT ''employee_joining_document_public_token.kit_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- File roles for the kit. Widened the same way migration 349 widened its ENUMs.
--   kit_source  - the merged, unsigned kit
--   kit_signed  - the signed artefact, referenced by EVERY member document
--   kit_extract - a per-document copy split out of the signed kit. Splitting
--                 breaks the signature, so these are convenience copies only and
--                 are labelled as such wherever they surface.
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_joining_document_file'
      AND COLUMN_NAME = 'file_role'
      AND COLUMN_TYPE LIKE '%kit_signed%') = 0,
  'ALTER TABLE employee_joining_document_file
     MODIFY COLUMN file_role ENUM(''template'',''hr_uploaded'',''generated'',''sent_for_esign'',
                                  ''signed'',''supporting'',''kit_source'',''kit_signed'',''kit_extract'')
     NOT NULL',
  'SELECT ''employee_joining_document_file.file_role already includes the kit roles'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
