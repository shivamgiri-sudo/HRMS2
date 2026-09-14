-- 1653_payroll_payable_days_override.sql
--
-- WHY
-- ---
-- Owner requirement, 2026-09-02: "in same page if we can directly set the payable days for any
-- employee before payroll release — it's for Payroll head."
--
-- The existing tool for correcting attendance is attendance_manual_override (238), and it is a
-- PER-DAY instrument: employee + date, old_status -> new_status, applied to
-- attendance_daily_record on approval. It is the right tool when a specific day is wrong and the
-- Payroll Head knows which one. It cannot express "this person's payable days for September are
-- 26" — reaching 26 through it means locating and correcting each individual day that is short,
-- which for a field employee whose whole month is intermittent is not one decision but twenty.
--
-- This table is that missing month-level statement, and it is deliberately a SEPARATE table
-- rather than an extension of 238: the two answer different questions, are entered at different
-- moments (a day is corrected when it is noticed; payable days are set just before release), and
-- must remain independently auditable. attendance_manual_override stays exactly as it is.
--
-- WHAT THIS TOUCHES IN THE PAYROLL ENGINE — read this before changing it
-- ---------------------------------------------------------------------
-- payrollCalculate.service.ts step 6 computes:
--     finalPayableDays = MIN(effectivePaidBase + eligibleWeekoffs + eligibleHolidays, activeCals)
-- and that value alone scales pay:
--     grossMonthly = monthlyGrossBase * (finalPayableDays / daysInMonth)
--
-- The override replaces the FIRST term only. The active-calendar cap is re-applied on top of the
-- overridden value and is NOT overridable:
--     finalPayableDays = MIN(override ?? calculatedPayable, activeCals)
--
-- That cap is the whole safety of this feature. Without it a typed 45 in a 30-day month, or 30
-- for someone who joined on the 20th, pays salary for days the employee was not employed — and
-- because the number is typed rather than derived, nothing else in the run would contradict it.
-- With the cap, the worst a bad entry can do is pay a full month to someone who was employed for
-- the full month, which is a visible, reviewable error rather than an impossible one.
--
-- The arithmetic itself is untouched. No rate, no proration formula, no statutory calculation
-- changes: only the days input becomes a number a named person can state and sign for.
--
-- WHAT CHANGES — one purely additive table, no existing table touched
-- ------------------------------------------------------------------
-- run_month is VARCHAR(7) 'YYYY-MM' and NOT a DATE. payroll_run.run_month is itself VARCHAR and
-- comparing it to a DATE matches zero rows — the defect that silently emptied earlier payroll
-- reports. The column here matches what the engine already stores so a join cannot miss.
--
-- payable_days is DECIMAL(5,2), not an integer: half days are real (attendance_daily_record
-- carries 0.5 for half_day and the paid base sums to .5), so a Payroll Head who needs 25.5 must
-- be able to say 25.5 rather than round a real half-day away.
--
-- UNIQUE on (employee_id, run_month) — one standing instruction per employee per month. Changing
-- your mind updates the row; the previous value survives in sensitive_action_log, which is where
-- the drill-down timeline reads from.
--
-- No approval workflow columns. Ruling of 2026-09-02: the Payroll Head sets this directly, as
-- with the attendance exception bucket in 1652. reason is NOT NULL, every write is audited, and
-- the routes refuse a month whose payroll run is already finalized — an override entered against
-- a closed run would never be read by anything and would be a silent no-op.
--
-- COLLATION: explicit COLLATE utf8mb4_unicode_ci on every string column. A bare CHARSET=utf8mb4
-- takes this server's default (utf8mb4_0900_ai_ci) and the first join to employees / auth_user is
-- a hard errno 1267 — the systemic defect 1627 exists to repair across 49 tables.
--
-- No FOREIGN KEY, matching every sibling payroll table (migration 1500's WFM FK blocked deploys
-- for days).
--
-- ROLLBACK
-- --------
-- DROP TABLE IF EXISTS payroll_payable_days_override;
-- The engine's lookup catches errno 1146 and falls through to the computed value, so dropping the
-- table restores the exact payable days every employee had before this migration. Runs already
-- calculated with an override keep the number they were calculated with, in salary_prep_line —
-- dropping the table does not silently restate a finished run.

CREATE TABLE IF NOT EXISTS payroll_payable_days_override (
  id            CHAR(36)      NOT NULL DEFAULT (UUID()) COLLATE utf8mb4_unicode_ci PRIMARY KEY,
  employee_id   CHAR(36)      NOT NULL COLLATE utf8mb4_unicode_ci,

  -- 'YYYY-MM', matching payroll_run.run_month's VARCHAR storage exactly.
  run_month     VARCHAR(7)    NOT NULL COLLATE utf8mb4_unicode_ci,

  -- The payable days the Payroll Head is stating. Still capped at the employee's active
  -- calendar days by the engine; this is the paid-base substitute, not the final word.
  payable_days  DECIMAL(5,2)  NOT NULL,

  -- What the engine would have computed when the override was entered. Recorded so the
  -- screen and the audit can show "22 -> 26" instead of just "26", and so a reviewer can see
  -- the size of the intervention without re-running payroll.
  computed_days DECIMAL(5,2)  NULL,

  reason        TEXT          NOT NULL COLLATE utf8mb4_unicode_ci,
  active_status TINYINT(1)    NOT NULL DEFAULT 1,

  created_by    CHAR(36)      NOT NULL COLLATE utf8mb4_unicode_ci,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by    CHAR(36)      NULL COLLATE utf8mb4_unicode_ci,
  updated_at    DATETIME      NULL ON UPDATE CURRENT_TIMESTAMP,
  revoked_by    CHAR(36)      NULL COLLATE utf8mb4_unicode_ci,
  revoked_at    DATETIME      NULL,
  revoke_reason TEXT          NULL COLLATE utf8mb4_unicode_ci,

  UNIQUE KEY uq_ppdo_employee_month (employee_id, run_month),
  INDEX idx_ppdo_month_active (run_month, active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
