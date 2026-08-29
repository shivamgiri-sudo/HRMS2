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

```
backend/sql/
  1633_attendance_source_rule_store.sql          # attendance_source_rule + dimension_value child
  1634_day_threshold_rule_store.sql               # day_threshold_rule (same dimension shape)
  1635_attendance_threshold_and_ceiling_store.sql # attendance_threshold_rule + attendance_dual_review_ceiling

backend/src/modules/wfm/
  attendance-source-rule-resolver.ts   # generic pure resolveRule<T>() — Requirement 2's algorithm, once
  attendance-source-rule.service.ts    # DB-backed: loads attendance_source_rule rows, calls resolver
  day-threshold-rule.service.ts        # DB-backed: loads day_threshold_rule rows, calls resolver
  attendance-threshold-config.service.ts # DB-backed: apr_corroboration / variance_tolerance / floor_absence_ceiling + dual_review_ceiling

backend/src/modules/wfm/__tests__/
  attendance-source-rule-resolver.property.test.ts  # Properties 1-4
  attendance-source-rule.service.test.ts
  day-threshold-rule.service.test.ts
  attendance-threshold-config.service.test.ts

backend/package.json                    # + fast-check devDependency
```

Each service file has one responsibility: turn "load this table's rows for this date" plus "call the
shared resolver" into a small typed API. None of them are wired into `attendanceEngineService` in
this phase — that wiring is Phase 4.

---

### Task 1: Add `fast-check` as a devDependency

**Files:**
- Modify: `backend/package.json`
- Test: none (dependency install; verified by Task 3's property test actually running)

**Interfaces:**
- Produces: `fast-check` importable as `import fc from 'fast-check'` in any backend test file.

- [ ] **Step 1: Install the package**

Run: `cd backend && npm install --save-dev fast-check`
Expected: `package.json` gains a `"fast-check": "^<version>"` line under `devDependencies`, and
`package-lock.json` updates. No production dependency changes.

- [ ] **Step 2: Verify it resolves inside vitest**

Create a throwaway smoke test to prove the import works before building on it:

```ts
// backend/src/modules/wfm/__tests__/fast-check-smoke.test.ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

describe('fast-check smoke test', () => {
  it('runs a trivial property', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => n + 0 === n),
      { numRuns: 10 },
    );
  });
});
```

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/fast-check-smoke.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 3: Delete the smoke test and commit the dependency**

```bash
rm backend/src/modules/wfm/__tests__/fast-check-smoke.test.ts
cd backend && git add package.json package-lock.json
git commit -m "chore: add fast-check devDependency for property-based tests"
```

---

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

### Task 3: The generic pure resolver — `resolveRule<T>()`

This is the single most important piece of code in the whole feature: Requirement 2's
candidacy → specificity → Dimension_Priority_Order → deterministic-tail algorithm, implemented
once, reused by every dimension-scoped store.

**Files:**
- Create: `backend/src/modules/wfm/attendance-source-rule-resolver.ts`
- Test: `backend/src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, no DB).
- Produces (consumed by Tasks 4-6):
  ```ts
  export type RuleDimension =
    | 'cost_centre' | 'process' | 'branch' | 'department' | 'designation' | 'employment_profile';
  export const DIMENSION_PRIORITY_ORDER: readonly RuleDimension[];
  export interface DimensionScopedRule {
    id: string;
    dimensionValues: Partial<Record<RuleDimension, Set<string>>>;
    effectiveFrom: string;
    createdAt: string;
  }
  export interface EmployeeAttributes {
    costCentreId: string | null; processId: string | null; branchId: string | null;
    departmentId: string | null; designationId: string | null; employmentProfile: string | null;
  }
  export type EliminationStep = 'not_candidate' | 'below_max_specificity' | 'priority_order' | 'deterministic_tail';
  export interface ResolutionResult<T extends DimensionScopedRule> {
    winner: T | null;
    specificityCount: number;
    candidates: Array<{ rule: T; eliminatedAtStep: EliminationStep | null }>;
    unresolvedDimensions: RuleDimension[];
  }
  export function resolveRule<T extends DimensionScopedRule>(
    windowedRules: T[], employeeAttrs: EmployeeAttributes,
  ): ResolutionResult<T>;
  ```

- [ ] **Step 1: Write the failing property tests**

```ts
// backend/src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  resolveRule,
  DIMENSION_PRIORITY_ORDER,
  type DimensionScopedRule,
  type EmployeeAttributes,
  type RuleDimension,
} from '../attendance-source-rule-resolver.js';

type TestRule = DimensionScopedRule & { attendanceSource: 'biometric' | 'dialler' };

// Small alphabets so generated rules and employees collide often enough to exercise
// specificity/priority/tie-break, not just the trivial "nothing matches" case.
const VALUE_ALPHABET = ['A', 'B'] as const;

const employeeAttrsArb: fc.Arbitrary<EmployeeAttributes> = fc.record({
  costCentreId: fc.option(fc.constantFrom(...VALUE_ALPHABET), { nil: null }),
  processId: fc.option(fc.constantFrom(...VALUE_ALPHABET), { nil: null }),
  branchId: fc.option(fc.constantFrom(...VALUE_ALPHABET), { nil: null }),
  departmentId: fc.option(fc.constantFrom(...VALUE_ALPHABET), { nil: null }),
  designationId: fc.option(fc.constantFrom(...VALUE_ALPHABET), { nil: null }),
  employmentProfile: fc.option(fc.constantFrom(...VALUE_ALPHABET), { nil: null }),
});

function dimensionValueArb(): fc.Arbitrary<Set<string> | undefined> {
  return fc.oneof(
    fc.constant(undefined), // unconstrained
    fc.uniqueArray(fc.constantFrom(...VALUE_ALPHABET), { minLength: 1, maxLength: 2 }).map(
      (vs) => new Set(vs),
    ),
  );
}

