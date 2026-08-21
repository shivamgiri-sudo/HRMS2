-- 1540_exit_pass_return_tracking.sql
--
-- Phase 3 of Asset & Material Exit Pass: return verification for returnable
-- items, plus the data an "Outside Premises" / "Overdue" view needs.
--
-- Status shape after this phase, for a RETURNABLE pass:
--   approved -> outside_premises -> closed
-- A NON_RETURNABLE pass now closes the moment exit is verified (updated in
-- application code alongside this migration) — there is nothing to return,
-- so it never sits in outside_premises.
--
-- Return condition is captured per item (exit_pass_items already has
-- condition_in from 1538; this adds has_damage/missing per item) plus one
-- return_remarks/verifier/timestamp on the parent request. Overdue itself is
-- NOT a stored status — it is derived at read time from
-- expected_return_at < NOW() while status = 'outside_premises', so a pass
-- doesn't need a background job to "become" overdue.
--
-- Deliberately NOT here: the two-stage "security captures physical return,
-- IT/Admin separately confirms condition" split the spec sketches in §24 —
-- this phase is a single return-verification step. Loss/damage financial
-- recovery, overdue notifications and exports remain later phases too.
--
-- Purely additive: columns on two tables this project itself created
-- (1538/1539), no other table touched.

ALTER TABLE exit_pass_requests
  ADD COLUMN return_verified_by CHAR(36) COLLATE utf8mb4_unicode_ci NULL AFTER exit_verification_method,
  ADD COLUMN return_verified_at DATETIME NULL AFTER return_verified_by,
  ADD COLUMN return_remarks TEXT NULL AFTER return_verified_at,
  ADD CONSTRAINT exit_pass_requests_ibfk_return_verifier FOREIGN KEY (return_verified_by) REFERENCES employees(id);

ALTER TABLE exit_pass_items
  ADD COLUMN has_damage TINYINT(1) NOT NULL DEFAULT 0 AFTER condition_in,
  ADD COLUMN missing TINYINT(1) NOT NULL DEFAULT 0 AFTER has_damage;

SELECT '1540_exit_pass_return_tracking.sql applied' AS migration_status;

-- Rollback:
--   ALTER TABLE exit_pass_requests DROP FOREIGN KEY exit_pass_requests_ibfk_return_verifier;
--   ALTER TABLE exit_pass_requests
--     DROP COLUMN return_verified_by, DROP COLUMN return_verified_at, DROP COLUMN return_remarks;
--   ALTER TABLE exit_pass_items DROP COLUMN has_damage, DROP COLUMN missing;
