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
