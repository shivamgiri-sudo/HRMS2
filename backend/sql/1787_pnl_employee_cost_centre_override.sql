-- Migration 1787: Per-employee cost centre override for P&L attribution
--
-- Business case (2026-09-16): cost centre BSS/BO/NOIDA-2/577 is a back-office pool whose staff
-- work entirely on the BSS/BO/NOIDA-2/576 (Onfido) account. Payroll books their cost to 577 because
-- that is their real HR cost centre (roster, attendance, leave all correctly key off it), but every
-- rupee of that cost is really Onfido's, so 576's P&L margin has been understated and 577's has read
-- as pure cost with no revenue for months. The two facts — where someone is administratively based,
-- and which cost centre their work actually serves — are allowed to differ, and until now the P&L
-- had no way to say so.
--
-- This table lets Finance redirect an employee's cost to a different cost centre FOR P&L PURPOSES
-- ONLY. It is read by a LEFT JOIN in every place Live P&L / CEO Overview aggregates payroll cost by
-- cost centre (pnl-reconciliation.service.ts readPayroll/readUnallocatedPayroll/exceptions,
-- ceo-overview.service.ts peopleByBranch) as
--   COALESCE(override.target_cost_centre_id, employee.cost_centre_id)
-- employees.cost_centre_id itself is never written by this feature — attendance, roster, leave,
-- payroll calculation and every other HR surface keep reading the employee's real cost centre.
--
-- One row per employee: a second mapping for the same employee_id updates the existing row rather
-- than adding a second, so there is exactly one current answer to "where does this person's cost
-- count" at any time. Deactivating (active_status = 0) reverts that employee to their real cost
-- centre everywhere this is read; the row is kept rather than deleted so who mapped what, and why,
-- stays visible.
--
-- Purely additive. Rollback: DROP TABLE IF EXISTS pnl_employee_cost_centre_override;

CREATE TABLE IF NOT EXISTS pnl_employee_cost_centre_override (
  id                     CHAR(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  employee_id            CHAR(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  target_cost_centre_id  CHAR(36)      COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Cost centre the employee''s pay counts toward in the P&L',
  reason                 VARCHAR(500)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  active_status          TINYINT(1)    NOT NULL DEFAULT 1,
  created_by             CHAR(36)      COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  updated_by             CHAR(36)      COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pecco_employee (employee_id),
  KEY idx_pecco_target (target_cost_centre_id, active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
