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
vi.mock('../../../db/mysql.js', () => ({
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

