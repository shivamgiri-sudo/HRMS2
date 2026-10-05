-- One row per salary voucher HRMS posts to Tally over the gateway. The push reads the 'posted'
-- rows to refuse posting the same voucher twice: Tally itself will happily accept a second
-- voucher with the same number.
CREATE TABLE IF NOT EXISTS salary_voucher_tally_push_log (
  id            CHAR(36)     NOT NULL,
  run_id        CHAR(36)     NOT NULL,
  company_code  VARCHAR(16)  NOT NULL,
  voucher_no    VARCHAR(120) NOT NULL,
  outcome       ENUM('posted','failed') NOT NULL,
  detail        TEXT NULL,
  pushed_by     CHAR(36)     NULL,
  pushed_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sv_tally_run (run_id, voucher_no, outcome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1967_salary_voucher_tally_push_log.sql applied' AS migration_status;
-- Rollback: DROP TABLE salary_voucher_tally_push_log;
