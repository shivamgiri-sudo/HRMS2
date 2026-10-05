-- Locks everything that has been pulled out for Tally, so the same voucher cannot be imported twice.
-- One ACTIVE row per (export_type, scope_key, item_key): `active` is 1 while locked and NULL once an
-- authorised person releases it (NULLs do not collide in a unique key, so history is kept).
CREATE TABLE IF NOT EXISTS tally_export_lock (
  id             CHAR(36)     NOT NULL,
  export_type    VARCHAR(30)  NOT NULL,            -- salary_voucher | bank_voucher | gst_sales
  scope_key      VARCHAR(120) NOT NULL,            -- salary: run id; bank: bank account id; gst: company GSTIN
  item_key       VARCHAR(190) NOT NULL,            -- salary: company|branch; bank: voucher number; gst: source_type:source_id
  item_label     VARCHAR(190) NULL,                -- what a person recognises: voucher number / bill number
  status         ENUM('exported','posted') NOT NULL DEFAULT 'exported',
  format         VARCHAR(12)  NULL,                -- csv | xlsx | xml | push
  exported_by    CHAR(36)     NULL,
  exported_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reexport_count INT          NOT NULL DEFAULT 0,
  active         TINYINT      NULL DEFAULT 1,
  released_by    CHAR(36)     NULL,
  released_at    DATETIME     NULL,
  release_reason VARCHAR(500) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tally_lock_active (export_type, scope_key, item_key, active),
  KEY idx_tally_lock_scope (export_type, scope_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1968_tally_export_lock.sql applied' AS migration_status;
-- Rollback: DROP TABLE tally_export_lock;
