-- 1801_payment_voucher_attachment.sql
--
-- WHY
-- Owner directive (2026-09-17 CEO/CA compliance review, "no issues at all fully compliant"):
-- a payment voucher had no way to attach supporting documentation at any stage — no invoice,
-- no bank advice, no approval memo. A CA reviewing a payment expects to see what it was for.
--
-- Same shape grn_request.attachment_path/attachment_original_name/attachment_mime already uses
-- (grn.service.ts's saveAttachment(), grn.routes.ts's multer upload/download pair) — one
-- attachment per record, stored on local disk under uploads/, re-uploadable until the record is
-- locked. For a GRN that lock is status='draft'; for a payment voucher it is status='released' —
-- once money has moved, the attachment becomes part of the historical record and should not
-- silently change under a completed payment the same way a GRN's own attachment logic already
-- protects an approved GRN.

SET @has_attachment_path = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'attachment_path'
);
SET @sql = IF(@has_attachment_path = 0,
  "ALTER TABLE payment_voucher ADD COLUMN attachment_path VARCHAR(500) NULL",
  "SELECT 'payment_voucher.attachment_path already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_attachment_original_name = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'attachment_original_name'
);
SET @sql = IF(@has_attachment_original_name = 0,
  "ALTER TABLE payment_voucher ADD COLUMN attachment_original_name VARCHAR(255) NULL",
  "SELECT 'payment_voucher.attachment_original_name already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_attachment_mime = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'attachment_mime'
);
SET @sql = IF(@has_attachment_mime = 0,
  "ALTER TABLE payment_voucher ADD COLUMN attachment_mime VARCHAR(100) NULL",
  "SELECT 'payment_voucher.attachment_mime already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_attachment_uploaded_by = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'attachment_uploaded_by'
);
SET @sql = IF(@has_attachment_uploaded_by = 0,
  "ALTER TABLE payment_voucher ADD COLUMN attachment_uploaded_by CHAR(36) NULL",
  "SELECT 'payment_voucher.attachment_uploaded_by already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_attachment_uploaded_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'attachment_uploaded_at'
);
SET @sql = IF(@has_attachment_uploaded_at = 0,
  "ALTER TABLE payment_voucher ADD COLUMN attachment_uploaded_at DATETIME NULL",
  "SELECT 'payment_voucher.attachment_uploaded_at already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Verification:
-- SHOW COLUMNS FROM payment_voucher LIKE 'attachment%';  -- expect 5 rows
