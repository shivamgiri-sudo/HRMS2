-- Client Invoice Payment Tracking Tables
-- Links client_invoice to payment records from db_bill.bill_pay_particulars

CREATE TABLE IF NOT EXISTS client_invoice_payment_status (
  id                    CHAR(36)        NOT NULL,
  invoice_id            CHAR(36)        NOT NULL,
  legacy_invoice_id     INT             NULL COMMENT 'Maps to db_bill.tbl_invoice.id via client_invoice.legacy_id',
  payment_status        ENUM('pending','partial','paid','overdue','disputed')
                                        NOT NULL DEFAULT 'pending',
  total_amount          DECIMAL(14,2)   NOT NULL,
  amount_received       DECIMAL(14,2)   NOT NULL DEFAULT 0,
  tds_deducted          DECIMAL(14,2)   NOT NULL DEFAULT 0,
  net_received          DECIMAL(14,2)   NOT NULL DEFAULT 0,
  last_payment_date     DATE            NULL,
  updated_by            VARCHAR(36)     NULL,
  updated_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_invoice (invoice_id),
  KEY idx_status (payment_status),
  KEY idx_legacy (legacy_invoice_id),
  CONSTRAINT fk_cips_invoice FOREIGN KEY (invoice_id)
    REFERENCES client_invoice(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_invoice_payment_log (
  id                    CHAR(36)        NOT NULL,
  payment_status_id     CHAR(36)        NOT NULL,
  bill_source_id        INT             NULL COMMENT 'Maps to db_bill.bill_pay_particulars.id',
  amount_paid           DECIMAL(14,2)   NOT NULL,
  tds_deducted          DECIMAL(14,2)   NOT NULL DEFAULT 0,
  net_amount            DECIMAL(14,2)   NOT NULL,
  payment_date          DATE            NOT NULL,
  payment_mode          VARCHAR(50)     NULL,
  deposit_bank          VARCHAR(100)    NULL,
  transaction_ref       VARCHAR(100)    NULL,
  remarks               TEXT            NULL,
  recorded_by           VARCHAR(36)     NULL,
  recorded_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_migrated           TINYINT(1)      NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_status (payment_status_id),
  KEY idx_date (payment_date),
  KEY idx_source (bill_source_id),
  CONSTRAINT fk_cipl_status FOREIGN KEY (payment_status_id)
    REFERENCES client_invoice_payment_status(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
