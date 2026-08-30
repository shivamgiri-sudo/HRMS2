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
