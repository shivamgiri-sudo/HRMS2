import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * The flat `statutory_config` table read as a lowercase key -> number map.
 *
 * `config_key` is UNIQUE, so this table holds exactly one row per key and
 * cannot express two versions of a rate. What it *can* express is that a row is
 * switched off (`is_active = 0`) or does not apply yet (`effective_from` in the
 * future) — and every read of it ignored both columns. A deactivated key still
 * fed payroll, and a rate seeded ahead of a Finance Act took effect the moment
 * it was saved rather than on the date it was given.
 *
 * `effective_from IS NULL` means no start date was ever recorded, which is true
 * of most of the table (PF, ESIC, gratuity, the standard deduction). Those are
 * treated as always in effect. Reading NULL as "not yet effective" would drop
 * every one of them and block payroll outright, which is why the check is
 * written as an explicit NULL allowance rather than a bare `effective_from <= ?`
 * — SQL's three-valued logic would silently exclude them.
 *
 * Versioned, approval-gated rate history belongs in `statutory_config_version`
 * and is resolved by statutory-config.resolver.ts. This is the honest reading
 * of the flat table, not a substitute for that.
 */

/**
 * Normalise a period or date to the date a rate must have taken effect by.
 *
 * Accepts "YYYY-MM" (salary_prep_run.run_month) and "YYYY-MM-DD"
 * (running-salary's month start). A period resolves to its first day: a rate
 * taking effect mid-month did not govern the month that was already running.
 */
function asOfDate(periodOrDate?: string): string | null {
  if (!periodOrDate) return null;
  if (/^\d{4}-\d{2}$/.test(periodOrDate)) return `${periodOrDate}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(periodOrDate)) return periodOrDate;
  throw new Error(
    `A period (YYYY-MM) or date (YYYY-MM-DD) is required, received "${periodOrDate}"`,
  );
}

/**
 * Approved statutory values in force on a given period or date.
 *
 * Pass the payroll period being computed. Omit it only where there genuinely is
 * no period in context (an ad-hoc projection), in which case today's date is
 * used — resolved by the database via CURDATE() so it agrees with the rest of
 * the schema rather than with this process's timezone.
 *
 * Keys are lowercased because callers look them up that way. Values that are
 * not finite numbers are skipped, so a malformed row reads as a missing key —
 * which the TDS contract reports as a named gap — rather than as NaN silently
 * propagating into someone's net pay.
 */
export async function loadFlatStatutoryConfig(
  periodOrDate?: string,
): Promise<Record<string, number>> {
  const asOf = asOfDate(periodOrDate);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT config_key, config_value
       FROM statutory_config
      WHERE is_active = 1
        AND (effective_from IS NULL OR effective_from <= COALESCE(?, CURDATE()))`,
    [asOf],
  );

  const config: Record<string, number> = {};
  for (const row of rows as Array<{ config_key: string; config_value: unknown }>) {
    const value = Number(row.config_value);
    if (Number.isFinite(value)) config[String(row.config_key).toLowerCase()] = value;
  }
  return config;
}
