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
vi.mock('../../../db/mysql.js', () => ({
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

