-- Migration 2187: absconder pay release (salary held at 0 paid days until Branch Head + Payroll Head approve)
--
-- absconder_pay_release_event: the audit trail of the release request (requested, Branch Head approved or
-- rejected, Payroll Head approved or rejected, re-requested). The approvals themselves stay on exit_request
-- (ff_exception_bh_* and ff_exception_*, migrations 2159/2162); the current state is derived from them and
-- from the latest event, so there is no second copy of an approval to drift.
-- exit_request.pay_release_route: how the held month is paid once released ('payroll' when the month's run is
-- still open, 'fnf' when it has closed), recorded once so the same days can never be paid by both.
--
-- Additive, information_schema-guarded and idempotent. No existing row changes.

CREATE TABLE IF NOT EXISTS absconder_pay_release_event (
  id               CHAR(36)     NOT NULL,
  exit_request_id  CHAR(36)     NOT NULL,
  employee_id      CHAR(36)     NOT NULL,
  action           ENUM('requested','bh_approved','bh_rejected','ph_approved','ph_rejected','re_requested') NOT NULL,
  actor_user_id    CHAR(36)     NULL,
  actor_role       VARCHAR(40)  NULL,
  reason           VARCHAR(500) NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_apre_exit (exit_request_id, created_at),
  KEY idx_apre_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_request' AND COLUMN_NAME = 'pay_release_route');
SET @s := IF(@c = 0, 'ALTER TABLE exit_request ADD COLUMN pay_release_route VARCHAR(10) NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
