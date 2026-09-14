-- 1024_tat_escalation_fix_and_seed.sql
--
-- Repairs the TAT escalation engine and seeds the escalation ladders it needs.
--
-- The engine already exists (modules/governance/tat.service.ts, routes mounted at
-- /api/governance/tat in app.ts:505) and has never worked. Verified 2026-07-31:
--
--   1. createTatInstance (tat.service.ts:34) inserts `process_id` into task_tat_instance.
--      That column does not exist -> ER_BAD_FIELD_ERROR on every call.
--   2. checkAndEscalate (:91) inserts task_tat_instance_id / action / notify_role into
--      task_escalation_log, whose real columns are tat_instance_id / action_taken /
--      notified_user_id / triggered_at -> throws.
--   3. completeTatInstance (:131) has the same mismatch -> throws.
--   4. tat.routes.ts:115 filters on t.process_id for process-scoped users -> 500.
--   5. escalation_matrix_master has ZERO rows, so even a correct worker would send nothing.
--
-- This migration fixes 1, 2, 3, 4 by adding the missing columns (additive — no existing
-- column is renamed or dropped, per CLAUDE.md rule 3) and fixes 5 by seeding the ladders.
-- The service-side repairs ship alongside in the same commit.
--
-- NOT EXECUTED against production (CLAUDE.md rule 4).

SET @db := DATABASE();

-- ---------------------------------------------------------------------------
-- 1. task_tat_instance.process_id
--    Makes createTatInstance's existing INSERT valid, and gives tat.routes.ts:115 the
--    column its process-scope filter already assumes. Also lets escalations resolve
--    process-scoped recipients.
-- ---------------------------------------------------------------------------
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='task_tat_instance' AND COLUMN_NAME='process_id') = 0,
  'ALTER TABLE task_tat_instance ADD COLUMN process_id CHAR(36) NULL AFTER branch_id',
  'SELECT "task_tat_instance.process_id exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Escalation worker's hot path: find open/breached instances past due, newest floor first.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='task_tat_instance' AND INDEX_NAME='idx_tti_due_status') = 0,
  'ALTER TABLE task_tat_instance ADD INDEX idx_tti_due_status (status, due_at)',
  'SELECT "task_tat_instance.idx_tti_due_status exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 2. task_escalation_log.notify_role
--    The log records WHICH ROLE was notified at each level. Without it the audit trail
--    cannot answer "who was told, and when" for a breach — only "someone was".
-- ---------------------------------------------------------------------------
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='task_escalation_log' AND COLUMN_NAME='notify_role') = 0,
  'ALTER TABLE task_escalation_log ADD COLUMN notify_role VARCHAR(50) NULL AFTER notified_user_id',
  'SELECT "task_escalation_log.notify_role exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- One log row per (instance, level). THE guard against re-escalating the same level on
-- every 15-minute poll — which is precisely how 43,943 duplicate alerts happened once
-- before, in official-email-compliance.worker.ts.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='task_escalation_log' AND INDEX_NAME='uq_tel_level') = 0,
  'ALTER TABLE task_escalation_log ADD UNIQUE INDEX uq_tel_level (tat_instance_id, escalation_level)',
  'SELECT "task_escalation_log.uq_tel_level exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
-- NOTE: completeTatInstance writes escalation_level = 0 for a completion row, which does
-- not collide with escalation levels 1..3. Intentional.

-- ---------------------------------------------------------------------------
-- 3. Escalation ladders
--
--    `trigger_after_hours` is measured FROM due_at, so level 1 at 0 hours fires the moment
--    the task is overdue and later levels fire progressively later. Ladders match
--    NOTIFICATION_CATALOGUE.md section 7 and the TAT durations already in
--    tat_matrix_master.
--
--    escalation_action is 'notify' throughout. 'reassign' and 'block' are supported by the
--    schema but deliberately unseeded: neither should happen automatically on a first
--    rollout.
--
--    notify_role values are normalised to keys that exist in workforce_role_catalog.
--    escalation_matrix_master.notify_role is an unconstrained VARCHAR(50), and the report
--    catalog elsewhere references roles such as hr_head and operations that are NOT
--    assignable — a literal match against user_roles.role_key would deny everyone.
-- ---------------------------------------------------------------------------
INSERT INTO escalation_matrix_master
  (id, task_type, escalation_level, trigger_after_hours, notify_role, escalation_action, is_active, created_at)
