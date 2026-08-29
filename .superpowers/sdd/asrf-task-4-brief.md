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

