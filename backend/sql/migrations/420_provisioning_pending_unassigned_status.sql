-- 420_provisioning_pending_unassigned_status.sql
--
-- it_provisioning_request.status is ENUM('pending','actioned','confirmed','waived'),
-- but the code writes 'pending_unassigned' when no user resolves for a task's
-- role, and seven call sites query for it. Under strict mode the INSERT was
-- rejected, which aborted the dispatch loop, so every task after the first
-- unassigned one was never created at all.
--
-- The value is added to the ENUM rather than changed in code, because the UI is
-- built around it: NativeITProvisioningTracker renders an "Unassigned" badge for
-- exactly this status and gates its reassign action on it
-- (NativeITProvisioningTracker.tsx:149, :1206), and the list endpoint does not
-- expose assignment_exception, so the UI has no other way to tell. Writing
-- 'pending' instead would have created the task but silently removed the
-- operator's ability to see and reassign it.
--
-- Additive: the four existing members keep their order and meaning, so stored
-- rows are unaffected. Re-runnable.

SET @needs_change := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'it_provisioning_request'
     AND COLUMN_NAME = 'status'
     AND COLUMN_TYPE NOT LIKE '%pending_unassigned%');

SET @sql := IF(@needs_change = 1,
  "ALTER TABLE it_provisioning_request
     MODIFY COLUMN status
       ENUM('pending','pending_unassigned','actioned','confirmed','waived')
       NOT NULL DEFAULT 'pending'",
  "SELECT 'it_provisioning_request.status already allows pending_unassigned' AS message");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT COLUMN_TYPE FROM information_schema.COLUMNS
--  WHERE TABLE_SCHEMA = DATABASE()
--    AND TABLE_NAME = 'it_provisioning_request' AND COLUMN_NAME = 'status';
--  -- expect: enum('pending','pending_unassigned','actioned','confirmed','waived')
