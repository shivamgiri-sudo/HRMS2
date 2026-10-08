import type { PoolConnection, RowDataPacket } from "mysql2/promise";

/**
 * Pre-approval snapshots of attendance_daily_record.
 *
 * Approving a leave or a regularization overwrites the attendance row. Before
 * migration 1023 the only thing kept was `old_attendance_status` /
 * `old_lwp_value` — two columns out of forty-five — and a day that had no row at
 * all was indistinguishable from a day whose row had a NULL status. Neither is
 * enough to put the day back.
 *
 * These helpers capture the whole row inside the approval transaction so a later
 * discard can restore it exactly, and record `row_existed` so the discard knows
 * whether to UPDATE the row back or DELETE it outright.
 */

export type SnapshotSourceType = "regularization" | "dispute" | "leave";

export interface AttendanceSnapshotRow {
  source_type: SnapshotSourceType;
  source_id: string;
  employee_id: string;
  record_date: string;
  row_existed: number;
  snapshot_json: string | null;
}

/** Every calendar date from `from` to `to` inclusive, as YYYY-MM-DD. */
export function enumerateDates(from: string, to: string): string[] {
  const start = String(from).slice(0, 10);
  const end = String(to).slice(0, 10);
  const out: string[] = [];
  // Anchored at UTC noon so a DST or timezone shift can never roll the date back
  // a day — the pool runs dateStrings, so these are plain calendar dates.
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return [];
  let guard = 0;
  while (cursor <= last && guard < 400) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }
  return out;
}

/**
 * Capture the pre-approval state of every given date, inside the caller's open
 * transaction.
 *
 * Uses INSERT IGNORE against `uq_snapshot_source_date` deliberately: if the same
 * request is approved twice, the FIRST snapshot must win. Overwriting it would
 * store the already-corrected values and destroy the original — the exact defect
 * this table exists to prevent.
 */
export async function captureAttendanceSnapshot(
  conn: PoolConnection,
  params: {
    sourceType: SnapshotSourceType;
    sourceId: string;
    employeeId: string;
    dates: string[];
    capturedBy?: string | null;
  }
): Promise<number> {
  const dates = params.dates.map((d) => String(d).slice(0, 10)).filter(Boolean);
  if (dates.length === 0) return 0;

  const placeholders = dates.map(() => "?").join(", ");
  const [existingRows] = await conn.execute<RowDataPacket[]>(
    `SELECT * FROM attendance_daily_record
      WHERE employee_id = ? AND record_date IN (${placeholders})`,
    [params.employeeId, ...dates]
  );

  const byDate = new Map<string, RowDataPacket>();
  for (const row of existingRows as RowDataPacket[]) {
    byDate.set(String((row as any).record_date).slice(0, 10), row);
  }

  const values: any[] = [];
  const tuples: string[] = [];
  for (const date of dates) {
    const existing = byDate.get(date);
    tuples.push("(UUID(), ?, ?, ?, ?, ?, ?, ?)");
    values.push(
      params.sourceType,
      params.sourceId,
      params.employeeId,
      date,
      existing ? 1 : 0,
      existing ? JSON.stringify(existing) : null,
      params.capturedBy ?? null
    );
  }

  const [result] = await conn.execute(
    `INSERT IGNORE INTO attendance_state_snapshot
       (id, source_type, source_id, employee_id, record_date, row_existed, snapshot_json, captured_by)
     VALUES ${tuples.join(", ")}`,
    values
  );
  return Number((result as any)?.affectedRows ?? 0);
}

/** Snapshots for one source, keyed by YYYY-MM-DD. */
export async function readAttendanceSnapshots(
  conn: PoolConnection,
  sourceType: SnapshotSourceType,
  sourceId: string
): Promise<Map<string, { row_existed: number; snapshot: Record<string, unknown> | null }>> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT record_date, row_existed, snapshot_json
       FROM attendance_state_snapshot
      WHERE source_type = ? AND source_id = ?`,
    [sourceType, sourceId]
  );
  const out = new Map<string, { row_existed: number; snapshot: Record<string, unknown> | null }>();
  for (const row of rows as RowDataPacket[]) {
    const raw = (row as any).snapshot_json;
    // mysql2 hands back JSON columns already parsed, but a driver or column-type
    // change would hand back a string — accept both rather than throw mid-restore.
    let parsed: Record<string, unknown> | null = null;
    if (raw && typeof raw === "object") parsed = raw as Record<string, unknown>;
    else if (typeof raw === "string" && raw.trim()) {
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
    }
    out.set(String((row as any).record_date).slice(0, 10), {
      row_existed: Number((row as any).row_existed ?? 0),
      snapshot: parsed,
    });
  }
  return out;
}
