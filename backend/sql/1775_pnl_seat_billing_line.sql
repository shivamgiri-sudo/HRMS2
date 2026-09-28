-- Migration 1775: Seat billing lines for the Live P&L revenue estimate
--
-- Finance-configurable seat billing per cost centre and LOB: one row per billed line
-- ("BVO Chat" 38,000 x 21 seats, "Abandon Cart" 34,500 x 12.38), effective by month. Read by
-- pnl-seat-billing.service.ts, which uses these rows in preference to the cost centre's last
-- invoice when estimating revenue for months that are not invoiced yet. Never read by payroll
-- and never written by any sync — only the P&L Configuration "Seat billing" tab writes here,
-- and every write is audited to audit_action_log (entity_type = 'pnl_seat_billing_line').
--
-- One cost centre carries several LOB lines at different rates (7 of 25 MAS cost centres billed
-- in Aug-26 did), so the grain is the LINE, not the cost centre.
--
-- Periods are YYYY-MM strings, matching period_code everywhere else in the P&L.
-- Every string column states utf8mb4_unicode_ci explicitly: a bare CHARSET=utf8mb4 takes the
-- server default utf8mb4_0900_ai_ci here, and joining such a table to cost_centre_master is a
-- hard errno 1267 (see 1617/1618/1627).
--
-- Purely additive. Rollback: DROP TABLE IF EXISTS pnl_seat_billing_line;

CREATE TABLE IF NOT EXISTS pnl_seat_billing_line (
  id              CHAR(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  cost_centre_id  CHAR(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  line_label      VARCHAR(200)  COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'LOB / billed line name',
  line_kind       VARCHAR(10)   COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'seat' COMMENT 'seat = rate x seats; fixed = monthly_amount',
  rate_monthly    DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'Monthly rate per seat (Rs)',
  seats           DECIMAL(10,2) NOT NULL DEFAULT 0,
  monthly_amount  DECIMAL(18,2) DEFAULT NULL COMMENT 'Fixed lines only',
  effective_from  CHAR(7)       COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'YYYY-MM',
  effective_to    CHAR(7)       COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'YYYY-MM, inclusive; NULL = open',
  source          VARCHAR(10)   COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual' COMMENT 'manual | invoice',
  source_period   CHAR(7)       COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Invoice month a line was imported from',
  source_bill_id  INT           DEFAULT NULL COMMENT 'billing_invoice_particular_snapshot.bill_source_id',
  notes           VARCHAR(500)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  active_status   TINYINT(1)    NOT NULL DEFAULT 1,
  created_by      CHAR(36)      COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  updated_by      CHAR(36)      COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_psbl_cost_centre (cost_centre_id, active_status, effective_from),
  KEY idx_psbl_period (effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
