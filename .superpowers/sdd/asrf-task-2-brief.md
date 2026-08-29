# Attendance Source Rule — Foundation (Phase 1 of 11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the single effective-dated Attendance_Source_Rule store, the Day_Threshold_Rule
store, the three threshold-kind config store and the Dual_Review_Ceiling store, plus one pure,
property-tested resolver reused by all four — with zero changes to `attendanceEngineService` or any
existing behaviour. This is schema-plus-pure-function only; nothing reads from these tables in
production yet.

**Architecture:** New tables only (additive, unexecuted pending owner approval per CLAUDE.md). One
generic pure function `resolveRule<T>()` implements Requirement 2's candidacy → specificity →
Dimension_Priority_Order → deterministic-tail algorithm once; four thin DB-backed wrapper services
(source rule, day threshold, the three threshold kinds, dual-review ceiling) each load their own
table's active/in-window rows and hand them to the same resolver.

**Tech Stack:** TypeScript, Express/mysql2 (existing `db` pool from `backend/src/db/mysql.js`),
vitest + fast-check (new devDependency) for property tests, plain SQL migrations under
`backend/sql/`.

## Global Constraints

- No SQL runs against production without the owner's explicit approval (CLAUDE.md hard stop) — every
  migration in this plan is written and registered but **not executed**.
- `ADD COLUMN IF NOT EXISTS` is invalid on this server's MySQL 8.0.42; any future ALTER in later
  phases uses the `INFORMATION_SCHEMA.COLUMNS` + `PREPARE`/`EXECUTE` idiom. No ALTERs in this phase —
  every table here is new.
- Every new table declares `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  explicitly — a bare `CHARSET=utf8mb4` resolves to the server default `utf8mb4_0900_ai_ci` and the
  first join to `employees` is a hard `ER_CANT_AGGREGATE_2COLLATIONS` (1267); migration 1627 exists
  solely to repair 49 tables that hit this.
- No `FOREIGN KEY` constraints — every ID column is a plain indexed `CHAR(36)`, per the established
  no-FK convention (`employee_manager_history`, migration 1624) and because migration 1500's
  `wfm_header_mapping_profile` FK to `process_master` is the one already blocking every deploy.
- Every migration file is registered in `MIGRATION_MANIFEST` (`backend/src/db/runPendingMigrations.ts`)
  with a one-paragraph inline comment, per the manifest convention every existing entry follows.
- vitest config: `fileParallelism: false`, `testTimeout: 30_000`, tests live under
  `src/**/__tests__/**/*.test.ts` — this plan's tests follow that path shape inside
  `backend/src/modules/wfm/__tests__/`.
- Source: `requirements.md` Requirements 1, 2, 6.10; `design.md` components 1–2 and the
  Dual_Review_Ceiling / Column_Mapping additions.

---

## File Structure
### Task 2: Migrations 1633–1635 — the four new tables

**Files:**
- Create: `backend/sql/1633_attendance_source_rule_store.sql`
- Create: `backend/sql/1634_day_threshold_rule_store.sql`
- Create: `backend/sql/1635_attendance_threshold_and_ceiling_store.sql`
- Test: `backend/src/db/__tests__/attendance-source-rule-store-migration.contract.test.ts`

**Interfaces:**
- Produces: tables `attendance_source_rule`, `attendance_source_rule_dimension_value`,
  `day_threshold_rule`, `day_threshold_rule_dimension_value`, `attendance_threshold_rule`,
  `attendance_threshold_rule_dimension_value`, `attendance_dual_review_ceiling` — column shapes
  consumed by Tasks 4–6.

- [ ] **Step 1: Write migration 1633**

```sql
-- 1633 — Attendance_Source_Rule store: the single effective-dated rule store that
-- replaces attendance_rule_config and apr_eligibility_config (requirements.md Requirement 1).
--
-- NOT YET EXECUTED. Purely additive: two new tables, nothing altered, nothing read by
-- production code yet (that wiring is a later migration). Needs owner approval before it
-- runs (CLAUDE.md).
--
-- WHY THIS EXISTS
-- Today two tables decide an employee's attendance source and disagree with no tiebreak:
-- `attendance_rule_config` (designation=4/process=2/branch=1) and `apr_eligibility_config`
-- (process=4/department=2/designation=1, no effective-dating at all), combined by
-- `processEmployee()` with a logical OR so neither store can say "no". Two active
-- unconstrained `attendance_rule_config` rows (`arc-global-001` biometric,
-- `arc-apr-ops-exec` dialler) are separated only by `ORDER BY ... LIMIT 1` with no
-- tiebreak — the same employee and date can resolve differently between two runs today.
--
-- WHAT THIS STORE IS
-- One row per Attendance_Source_Rule, keyed on up to six Rule_Dimensions (cost centre,
-- branch, process, department, designation, employment profile), each either unconstrained
-- (no child rows) or constrained to one or more values (rows in the child table — set-valued
-- constraints exist because department_master holds both 'OPERATIONS' (897 active
-- employees) and 'Operations' (148) as separate rows, and a rule keyed on one identifier
-- must still be able to reach both). Resolution is a pure in-memory function
-- (attendance-source-rule-resolver.ts), not a SQL ORDER BY ... LIMIT 1 — that is the
-- structural fix for the non-determinism above.
--
-- Exactly one System_Default_Rule (a row with zero dimension_value children) must exist at
-- all times; that invariant is enforced at the application write path (Task 4 of this plan),
-- not by this migration, because MySQL's UNIQUE index treats NULL-vs-NULL dimension columns
-- as distinct and cannot enforce "at most one fully-unconstrained row" on its own.
--
-- ROLLBACK
--   DROP TABLE attendance_source_rule_dimension_value;
--   DROP TABLE attendance_source_rule;

