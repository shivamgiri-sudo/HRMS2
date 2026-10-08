/**
 * Persists the outcome of the last Meta lead-sync cycle in org_settings (existing key/value table), so the
 * pipeline-health strip survives an API restart. Only times, counts and a short error code are stored: never an
 * error message (can carry tokens or names) and never lead data. Reads and writes never throw.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export const SYNC_STATUS_KEY = "he_meta_sync_last";

export interface SyncStatusRecord {
  finishedAt: string;
  ok: boolean;
  imported: number;
  forms: number;
  formErrors: number;
  /** Short token such as ECONNRESET; null when ok. */
  errorCode: string | null;
  /** Finish time of the most recent successful cycle (carried over across failed ones); null if none known. */
  lastOkAt: string | null;
}

/** A code-like token only (letters, digits, `_ . -`, max 40); anything else, including free-text messages, becomes "error". */
export function safeErrorCode(err: unknown): string {
  const e = err as { code?: unknown; name?: unknown } | null | undefined;
  for (const c of [e?.code, e?.name]) {
    if (typeof c === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(c) && c !== "Error") return c;
  }
  return "error";
}

const validTime = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function parseSyncStatus(raw: unknown): SyncStatusRecord | null {
  let o: any = raw;
  if (typeof raw === "string") { try { o = JSON.parse(raw); } catch { return null; } }
  if (!o || typeof o !== "object" || !validTime(o.finishedAt) || typeof o.ok !== "boolean") return null;
  return {
    finishedAt: o.finishedAt, ok: o.ok, imported: num(o.imported), forms: num(o.forms), formErrors: num(o.formErrors),
    errorCode: typeof o.errorCode === "string" ? safeErrorCode({ code: o.errorCode }) : null,
    lastOkAt: validTime(o.lastOkAt) ? o.lastOkAt : null,
  };
}

export function newerRecord(a: SyncStatusRecord | null, b: SyncStatusRecord | null): SyncStatusRecord | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b.finishedAt) > Date.parse(a.finishedAt) ? b : a;
}

export async function writeSyncStatus(rec: SyncStatusRecord): Promise<void> {
  try {
    const value = JSON.stringify({
      finishedAt: rec.finishedAt, ok: rec.ok, imported: rec.imported, forms: rec.forms, formErrors: rec.formErrors,
      errorCode: rec.errorCode, lastOkAt: rec.lastOkAt,
    });
    await db.execute(
      `INSERT INTO org_settings (id, setting_key, setting_value, label) VALUES (UUID(), ?, ?, 'Hiring Engine: last Meta lead sync')
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [SYNC_STATUS_KEY, value],
    );
  } catch (err: any) {
    console.warn("[meta-sync] could not persist sync status:", safeErrorCode(err));
  }
}

export async function readSyncStatus(): Promise<SyncStatusRecord | null> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT setting_value FROM org_settings WHERE setting_key = ? LIMIT 1", [SYNC_STATUS_KEY]);
    return rows?.[0] ? parseSyncStatus(rows[0].setting_value) : null;
  } catch { return null; }
}
