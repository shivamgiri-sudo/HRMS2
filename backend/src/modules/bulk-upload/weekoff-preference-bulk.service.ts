import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0, "0": 0,
  monday: 1, mon: 1, "1": 1,
  tuesday: 2, tue: 2, "2": 2,
  wednesday: 3, wed: 3, "3": 3,
  thursday: 4, thu: 4, "4": 4,
  friday: 5, fri: 5, "5": 5,
  saturday: 6, sat: 6, "6": 6,
};

function parseDay(val: string | undefined): number | null {
  if (val === undefined || val === null || val.trim() === "") return null;
  const n = DAY_NAMES[val.trim().toLowerCase()];
  return n !== undefined ? n : null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: unknown;
}

interface EmployeeRow extends RowDataPacket {
  employee_code: string;
  id: string;
  process_id: string;
  branch_id: string;
}

interface MaxOrderRow extends RowDataPacket {
  week_start_date: string;
  process_id: string;
  max_order: number;
}

interface ParsedRow {
  rowId: string;
  rowNo: number;
  employeeCode: string;
  weekStartDate: string;
  day1: number;
  day2: number | null;
  reason: string | null;
}

interface PreparedRow {
  rowId: string;
  prefId: string;
  employeeId: string;
  processId: string;
  branchId: string;
  weekStartDate: string;
  day1: number;
  day2: number | null;
  reason: string | null;
  submissionOrder: number;
}

