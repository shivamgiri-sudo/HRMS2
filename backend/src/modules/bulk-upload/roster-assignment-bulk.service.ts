import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { logRosterChange } from "../roster/roster-change-log.js";

export async function importRosterAssignmentBatch(
  batchId: string,
  userId: string
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  // Previously every db.execute() autocommitted independently: a crash or dropped
  // connection partway through the loop left an arbitrary prefix of rows imported
  // into the live wfm_roster_assignment table with no rollback, while upload_batch
  // itself never got marked imported — the UI would show the batch as pending while
  // assignments already existed. Wrapped in one transaction so a mid-run failure
  // leaves nothing behind instead of a silent partial import. Per-row validation
  // failures are NOT transaction aborts — they're expected outcomes, recorded and
  // the loop continues, same as before; only an unexpected throw (e.g. connection
  // loss) rolls the whole batch back.
  const conn = await db.getConnection();
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    await conn.beginTransaction();

    const [batchRows] = await conn.execute<RowDataPacket[]>(
      "SELECT * FROM upload_batch_row WHERE upload_batch_id = ? AND row_status IN ('valid','pending') ORDER BY row_no ASC",
      [batchId]
    );

    for (const batchRow of batchRows as RowDataPacket[]) {
      const raw = (typeof batchRow.normalized_data === "string"
        ? JSON.parse(batchRow.normalized_data)
        : batchRow.normalized_data) as Record<string, string>;

      const { cycle_id, employee_code, roster_date, shift_code, is_week_off, notes } = raw;

      if (!cycle_id || !employee_code || !roster_date) {
        const msg = `Row ${batchRow.row_no}: missing cycle_id, employee_code or roster_date`;
        errors.push(msg);
        await conn.execute(
          "UPDATE upload_batch_row SET row_status='error', error_messages=? WHERE id=?",
          [JSON.stringify([msg]), batchRow.id]
        );
        skipped++;
        continue;
      }

      // Resolve employee_id from code
      const [empRows] = await conn.execute<RowDataPacket[]>(
        "SELECT id FROM employees WHERE employee_code = ? AND employment_status = 'active' LIMIT 1",
        [employee_code]
      );
      if (!(empRows as RowDataPacket[]).length) {
        const msg = `Row ${batchRow.row_no}: employee_code '${employee_code}' not found or inactive`;
        errors.push(msg);
        await conn.execute(
          "UPDATE upload_batch_row SET row_status='error', error_messages=? WHERE id=?",
          [JSON.stringify([msg]), batchRow.id]
        );
        skipped++;
        continue;
      }
      const employeeId = (empRows as RowDataPacket[])[0].id as string;

      // Resolve shift_template_id from code (if not week-off)
      let shiftTemplateId: string | null = null;
      const isWeekOff = is_week_off === "1" || is_week_off === "true";
      if (!isWeekOff && shift_code) {
        const [shiftRows] = await conn.execute<RowDataPacket[]>(
          "SELECT id FROM wfm_shift_template WHERE shift_code = ? AND active_status = 1 LIMIT 1",
          [shift_code]
        );
        if (!(shiftRows as RowDataPacket[]).length) {
          const msg = `Row ${batchRow.row_no}: shift_code '${shift_code}' not found`;
          errors.push(msg);
          await conn.execute(
            "UPDATE upload_batch_row SET row_status='error', error_messages=? WHERE id=?",
            [JSON.stringify([msg]), batchRow.id]
          );
          skipped++;
          continue;
        }
        shiftTemplateId = (shiftRows as RowDataPacket[])[0].id as string;
      }

      // Before the overwrite: this is the only record of what a re-upload changes.
      // roster_change_log exists specifically for this (old_value_json/new_value_json/
      // reason/changed_by) and previously received nothing from either bulk service —
      // a same employee+date re-upload silently replaced the prior shift with no trace.
      const [beforeRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, shift_template_id, is_week_off FROM wfm_roster_assignment
          WHERE employee_id = ? AND roster_date = ? LIMIT 1`,
        [employeeId, roster_date]
      );
      const before = (beforeRows as RowDataPacket[])[0] as
        | { id: string; shift_template_id: string | null; is_week_off: number }
        | undefined;

      const assignmentId = before?.id ?? randomUUID();
      await conn.execute(
        // wfm_roster_assignment has no notes, created_by or updated_by column - it
        // carries created_at/updated_at and no actor. Those three names made every
        // bulk roster upload fail outright.
        //
        // The uploader's note is kept rather than dropped: system_decision_reason is
        // the row's only free-text field and is already the column the RTA and WFM
        // views surface next to decision_source, which this sets to 'bulk_upload'.
        `INSERT INTO wfm_roster_assignment
           (id, cycle_id, employee_id, roster_date, shift_template_id, is_week_off,
            roster_status, publish_status, decision_source, system_decision_reason)
         VALUES (?, ?, ?, ?, ?, ?, 'published', 'published', 'bulk_upload', ?)
         ON DUPLICATE KEY UPDATE
           shift_template_id = VALUES(shift_template_id),
           is_week_off = VALUES(is_week_off),
           decision_source = 'bulk_upload',
           system_decision_reason = VALUES(system_decision_reason),
           updated_at = NOW()`,
        [assignmentId, cycle_id, employeeId, roster_date, shiftTemplateId,
         isWeekOff ? 1 : 0, notes ?? null]
      );

      if (before && (before.shift_template_id !== shiftTemplateId || Boolean(before.is_week_off) !== isWeekOff)) {
        await logRosterChange(conn, {
          entityType: "wfm_roster_assignment",
          entityId: before.id,
          changedBy: userId,
          reason: `Bulk roster upload (batch ${batchId})`,
          oldValue: { shift_template_id: before.shift_template_id, is_week_off: Boolean(before.is_week_off) },
          newValue: { shift_template_id: shiftTemplateId, is_week_off: isWeekOff },
        });
      }

      await conn.execute(
        "UPDATE upload_batch_row SET row_status='imported', target_record_id=? WHERE id=?",
        [assignmentId, batchRow.id]
      );
      imported++;
    }

    // imported_by and imported_at are added by migration 1134. They did not exist
    // when this statement was first written, which is why naming them meant a batch
    // was never marked imported at all - imported_rows stayed unset and
    // batch_status stayed at whatever it was before.
    await conn.execute(
      `UPDATE upload_batch SET batch_status=?, imported_rows=?, imported_by=?, imported_at=NOW(), updated_at=NOW()
       WHERE id=?`,
      [errors.length > 0 ? "imported_with_errors" : "imported", imported, userId ?? null, batchId]
    );

    await conn.commit();
    return { imported, skipped, errors };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
