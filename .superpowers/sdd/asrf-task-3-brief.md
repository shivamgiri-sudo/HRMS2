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

