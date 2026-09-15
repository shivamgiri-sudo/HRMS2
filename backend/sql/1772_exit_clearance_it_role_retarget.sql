-- Retargets the "IT access closure" exit clearance task from owner_role='admin' to
-- owner_role='it' — owner ruling 2026-09-15, alongside the code change in
-- exit-intelligence.service.ts's createDefaultClearanceTasks (new tasks are already
-- created with owner_role='it' going forward; this backfills existing ones).
--
-- Scope: only currently-open rows (status NOT IN ('cleared','waived')). Live-verified
-- 2026-09-15: 8 open rows, 9 total for clearance_area='it' — the 1 non-open row is left
-- untouched so historical audit trail (who cleared/waived it, and under which owner_role
-- it was cleared) is not rewritten.
UPDATE exit_clearance_task
   SET owner_role = 'it', updated_at = NOW()
 WHERE clearance_area = 'it'
   AND owner_role = 'admin'
   AND status NOT IN ('cleared', 'waived');