let ruleCounter = 0;
const testRuleArb: fc.Arbitrary<TestRule> = fc
  .record({
    cost_centre: dimensionValueArb(),
    process: dimensionValueArb(),
    branch: dimensionValueArb(),
    department: dimensionValueArb(),
    designation: dimensionValueArb(),
    employment_profile: dimensionValueArb(),
    effectiveFrom: fc.constantFrom('2026-01-01', '2026-06-01', '2026-08-01'),
    createdAtOffset: fc.integer({ min: 0, max: 1000 }),
    attendanceSource: fc.constantFrom<'biometric' | 'dialler'>('biometric', 'dialler'),
  })
  .map((r) => {
    ruleCounter += 1;
    const dimensionValues: Partial<Record<RuleDimension, Set<string>>> = {};
    for (const dim of DIMENSION_PRIORITY_ORDER) {
      const v = (r as any)[dim] as Set<string> | undefined;
      if (v) dimensionValues[dim] = v;
    }
    return {
      id: `rule-${ruleCounter}`,
      dimensionValues,
      effectiveFrom: r.effectiveFrom,
      createdAt: `2026-01-01T00:00:${String(r.createdAtOffset % 60).padStart(2, '0')}.000Z`,
      attendanceSource: r.attendanceSource,
    } satisfies TestRule;
  });

function systemDefaultRule(): TestRule {
  return {
    id: 'system-default',
    dimensionValues: {},
    effectiveFrom: '2026-01-01',
    createdAt: '2026-01-01T00:00:00.000Z',
    attendanceSource: 'biometric',
  };
}

