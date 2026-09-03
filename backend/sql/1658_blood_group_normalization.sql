-- 1658_blood_group_normalization.sql
--
-- Normalises employees.blood_group to the eight real blood groups, or NULL.
--
-- WHY
-- The employee ID card reads employees.blood_group straight through
-- (EmployeeIDCard.tsx <- /api/employees/:id/stat-card). The column is free-text
-- VARCHAR and, until the Profile editor became a dropdown in this same change,
-- accepted whatever anyone typed. Measured on the live database 2026-09-03:
--
--     'NA'       28,502   the legacy import's placeholder for "not recorded"
--     'A'            45   no sign; the sign cannot be guessed
--     'O +'           1   stray space
--     'B+ve'          1   've' suffix
--     'SAMBHLI'       1   a place name in a blood group column
--     valid       18,566   untouched by this migration
--
-- 'NA' is the one that matters. It is not a blood group, it is the absence of
-- one, and stored as-is it printed on a real employee ID card as
-- "Blood Group : NA" — the field looked populated while carrying nothing a
-- paramedic could act on. A blank is honest; a fake reading is not.
--
-- WHAT
-- Repairs what is repairable ('O +' -> 'O+', 'B+ve' -> 'B+') by applying exactly
-- the normalisation backend/src/modules/employees/bloodGroup.util.ts applies to
-- every write from now on, and NULLs everything that still is not one of the
-- eight groups. A row already holding a valid group is not touched.
--
-- SAFETY
-- Every changed row is copied to employees_blood_group_backup_20260903 first
-- (id + the exact prior string), so this is reversible with a single UPDATE ...
-- JOIN. No column is added or dropped, no row is deleted, and no table other
-- than employees is written. Guarded on information_schema so a re-run, or a
-- database where the column is absent, is a no-op rather than an error.

-- ── 1. Backup, before anything is changed ────────────────────────────────────
-- Explicit COLLATE on both string columns: this table is joined back to
-- employees.id, and a bare CHARSET=utf8mb4 inherits the server's
-- utf8mb4_0900_ai_ci default, which makes that join errno 1267 (the collation
-- drift 1627 exists to repair across 49 tables).
CREATE TABLE IF NOT EXISTS employees_blood_group_backup_20260903 (
  id             CHAR(36)     NOT NULL COLLATE utf8mb4_unicode_ci,
  blood_group    VARCHAR(50)  NULL     COLLATE utf8mb4_unicode_ci,
  captured_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. Rewrite, guarded on the column this statement READS ───────────────────
-- An unguarded UPDATE that reads a column the target database does not have
-- aborts the whole migration run at boot and takes the backend down with it
-- (2026-09-02). The guard makes both the backup INSERT and the UPDATE no-ops
-- rather than parse errors when employees.blood_group is absent.
SET @has_bg := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'employees'
     AND COLUMN_NAME  = 'blood_group'
);

-- The canonical form of employees.blood_group, character for character the same
-- transformation as normalizeBloodGroup() in bloodGroup.util.ts:
--   strip spaces -> uppercase -> spelled-out signs to + / - -> drop a trailing
--   'VE' -> drop anything that is not a letter or a sign -> keep only if the
--   result is one of the eight groups, else NULL.
SET @norm := "
  NULLIF(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REPLACE(REPLACE(REPLACE(REPLACE(UPPER(REPLACE(blood_group,' ','')),
          'POSITIVE','+'),'POSTIVE','+'),'NEGATIVE','-'),'NEGTIVE','-'),
      'VE$',''),
    '[^A-Z+-]','')
  ,'')";

SET @canon := CONCAT("(CASE WHEN ", @norm, " REGEXP '^(AB|A|B|O)[+-]$' THEN ", @norm, " ELSE NULL END)");

-- Rows this migration will change: a non-NULL value whose canonical form
-- differs from what is stored (including the ones that canonicalise to NULL).
SET @changed := CONCAT(
  "blood_group IS NOT NULL AND (", @canon, " IS NULL OR ", @canon, " <> blood_group)"
);

SET @sql := IF(@has_bg = 0,
  'DO 0',
  CONCAT('INSERT IGNORE INTO employees_blood_group_backup_20260903 (id, blood_group) ',
         'SELECT id, blood_group FROM employees WHERE ', @changed)
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@has_bg = 0,
  'DO 0',
  CONCAT('UPDATE employees SET blood_group = ', @canon, ' WHERE ', @changed)
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Rollback, if it is ever needed:
--   UPDATE employees e
--     JOIN employees_blood_group_backup_20260903 b ON b.id = e.id
--      SET e.blood_group = b.blood_group;