SELECT * FROM (
  SELECT UUID() AS id, 'EMAIL_CREATION'        AS t, 1 AS lvl,  0 AS h, 'owner'        AS r, 'notify' AS a, 1 AS act, NOW() AS c UNION ALL
  SELECT UUID(), 'EMAIL_CREATION',        2,  4, 'manager',     'notify', 1, NOW() UNION ALL
  SELECT UUID(), 'EMAIL_CREATION',        3,  8, 'hr',          'notify', 1, NOW() UNION ALL

  SELECT UUID(), 'DOMAIN_CREATION',       1,  0, 'owner',       'notify', 1, NOW() UNION ALL
  SELECT UUID(), 'DOMAIN_CREATION',       2,  4, 'manager',     'notify', 1, NOW() UNION ALL
  SELECT UUID(), 'DOMAIN_CREATION',       3,  8, 'hr',          'notify', 1, NOW() UNION ALL

  SELECT UUID(), 'BGV_INITIATION',        1,  0, 'owner',       'notify', 1, NOW() UNION ALL
  SELECT UUID(), 'BGV_INITIATION',        2,  8, 'manager',     'notify', 1, NOW() UNION ALL
  SELECT UUID(), 'BGV_INITIATION',        3, 24, 'hr',          'notify', 1, NOW() UNION ALL

  SELECT UUID(), 'ASSET_ALLOCATION',      1,  0, 'owner',       'notify', 1, NOW() UNION ALL
  SELECT UUID(), 'ASSET_ALLOCATION',      2, 12, 'manager',     'notify', 1, NOW() UNION ALL
  SELECT UUID(), 'ASSET_ALLOCATION',      3, 24, 'branch_head', 'notify', 1, NOW() UNION ALL

  SELECT UUID(), 'APPOINTMENT_LETTER',    1,  0, 'owner',       'notify', 1, NOW() UNION ALL
  SELECT UUID(), 'APPOINTMENT_LETTER',    2, 12, 'hr',          'notify', 1, NOW() UNION ALL
  SELECT UUID(), 'APPOINTMENT_LETTER',    3, 24, 'branch_head', 'notify', 1, NOW() UNION ALL

  SELECT UUID(), 'BIOMETRIC_ENROLL',      1,  0, 'owner',       'notify', 1, NOW() UNION ALL
  SELECT UUID(), 'BIOMETRIC_ENROLL',      2, 24, 'manager',     'notify', 1, NOW() UNION ALL

  SELECT UUID(), 'ID_CARD',               1,  0, 'owner',       'notify', 1, NOW() UNION ALL
  SELECT UUID(), 'ID_CARD',               2, 24, 'hr',          'notify', 1, NOW() UNION ALL

  SELECT UUID(), 'JCLR_ENTRY',            1,  0, 'owner',       'notify', 1, NOW() UNION ALL
  SELECT UUID(), 'JCLR_ENTRY',            2, 12, 'payroll_hr',  'notify', 1, NOW() UNION ALL
  SELECT UUID(), 'JCLR_ENTRY',            3, 24, 'branch_head', 'notify', 1, NOW() UNION ALL

  SELECT UUID(), 'PAYROLL_HR_VALIDATION', 1,  0, 'owner',        'notify', 1, NOW() UNION ALL
  SELECT UUID(), 'PAYROLL_HR_VALIDATION', 2, 12, 'payroll_head', 'notify', 1, NOW() UNION ALL
  SELECT UUID(), 'PAYROLL_HR_VALIDATION', 3, 24, 'finance',      'notify', 1, NOW()
) AS seed
WHERE NOT EXISTS (
  SELECT 1 FROM escalation_matrix_master e
   WHERE e.task_type = seed.t AND e.escalation_level = seed.lvl
);
-- WHERE NOT EXISTS rather than INSERT IGNORE: escalation_matrix_master has no unique key
-- on (task_type, escalation_level), so IGNORE would happily insert duplicates on a re-run
-- and every breach would then escalate twice.

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT task_type, COUNT(*) levels, GROUP_CONCAT(CONCAT('L',escalation_level,'@',trigger_after_hours,'h:',notify_role) ORDER BY escalation_level) ladder
--   FROM escalation_matrix_master WHERE is_active=1 GROUP BY task_type ORDER BY task_type;
--   -- expect 9 task types, 25 rows total, no duplicated (task_type, escalation_level)
--
-- SELECT task_type, escalation_level, COUNT(*) FROM escalation_matrix_master
--  GROUP BY 1,2 HAVING COUNT(*) > 1;
--   -- MUST return zero rows. If it does not, the migration was run before this guard existed.
--
-- KNOWN PRE-EXISTING DATA ISSUE (not fixed here — it is someone else's data to clean):
-- tat_matrix_master holds 18 rows for 9 task types, i.e. every task type is duplicated.
-- createTatInstance's lookup uses LIMIT 1 so behaviour is unaffected, but a dedupe is
-- worth doing separately:
--   SELECT task_type, COUNT(*) FROM tat_matrix_master GROUP BY 1 HAVING COUNT(*) > 1;
