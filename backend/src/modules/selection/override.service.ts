// HR include/exclude overrides per person x requisition (or every requisition, scope '*'); plan 2026-10-09 S12.
// Reads here; the write path (reason required, history, scope checks) is setOverride / removeOverride.
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { normalizeMobile10 } from "../hiring-engine/he-phone.js";
import { jobRequisitionService } from "../job-requisition/job-requisition.service.js";
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

// ── write path (S12) ──────────────────────────────────────────────────────────────────────────────
export const OVERRIDE_ROLES = ["super_admin", "admin", "hr", "recruitment_hr"] as const;
export interface OverrideActor { id: string; role: string; user: NonNullable<AuthenticatedRequest["authUser"]> }
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const variants = (m: string) => [m, `+91${m}`, `91${m}`, `0${m}`];

/** System exclusions no override can lift: legacy/test records, opted out, hard reject, current employee, joined. */
export async function systemExclusionOf(mobile10: string): Promise<string | null> {
  const [leads] = await db.execute<RowDataPacket[]>("SELECT l.status, l.final_status, l.is_employee FROM he_lead l WHERE l.mobile10 = ? LIMIT 1", [mobile10]);
  const l = leads[0];
  if (l?.status === "opted_out") return "opted_out";
  if (l && Number(l.is_employee) === 1) return "current_employee";
  if (l && (l.status === "joined" || l.final_status === "joined")) return "already_joined";
  const [ats] = await db.execute<RowDataPacket[]>("SELECT ac.record_type, ac.hard_reject_reason FROM ats_candidate ac WHERE ac.mobile IN (?, ?, ?, ?)", variants(mobile10));
  if (ats.some((a) => a.record_type === "legacy_employee")) return "legacy_employee";
  if (ats.some((a) => a.record_type === "test")) return "test";
  if (ats.some((a) => String(a.hard_reject_reason ?? "").trim())) return "hard_reject";
  return null;
}

async function checkScope(scope: string, actor: OverrideActor) {
  if (scope === "*") {
    if (!(await jobRequisitionService.getBranchScope(actor.user)).orgWide) throw fail(403, "Only an org-wide user can set an override for every requisition");
  } else if (!(await jobRequisitionService.isRequisitionVisible(actor.user, { id: scope }))) {
    throw fail(404, "Requisition not found");
  }
}
function cleanInput(a: { mobile: string; requisitionScope: string; reason: string }) {
  const mobile10 = normalizeMobile10(a.mobile);
  const reason = String(a.reason ?? "").trim();
  if (!mobile10) throw fail(400, "A valid Indian mobile is required");
  if (!reason || reason.length > 300) throw fail(400, "A reason (1-300 characters) is required");
  const scope = String(a.requisitionScope ?? "").trim();
  if (!scope || scope.length > 36) throw fail(400, "requisitionScope must be a requisition id or *");
  return { mobile10, reason, scope };
}
const OV_SELECT = "SELECT mobile10, requisition_scope, kind, reason, actor_id, created_at FROM shortlist_override WHERE mobile10 = ? AND requisition_scope = ? FOR UPDATE";
const snap = (r: RowDataPacket | undefined) => (r ? { kind: r.kind, reason: r.reason, actorId: r.actor_id, at: String(r.created_at) } : null);

async function inTx<T>(fn: (ex: (sql: string, p: unknown[]) => Promise<[RowDataPacket[], unknown]>) => Promise<T>): Promise<T> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn((sql, p) => conn.execute(sql, p as never) as never);
    await conn.commit();
    return out;
  } catch (e) { await conn.rollback().catch(() => {}); throw e; } finally { conn.release(); }
}

export async function setOverride(a: { mobile: string; requisitionScope: string; kind: "include" | "exclude"; reason: string; actor: OverrideActor }): Promise<{ warning: string | null }> {
  const { mobile10, reason, scope } = cleanInput(a);
  if (a.kind !== "include" && a.kind !== "exclude") throw fail(400, "kind must be include or exclude");
  await checkScope(scope, a.actor);
  await inTx(async (ex) => {
    const [cur] = await ex(OV_SELECT, [mobile10, scope]);
    await ex(`INSERT INTO shortlist_override (mobile10, requisition_scope, kind, reason, actor_id, actor_role) VALUES (?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE kind = VALUES(kind), reason = VALUES(reason), actor_id = VALUES(actor_id), actor_role = VALUES(actor_role), created_at = CURRENT_TIMESTAMP`,
      [mobile10, scope, a.kind, reason, a.actor.id, a.actor.role]);
    await ex("INSERT INTO shortlist_override_log (mobile10, requisition_scope, action, before_json, after_json, reason, actor_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [mobile10, scope, "set", JSON.stringify(snap(cur[0])), JSON.stringify({ kind: a.kind, reason, actorId: a.actor.id }), reason, a.actor.id]);
  });
  const sys = a.kind === "include" ? await systemExclusionOf(mobile10) : null;
  return { warning: sys ? `system exclusion cannot be overridden (${sys})` : null };
}

export async function removeOverride(a: { mobile: string; requisitionScope: string; reason: string; actor: OverrideActor }): Promise<void> {
  const { mobile10, reason, scope } = cleanInput(a);
  await checkScope(scope, a.actor);
  await inTx(async (ex) => {
    const [cur] = await ex(OV_SELECT, [mobile10, scope]);
    if (!cur[0]) throw fail(404, "No override for this person and requisition");
    await ex("DELETE FROM shortlist_override WHERE mobile10 = ? AND requisition_scope = ?", [mobile10, scope]);
    await ex("INSERT INTO shortlist_override_log (mobile10, requisition_scope, action, before_json, after_json, reason, actor_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [mobile10, scope, "remove", JSON.stringify(snap(cur[0])), JSON.stringify(null), reason, a.actor.id]);
  });
}

/** The person's override history, limited to '*' and requisitions the caller can see. */
export async function overrideHistory(mobile: string, actor: OverrideActor) {
  const mobile10 = normalizeMobile10(mobile);
  if (!mobile10) throw fail(400, "A valid Indian mobile is required");
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT action, requisition_scope, before_json, after_json, reason, actor_id, created_at FROM shortlist_override_log WHERE mobile10 = ? ORDER BY id", [mobile10]);
  const out: Array<{ action: string; requisitionScope: string; before: unknown; after: unknown; reason: string; actorId: string; at: string }> = [];
  for (const r of rows) {
    if (r.requisition_scope !== "*" && !(await jobRequisitionService.isRequisitionVisible(actor.user, { id: String(r.requisition_scope) }))) continue;
    out.push({ action: String(r.action), requisitionScope: String(r.requisition_scope), before: r.before_json, after: r.after_json, reason: String(r.reason), actorId: String(r.actor_id), at: String(r.created_at) });
  }
  return out;
}
