import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { logRosterChange } from "../roster/roster-change-log.js";
import { computeScheduledMinutes, rosterAssignmentColumns } from "../wfm/shift-scheduling.util.js";
import { isRestPolicyFeatureActive, validateMinimumRest, withEmployeeRosterLock } from "../wfm/rest-policy.service.js";
import { checkEmployeeDateNotLocked } from "../roster/roster-lock-guard.js";

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

      // Resolve employee_id from code (process_id/branch_id pulled here too, for
      // the Area 2 rest-policy scope resolution below — avoids a second round trip)
      const [empRows] = await conn.execute<RowDataPacket[]>(
        "SELECT id, process_id, branch_id FROM employees WHERE employee_code = ? AND employment_status = 'active' LIMIT 1",
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
      const employeeRow = (empRows as RowDataPacket[])[0];
      const employeeId = employeeRow.id as string;

      // Resolve shift_template_id from code (if not week-off). wfm_shift_template
      // is already an append-only/versioned table (no UPDATE route has ever
      // existed for it) — the id itself is the stable, immutable reference Area 4
      // requires, so no separate shift_version_id is needed for this path. What
      // WAS missing is the start/end-time and duration snapshot on the assignment
      // row itself: shift_start_time/shift_end_time existed as columns but were
      // never populated by this bulk path, so a bulk-uploaded row could not be
      // reconstructed without a live join back through wfm_shift_template.
      let shiftTemplateId: string | null = null;
      let shiftStartTime: string | null = null;
      let shiftEndTime: string | null = null;
      const isWeekOff = is_week_off === "1" || is_week_off === "true";
      if (!isWeekOff && shift_code) {
        const [shiftRows] = await conn.execute<RowDataPacket[]>(
          "SELECT id, start_time, end_time FROM wfm_shift_template WHERE shift_code = ? AND active_status = 1 LIMIT 1",
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
        const shiftRow = (shiftRows as RowDataPacket[])[0];
        shiftTemplateId = shiftRow.id as string;
        shiftStartTime = shiftRow.start_time as string;
        shiftEndTime = shiftRow.end_time as string;
      }
      const scheduledMinutes = shiftStartTime && shiftEndTime
        ? computeScheduledMinutes(String(shiftStartTime).slice(0, 5), String(shiftEndTime).slice(0, 5))
        : null;

      // Area 2 concurrency fix (2026-08-13): the rest-check and the INSERT
      // below are wrapped in ONE per-employee advisory-lock critical section
      // — checking under the lock but writing after releasing it would leave
      // the exact race the lock exists to close (a concurrent writer could
      // still land between release and insert). This batch's own transaction
      // already serializes rows WITHIN itself, but not against a DIFFERENT
      // concurrent request for the same employee (a second bulk upload, or a
      // manual assignment) using a different connection — GET_LOCK is
      // visible across connections, a single-connection transaction is not.
      // The lock's own connection is necessarily separate from `conn` (GET_LOCK
      // is session-scoped) but every read/write below still runs on `conn`,
      // the batch's own transaction connection, from inside the lock's
      // critical section.
      const rowResult = await withEmployeeRosterLock(employeeId, async (): Promise<
        { ok: true; assignmentId: string } | { ok: false; message: string }
      > => {
        // Closure item #2 (2026-08-13): shared attendance/payroll lock guard,
        // the same function every other write path in this program now uses.
        // Checked first — a locked date is a harder stop than a rest-policy
        // outcome, and there's no point resolving a rest check for a row
        // this bulk path is about to refuse anyway.
        const dateLockResult = await checkEmployeeDateNotLocked(conn, employeeId, roster_date);
        if (dateLockResult.blocked) {
          return { ok: false, message: `Row ${batchRow.row_no}: ${dateLockResult.error}` };
        }

        // Area 2: minimum-rest validation. Bulk upload BLOCKS on insufficient
        // rest with no override path — an override needs an individual,
        // deliberate approval (reason + named approver), which a CSV column
        // can't legitimately grant. Only runs for non-week-off rows with a
        // resolved shift time, and only once the feature is actually turned
        // on (migration 1210 applied) — otherwise this is a no-op.
        if (!isWeekOff && shiftStartTime && shiftEndTime && (await isRestPolicyFeatureActive(conn))) {
          const restCheck = await validateMinimumRest(
            { employeeId, processId: employeeRow.process_id ?? null, branchId: employeeRow.branch_id ?? null, forDate: roster_date },
            { startTime: String(shiftStartTime).slice(0, 5), endTime: String(shiftEndTime).slice(0, 5) },
            null,
            conn
          );
          if (!restCheck.ok) {
            const message = restCheck.reason === "REST_POLICY_MISSING"
              ? `Row ${batchRow.row_no}: no minimum-rest policy configured for this employee/process/branch/organization`
              : `Row ${batchRow.row_no}: only ${restCheck.actualRestMinutes}min rest against the ${restCheck.against} shift (minimum ${restCheck.requiredRestMinutes}min) — bulk upload does not support emergency override, use manual assignment instead`;
            return { ok: false, message };
          }
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

        // shift_version_id/scheduled_minutes only exist once migration
        // 1200_shift_versioning.sql has been applied — probe rather than assume,
        // same pattern as the live engine (auto-roster-synced.service.ts).
        const raCols = await rosterAssignmentColumns(conn);
        const hasScheduledMinutes = raCols.has("scheduled_minutes");
        const hasShiftVersionId = raCols.has("shift_version_id");

        // Built as synchronized (column, placeholder, value) triples, in the exact
        // order they'll appear in the SQL text — MySQL binds `?` positionally, so
        // insertVals must stay index-aligned with insertPlaceholders regardless of
        // which optional columns get spliced in. system_decision_reason is placed
        // last on purpose, alongside its value, rather than fixed mid-list with its
        // value appended separately later — that split is what broke the alignment.
        const insertCols = ["id", "cycle_id", "employee_id", "roster_date", "shift_template_id", "is_week_off",
          "shift_start_time", "shift_end_time"];
        const insertPlaceholders = ["?", "?", "?", "?", "?", "?", "?", "?"];
        const insertVals: unknown[] = [assignmentId, cycle_id, employeeId, roster_date, shiftTemplateId,
          isWeekOff ? 1 : 0, shiftStartTime, shiftEndTime];
        const updateClauses = [
          "shift_template_id = VALUES(shift_template_id)",
          "is_week_off = VALUES(is_week_off)",
          "shift_start_time = VALUES(shift_start_time)",
          "shift_end_time = VALUES(shift_end_time)",
        ];
        if (hasShiftVersionId) {
          insertCols.push("shift_version_id");
          insertPlaceholders.push("?");
          insertVals.push(shiftTemplateId);
          updateClauses.push("shift_version_id = VALUES(shift_version_id)");
        }
        if (hasScheduledMinutes) {
          insertCols.push("scheduled_minutes");
          insertPlaceholders.push("?");
          insertVals.push(scheduledMinutes);
          updateClauses.push("scheduled_minutes = VALUES(scheduled_minutes)");
        }
        insertCols.push("roster_status", "publish_status", "decision_source", "system_decision_reason");
        insertPlaceholders.push("'published'", "'published'", "'bulk_upload'", "?");
        insertVals.push(notes ?? null);
        updateClauses.push("decision_source = 'bulk_upload'", "system_decision_reason = VALUES(system_decision_reason)", "updated_at = NOW()");

        await conn.execute(
          // wfm_roster_assignment has no notes, created_by or updated_by column - it
          // carries created_at/updated_at and no actor. Those three names made every
          // bulk roster upload fail outright.
          //
          // The uploader's note is kept rather than dropped: system_decision_reason is
          // the row's only free-text field and is already the column the RTA and WFM
          // views surface next to decision_source, which this sets to 'bulk_upload'.
          `INSERT INTO wfm_roster_assignment
             (${insertCols.join(", ")})
           VALUES (${insertPlaceholders.join(", ")})
           ON DUPLICATE KEY UPDATE
             ${updateClauses.join(",\n             ")}`,
          insertVals
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

        return { ok: true, assignmentId };
      });

      if (!rowResult.ok) {
        errors.push(rowResult.message);
        await conn.execute(
          "UPDATE upload_batch_row SET row_status='error', error_messages=? WHERE id=?",
          [JSON.stringify([rowResult.message]), batchRow.id]
        );
        skipped++;
        continue;
      }

      await conn.execute(
        "UPDATE upload_batch_row SET row_status='imported', target_record_id=? WHERE id=?",
        [rowResult.assignmentId, batchRow.id]
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
