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
