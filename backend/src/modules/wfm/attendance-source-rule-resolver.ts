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
