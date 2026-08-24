-- Finance Head Payment Management for Client Invoices
-- Payment tracking stored in mas_hrms, merged with db_bill invoice data

CREATE TABLE IF NOT EXISTS client_invoice_payment_status (
  id               CHAR(36)                        NOT NULL,
  -- Reference to db_bill tbl_invoice (id column there)
  invoice_ref_id   INT                             NOT NULL,
  -- Snapshot fields from db_bill for audit
  client_name      VARCHAR(255)                    NULL,
  branch_name      VARCHAR(100)                    NULL,
  cost_centre      VARCHAR(100)                    NULL,
  invoice_month    VARCHAR(20)                     NULL,
  finance_year     VARCHAR(20)                     NULL,
  invoice_amount   DECIMAL(14,2)                   NULL,
  -- Payment tracking
  payment_status   ENUM('pending','partial','paid','overdue','disputed')
                                                   NOT NULL DEFAULT 'pending',
  amount_received  DECIMAL(14,2)                   NOT NULL DEFAULT 0,
  payment_date     DATE                            NULL,
  payment_mode     VARCHAR(50)                     NULL,
  transaction_ref  VARCHAR(100)                    NULL,
  remarks          TEXT                            NULL,
  -- Metadata
  updated_by       VARCHAR(36)                     NOT NULL,
  updated_at       DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at       DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_invoice_ref (invoice_ref_id),
  KEY idx_status (payment_status),
  KEY idx_client (client_name),
  KEY idx_month (finance_year, invoice_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Payment history log (each payment entry for partial payments)
CREATE TABLE IF NOT EXISTS client_invoice_payment_log (
  id               CHAR(36)                        NOT NULL,
  tracking_id      CHAR(36)                        NOT NULL,
  amount_paid      DECIMAL(14,2)                   NOT NULL,
  payment_date     DATE                            NOT NULL,
  payment_mode     VARCHAR(50)                     NULL,
  transaction_ref  VARCHAR(100)                    NULL,
  remarks          TEXT                            NULL,
  recorded_by      VARCHAR(36)                     NOT NULL,
  recorded_at      DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tracking (tracking_id),
  KEY idx_date (payment_date),
  CONSTRAINT fk_payment_log_tracking
    FOREIGN KEY (tracking_id) REFERENCES client_invoice_payment_status(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Predictive revenue configuration (seat-based billing rates per process)
CREATE TABLE IF NOT EXISTS client_billing_rate_config (
  id               CHAR(36)                        NOT NULL,
  client_name      VARCHAR(255)                    NOT NULL,
  branch_name      VARCHAR(100)                    NOT NULL,
  cost_centre      VARCHAR(100)                    NOT NULL,
  process_name     VARCHAR(255)                    NULL,
  seats            DECIMAL(10,2)                   NOT NULL DEFAULT 0,
  rate_per_seat    DECIMAL(12,2)                   NOT NULL DEFAULT 0,
  effective_from   DATE                            NOT NULL,
  effective_to     DATE                            NULL,
  is_active        TINYINT(1)                      NOT NULL DEFAULT 1,
  source           ENUM('manual','db_bill_sync')   NOT NULL DEFAULT 'manual',
  last_synced_at   DATETIME                        NULL,
  created_by       VARCHAR(36)                     NOT NULL,
  created_at       DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_client_branch (client_name, branch_name),
  KEY idx_cost_centre (cost_centre),
  KEY idx_active (is_active, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
