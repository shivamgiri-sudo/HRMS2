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
