import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { logSourceFailure } from "../../shared/apiResponse.js";

/**
 * Writes to roster_change_log — the table CLAUDE.md's own Roster Governance section
 * requires ("Post-publication changes require mandatory reason and audit") and which
 * existed with exactly the right columns (old_value_json/new_value_json/reason/
 * changed_by) but received nothing from either bulk-upload service: a re-uploaded
 * roster silently overwrote the prior shift/week-off with no record of what it used
 * to be or why.
 *
 * Best-effort by design: roster_change_log.cycle_id is NOT NULL with a FOREIGN KEY to
 * weekly_roster_cycle, but wfm_roster_assignment.cycle_id — the id this is called
 * with — is documented as "set when assignment originates from a cycle", i.e. it can
 * legitimately be null or reference a cycle this governance table doesn't (yet) know
 * about. A logging failure here must never abort the write it's describing; it's
 * caught and reported, not rethrown.
 */
export async function logRosterChange(
  conn: { execute<T extends RowDataPacket[] = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown]> },
  input: {
    entityType: "wfm_roster_assignment";
    entityId: string;
    changedBy: string;
    reason: string;
    cycleId?: string | null;
    changeDate?: string;
    oldValue: { shift_template_id: string | null; is_week_off: boolean };
    newValue: { shift_template_id: string | null; is_week_off: boolean };
  },
): Promise<void> {
  if (!input.cycleId) return; // cycle_id is NOT NULL on roster_change_log — nothing to attribute this to.

  const changeTypes: Array<"shift_change" | "week_off_change"> = [];
  if (input.oldValue.shift_template_id !== input.newValue.shift_template_id) changeTypes.push("shift_change");
  if (input.oldValue.is_week_off !== input.newValue.is_week_off) changeTypes.push("week_off_change");
  if (changeTypes.length === 0) return;

  for (const changeType of changeTypes) {
    try {
      await conn.execute(
        `INSERT INTO roster_change_log
           (id, cycle_id, employee_id, change_type, old_value_json, new_value_json, reason, change_date, changed_by)
         SELECT ?, ?, employee_id, ?, ?, ?, ?, ?, ?
           FROM wfm_roster_assignment WHERE id = ? LIMIT 1`,
        [
          randomUUID(),
          input.cycleId,
          changeType,
          JSON.stringify(input.oldValue),
          JSON.stringify(input.newValue),
          input.reason,
          input.changeDate ?? new Date().toISOString().slice(0, 10),
          input.changedBy,
          input.entityId,
        ],
      );
    } catch (err) {
      logSourceFailure("roster-change-log", err, { entityType: input.entityType, entityId: input.entityId, changeType });
    }
  }
}
