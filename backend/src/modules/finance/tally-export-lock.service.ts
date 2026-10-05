import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

/**
 * Locks what has been pulled out for Tally, so the same voucher is not imported twice.
 *
 * Tally accepts a second voucher with the same number without complaint, so the protection has to
 * live here. Every Tally-bound export (salary voucher CSV/Excel/XML and the HTTP push, bank
 * vouchers, GST sales) goes through the same three steps:
 *
 *   1. split the items into FRESH (never pulled) and LOCKED (already pulled);
 *   2. export only the fresh ones and lock them in the same breath;
 *   3. a locked item comes out again only by an explicit, reasoned, audited RE-EXPORT by a
 *      finance head / super_admin, or after its lock is RELEASED (e.g. the import into Tally failed).
 */

export type LockType = "salary_voucher" | "bank_voucher" | "gst_sales";
export type LockItem = { key: string; label?: string };
export type LockRow = {
  item_key: string; item_label: string | null; status: "exported" | "posted"; format: string | null;
  exported_by: string | null; exported_by_name: string | null; exported_at: string; reexport_count: number;
};

const REEXPORT_ROLES = new Set(["finance_head", "super_admin"]);
const MIN_REASON = 10;

export function canReexport(roles: string[] | undefined, primaryRole?: string) {
  return [...(roles ?? []), primaryRole ?? ""].some((r) => REEXPORT_ROLES.has(r));
}

export const tallyExportLock = {
  async locks(type: LockType, scope: string, keys?: string[]): Promise<Map<string, LockRow>> {
    const params: unknown[] = [type, scope];
    let keyFilter = "";
    if (keys) {
      if (!keys.length) return new Map();
      keyFilter = ` AND l.item_key IN (${keys.map(() => "?").join(",")})`;
      params.push(...keys);
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT l.item_key, l.item_label, l.status, l.format, l.exported_by, l.exported_at, l.reexport_count
         FROM tally_export_lock l
        WHERE l.export_type = ? AND l.scope_key = ? AND l.active = 1${keyFilter}`, params);
    // Names are looked up separately, not joined: the two tables' ids need not share a collation,
    // and a join between them would then fail the whole page.
    const userIds = [...new Set((rows as RowDataPacket[]).map((r) => r.exported_by).filter(Boolean).map(String))];
    const names = new Map<string, string>();
    if (userIds.length) {
      const [emps] = await db.execute<RowDataPacket[]>(
        `SELECT user_id, MIN(first_name) AS first_name, MIN(last_name) AS last_name FROM employees
          WHERE user_id IN (${userIds.map(() => "?").join(",")}) GROUP BY user_id`, userIds);
      for (const e of emps as RowDataPacket[]) names.set(String(e.user_id), `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim());
    }
    return new Map((rows as RowDataPacket[]).map((r) => [String(r.item_key), {
      item_key: String(r.item_key), item_label: r.item_label ?? null, status: r.status, format: r.format ?? null,
      exported_by: r.exported_by ?? null, exported_by_name: (r.exported_by && names.get(String(r.exported_by))) || null,
      exported_at: r.exported_at instanceof Date ? r.exported_at.toISOString() : String(r.exported_at), reexport_count: Number(r.reexport_count),
    } as LockRow]));
  },

  /**
   * Validates a re-export request. Returns the reason to record, or throws a message for the
   * caller to send back. Not a lock check — only "may this person override, and did they say why".
   */
  assertReexport(reason: unknown, roles: string[] | undefined, primaryRole?: string): string {
    if (!canReexport(roles, primaryRole)) throw Object.assign(new Error("Only a finance head or super admin can re-export vouchers that are already locked."), { statusCode: 403 });
    const text = String(reason ?? "").trim();
    if (text.length < MIN_REASON) throw Object.assign(new Error(`Give a reason of at least ${MIN_REASON} characters for exporting already-exported vouchers again.`), { statusCode: 400 });
    return text;
  },

  /**
   * Locks the items and returns the keys THIS call actually locked. A key that is already locked is
   * left untouched, so when two people export at the same moment only one of them gets the key
   * back — the caller must treat a short list as "someone else got there first" and stop.
   */
  async lock(type: LockType, scope: string, items: LockItem[], userId: string, format: string): Promise<string[]> {
    const got: string[] = [];
    for (const it of items) {
      const [res] = await db.execute<any>(
        // INSERT IGNORE: a key that is already locked inserts nothing and reports 0 rows. (ON DUPLICATE
        // KEY UPDATE would report the matched row as 1 under mysql2's default FOUND_ROWS flag.)
        `INSERT IGNORE INTO tally_export_lock (id, export_type, scope_key, item_key, item_label, status, format, exported_by, active)
         VALUES (?,?,?,?,?,'exported',?,?,1)`,
        [randomUUID(), type, scope, it.key, (it.label ?? "").slice(0, 190) || null, format, userId || null]);
      if (Number(res.affectedRows) === 1) got.push(it.key);
    }
    return got;
  },

  async markPosted(type: LockType, scope: string, keys: string[]) {
    if (!keys.length) return;
    await db.execute(
      `UPDATE tally_export_lock SET status = 'posted', format = 'push'
        WHERE export_type = ? AND scope_key = ? AND active = 1 AND item_key IN (${keys.map(() => "?").join(",")})`,
      [type, scope, ...keys]);
  },

  /** Counts a deliberate re-export against the existing locks and audits it. */
  async recordReexport(type: LockType, scope: string, items: LockItem[], userId: string, role: string | undefined, reason: string, format: string) {
    if (items.length) {
      await db.execute(
        `UPDATE tally_export_lock SET reexport_count = reexport_count + 1
          WHERE export_type = ? AND scope_key = ? AND active = 1 AND item_key IN (${items.map(() => "?").join(",")})`,
        [type, scope, ...items.map((i) => i.key)]);
    }
    await logSensitiveAction({
      actor_user_id: userId, actor_role: role, action_type: "TALLY_EXPORT_REEXPORT", module_key: "FINANCE",
      entity_type: type, entity_id: scope, reason, change_summary: { items: items.map((i) => i.label ?? i.key).slice(0, 200), format },
    }).catch(() => undefined);
  },

  /** Unlocks items (history kept). For when the import into Tally failed and the file must be pulled again. */
  async release(type: LockType, scope: string, keys: string[], userId: string, role: string | undefined, reason: string) {
    if (!keys.length) return 0;
    const [res] = await db.execute<any>(
      `UPDATE tally_export_lock SET active = NULL, released_by = ?, released_at = NOW(), release_reason = ?
        WHERE export_type = ? AND scope_key = ? AND active = 1 AND item_key IN (${keys.map(() => "?").join(",")})`,
      [userId, reason.slice(0, 500), type, scope, ...keys]);
    await logSensitiveAction({
      actor_user_id: userId, actor_role: role, action_type: "TALLY_EXPORT_LOCK_RELEASED", module_key: "FINANCE",
      entity_type: type, entity_id: scope, reason, change_summary: { released: res.affectedRows, keys: keys.slice(0, 200) },
    }).catch(() => undefined);
    return Number(res.affectedRows ?? 0);
  },
};

/** Splits items by lock state. */
export async function splitByLock(type: LockType, scope: string, items: LockItem[]) {
  const locks = await tallyExportLock.locks(type, scope, items.map((i) => i.key));
  return {
    fresh: items.filter((i) => !locks.has(i.key)),
    locked: items.filter((i) => locks.has(i.key)).map((i) => ({ ...i, lock: locks.get(i.key)! })),
  };
}