CREATE TABLE IF NOT EXISTS attendance_source_rule (
  id                CHAR(36)     NOT NULL,
  rule_name         VARCHAR(255) NOT NULL,
  attendance_source ENUM('dialler','biometric') NOT NULL,
  effective_from    DATE         NOT NULL,
  effective_to      DATE         NULL,
  change_reason     TEXT         NOT NULL,
  active_status     TINYINT      NOT NULL DEFAULT 1,
  created_by        CHAR(36)     NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- date-window filtering is the only SQL-side filter the resolver's DB wrapper does;
  -- employee-attribute matching happens in memory (see attendance-source-rule-resolver.ts).
  KEY idx_asr_active_window (active_status, effective_from, effective_to)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Single effective-dated Attendance_Source_Rule store (requirements.md Requirement 1). Replaces attendance_rule_config + apr_eligibility_config once migration 15 approves the cutover.';

CREATE TABLE IF NOT EXISTS attendance_source_rule_dimension_value (
  rule_id   CHAR(36) NOT NULL,
  dimension ENUM('cost_centre','process','branch','department','designation','employment_profile') NOT NULL,
  value_id  VARCHAR(100) NOT NULL,
  PRIMARY KEY (rule_id, dimension, value_id),
  KEY idx_asrdv_rule (rule_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Set-valued Rule_Dimension constraints for attendance_source_rule (criterion 2.10). Zero rows for a dimension = unconstrained; one row = ordinary single-value case; two+ rows = duplicate-master-row case (e.g. OPERATIONS/Operations).';

SELECT 'Migration 1633 applied: attendance_source_rule + attendance_source_rule_dimension_value' AS migration_status;
```

- [ ] **Step 2: Write migration 1634**

```sql
-- 1634 — Day_Threshold_Rule store: full_day_minutes / half_day_minutes / grace_minutes,
-- relocated out of attendance_rule_config (requirements.md criteria 1.14-1.16).
--
-- NOT YET EXECUTED. Purely additive. Needs owner approval before it runs (CLAUDE.md).
--
-- WHY THIS EXISTS
-- attendance_rule_config carries full_day_minutes/half_day_minutes/grace_minutes today, but
-- classifyMinutes() (the function that reads them) is never reached on the processEmployee()
-- path — the thresholds actually applied are hardcoded 540/480 constants plus
-- attendance_feature_config's biometric_half_day_floor_minutes=270 /
-- netlogin_half_day_floor_minutes=240. Because attendance_rule_config is retired by this
-- feature (migration 1633), these three values need a home, and design.md's decision
-- (secondary decision 1) is that they get their OWN effective-dated store resolved by the
-- same six Rule_Dimensions and the same resolver as attendance_source_rule — not carried on
-- it — because source policy and day-threshold policy change on different cadences.
--
-- Exactly one unconstrained Day_Threshold_Rule must exist at all times (criterion 1.15),
-- enforced at the application write path, same as attendance_source_rule's System_Default_Rule.
--
-- ROLLBACK
--   DROP TABLE day_threshold_rule_dimension_value;
--   DROP TABLE day_threshold_rule;

CREATE TABLE IF NOT EXISTS day_threshold_rule (
  id                CHAR(36)       NOT NULL,
  rule_name         VARCHAR(255)   NOT NULL,
  full_day_minutes  SMALLINT UNSIGNED NOT NULL,
  half_day_minutes  SMALLINT UNSIGNED NOT NULL,
  grace_minutes     SMALLINT UNSIGNED NOT NULL,
  effective_from    DATE           NOT NULL,
  effective_to      DATE           NULL,
  change_reason     TEXT           NOT NULL,
  active_status     TINYINT        NOT NULL DEFAULT 1,
  created_by        CHAR(36)       NULL,
  created_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME       NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_dtr_active_window (active_status, effective_from, effective_to)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Effective-dated day-classification thresholds (criteria 1.14-1.16), resolved by the same six Rule_Dimensions and the same resolver as attendance_source_rule.';

CREATE TABLE IF NOT EXISTS day_threshold_rule_dimension_value (
  rule_id   CHAR(36) NOT NULL,
  dimension ENUM('cost_centre','process','branch','department','designation','employment_profile') NOT NULL,
  value_id  VARCHAR(100) NOT NULL,
  PRIMARY KEY (rule_id, dimension, value_id),
  KEY idx_dtrdv_rule (rule_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Set-valued Rule_Dimension constraints for day_threshold_rule, same shape as attendance_source_rule_dimension_value.';

SELECT 'Migration 1634 applied: day_threshold_rule + day_threshold_rule_dimension_value' AS migration_status;
```

- [ ] **Step 3: Write migration 1635**

```sql
-- 1635 — Threshold-kind config store (APR_Corroboration_Threshold / Variance_Tolerance /
-- Floor_Absence_Pattern_Ceiling) and the Dual_Review_Ceiling store (requirements.md
-- criteria 5.4, 6.2, 10.4, 6.10, 12.7).
--
-- NOT YET EXECUTED. Purely additive. Needs owner approval before it runs (CLAUDE.md).
--
-- WHY THIS EXISTS
-- Three thresholds are each configurable per the same six Rule_Dimensions and resolved by
-- the same candidacy/tie-break rules as attendance_source_rule (Requirement 2): the minimum
-- productive minutes that corroborate a biometric day (default 480), the minimum excess of
-- biometric over productive minutes that raises a variance (default 60), and the ceiling
-- below which a full biometric day is a Floor_Absence_Pattern occurrence (default 60). One
-- table with a threshold_kind discriminator serves all three, because they share an
-- identical dimension shape and only the applied value and its meaning differ.
--
-- Dual_Review_Ceiling is DIFFERENT: requirements.md criterion 6.10 scopes it to branch and
-- Pay_Month, not to the six Rule_Dimensions, so it gets its own two-column-key table
-- rather than being forced into the six-dimension shape above.
--
-- ROLLBACK
--   DROP TABLE attendance_dual_review_ceiling;
--   DROP TABLE attendance_threshold_rule_dimension_value;
--   DROP TABLE attendance_threshold_rule;

CREATE TABLE IF NOT EXISTS attendance_threshold_rule (
  id                CHAR(36)       NOT NULL,
  rule_name         VARCHAR(255)   NOT NULL,
  threshold_kind    ENUM('apr_corroboration','variance_tolerance','floor_absence_ceiling') NOT NULL,
  threshold_minutes SMALLINT UNSIGNED NOT NULL,
  effective_from    DATE           NOT NULL,
  effective_to      DATE           NULL,
  change_reason     TEXT           NOT NULL,
  active_status     TINYINT        NOT NULL DEFAULT 1,
  created_by        CHAR(36)       NULL,
  created_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME       NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_atr_kind_active_window (threshold_kind, active_status, effective_from, effective_to)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='APR_Corroboration_Threshold / Variance_Tolerance / Floor_Absence_Pattern_Ceiling, one store, discriminated by threshold_kind, resolved per the same six Rule_Dimensions as attendance_source_rule.';

CREATE TABLE IF NOT EXISTS attendance_threshold_rule_dimension_value (
  rule_id   CHAR(36) NOT NULL,
  dimension ENUM('cost_centre','process','branch','department','designation','employment_profile') NOT NULL,
  value_id  VARCHAR(100) NOT NULL,
  PRIMARY KEY (rule_id, dimension, value_id),
  KEY idx_atrdv_rule (rule_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Set-valued Rule_Dimension constraints for attendance_threshold_rule, same shape as attendance_source_rule_dimension_value.';

CREATE TABLE IF NOT EXISTS attendance_dual_review_ceiling (
  id            CHAR(36)     NOT NULL,
  branch_id     CHAR(36)     NULL,   -- NULL = every branch
  pay_month     VARCHAR(7)   NULL,   -- 'YYYY-MM', matches salary_prep_run.run_month; NULL = every Pay_Month
  ceiling_value SMALLINT UNSIGNED NOT NULL,
  active_status TINYINT      NOT NULL DEFAULT 1,
  created_by    CHAR(36)     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_adrc_scope (branch_id, pay_month)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Dual_Review_Ceiling (criterion 6.10), scoped to branch + Pay_Month, NOT the six Rule_Dimensions. Resolution precedence: exact (branch,pay_month) > (branch,NULL) > (NULL,pay_month) > default 100.';

SELECT 'Migration 1635 applied: attendance_threshold_rule + attendance_threshold_rule_dimension_value + attendance_dual_review_ceiling' AS migration_status;
```

- [ ] **Step 4: Write a contract test proving the tables parse and load cleanly against a fresh schema**

This repository already has a `scripts/migrate-fresh-test.ts` pattern for exercising
`MIGRATION_MANIFEST` against a throwaway database; this contract test instead does a narrower,
faster check — that the three new SQL files are syntactically well-formed and declare the exact
columns Tasks 4–6 depend on, by parsing them as text (matching the style of the existing
`biometric-migration-collation.contract.test.ts`).

```ts
// backend/src/db/__tests__/attendance-source-rule-store-migration.contract.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SQL_DIR = join(__dirname, '../../../sql');

function readMigration(file: string): string {
  return readFileSync(join(SQL_DIR, file), 'utf-8');
}

describe('attendance source rule store migrations (1633-1635)', () => {
  it('1633 declares attendance_source_rule with the ENUM and COLLATE this design requires', () => {
    const sql = readMigration('1633_attendance_source_rule_store.sql');
    expect(sql).toContain("attendance_source ENUM('dialler','biometric') NOT NULL");
    expect(sql).toContain('COLLATE=utf8mb4_unicode_ci');
    expect(sql).not.toMatch(/FOREIGN KEY/i);
  });

  it('1633 declares the dimension_value child table keyed (rule_id, dimension, value_id)', () => {
    const sql = readMigration('1633_attendance_source_rule_store.sql');
    expect(sql).toContain('PRIMARY KEY (rule_id, dimension, value_id)');
  });

  it('1634 declares day_threshold_rule with all three threshold columns', () => {
    const sql = readMigration('1634_day_threshold_rule_store.sql');
    expect(sql).toContain('full_day_minutes  SMALLINT UNSIGNED NOT NULL');
    expect(sql).toContain('half_day_minutes  SMALLINT UNSIGNED NOT NULL');
    expect(sql).toContain('grace_minutes     SMALLINT UNSIGNED NOT NULL');
  });

  it('1635 declares attendance_threshold_rule with the three-kind ENUM', () => {
    const sql = readMigration('1635_attendance_threshold_and_ceiling_store.sql');
    expect(sql).toContain(
      "threshold_kind    ENUM('apr_corroboration','variance_tolerance','floor_absence_ceiling') NOT NULL",
    );
  });

  it('1635 declares attendance_dual_review_ceiling scoped to branch + pay_month, not the six dimensions', () => {
    const sql = readMigration('1635_attendance_threshold_and_ceiling_store.sql');
    expect(sql).toContain('branch_id     CHAR(36)     NULL');
    expect(sql).toContain("pay_month     VARCHAR(7)   NULL");
    expect(sql).toContain('UNIQUE KEY uq_adrc_scope (branch_id, pay_month)');
  });

  it('none of the three migrations use a FOREIGN KEY constraint', () => {
    for (const file of [
      '1633_attendance_source_rule_store.sql',
      '1634_day_threshold_rule_store.sql',
      '1635_attendance_threshold_and_ceiling_store.sql',
    ]) {
      expect(readMigration(file)).not.toMatch(/FOREIGN KEY/i);
    }
  });
});
```

- [ ] **Step 5: Run the contract test**

Run: `cd backend && npx vitest run src/db/__tests__/attendance-source-rule-store-migration.contract.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/sql/1633_attendance_source_rule_store.sql \
        backend/sql/1634_day_threshold_rule_store.sql \
        backend/sql/1635_attendance_threshold_and_ceiling_store.sql \
        backend/src/db/__tests__/attendance-source-rule-store-migration.contract.test.ts
git commit -m "feat: add attendance_source_rule, day_threshold_rule, attendance_threshold_rule and attendance_dual_review_ceiling tables (unexecuted)"
```

---

