/**
 * One writer per destination, declared rather than assumed.
 *
 * THE PROBLEM THIS EXISTS FOR
 *
 * integration_biometric_daily is unique on
 * (integration_key, source_table, employee_code, activity_date).
 *
 * `integration_key` being IN that key is the trap. Re-running the same
 * connector upserts harmlessly — that is what the ON DUPLICATE KEY UPDATE in
 * dbSyncService handles. But a DIFFERENT connector writing the same employee on
 * the same date does not collide at all. It inserts a parallel row.
 *
 * Biometric data is already flowing: 34,620 rows under integration_key
 * 'cosec_sqlserver' from dbo.Mx_ATDEventTrn, written by the cosec-sync worker
 * and current to today. The disabled `cosec_biometric` schedule is mapped to the
 * SAME source table and would write it under its own key. Nothing would error;
 * there would simply be two rows where there was one.
 *
 * And the consumers do not filter on integration_key. break-management.service
 * (five call sites), dashboard-drilldown.service and dashboard-metric.service
 * all aggregate this table without it — only biometric-punch.routes:127 filters,
 * and only for the cosec_live webhook. So attendance and punch counts would
 * inflate silently, which is the worst way for a number to be wrong.
 *
 * WHY A GUARD RATHER THAN "REMEMBER NOT TO ENABLE IT"
 *
 * The six schedules are disabled today. Disabled is a state someone can change
 * in one click, in a UI, months from now, without knowing any of the above. The
 * safeguard has to live where the write happens.
 *
 * This refuses the write instead of deduplicating after the fact, because by the
 * time a duplicate row exists every consumer has already counted it.
 */

/**
 * Destination table -> the ONE integration_key permitted to write it.
 *
 * Absent from this map means unguarded: dialer_session_log and
 * integration_call_daily are legitimately multi-source (dialer_1 and dialer_2
 * cover different campaigns), and their consumers do scope by key.
 */
export const CANONICAL_WRITERS: Readonly<Record<string, string>> = {
  // Determined from production on 2026-08-02, not chosen: cosec_sqlserver holds
  // 34,620 rows current to today, while cosec_mysql stopped on 2026-07-12.
  integration_biometric_daily: "cosec_sqlserver",
};

export type WriteVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * May this connector write this table?
 *
 * Pure, so the rule is arguable in a test rather than buried in a sync loop.
 */
export function mayWriteTable(targetTable: string, integrationKey: string): WriteVerdict {
  const canonical = CANONICAL_WRITERS[targetTable];
  if (!canonical) return { allowed: true };
  if (canonical === integrationKey) return { allowed: true };

  return {
    allowed: false,
    reason:
      `${integrationKey} is not the canonical writer for ${targetTable} — ${canonical} is. ` +
      `Its rows would not collide with ${canonical}'s, because integration_key is part of the ` +
      `unique key, so they would sit alongside them as duplicates and every consumer that does ` +
      `not filter integration_key would double-count. If ${integrationKey} is meant to replace ` +
      `${canonical}, retire the incumbent writer first and change CANONICAL_WRITERS in the same ` +
      `commit.`,
  };
}
