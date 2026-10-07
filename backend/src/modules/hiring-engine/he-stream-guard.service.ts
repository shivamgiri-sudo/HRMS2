/**
 * Keeps the legacy whole-audience line-up (Find leads, campaign launch) off stream-fed drives: it would size to target_shows, delete the
 * other streams' suggestions and orphan their credits. A missing stream table (2135 not applied) means no streams; any other read error
 * refuses (fail safe) instead of running the legacy line-up.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";

export type StreamCheck = "none" | "streams" | "unknown";
export const DRIVE_STREAM_FED = "This drive is fed by streams; use Plan now";
export const REQUISITION_STREAM_FED = "This requisition is fed by streams; use Plan now";
export const STREAM_CHECK_FAILED = "Could not check the requisition's streams; try again";

const codeOf = (err: unknown): string => { const e = err as { code?: string; name?: string }; return e?.code ?? e?.name ?? "error"; };
export const isNoSuchTable = (err: unknown): boolean => codeOf(err) === "ER_NO_SUCH_TABLE";

async function check(where: string, sql: string, params: unknown[]): Promise<StreamCheck> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    return Number(rows[0]?.hit ?? 0) > 0 ? "streams" : "none";
  } catch (err) {
    if (isNoSuchTable(err)) return "none";
    logger.warn({ where, code: codeOf(err) }, "[he-streams] stream check failed");
    return "unknown";
  }
}

/** Whether a stream pass planned this drive (it has a requisition_stream_plan row). */
export function driveStreamCheck(driveId: string): Promise<StreamCheck> {
  return check("drive", "SELECT COUNT(*) AS hit FROM requisition_stream_plan WHERE drive_id = ?", [driveId]);
}

/** Whether a launch for this requisition and day would collide with streams: an open / paused stream, or a stream-fed drive that day. */
export function launchStreamCheck(requisitionId: string, date: string): Promise<StreamCheck> {
  return check("launch",
    `SELECT (SELECT COUNT(*) FROM requisition_stream WHERE requisition_id = ? AND status IN ('open','paused'))
          + (SELECT COUNT(*) FROM requisition_stream_plan p JOIN he_drive d ON d.id = p.drive_id WHERE d.requisition_id = ? AND d.drive_date = ?) AS hit`,
    [requisitionId, requisitionId, date]);
}