describe('resolveRule — Property 1: Resolution totality', () => {
  it('always returns exactly one winner when the System_Default_Rule is present', () => {
    // Feature: payroll-attendance-source-rules, Property 1: Resolution totality
    fc.assert(
      fc.property(
        fc.array(testRuleArb, { maxLength: 8 }),
        employeeAttrsArb,
        (extraRules, attrs) => {
          const rules = [systemDefaultRule(), ...extraRules];
          const result = resolveRule(rules, attrs);
          expect(result.winner).not.toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('resolveRule — Property 2: Resolution determinism', () => {
  it('two consecutive resolutions over an unchanged store return the same winner', () => {
    // Feature: payroll-attendance-source-rules, Property 2: Resolution determinism
    fc.assert(
      fc.property(
        fc.array(testRuleArb, { maxLength: 8 }),
        employeeAttrsArb,
        (extraRules, attrs) => {
          const rules = [systemDefaultRule(), ...extraRules];
          const first = resolveRule(rules, attrs);
          const second = resolveRule(rules, attrs);
          expect(second.winner?.id).toBe(first.winner?.id);
          expect(second.winner?.attendanceSource).toBe(first.winner?.attendanceSource);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('resolveRule — Property 3: Specificity and priority ordering govern selection', () => {
  it('the winner has the maximum specificity among matching rules', () => {
    // Feature: payroll-attendance-source-rules, Property 3: Specificity and priority ordering govern selection
    fc.assert(
      fc.property(
        fc.array(testRuleArb, { maxLength: 8 }),
        employeeAttrsArb,
        (extraRules, attrs) => {
          const rules = [systemDefaultRule(), ...extraRules];
          const result = resolveRule(rules, attrs);
          const matchingSpecificities = result.candidates
            .filter((c) => c.eliminatedAtStep !== 'not_candidate')
            .map((c) =>
              DIMENSION_PRIORITY_ORDER.filter((d) => c.rule.dimensionValues[d]).length,
            );
          const maxSpec = Math.max(...matchingSpecificities);
          const winnerSpec = DIMENSION_PRIORITY_ORDER.filter(
            (d) => result.winner!.dimensionValues[d],
          ).length;
          expect(winnerSpec).toBe(maxSpec);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('resolveRule — Property 4: A missing dimension value never matches a rule constraining it', () => {
  it('a rule constraining a dimension the employee has no value for is never the winner', () => {
    // Feature: payroll-attendance-source-rules, Property 4: A missing dimension value never matches a rule constraining it
    fc.assert(
      fc.property(
        fc.array(testRuleArb, { maxLength: 8 }),
        employeeAttrsArb,
        (extraRules, attrs) => {
          const rules = [systemDefaultRule(), ...extraRules];
          const result = resolveRule(rules, attrs);

          for (const dim of DIMENSION_PRIORITY_ORDER) {
            const empValue = ({
              cost_centre: attrs.costCentreId,
              process: attrs.processId,
              branch: attrs.branchId,
              department: attrs.departmentId,
              designation: attrs.designationId,
              employment_profile: attrs.employmentProfile,
            } as Record<RuleDimension, string | null>)[dim];

            if (empValue === null) {
              expect(result.unresolvedDimensions).toContain(dim);
              if (result.winner!.dimensionValues[dim]) {
                throw new Error(
                  `winner ${result.winner!.id} constrains unresolved dimension ${dim}`,
                );
              }
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts`
Expected: FAIL — `Cannot find module '../attendance-source-rule-resolver.js'`

- [ ] **Step 3: Write the resolver**

```ts
// backend/src/modules/wfm/attendance-source-rule-resolver.ts
//
// Requirement 2's deterministic resolution algorithm (requirements.md), implemented once as
// a pure function and reused by attendance-source-rule.service.ts, day-threshold-rule.service.ts
// and attendance-threshold-config.service.ts (design.md component 1: "the same pure walk is
// reused ... so 'resolved by the same candidacy and tie-breaking rules as Requirement 2' is
// one implementation, not four").
//
// This function does NOT talk to the database and does NOT filter by effective-date window —
// callers pass in only rules already active and within the date's effective window (a cheap
// indexed SQL filter, see attendance-source-rule.service.ts). Everything this function does —
// employee-attribute matching, specificity, Dimension_Priority_Order, the deterministic tail —
// depends on the employee's attribute values, not on the date directly, so it belongs in
// memory where it is directly property-testable (design.md Testing Strategy).

export type RuleDimension =
  | 'cost_centre'
  | 'process'
  | 'branch'
  | 'department'
  | 'designation'
  | 'employment_profile';

// requirements.md decision A1: cost centre, process, branch, department, designation, profile.
export const DIMENSION_PRIORITY_ORDER: readonly RuleDimension[] = [
  'cost_centre',
  'process',
  'branch',
  'department',
  'designation',
  'employment_profile',
];

export interface DimensionScopedRule {
  id: string;
  // A dimension absent from this object (or present as undefined) is unconstrained and
  // matches every value, including an employee with no value for that dimension. A dimension
  // present with a non-empty Set is the set-valued constraint of criterion 2.10 — one element
  // is the ordinary single-value case.
  dimensionValues: Partial<Record<RuleDimension, Set<string>>>;
  effectiveFrom: string; // 'YYYY-MM-DD', already known to be within window by the caller
  createdAt: string; // ISO timestamp, used only for the deterministic tail (criterion 2.5)
}

export interface EmployeeAttributes {
  costCentreId: string | null;
  processId: string | null;
  branchId: string | null;
  departmentId: string | null;
  designationId: string | null;
  employmentProfile: string | null;
}

export type EliminationStep =
  | 'not_candidate' // criterion 2.2/2.8: inactive dimension mismatch or employee value missing
  | 'below_max_specificity' // criterion 2.3
  | 'priority_order' // criterion 2.4
  | 'deterministic_tail'; // criterion 2.5

export interface ResolutionResult<T extends DimensionScopedRule> {
  winner: T | null;
  specificityCount: number;
  // Every rule passed in, annotated with the step it was eliminated at, or null for the winner.
  // This is exactly criterion 2.9's resolution-preview payload.
  candidates: Array<{ rule: T; eliminatedAtStep: EliminationStep | null }>;
  unresolvedDimensions: RuleDimension[];
}

function employeeAttributeFor(dim: RuleDimension, attrs: EmployeeAttributes): string | null {
  switch (dim) {
    case 'cost_centre':
      return attrs.costCentreId;
    case 'process':
      return attrs.processId;
    case 'branch':
      return attrs.branchId;
    case 'department':
      return attrs.departmentId;
    case 'designation':
      return attrs.designationId;
    case 'employment_profile':
      return attrs.employmentProfile;
  }
}

function ruleMatchesEmployee(
  rule: DimensionScopedRule,
  attrs: EmployeeAttributes,
): boolean {
  for (const dim of DIMENSION_PRIORITY_ORDER) {
    const constraint = rule.dimensionValues[dim];
    if (!constraint || constraint.size === 0) continue; // unconstrained
    const empValue = employeeAttributeFor(dim, attrs);
    // criterion 2.8: a missing employee attribute makes every rule constraining that
    // dimension a non-candidate, never an accidental match.
    if (empValue === null) return false;
    if (!constraint.has(empValue)) return false;
  }
  return true;
}

function specificityCount(rule: DimensionScopedRule): number {
  return DIMENSION_PRIORITY_ORDER.filter(
    (d) => rule.dimensionValues[d] && rule.dimensionValues[d]!.size > 0,
  ).length;
}

export function resolveRule<T extends DimensionScopedRule>(
  windowedRules: T[],
  employeeAttrs: EmployeeAttributes,
): ResolutionResult<T> {
  const unresolvedDimensions = DIMENSION_PRIORITY_ORDER.filter(
    (d) => employeeAttributeFor(d, employeeAttrs) === null,
  );

  const eliminatedAt = new Map<string, EliminationStep>();

  // Step 1 (criterion 2.2, 2.8): candidacy — active + in-window is already guaranteed by the
  // caller; here we filter to dimension-matching.
  const matching = windowedRules.filter((r) => {
    const ok = ruleMatchesEmployee(r, employeeAttrs);
    if (!ok) eliminatedAt.set(r.id, 'not_candidate');
    return ok;
  });

  if (matching.length === 0) {
    return {
      winner: null,
      specificityCount: -1,
      candidates: windowedRules.map((r) => ({
        rule: r,
        eliminatedAtStep: eliminatedAt.get(r.id) ?? null,
      })),
      unresolvedDimensions,
    };
  }

  // Step 2 (criterion 2.3): keep only the maximum-specificity candidates.
  const maxSpec = Math.max(...matching.map(specificityCount));
  let survivors = matching.filter((r) => {
    const keep = specificityCount(r) === maxSpec;
    if (!keep) eliminatedAt.set(r.id, 'below_max_specificity');
    return keep;
  });

  // Step 3 (criterion 2.4): first dimension in priority order constrained by SOME but not ALL
  // survivors — keep only those constraining it.
  if (survivors.length > 1) {
    for (const dim of DIMENSION_PRIORITY_ORDER) {
      const constrainedBy = survivors.filter(
        (r) => r.dimensionValues[dim] && r.dimensionValues[dim]!.size > 0,
      );
      if (constrainedBy.length > 0 && constrainedBy.length < survivors.length) {
        for (const r of survivors) {
          if (!constrainedBy.includes(r)) eliminatedAt.set(r.id, 'priority_order');
        }
        survivors = constrainedBy;
        break;
      }
    }
  }

  // Step 4 (criterion 2.5): deterministic tail — latest effective_from, then latest
  // created_at, then lowest id in ascending byte order.
  survivors = [...survivors].sort((a, b) => {
    if (a.effectiveFrom !== b.effectiveFrom) {
      return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
    }
    if (a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? 1 : -1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  for (const r of survivors.slice(1)) {
    eliminatedAt.set(r.id, 'deterministic_tail');
  }

  const winner = survivors[0];

  return {
    winner,
    specificityCount: maxSpec,
    candidates: windowedRules.map((r) => ({
      rule: r,
      eliminatedAtStep: r.id === winner.id ? null : eliminatedAt.get(r.id) ?? null,
    })),
    unresolvedDimensions,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts`
Expected: PASS, 4 tests (each running 200 generated cases).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/wfm/attendance-source-rule-resolver.ts \
        backend/src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts
git commit -m "feat: add resolveRule() — the deterministic Attendance_Source_Rule resolution algorithm (Requirement 2), property-tested"
```

---

### Task 4: `attendance-source-rule.service.ts` — DB-backed wrapper over `resolveRule()`

**Files:**
- Create: `backend/src/modules/wfm/attendance-source-rule.service.ts`
- Test: `backend/src/modules/wfm/__tests__/attendance-source-rule.service.test.ts`

**Interfaces:**
- Consumes: `resolveRule()`, `DimensionScopedRule`, `EmployeeAttributes`, `RuleDimension` from
  `./attendance-source-rule-resolver.js` (Task 3); the `db` pool from `../../db/mysql.js`.
- Produces (consumed by Phase 4's engine wiring, not this phase):
  ```ts
  export interface AttendanceSourceRuleRow extends DimensionScopedRule {
    attendanceSource: 'dialler' | 'biometric';
  }
  export async function loadActiveWindowedRules(date: string): Promise<AttendanceSourceRuleRow[]>;
  export async function resolveAttendanceSource(
    employeeAttrs: EmployeeAttributes, date: string,
  ): Promise<{ attendanceSource: 'dialler' | 'biometric'; decidingRuleId: string; unresolvedDimensions: RuleDimension[] }>;
  export async function previewResolution(
    employeeAttrs: EmployeeAttributes, date: string,
  ): Promise<ReturnType<typeof resolveRule<AttendanceSourceRuleRow>>>;
  ```

This test uses the same mocked-`db` harness pattern this repository's backend tests already use
(per repo convention: demo-token auth is irrelevant here since this is a pure service test, not a
route test, but the `db.execute` mock follows the same `vi.mock('../../db/mysql.js', ...)` shape
used throughout `backend/src/modules/wfm/__tests__/`).

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/modules/wfm/__tests__/attendance-source-rule.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../db/mysql.js', () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
}));

import {
  loadActiveWindowedRules,
  resolveAttendanceSource,
} from '../attendance-source-rule.service.js';

describe('attendance-source-rule.service', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it('loadActiveWindowedRules assembles rule rows with their dimension_value children into Sets', async () => {
    executeMock
      .mockResolvedValueOnce([
        [
          {
            id: 'rule-1',
            attendance_source: 'dialler',
            effective_from: '2026-06-01',
            created_at: '2026-06-01 10:00:00',
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          { rule_id: 'rule-1', dimension: 'process', value_id: 'proc-voice' },
          { rule_id: 'rule-1', dimension: 'department', value_id: 'dept-ops' },
          { rule_id: 'rule-1', dimension: 'department', value_id: 'dept-ops-alt' },
        ],
      ]);

    const rules = await loadActiveWindowedRules('2026-07-15');

    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe('rule-1');
    expect(rules[0].attendanceSource).toBe('dialler');
    expect(rules[0].dimensionValues.process).toEqual(new Set(['proc-voice']));
    expect(rules[0].dimensionValues.department).toEqual(new Set(['dept-ops', 'dept-ops-alt']));
    expect(rules[0].dimensionValues.cost_centre).toBeUndefined();
  });

  it('resolveAttendanceSource returns the resolved source and deciding rule id', async () => {
    executeMock
      .mockResolvedValueOnce([
        [
          {
            id: 'system-default',
            attendance_source: 'biometric',
            effective_from: '2026-01-01',
            created_at: '2026-01-01 00:00:00',
          },
          {
            id: 'rule-voice-dialler',
            attendance_source: 'dialler',
            effective_from: '2026-06-01',
            created_at: '2026-06-01 10:00:00',
          },
        ],
      ])
      .mockResolvedValueOnce([
        [{ rule_id: 'rule-voice-dialler', dimension: 'process', value_id: 'proc-voice' }],
      ]);

    const result = await resolveAttendanceSource(
      {
        costCentreId: null,
        processId: 'proc-voice',
        branchId: null,
        departmentId: null,
        designationId: null,
        employmentProfile: null,
      },
      '2026-07-15',
    );

    expect(result.attendanceSource).toBe('dialler');
    expect(result.decidingRuleId).toBe('rule-voice-dialler');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/attendance-source-rule.service.test.ts`
Expected: FAIL — `Cannot find module '../attendance-source-rule.service.js'`

- [ ] **Step 3: Write the service**

```ts
// backend/src/modules/wfm/attendance-source-rule.service.ts
//
// DB-backed wrapper over resolveRule() (Task 3) for the attendance_source_rule store
// (requirements.md Requirement 1). Loads only active rows whose effective-date window
// covers the target date — the one filter that IS safe to push into SQL, because it does
// not depend on employee attributes — then hands them to the pure resolver for the
// employee-attribute matching, specificity and tie-break logic.
//
// Not wired into attendanceEngineService in this phase (Phase 4 of the roadmap does that).

import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import {
  resolveRule,
  DIMENSION_PRIORITY_ORDER,
  type DimensionScopedRule,
  type EmployeeAttributes,
  type RuleDimension,
} from './attendance-source-rule-resolver.js';

export interface AttendanceSourceRuleRow extends DimensionScopedRule {
  attendanceSource: 'dialler' | 'biometric';
}

interface RuleRow extends RowDataPacket {
  id: string;
  attendance_source: 'dialler' | 'biometric';
  effective_from: string;
  created_at: string;
}

interface DimensionValueRow extends RowDataPacket {
  rule_id: string;
  dimension: RuleDimension;
  value_id: string;
}

/**
 * Loads every active attendance_source_rule row whose effective-date window covers `date`,
 * with its dimension_value children assembled into Sets. This is the only SQL-side filter —
 * everything else (Requirement 2's matching/specificity/tie-break) happens in resolveRule().
 */
export async function loadActiveWindowedRules(date: string): Promise<AttendanceSourceRuleRow[]> {
  const [ruleRows] = await db.execute<RuleRow[]>(
    `SELECT id, attendance_source, effective_from, created_at
       FROM attendance_source_rule
      WHERE active_status = 1
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)`,
    [date, date],
  );

  if (ruleRows.length === 0) return [];

  const ruleIds = ruleRows.map((r) => r.id);
  const placeholders = ruleIds.map(() => '?').join(',');
  const [dimRows] = await db.execute<DimensionValueRow[]>(
    `SELECT rule_id, dimension, value_id
       FROM attendance_source_rule_dimension_value
      WHERE rule_id IN (${placeholders})`,
    ruleIds,
  );

  const dimensionsByRule = new Map<string, Partial<Record<RuleDimension, Set<string>>>>();
  for (const row of dimRows) {
    const existing = dimensionsByRule.get(row.rule_id) ?? {};
    const set = existing[row.dimension] ?? new Set<string>();
    set.add(row.value_id);
    existing[row.dimension] = set;
    dimensionsByRule.set(row.rule_id, existing);
  }

  return ruleRows.map((r) => ({
    id: r.id,
    attendanceSource: r.attendance_source,
    effectiveFrom: r.effective_from,
    createdAt: r.created_at,
    dimensionValues: dimensionsByRule.get(r.id) ?? {},
  }));
}

/**
 * Resolves the Attendance_Source for one employee and one date (criterion 2.1). Throws if the
 * rule store holds no candidate at all — that should never happen once the System_Default_Rule
 * invariant (criteria 1.10, 1.11) is enforced, but this function does not assume it silently.
 */
export async function resolveAttendanceSource(
  employeeAttrs: EmployeeAttributes,
  date: string,
): Promise<{
  attendanceSource: 'dialler' | 'biometric';
  decidingRuleId: string;
  unresolvedDimensions: RuleDimension[];
}> {
  const rules = await loadActiveWindowedRules(date);
  const result = resolveRule(rules, employeeAttrs);

  if (!result.winner) {
    throw new Error(
      `No Attendance_Source_Rule resolved for date ${date} — the store is missing its mandatory System_Default_Rule`,
    );
  }

  return {
    attendanceSource: result.winner.attendanceSource,
    decidingRuleId: result.winner.id,
    unresolvedDimensions: result.unresolvedDimensions,
  };
}

/**
 * Resolution preview (criteria 2.9, 12.4): returns the full candidate list with elimination
 * steps, for the rule administration screen's "test against a real employee" tool.
 */
export async function previewResolution(
  employeeAttrs: EmployeeAttributes,
  date: string,
) {
  const rules = await loadActiveWindowedRules(date);
  return resolveRule(rules, employeeAttrs);
}

export { DIMENSION_PRIORITY_ORDER };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/attendance-source-rule.service.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/wfm/attendance-source-rule.service.ts \
        backend/src/modules/wfm/__tests__/attendance-source-rule.service.test.ts
git commit -m "feat: add attendance-source-rule.service.ts — DB-backed resolveAttendanceSource() and previewResolution()"
```

---

### Task 5: `day-threshold-rule.service.ts` — same wrapper pattern, different table

**Files:**
- Create: `backend/src/modules/wfm/day-threshold-rule.service.ts`
- Test: `backend/src/modules/wfm/__tests__/day-threshold-rule.service.test.ts`

**Interfaces:**
- Consumes: `resolveRule()`, `DimensionScopedRule`, `EmployeeAttributes` from
  `./attendance-source-rule-resolver.js` (Task 3).
- Produces:
  ```ts
  export interface DayThresholdRuleRow extends DimensionScopedRule {
    fullDayMinutes: number; halfDayMinutes: number; graceMinutes: number;
  }
  export async function resolveDayThresholds(
    employeeAttrs: EmployeeAttributes, date: string,
  ): Promise<{ fullDayMinutes: number; halfDayMinutes: number; graceMinutes: number; decidingRuleId: string }>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/modules/wfm/__tests__/day-threshold-rule.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../db/mysql.js', () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
}));

import { resolveDayThresholds } from '../day-threshold-rule.service.js';

describe('day-threshold-rule.service', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it('resolves to the unconstrained Day_Threshold_Rule when nothing more specific matches', async () => {
    executeMock
      .mockResolvedValueOnce([
        [
          {
            id: 'default-thresholds',
            full_day_minutes: 540,
            half_day_minutes: 270,
            grace_minutes: 10,
            effective_from: '2026-01-01',
            created_at: '2026-01-01 00:00:00',
          },
        ],
      ])
      .mockResolvedValueOnce([[]]);

    const result = await resolveDayThresholds(
      {
        costCentreId: null,
        processId: null,
        branchId: null,
        departmentId: null,
        designationId: null,
        employmentProfile: null,
      },
      '2026-07-15',
    );

    expect(result).toEqual({
      fullDayMinutes: 540,
      halfDayMinutes: 270,
      graceMinutes: 10,
      decidingRuleId: 'default-thresholds',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/day-threshold-rule.service.test.ts`
Expected: FAIL — `Cannot find module '../day-threshold-rule.service.js'`

- [ ] **Step 3: Write the service**

```ts
// backend/src/modules/wfm/day-threshold-rule.service.ts
//
// DB-backed wrapper over resolveRule() for the day_threshold_rule store (requirements.md
// criteria 1.14-1.16): full_day_minutes / half_day_minutes / grace_minutes, resolved by the
// same six Rule_Dimensions and the same resolver as attendance_source_rule. Not wired into
// classifyMinutes() in this phase — that wiring is Phase 4.

import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import {
  resolveRule,
  type DimensionScopedRule,
  type EmployeeAttributes,
  type RuleDimension,
} from './attendance-source-rule-resolver.js';

export interface DayThresholdRuleRow extends DimensionScopedRule {
  fullDayMinutes: number;
  halfDayMinutes: number;
  graceMinutes: number;
}

interface RuleRow extends RowDataPacket {
  id: string;
  full_day_minutes: number;
  half_day_minutes: number;
  grace_minutes: number;
  effective_from: string;
  created_at: string;
}

interface DimensionValueRow extends RowDataPacket {
  rule_id: string;
  dimension: RuleDimension;
  value_id: string;
}

async function loadActiveWindowedRules(date: string): Promise<DayThresholdRuleRow[]> {
  const [ruleRows] = await db.execute<RuleRow[]>(
    `SELECT id, full_day_minutes, half_day_minutes, grace_minutes, effective_from, created_at
       FROM day_threshold_rule
      WHERE active_status = 1
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)`,
    [date, date],
  );

  if (ruleRows.length === 0) return [];

  const ruleIds = ruleRows.map((r) => r.id);
  const placeholders = ruleIds.map(() => '?').join(',');
  const [dimRows] = await db.execute<DimensionValueRow[]>(
    `SELECT rule_id, dimension, value_id
       FROM day_threshold_rule_dimension_value
      WHERE rule_id IN (${placeholders})`,
    ruleIds,
  );

  const dimensionsByRule = new Map<string, Partial<Record<RuleDimension, Set<string>>>>();
  for (const row of dimRows) {
    const existing = dimensionsByRule.get(row.rule_id) ?? {};
    const set = existing[row.dimension] ?? new Set<string>();
    set.add(row.value_id);
    existing[row.dimension] = set;
    dimensionsByRule.set(row.rule_id, existing);
  }

  return ruleRows.map((r) => ({
    id: r.id,
    fullDayMinutes: r.full_day_minutes,
    halfDayMinutes: r.half_day_minutes,
    graceMinutes: r.grace_minutes,
    effectiveFrom: r.effective_from,
    createdAt: r.created_at,
    dimensionValues: dimensionsByRule.get(r.id) ?? {},
  }));
}

export async function resolveDayThresholds(
  employeeAttrs: EmployeeAttributes,
  date: string,
): Promise<{
  fullDayMinutes: number;
  halfDayMinutes: number;
  graceMinutes: number;
  decidingRuleId: string;
}> {
  const rules = await loadActiveWindowedRules(date);
  const result = resolveRule(rules, employeeAttrs);

  if (!result.winner) {
    throw new Error(
      `No Day_Threshold_Rule resolved for date ${date} — the store is missing its mandatory unconstrained row`,
    );
  }

  return {
    fullDayMinutes: result.winner.fullDayMinutes,
    halfDayMinutes: result.winner.halfDayMinutes,
    graceMinutes: result.winner.graceMinutes,
    decidingRuleId: result.winner.id,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/day-threshold-rule.service.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/wfm/day-threshold-rule.service.ts \
        backend/src/modules/wfm/__tests__/day-threshold-rule.service.test.ts
git commit -m "feat: add day-threshold-rule.service.ts — resolveDayThresholds() over the relocated day-classification thresholds"
```

---

### Task 6: `attendance-threshold-config.service.ts` — the three threshold kinds + Dual_Review_Ceiling

**Files:**
- Create: `backend/src/modules/wfm/attendance-threshold-config.service.ts`
- Test: `backend/src/modules/wfm/__tests__/attendance-threshold-config.service.test.ts`

**Interfaces:**
- Consumes: `resolveRule()`, `DimensionScopedRule`, `EmployeeAttributes` from
  `./attendance-source-rule-resolver.js` (Task 3).
- Produces:
  ```ts
  export type ThresholdKind = 'apr_corroboration' | 'variance_tolerance' | 'floor_absence_ceiling';
  export const DEFAULT_THRESHOLD_MINUTES: Record<ThresholdKind, number>; // 480, 60, 60
  export async function resolveThreshold(
    kind: ThresholdKind, employeeAttrs: EmployeeAttributes, date: string,
  ): Promise<number>;
  export async function resolveDualReviewCeiling(branchId: string, payMonth: string): Promise<number>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// backend/src/modules/wfm/__tests__/attendance-threshold-config.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../db/mysql.js', () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
}));

import {
  resolveThreshold,
  resolveDualReviewCeiling,
  DEFAULT_THRESHOLD_MINUTES,
} from '../attendance-threshold-config.service.js';

describe('attendance-threshold-config.service', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it('applies the 480-minute default (criterion 5.5) when no apr_corroboration rule is configured', async () => {
    executeMock.mockResolvedValueOnce([[]]); // no rows for this threshold_kind at all

    const minutes = await resolveThreshold(
      'apr_corroboration',
      {
        costCentreId: null,
        processId: null,
        branchId: null,
        departmentId: null,
        designationId: null,
        employmentProfile: null,
      },
      '2026-07-15',
    );

    expect(minutes).toBe(480);
    expect(DEFAULT_THRESHOLD_MINUTES.apr_corroboration).toBe(480);
    expect(DEFAULT_THRESHOLD_MINUTES.variance_tolerance).toBe(60);
    expect(DEFAULT_THRESHOLD_MINUTES.floor_absence_ceiling).toBe(60);
  });

  it('resolveDualReviewCeiling falls back to 100 when no row matches (criterion 6.10)', async () => {
    executeMock.mockResolvedValueOnce([[]]); // exact (branch, pay_month) — no match
    executeMock.mockResolvedValueOnce([[]]); // (branch, NULL) — no match
    executeMock.mockResolvedValueOnce([[]]); // (NULL, pay_month) — no match

    const ceiling = await resolveDualReviewCeiling('branch-1', '2026-07');

    expect(ceiling).toBe(100);
  });

  it('resolveDualReviewCeiling prefers an exact branch+pay_month match', async () => {
    executeMock.mockResolvedValueOnce([[{ ceiling_value: 150 }]]);

    const ceiling = await resolveDualReviewCeiling('branch-1', '2026-07');

    expect(ceiling).toBe(150);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/attendance-threshold-config.service.test.ts`
Expected: FAIL — `Cannot find module '../attendance-threshold-config.service.js'`

- [ ] **Step 3: Write the service**

```ts
// backend/src/modules/wfm/attendance-threshold-config.service.ts
//
// DB-backed resolution for the three threshold kinds (APR_Corroboration_Threshold,
// Variance_Tolerance, Floor_Absence_Pattern_Ceiling — requirements.md criteria 5.4-5.5, 6.2,
// 10.4) sharing attendance_threshold_rule, plus Dual_Review_Ceiling (criterion 6.10), which is
// scoped to branch + Pay_Month rather than the six Rule_Dimensions and therefore resolved by
// a separate, simpler precedence (design.md: "Ceiling resolution").

import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import {
  resolveRule,
  type DimensionScopedRule,
  type EmployeeAttributes,
  type RuleDimension,
} from './attendance-source-rule-resolver.js';

export type ThresholdKind = 'apr_corroboration' | 'variance_tolerance' | 'floor_absence_ceiling';

// requirements.md decision A2 (480/60) and Requirement 10 acceptance criterion 10.4 (60).
export const DEFAULT_THRESHOLD_MINUTES: Record<ThresholdKind, number> = {
  apr_corroboration: 480,
  variance_tolerance: 60,
  floor_absence_ceiling: 60,
};

interface ThresholdRuleRow extends DimensionScopedRule {
  thresholdMinutes: number;
}

interface RuleRow extends RowDataPacket {
  id: string;
  threshold_minutes: number;
  effective_from: string;
  created_at: string;
}

interface DimensionValueRow extends RowDataPacket {
  rule_id: string;
  dimension: RuleDimension;
  value_id: string;
}

async function loadActiveWindowedRules(
  kind: ThresholdKind,
  date: string,
): Promise<ThresholdRuleRow[]> {
  const [ruleRows] = await db.execute<RuleRow[]>(
    `SELECT id, threshold_minutes, effective_from, created_at
       FROM attendance_threshold_rule
      WHERE threshold_kind = ?
        AND active_status = 1
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)`,
    [kind, date, date],
  );

  if (ruleRows.length === 0) return [];

  const ruleIds = ruleRows.map((r) => r.id);
  const placeholders = ruleIds.map(() => '?').join(',');
  const [dimRows] = await db.execute<DimensionValueRow[]>(
    `SELECT rule_id, dimension, value_id
       FROM attendance_threshold_rule_dimension_value
      WHERE rule_id IN (${placeholders})`,
    ruleIds,
  );

  const dimensionsByRule = new Map<string, Partial<Record<RuleDimension, Set<string>>>>();
  for (const row of dimRows) {
    const existing = dimensionsByRule.get(row.rule_id) ?? {};
    const set = existing[row.dimension] ?? new Set<string>();
    set.add(row.value_id);
    existing[row.dimension] = set;
    dimensionsByRule.set(row.rule_id, existing);
  }

  return ruleRows.map((r) => ({
    id: r.id,
    thresholdMinutes: r.threshold_minutes,
    effectiveFrom: r.effective_from,
    createdAt: r.created_at,
    dimensionValues: dimensionsByRule.get(r.id) ?? {},
  }));
}

/**
 * Resolves one of the three threshold kinds for an employee and date. Unlike
 * attendance_source_rule and day_threshold_rule, an unconstrained row is NOT mandatory here —
 * criteria 5.5, 6.2 and 10.4 each specify their own numeric default (480/60/60) to apply when
 * nothing is configured at all, so an empty result is a valid, expected state, not an error.
 */
export async function resolveThreshold(
  kind: ThresholdKind,
  employeeAttrs: EmployeeAttributes,
  date: string,
): Promise<number> {
  const rules = await loadActiveWindowedRules(kind, date);
  if (rules.length === 0) return DEFAULT_THRESHOLD_MINUTES[kind];

  const result = resolveRule(rules, employeeAttrs);
  if (!result.winner) return DEFAULT_THRESHOLD_MINUTES[kind];

  // criterion 5.8: a non-finite or non-positive stored value falls back to the default and
  // must be flagged — the write-time validation that prevents this from being written at all
  // is a later phase's rule-admin-screen task; this defensive check is the read-time half of
  // that same guard, mirroring resolveHalfDayFloorMinutes()'s existing malformed-value defence.
  const minutes = result.winner.thresholdMinutes;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return DEFAULT_THRESHOLD_MINUTES[kind];
  }
  return minutes;
}

/**
 * Resolves Dual_Review_Ceiling for one branch and Pay_Month (criterion 6.10). Precedence:
 * exact (branch, pay_month) match, then (branch, NULL), then (NULL, pay_month), then the
 * hardcoded default of 100. This is a two-key lookup, not a six-dimension resolveRule() call,
 * because Dual_Review_Ceiling is deliberately scoped to branch + Pay_Month only (design.md:
 * "Ceiling resolution").
 */
export async function resolveDualReviewCeiling(
  branchId: string,
  payMonth: string,
): Promise<number> {
  const exact = await queryCeiling(branchId, payMonth);
  if (exact !== null) return exact;

  const branchOnly = await queryCeiling(branchId, null);
  if (branchOnly !== null) return branchOnly;

  const monthOnly = await queryCeiling(null, payMonth);
  if (monthOnly !== null) return monthOnly;

  return 100;
}

async function queryCeiling(
  branchId: string | null,
  payMonth: string | null,
): Promise<number | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ceiling_value
       FROM attendance_dual_review_ceiling
      WHERE active_status = 1
        AND branch_id ${branchId === null ? 'IS NULL' : '= ?'}
        AND pay_month ${payMonth === null ? 'IS NULL' : '= ?'}
      LIMIT 1`,
    [branchId, payMonth].filter((v) => v !== null),
  );
  return rows.length > 0 ? (rows[0] as any).ceiling_value : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/attendance-threshold-config.service.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/wfm/attendance-threshold-config.service.ts \
        backend/src/modules/wfm/__tests__/attendance-threshold-config.service.test.ts
git commit -m "feat: add attendance-threshold-config.service.ts — resolveThreshold() and resolveDualReviewCeiling()"
```

---

### Task 7: Register migrations 1633–1635 in `MIGRATION_MANIFEST`

**Files:**
- Modify: `backend/src/db/runPendingMigrations.ts:817` (immediately after the existing
  `"1632_salary_revision_page.sql"` entry — confirm the exact current last line with
  `grep -n "1632_salary_revision_page.sql" backend/src/db/runPendingMigrations.ts` before editing,
  since other sessions may have appended entries after it)
- Modify: `backend/sql/MIGRATION_MANIFEST.lock.json` (regenerated, not hand-edited)

**Interfaces:**
- Consumes: nothing new.
- Produces: `MIGRATION_MANIFEST` includes the three new filenames, so
  `scripts/migrate-fresh-test.ts` and the existing manifest-guard contract test pick them up.

- [ ] **Step 1: Confirm the current manifest tail and the migration file's own registration guard**

Run: `cd backend && grep -n "1632_salary_revision_page.sql" src/db/runPendingMigrations.ts`
Expected: one line, e.g. `814:  "1632_salary_revision_page.sql", // ...`

This repository has a manifest-guard contract test (per CLAUDE.md/design.md: "every new SQL file
appears in MIGRATION_MANIFEST, which the existing manifest guard already enforces") — running it
now, before the edit, confirms it currently passes and will be the thing that fails next.

Run: `cd backend && npx vitest run --reporter=verbose 2>&1 | grep -i "manifest"`
Expected: an existing test name containing "manifest" is listed and passing.

- [ ] **Step 2: Add the three entries**

Using Edit on `backend/src/db/runPendingMigrations.ts`, insert immediately after the
`"1632_salary_revision_page.sql"` line found in Step 1:

```ts
  "1633_attendance_source_rule_store.sql", // Creates attendance_source_rule + attendance_source_rule_dimension_value: the single effective-dated Attendance_Source_Rule store (requirements.md Requirement 1) that replaces attendance_rule_config + apr_eligibility_config's non-deterministic OR-combination. Resolution is a pure in-memory function (attendance-source-rule-resolver.ts), not a SQL ORDER BY ... LIMIT 1 tiebreak. Purely additive — two new tables, no ALTER, nothing read by production code yet; the engine cutover and the migration-15 proposal/approval workflow are later phases. No FOREIGN KEY (matches the no-FK convention; migration 1500's FK to process_master is the one already blocking every deploy).
  "1634_day_threshold_rule_store.sql", // Creates day_threshold_rule + day_threshold_rule_dimension_value: full_day_minutes/half_day_minutes/grace_minutes relocated out of attendance_rule_config (criteria 1.14-1.16), resolved by the same six Rule_Dimensions and the same resolver as attendance_source_rule. Purely additive, not yet read by classifyMinutes().
  "1635_attendance_threshold_and_ceiling_store.sql", // Creates attendance_threshold_rule (+ dimension_value child) for the three threshold kinds (apr_corroboration/variance_tolerance/floor_absence_ceiling, defaults 480/60/60) and attendance_dual_review_ceiling, scoped to branch + Pay_Month rather than the six Rule_Dimensions (criterion 6.10). Purely additive.
```

- [ ] **Step 3: Regenerate the lock file**

Run: `cd backend && node scripts/update-migration-lock.mjs`
Expected: `backend/sql/MIGRATION_MANIFEST.lock.json` updates to include checksums for the three
new files; diff it to confirm only additions, no removed or reordered entries:

Run: `git diff backend/sql/MIGRATION_MANIFEST.lock.json`
Expected: three new JSON entries appended, nothing else changed.

- [ ] **Step 4: Run the manifest-guard contract test again to confirm it passes with the new files registered**

Run: `cd backend && npx vitest run --reporter=verbose 2>&1 | grep -i "manifest"`
Expected: the same test(s) from Step 1, still passing.

- [ ] **Step 5: Run the full new-file test suite from Tasks 2-6 together, once, as a final gate**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts src/modules/wfm/__tests__/attendance-source-rule.service.test.ts src/modules/wfm/__tests__/day-threshold-rule.service.test.ts src/modules/wfm/__tests__/attendance-threshold-config.service.test.ts src/db/__tests__/attendance-source-rule-store-migration.contract.test.ts`
Expected: PASS, 16 tests total (4 property + 2 + 1 + 3 + 6 contract).

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/runPendingMigrations.ts backend/sql/MIGRATION_MANIFEST.lock.json
git commit -m "chore: register migrations 1633-1635 in MIGRATION_MANIFEST"
```

---

## What Phase 1 deliberately does not do

No wiring into `attendanceEngineService.processEmployee()`, no rule-administration UI, no write-path
validation endpoints (criteria 1.7–1.13), no migration-proposal workflow (Requirement 15). Those are
Phases 2–11 of the roadmap discussed with the user:

2. Dialler registry + Column_Mapping + canonical aggregation (pure `deriveCanonical()`)
3. WFM manual upload pipeline (Upload_Batch, column-mapping parsing, preview, supersession)
4. Engine integration — wire this phase's resolvers into `processEmployee()`, provenance record,
   variance + Floor_Absence_Pattern detection
5. Adjustment authority + payroll cutoff behaviour
6. Migration (proposal + reconciliation + approval gate, Requirement 15)
7. Access control + page wiring (six new page codes)
8. UI — rule administration screen
9. UI — Variance Review Queue + reporting
10. UI — Consolidated Productivity View + WFM upload screen
11. Audit log + contract tests + smoke checks

Each later phase gets its own plan via this same skill when it's time to build it, so no phase
requires holding the whole 19-requirement spec in context at once.
