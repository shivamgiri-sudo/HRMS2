-- Migration 1222: add the final_roster_status value the manager-reject route already writes
--
-- WHY
-- wfm.routes.ts POST /api/wfm/roster/:assignmentId/reject-employee-request does:
--
--   UPDATE wfm_roster_assignment
--      SET final_roster_status = 'manager_rejected_employee_request', ...
--
-- 'manager_rejected_employee_request' is not a member of that enum. Verified live 2026-08-15:
--
--   enum('generated','pending_employee_ack','acknowledged','rejected_by_employee',
--        'pending_manager_action','realigned_by_manager','force_approved_by_manager',
--        'escalated_to_hr','approved_final','published_to_rta')
--
-- and production runs with STRICT_TRANS_TABLES, so that UPDATE does not silently coerce to ''
-- — it raises ER_DATA_TRUNCATED (1265) and the request 500s. Every time, for every manager.
--
-- The route is fully built around a write that cannot succeed: it resolves the actor's scope
-- (including a documented LEFT JOIN fix so a manager is not refused on their own direct
-- report), checks the roster-date lock, and then inserts a roster_decision_audit row. The
-- throw happens on the UPDATE, which is before the audit INSERT — so a rejection that a
-- manager believes they recorded leaves no assignment change AND no audit trail.
--
-- Confirmed never to have worked: 0 rows in wfm_roster_assignment hold '' (the non-strict
-- fallback) and all 413,386 sit at 'generated', so no execution has ever landed.
--
-- The read side already assumes the value exists — GET /api/wfm/my-weekoff lists it in its
-- final_roster_status IN (...) filter, and both wfm.routes.ts and rta.routes.ts branch on it
-- in CASE expressions. The enum is the only place it is missing, so adding the member is the
-- faithful fix rather than remapping the write onto some other state, which would collapse a
-- distinct outcome ("manager declined the employee's request, original assignment stands")
-- into an existing one and change what the audit trail means.
--
-- WHAT THIS DOES
-- Appends one member to the enum. Appended LAST so every existing member keeps its ordinal
-- and no stored row is reinterpreted — MySQL stores enums by index, so inserting the value
-- mid-list would silently rewrite the meaning of existing data. Nullability, default and every
-- other attribute are carried through unchanged: NOT NULL DEFAULT 'generated'.
--
-- Purely additive. No row is touched, no status changes, and nothing starts happening on
-- apply except that the route above stops throwing.
--
-- Guarded through information_schema + PREPARE. Idempotent — re-running is a no-op.

SET @needs_member := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'wfm_roster_assignment'
     AND COLUMN_NAME = 'final_roster_status'
     AND COLUMN_TYPE NOT LIKE '%manager_rejected_employee_request%'
);
SET @ddl := IF(@needs_member = 1,
  "ALTER TABLE wfm_roster_assignment MODIFY COLUMN final_roster_status enum('generated','pending_employee_ack','acknowledged','rejected_by_employee','pending_manager_action','realigned_by_manager','force_approved_by_manager','escalated_to_hr','approved_final','published_to_rta','manager_rejected_employee_request') NOT NULL DEFAULT 'generated'",
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
