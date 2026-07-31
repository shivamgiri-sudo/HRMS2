import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { REQUIRED_TDS_CONFIG_KEYS } from "./statutory-regime.js";

/**
 * Resolve statutory configuration as it stood for a given payroll period.
 *
 * The rule this encodes is not a preference. TDS on salary is deducted under
 * s.192 at each employee's average rate for the year, and what was deducted has
 * to reconcile later against Form 16 and the quarterly 24Q. That is only
 * possible if a past period can be recomputed at the rates that were actually
 * in force for it — so rates are selected BY PERIOD, never "whatever the table
 * holds right now".
 *
 * statutory_config cannot express this: config_key is UNIQUE, so a Finance Act
 * change overwrites the live row and the previous year's rates cease to exist.
 * statutory_config_version (migration 1030) keeps every version with its own
 * effective_from, and this resolver picks the latest one that had taken effect
 * by the start of the period and had been approved.
 *
 * Unapproved rows are proposals and are deliberately invisible here.
 */

export interface StatutoryConfigResolution {
  /** Period this was resolved for, YYYY-MM. */
  period: string;
  /** Approved values effective for the period, keys lower-cased. */
  values: Record<string, number>;
  /** Required keys with no approved version effective for the period. */
  missing: string[];
  /**
   * "versioned"   — resolved from statutory_config_version.
   * "unavailable" — the versioned table could not be read (migration 1030 not
   *                 applied yet, or the query failed). Callers must treat this
   *                 as "not configured" and refuse to compute, NOT as a reason
   *                 to fall back to constants.
   */
  source: "versioned" | "unavailable";
}

/**
 * Keys a TDS computation cannot proceed without.
 *
 * Defined once in statutory-regime.ts and re-exported here, so importers of
 * either module see the same list. It was previously declared in both files:
 * two lists that had to be edited together, where a Finance Act adding a slab
 * to one and not the other leaves the gate demanding a key the calculator never
 * reads — or the calculator reading one the gate never checks.
 */
export { REQUIRED_TDS_CONFIG_KEYS };

/** First day of the payroll period — the date a version must have taken effect by. */
function periodStart(period: string): string {
  return `${period}-01`;
}

function isValidPeriod(period: string): boolean {
  return /^\d{4}-\d{2}$/.test(period);
}

/**
 * Approved statutory values effective for `period` (YYYY-MM).
 *
 * `requiredKeys` are reported in `missing` when absent; other keys are returned
 * if present but never demanded.
 */
export async function getStatutoryConfigForPeriod(
  period: string,
  requiredKeys: readonly string[] = REQUIRED_TDS_CONFIG_KEYS,
): Promise<StatutoryConfigResolution> {
  if (!isValidPeriod(period)) {
    throw new Error(`A valid payroll period (YYYY-MM) is required, received "${period}"`);
  }
  const start = periodStart(period);

  let rows: RowDataPacket[];
  try {
    // One row per key: the newest version that had taken effect by the start of
    // the period, was still open (or closed after it), and had been approved.
    const [result] = await db.execute<RowDataPacket[]>(
      `SELECT config_key, config_value
         FROM (
           SELECT config_key, config_value,
                  ROW_NUMBER() OVER (
                    PARTITION BY config_key
                    ORDER BY effective_from DESC
                  ) AS rn
             FROM statutory_config_version
            WHERE effective_from <= ?
              AND (effective_to IS NULL OR effective_to >= ?)
              AND approved_at IS NOT NULL
         ) ranked
        WHERE ranked.rn = 1`,
      [start, start],
    );
    rows = result;
  } catch {
    // Migration 1030 not applied, or the read failed. Report it as unavailable
    // rather than throwing: the caller's job is to refuse to compute, and a
    // thrown error here would look like an outage instead of a config gap.
    return {
      period,
      values: {},
      missing: [...requiredKeys],
      source: "unavailable",
    };
  }

  const values: Record<string, number> = {};
  for (const row of rows as Array<{ config_key: string; config_value: string }>) {
    const value = Number(row.config_value);
    if (Number.isFinite(value)) values[String(row.config_key).toLowerCase()] = value;
  }

  const missing = requiredKeys.filter((key) => !(key.toLowerCase() in values));

  return { period, values, missing, source: rows.length ? "versioned" : "unavailable" };
}

export interface TdsConfigGate {
  configured: boolean;
  period: string;
  missing: string[];
  /** Human-readable reason, safe to surface to a finance user. */
  reason: string | null;
  values: Record<string, number>;
}

/**
 * Whether TDS may be computed for a period at all.
 *
 * Deliberately returns a verdict instead of throwing, so a payroll pre-flight
 * can list every gap at once rather than failing on the first one. The charter
 * rule is that TDS stays blocked or pending until approved effective-dated
 * configuration exists — with no hardcoded fallback slabs, because constants
 * go stale invisibly: after a Finance Act the code keeps deducting last year's
 * rates and nothing reports it.
 */
export async function checkTdsConfigForPeriod(period: string): Promise<TdsConfigGate> {
  const resolved = await getStatutoryConfigForPeriod(period, REQUIRED_TDS_CONFIG_KEYS);

  if (resolved.source === "unavailable" && resolved.values && Object.keys(resolved.values).length === 0) {
    return {
      configured: false,
      period,
      missing: resolved.missing,
      reason:
        `No approved statutory configuration is readable for ${period}. ` +
        `Seed and approve the TDS slab keys in statutory_config_version before running payroll for this period.`,
      values: {},
    };
  }

  if (resolved.missing.length > 0) {
    return {
      configured: false,
      period,
      missing: resolved.missing,
      reason:
        `TDS configuration for ${period} is incomplete — no approved version effective for this period for: ` +
        `${resolved.missing.join(", ")}.`,
      values: resolved.values,
    };
  }

  return { configured: true, period, missing: [], reason: null, values: resolved.values };
}
