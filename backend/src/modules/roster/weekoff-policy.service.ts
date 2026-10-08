import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * Part A.1 of the 2026-08-13 roster enterprise-controls program: the last
 * two tiers of the week-off resolution hierarchy (employee preference ->
 * roster template -> process/branch/org default -> unresolved). Tier 1
 * (week_off_preference) is resolved directly in roster-generation.service.ts
 * against the already-loaded approvedWeekoffs map; this file covers tier 2
 * (roster_template.pattern_json — loaded there since 060_roster_master.sql
 * but never read again until now) and tier 3-5 (week_off_policy_default,
 * migration 1202).
 *
 * Never defaults to Sunday or any other day: a scope with nothing configured
 * (an empty week_off_policy_default table, or a malformed/absent
 * pattern_json) returns null/false rather than substituting a guess — the
 * caller must treat "nothing resolved at any tier" as WEEK_OFF_POLICY_MISSING,
 * a first-class condition that blocks roster publication
 * (roster.governance.service.ts's advanceCycleStatus), not a silently
 * accepted 7-day working week.
 */

interface WeekOffPolicyDefaultRow extends RowDataPacket {
  default_week_off_day: number;
  scope_type: "global" | "branch" | "process";
}

export type WeekOffScopeSource = "process_default" | "branch_default" | "global_default";

/**
 * Tier 3 (process) -> tier 4 (branch) -> tier 5 (organization/global), most
 * specific scope wins — same ORDER BY CASE scope_type precedence pattern
 * payrollCalculate.service.ts already uses for attendance_billing_config.
 * Returns null when no row matches at any scope (including when the table
 * is empty, which is its default state — see migration 1202's own note that
 * it seeds nothing).
 */
export async function resolveWeekOffScopeDefault(
  processId: string,
  branchId: string | null
): Promise<{ day: number; source: WeekOffScopeSource } | null> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const [rows] = await db.execute<WeekOffPolicyDefaultRow[]>(
      `SELECT default_week_off_day, scope_type FROM week_off_policy_default
        WHERE active_status = 1
          AND effective_from <= ?
          AND (effective_to IS NULL OR effective_to >= ?)
          AND (
            (scope_type = 'process' AND process_id = ?) OR
            (scope_type = 'branch'  AND branch_id = ?) OR
            (scope_type = 'global'  AND process_id IS NULL AND branch_id IS NULL)
          )
        ORDER BY
          CASE scope_type
            WHEN 'process' THEN 1
            WHEN 'branch'  THEN 2
            ELSE 3
          END
        LIMIT 1`,
      [today, today, processId, branchId]
    );
    const row = rows[0];
    if (!row) return null;
    const source: WeekOffScopeSource =
      row.scope_type === "process" ? "process_default" : row.scope_type === "branch" ? "branch_default" : "global_default";
    return { day: Number(row.default_week_off_day), source };
  } catch (error) {
    // Table may not exist yet on a DB that hasn't had migration 1202 applied
    // (this migration is registered but not force-run) — degrade to
    // "nothing configured", same outcome as an empty table, rather than
    // failing generation entirely.
    console.error("[roster] week_off_policy_default lookup unavailable; treating as unconfigured:", (error as Error)?.message);
    return null;
  }
}

interface RosterTemplateDayPattern {
  day_number: number;
  shift_template_id?: string | null;
  is_week_off?: boolean;
  is_rotational?: boolean;
}

export interface RosterTemplatePattern {
  days?: RosterTemplateDayPattern[];
}

/**
 * roster_template.pattern_json.days[] is indexed by day_number (1-based),
 * one entry per DATE POSITION in the cycle (day_number 1 = the cycle's
 * first date, not "Monday") — confirmed against the only seeded shape,
 * 060_roster_master.sql's "5-Day Week (Mon-Fri)" template (cycle_days=7,
 * seven day entries, day_number 1 and 7 marked is_week_off:true).
 */
export function parseRosterTemplatePattern(patternJson: unknown): RosterTemplatePattern | null {
  try {
    const parsed = typeof patternJson === "string" ? JSON.parse(patternJson) : patternJson;
    if (parsed && Array.isArray((parsed as RosterTemplatePattern).days)) {
      return parsed as RosterTemplatePattern;
    }
  } catch (error) {
    console.error("[roster] roster_template.pattern_json malformed; treating template tier as unresolved:", (error as Error)?.message);
  }
  return null;
}

/**
 * dateIndexInCycle is 0-based (position within the cycle's date list).
 * Returns null (not false) when the pattern has no entry for this position
 * at all — distinct from "resolved and this position is a working day" —
 * so the caller can still fall through to the next tier rather than treat a
 * short/malformed pattern as "definitely not a week-off."
 */
export function isWeekOffByTemplate(pattern: RosterTemplatePattern, dateIndexInCycle: number): boolean | null {
  const entry = pattern.days?.find((d) => d.day_number === dateIndexInCycle + 1);
  if (!entry) return null;
  return !!entry.is_week_off;
}
