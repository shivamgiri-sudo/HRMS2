-- Records exactly which (leave_type_id, balance_year) buckets a leave approval
-- actually deducted days from, and how many. Needed by three fixes together
-- (2026-08-13 leave-module audit, policy sign-off on #12/#13/#14/#7):
--
--   1. A leave request crossing a calendar-year boundary (e.g. 30-Dec to
--      03-Jan) must deduct from BOTH years' leave_balance_ledger rows, not
--      attribute the whole request to from_date's year.
--   2. CL/ML pooling (leave_policy_config.pool_with — configured since
--      205_leave_policy_config_fix.sql / 245_leave_credit_redesign.sql, but
--      never actually implemented) means a CL request can draw its shortfall
--      from the ML balance (and vice versa) once its own type is exhausted —
--      so a single approval can touch two different leave_type_id rows.
--
-- Without recording exactly what was deducted, a later cancellation/rejection
-- would have to RE-DERIVE the split by re-running the same date/holiday/roster
-- classification — which could disagree with what was actually deducted if
-- leave_holiday_master or wfm_roster_assignment changed in between (e.g. HR
-- adds a holiday retroactively), causing an imprecise restore. Reading back
-- the exact recorded breakdown instead makes the restore exact, and doubles
-- as the audit trail a pooled deduction needs (previously, cross_type_deduction
-- on leave_request was schema-only — added by 245_leave_credit_redesign.sql,
-- never written by any code — this replaces that dead column's intended job
-- with a proper table instead of overloading a JSON blob).
--
-- Purely additive: no existing table or column is altered.

CREATE TABLE IF NOT EXISTS leave_balance_deduction (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  leave_request_id CHAR(36)     NOT NULL,
  leave_type_id   CHAR(36)      NOT NULL,
  balance_year    INT           NOT NULL,
  days_deducted   DECIMAL(6,2)  NOT NULL,
  -- true for the bucket matching the request's OWN leave type; false for a
  -- pooled bucket drawn from the partner type (e.g. an ML request's CL draw).
  is_primary_type TINYINT(1)    NOT NULL DEFAULT 1,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (leave_request_id) REFERENCES leave_request(id) ON DELETE CASCADE,
  FOREIGN KEY (leave_type_id) REFERENCES leave_type_master(id) ON DELETE RESTRICT,
  INDEX idx_lbd_request (leave_request_id),
  INDEX idx_lbd_type_year (leave_type_id, balance_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
