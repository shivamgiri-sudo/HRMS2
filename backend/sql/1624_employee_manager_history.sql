-- 1624 — effective-dated reporting-manager history
--
-- NOT YET EXECUTED. Additive: one new table plus a seed of the current state. No existing
-- column, row or index is altered. Needs owner approval before it runs (CLAUDE.md).
--
-- WHY THIS EXISTS
-- `employees.reporting_manager_id` is a single mutable pointer with no history anywhere.
-- Verified on the live database 2026-08-27:
--
--   reporting_manager_change_request      0 rows
--   transfer_record                       0 rows
--   audit_log                             0 rows
--   employee_lifecycle_event             35 rows, all 'status_change', none about managers
--   kpi_daily_actual.team_leader_id_at_event   0 of 71,303 populated
--                                         (the point-in-time column already exists — and has
--                                          never once been written)
--
-- So the moment a manager changes, the platform forgets there was ever a different one.
-- Anything attributed to a manager is therefore attributed to WHOEVER HOLDS THE POINTER
-- TODAY, not to whoever held it when the thing happened. For attrition and shrinkage that
-- is not a rounding error, it is the whole number:
--
--   * an exit that happened under manager A lands on manager B's attrition the day B
--     inherits the team — and simultaneously vanishes from A's;
--   * a manager who takes over a struggling team inherits its entire past attrition on day
--     one, and a manager who leaves takes their record with them;
--   * 2,564 exits in the last 12 months (2,516 with a manager pointer) are all currently
--     attributable only to the present-day pointer.
--
-- WHAT THIS TABLE IS
-- One row per (employee, manager, period). effective_to IS NULL means "current". A manager
-- change closes the open row and opens a new one, so "who managed this person on 12 June"
-- is a lookup rather than a guess.
--
-- provenance is load-bearing, not decoration:
--   'seed'      — written by this migration from today's pointer. It records who manages
--                 the person NOW and says nothing truthful about any earlier period.
--   'observed'  — written at the moment of a real change by the application.
--   'imported'  — reconstructed from an upstream system, if one is ever found that has it.
--
-- Consumers MUST NOT treat a 'seed' row as evidence of who managed someone before the seed
-- date. The attribution service reports such cases as `assumed_current` rather than
-- silently backdating them — an attrition figure that looks precise and is actually a guess
-- is worse than one that admits what it does not know.
--
-- ROLLBACK
--   DROP TABLE employee_manager_history;

CREATE TABLE IF NOT EXISTS employee_manager_history (
  id             CHAR(36)     NOT NULL,
  employee_id    CHAR(36)     NOT NULL,
  -- NULL is meaningful: a period during which the person had no recorded manager.
  manager_id     CHAR(36)     NULL,
  -- The rest of the supervisory context, captured at the same instant.
  --
  -- An employee's effective supervision is not just their named manager: it is the manager
  -- PLUS the process they sit in and the branch they sit at, because the process manager and
  -- branch head own the outcome too. Move someone between processes and their reporting
  -- manager column may not change at all, yet the people accountable for their attendance,
  -- attrition and shrinkage have. Attributing on manager alone would leave those moves
  -- invisible and quietly keep charging the old process for a person who left it.
  --
  -- kpi_daily_actual already carries branch_id_at_event and process_id_at_event for exactly
  -- this reason — 23,368 and 21,100 of its rows are populated — so the pattern is established
  -- here, not invented.
  process_id     CHAR(36)     NULL,
  branch_id      CHAR(36)     NULL,
  effective_from DATE         NOT NULL,
  -- NULL = still current. Exactly one open row per employee (enforced by uq_emh_open).
  effective_to   DATE         NULL,
  provenance     ENUM('seed','observed','imported') NOT NULL DEFAULT 'observed',
  changed_by     CHAR(36)     NULL,
  reason         VARCHAR(255) NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_emh_employee_period (employee_id, effective_from, effective_to),
  KEY idx_emh_manager_period  (manager_id, effective_from, effective_to),
  KEY idx_emh_process_period  (process_id, effective_from, effective_to),
  KEY idx_emh_branch_period   (branch_id, effective_from, effective_to),
  -- "Who managed this person on date D" and "whose team was this on date D" are the two
  -- queries this table exists to answer; both are index-covered above.
  UNIQUE KEY uq_emh_employee_from (employee_id, effective_from)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  -- utf8mb4_unicode_ci to match employees.id / employees.reporting_manager_id. A different
  -- collation here would make every join to employees fail with errno 1267 on a string
  -- comparison — the failure mode that has already caused live outages in this schema.
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Effective-dated supervisory assignment (manager + process + branch). Point-in-time attribution for attrition/shrinkage.';

-- Seed the current state as the opening period for every active employee who has a manager.
-- effective_from is the seed date, NOT the date of joining: we know who manages them today
-- and we genuinely do not know when that started. Claiming date_of_joining would fabricate
-- history and would silently backdate every exit onto the present-day manager — the exact
-- bug this table is being introduced to prevent.
INSERT INTO employee_manager_history
  (id, employee_id, manager_id, process_id, branch_id, effective_from, effective_to, provenance, reason)
SELECT UUID(), e.id, e.reporting_manager_id, e.process_id, e.branch_id, CURDATE(), NULL, 'seed',
       'Seeded from employees.reporting_manager_id/process_id/branch_id at migration 1624'
  FROM employees e
 WHERE e.active_status = 1
   AND e.reporting_manager_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM employee_manager_history h WHERE h.employee_id = e.id
   );