const CHUNK_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function importWeekOffPreferenceBatch(
  batchId: string,
  userId: string
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    "SELECT * FROM upload_batch_row WHERE upload_batch_id = ? AND row_status IN ('valid','pending') ORDER BY row_no ASC",
    [batchId]
  );

  if (batchRows.length === 0) {
    return { imported: 0, skipped: 0, errors: [] };
  }

  const parsed: ParsedRow[] = [];
  const errors: string[] = [];
  let skipped = 0;
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const employeeCodes = new Set<string>();

  for (const batchRow of batchRows) {
    const raw = (typeof batchRow.normalized_data === "string"
      ? JSON.parse(batchRow.normalized_data)
      : batchRow.normalized_data) as Record<string, string>;

    const { employee_code, week_start_date, preferred_day_1, preferred_day_2, reason } = raw;

    if (!employee_code || !week_start_date || preferred_day_1 === undefined) {
      const msg = `Row ${batchRow.row_no}: missing employee_code, week_start_date or preferred_day_1`;
      errors.push(msg);
      errorUpdates.push({ rowId: batchRow.id, message: msg });
      skipped++;
      continue;
    }

    const day1 = parseDay(preferred_day_1);
    if (day1 === null) {
      const msg = `Row ${batchRow.row_no}: invalid preferred_day_1 '${preferred_day_1}'`;
      errors.push(msg);
      errorUpdates.push({ rowId: batchRow.id, message: msg });
      skipped++;
      continue;
    }

    parsed.push({
      rowId: batchRow.id, rowNo: batchRow.row_no, employeeCode: employee_code,
      weekStartDate: week_start_date, day1, day2: parseDay(preferred_day_2) ?? null,
      reason: reason ?? null,
    });
    employeeCodes.add(employee_code);
  }

  // One bulk employee lookup instead of one SELECT per row.
  const employeeMap = new Map<string, EmployeeRow>();
  if (employeeCodes.size > 0) {
    const codes = Array.from(employeeCodes);
    const [rows] = await db.execute<EmployeeRow[]>(
      `SELECT id, employee_code, process_id, branch_id FROM employees
       WHERE employee_code IN (${codes.map(() => "?").join(",")}) AND employment_status = 'active'`,
      codes
    );
    for (const r of rows) employeeMap.set(r.employee_code, r);
  }

  const resolved: Array<ParsedRow & { employeeId: string; processId: string; branchId: string }> = [];
  for (const row of parsed) {
    const emp = employeeMap.get(row.employeeCode);
    if (!emp) {
      const msg = `Row ${row.rowNo}: employee_code '${row.employeeCode}' not found or inactive`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.rowId, message: msg });
      skipped++;
      continue;
    }
    resolved.push({ ...row, employeeId: emp.id, processId: emp.process_id, branchId: emp.branch_id });
  }

  // submission_order is a running MAX+1 per (week_start_date, process_id) —
  // genuinely sequential, so it cannot simply be parallelized. Instead of one
  // "SELECT MAX..." round trip per row, fetch each referenced (week, process)
  // group's CURRENT max once, then assign each row's order locally as we walk
  // the rows in the same row_no order the original per-row loop used — same
  // result, one query instead of N.
  const weekDates = Array.from(new Set(resolved.map((r) => r.weekStartDate)));
  const processIds = Array.from(new Set(resolved.map((r) => r.processId)));
  const groupMax = new Map<string, number>();
  if (weekDates.length > 0 && processIds.length > 0) {
    const [rows] = await db.execute<MaxOrderRow[]>(
      `SELECT week_start_date, process_id, COALESCE(MAX(submission_order),0) AS max_order
       FROM week_off_preference
       WHERE week_start_date IN (${weekDates.map(() => "?").join(",")})
         AND process_id IN (${processIds.map(() => "?").join(",")})
       GROUP BY week_start_date, process_id`,
      [...weekDates, ...processIds]
    );
    for (const r of rows) {
      groupMax.set(`${String(r.week_start_date).slice(0, 10)}|${r.process_id}`, Number(r.max_order));
    }
  }

  const prepared: PreparedRow[] = [];
  for (const row of resolved) {
    const key = `${row.weekStartDate}|${row.processId}`;
    const nextOrder = (groupMax.get(key) ?? 0) + 1;
    groupMax.set(key, nextOrder);
    prepared.push({
      rowId: row.rowId, prefId: randomUUID(), employeeId: row.employeeId,
      processId: row.processId, branchId: row.branchId, weekStartDate: row.weekStartDate,
      day1: row.day1, day2: row.day2, reason: row.reason, submissionOrder: nextOrder,
    });
  }

  let imported = 0;
  const importedRowUpdates: Array<{ rowId: string; prefId: string }> = [];

  // Chunked multi-row upsert instead of one INSERT per row. If a chunk's
  // statement fails (a constraint violation on one of its rows), that chunk
  // alone is retried row-by-row so only the actually-bad row ends up marked
  // as an error — every other row in the batch still lands.
  for (const rowsInChunk of chunk(prepared, CHUNK_SIZE)) {
    const placeholders = rowsInChunk.map(() => "(?,?,?,?,?,?,?,?,?,?,'submitted',?,?)").join(", ");
    const params = rowsInChunk.flatMap((r) => [
      r.prefId, r.employeeId, r.processId, r.branchId, r.weekStartDate,
      r.day1, r.day2, r.day1, r.day2, r.reason, r.submissionOrder, userId,
    ]);

    try {
      await db.execute(
        // preferred_day (singular) is the column every live consumer actually reads —
        // weekoff-allocation.service.ts's FCFS run, roster-generation.service.ts, and
        // the manual single-preference path in roster-capacity.service.ts all select
        // or insert `preferred_day`/`alternate_day`, none of them
        // `preferred_day_1`/`preferred_day_2`. preferred_day is also NOT NULL with no
        // default, so before this every bulk-upload row failed outright with "Field
        // 'preferred_day' doesn't have a default value" — live-confirmed via PREPARE,
        // 0 successful imports ever. preferred_day/alternate_day are populated from
        // the same day1/day2 values written to preferred_day_1/preferred_day_2, so
        // both column generations stay in agreement — matching what
        // submitWeekOffPreference writes for a manually-submitted preference. This
        // does not add auto-approval or capacity-check behavior: uploaded rows still
        // land as pending, only now visible to the engine that actually allocates
        // week-offs.
        `INSERT INTO week_off_preference
           (id, employee_id, process_id, branch_id, week_start_date,
            preferred_day, alternate_day, preferred_day_1, preferred_day_2, reason, status, submission_order, created_by)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           preferred_day = VALUES(preferred_day),
           alternate_day = VALUES(alternate_day),
           preferred_day_1 = VALUES(preferred_day_1),
           preferred_day_2 = VALUES(preferred_day_2),
           reason = VALUES(reason),
           status = 'submitted'`,
        params
      );
      for (const r of rowsInChunk) {
        importedRowUpdates.push({ rowId: r.rowId, prefId: r.prefId });
        imported++;
      }
    } catch {
      for (const r of rowsInChunk) {
        try {
          await db.execute(
            `INSERT INTO week_off_preference
               (id, employee_id, process_id, branch_id, week_start_date,
                preferred_day, alternate_day, preferred_day_1, preferred_day_2, reason, status, submission_order, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)
             ON DUPLICATE KEY UPDATE
               preferred_day = VALUES(preferred_day),
               alternate_day = VALUES(alternate_day),
               preferred_day_1 = VALUES(preferred_day_1),
               preferred_day_2 = VALUES(preferred_day_2),
               reason = VALUES(reason),
               status = 'submitted'`,
            [r.prefId, r.employeeId, r.processId, r.branchId, r.weekStartDate,
             r.day1, r.day2, r.day1, r.day2, r.reason, r.submissionOrder, userId]
          );
          importedRowUpdates.push({ rowId: r.rowId, prefId: r.prefId });
          imported++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(msg);
          errorUpdates.push({ rowId: r.rowId, message: msg.slice(0, 500) });
          skipped++;
        }
      }
    }
  }

  if (importedRowUpdates.length > 0) {
    const cases = importedRowUpdates.map(() => "WHEN ? THEN ?").join(" ");
    const caseParams = importedRowUpdates.flatMap((u) => [u.rowId, u.prefId]);
    const ids = importedRowUpdates.map((u) => u.rowId);
    // target_record_id was never a real column on upload_batch_row — migration 1522
    // named the pair created_entity_type/created_entity_id instead. This threw
    // ER_BAD_FIELD_ERROR after the week_off_preference INSERTs above had ALREADY
    // committed (this function opens no transaction of its own, unlike the roster
    // services), so the uncaught throw left upload_batch marked 'failed' while the
    // rows were durably written — the UI reported failure for data that had, in
    // fact, landed. Live-confirmed via PREPARE.
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'imported',
              created_entity_type = 'week_off_preference',
              created_entity_id = CASE id ${cases} END
       WHERE id IN (${ids.map(() => "?").join(",")})`,
      [...caseParams, ...ids]
    );
  }
  if (errorUpdates.length > 0) {
    const cases = errorUpdates.map(() => "WHEN ? THEN ?").join(" ");
    const caseParams = errorUpdates.flatMap((u) => [u.rowId, JSON.stringify([u.message])]);
    const ids = errorUpdates.map((u) => u.rowId);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END
       WHERE id IN (${ids.map(() => "?").join(",")})`,
      [...caseParams, ...ids]
    );
  }

  await db.execute(
    `UPDATE upload_batch SET batch_status=?, imported_rows=?, imported_by=?, imported_at=NOW()
     WHERE id=?`,
    [errors.length > 0 ? "imported_with_errors" : "imported", imported, userId, batchId]
  );

  return { imported, skipped, errors };
}
