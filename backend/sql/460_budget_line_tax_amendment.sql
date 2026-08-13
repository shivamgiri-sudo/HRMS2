CREATE TABLE IF NOT EXISTS finance_budget_line_tax_amendment (
  id                  CHAR(36)      NOT NULL PRIMARY KEY,
  budget_id           CHAR(36)      NOT NULL,
  line_id             CHAR(36)      NOT NULL,
  item_name           VARCHAR(255)  NOT NULL,

  old_tax_treatment   VARCHAR(40)   NOT NULL,
  new_tax_treatment   VARCHAR(40)   NOT NULL,
  old_gst_rate        DECIMAL(5,2)  NOT NULL,
  new_gst_rate        DECIMAL(5,2)  NOT NULL,
  old_gst_type        VARCHAR(20)   NOT NULL,
  new_gst_type        VARCHAR(20)   NOT NULL,
  old_recoverable_pct DECIMAL(5,2)  NOT NULL,
  new_recoverable_pct DECIMAL(5,2)  NOT NULL,

  old_base            DECIMAL(18,2) NOT NULL,
  new_base            DECIMAL(18,2) NOT NULL,
  old_tax             DECIMAL(18,2) NOT NULL,
  new_tax             DECIMAL(18,2) NOT NULL,
  old_gross           DECIMAL(18,2) NOT NULL,
  new_gross           DECIMAL(18,2) NOT NULL,
  old_recoverable_tax DECIMAL(18,2) NOT NULL,
  new_recoverable_tax DECIMAL(18,2) NOT NULL,
  old_pnl             DECIMAL(18,2) NOT NULL,
  new_pnl             DECIMAL(18,2) NOT NULL,

  gross_delta         DECIMAL(18,2) GENERATED ALWAYS AS (new_gross - old_gross) STORED,
  pnl_delta           DECIMAL(18,2) GENERATED ALWAYS AS (new_pnl - old_pnl) STORED,

  reason              TEXT          NOT NULL,
  requested_by        CHAR(36)      NOT NULL,
  requested_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by         CHAR(36)      NULL,
  approved_at         DATETIME      NULL,
  rejected_by         CHAR(36)      NULL,
  rejected_at         DATETIME      NULL,
  rejection_reason    TEXT          NULL,

  status              ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',

  CONSTRAINT fk_bltax_budget FOREIGN KEY (budget_id)
    REFERENCES finance_budget_header(id) ON DELETE CASCADE,
  INDEX idx_bltax_budget_status (budget_id, status),
  INDEX idx_bltax_line (line_id),
  INDEX idx_bltax_requested (requested_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
