// HR include/exclude overrides per person x requisition (or every requisition, scope '*'); plan 2026-10-09 S12.
// Reads here; the write path (reason required, history, scope checks) is setOverride / removeOverride.
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { Evaluation } from "./selection-types.js";

export type Override = NonNullable<Evaluation["override"]>;

/** Overrides that apply to one requisition: its own beat the '*' ones. Map by mobile10. */
export async function loadOverrides(requisitionId: string, mobiles?: string[]): Promise<Map<string, Override>> {
  const out = new Map<string, Override>();
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT mobile10, requisition_scope, kind, reason, actor_id, created_at FROM shortlist_override
        WHERE requisition_scope IN (?, '*')${mobiles?.length ? ` AND mobile10 IN (${mobiles.map(() => "?").join(",")})` : ""}`,
      [requisitionId, ...(mobiles ?? [])]);
    for (const r of [...rows].sort((a, b) => (a.requisition_scope === "*" ? 0 : 1) - (b.requisition_scope === "*" ? 0 : 1))) {
      out.set(String(r.mobile10), { kind: r.kind === "exclude" ? "exclude" : "include", reason: String(r.reason), actorId: String(r.actor_id), at: String(r.created_at) });
    }
  } catch { /* before migration 2147 there are no overrides */ }
  return out;
}

export function withOverride(e: Evaluation, o: Override | undefined): Evaluation {
  return o ? { ...e, override: o } : e;
}
