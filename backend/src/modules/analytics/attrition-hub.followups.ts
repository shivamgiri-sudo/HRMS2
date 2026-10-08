/**
 * Attrition hub - follow-up log (who contacted whom about what, and how it went) and a measure of
 * whether it works. The table is created by migration 1989; until it exists every read degrades to
 * "nothing logged" instead of failing the page.
 */
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { addDays, today } from "./attrition-hub.data.js";
import { probabilityFor, type Model } from "./attrition-hub.service.js";
import type { LastFollowup } from "./attrition-hub.drill.js";

export const FOLLOWUP_KINDS = ["absent_outreach", "stay_conversation", "pay_review", "buddy_assigned", "shift_change", "other"] as const;
export const FOLLOWUP_OUTCOMES = ["pending", "reached_returning", "reached_resigning", "not_reachable", "improved", "no_change"] as const;
export type FollowupKindT = (typeof FOLLOWUP_KINDS)[number];
export type FollowupOutcomeT = (typeof FOLLOWUP_OUTCOMES)[number];

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

export async function latestFollowups(): Promise<Map<string, LastFollowup>> {
  const m = new Map<string, LastFollowup>();
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT f.employee_id, f.kind, f.outcome, f.created_at
         FROM attrition_followup f
         JOIN (SELECT employee_id, MAX(created_at) AS mc FROM attrition_followup GROUP BY employee_id) l
           ON l.employee_id = f.employee_id AND l.mc = f.created_at`,
    );
    for (const r of rows) m.set(String(r.employee_id), { kind: String(r.kind), outcome: String(r.outcome), at: iso(r.created_at) });
  } catch (err) { console.error("[attrition-hub] follow-ups unavailable:", err instanceof Error ? err.message : err); }
  return m;
}

export async function listFollowups(employeeId: string) {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_id, kind, outcome, note, created_at, created_by_name FROM attrition_followup
        WHERE employee_id = ? ORDER BY created_at DESC LIMIT 50`, [employeeId]);
    return rows.map((r) => ({ id: String(r.id), employeeId: String(r.employee_id), kind: r.kind, outcome: r.outcome, note: r.note ?? null, createdAt: iso(r.created_at), createdByName: r.created_by_name ?? null }));
  } catch (err) { console.error("[attrition-hub] follow-ups unavailable:", err instanceof Error ? err.message : err); return []; }
}

export function validateFollowup(body: Record<string, unknown>): { ok: true; kind: FollowupKindT; outcome: FollowupOutcomeT; note: string | null } | { ok: false; message: string } {
  const kind = String(body.kind ?? ""), outcome = String(body.outcome ?? "");
  if (!(FOLLOWUP_KINDS as readonly string[]).includes(kind)) return { ok: false, message: "Unknown follow-up type" };
  if (!(FOLLOWUP_OUTCOMES as readonly string[]).includes(outcome)) return { ok: false, message: "Unknown outcome" };
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  return { ok: true, kind: kind as FollowupKindT, outcome: outcome as FollowupOutcomeT, note };
}

export async function addFollowup(a: { employeeId: string; kind: FollowupKindT; outcome: FollowupOutcomeT; note: string | null; userId: string; tier: string; score: number }) {
  const [nameRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(full_name),''), TRIM(CONCAT(first_name,' ',COALESCE(last_name,'')))) AS n FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`, [a.userId]);
  const by = nameRows[0]?.n ? String(nameRows[0].n) : null;
  const id = randomUUID();
  await db.execute(
    `INSERT INTO attrition_followup (id, employee_id, kind, outcome, note, tier_at_action, score_at_action, created_by, created_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, a.employeeId, a.kind, a.outcome, a.note, a.tier, a.score, a.userId, by]);
  return { id, employeeId: a.employeeId, kind: a.kind, outcome: a.outcome, note: a.note, createdAt: new Date().toISOString(), createdByName: by };
}

/**
 * Of the people first actioned 30+ days ago, how many were still employed 30 days after that action,
 * against what the model expected for people of their risk tier at the time (no intervention).
 */
export async function followupEffect(allowed: Set<string> | null, model: Model | null) {
  const empty = { windowDays: 30, actioned: 0, stillActive: 0, stillActivePct: null as number | null, baselinePct: null as number | null, byKind: [] as { kind: string; n: number; stillActivePct: number | null }[], logged30: 0 };
  try {
    // No SQL join to employees: that table and this one may carry different collations. Join in code.
    const [first] = await db.execute<RowDataPacket[]>(
      `SELECT f.employee_id, f.kind, f.tier_at_action, f.created_at AS first_at
         FROM attrition_followup f
         JOIN (SELECT employee_id, MIN(created_at) AS mc FROM attrition_followup GROUP BY employee_id) m
           ON m.employee_id = f.employee_id AND m.mc = f.created_at`);
    const ids = [...new Set(first.map((r) => String(r.employee_id)))];
    const status = new Map<string, { active_status: number; exit_date: string | null }>();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const [emp] = await db.execute<RowDataPacket[]>(
        `SELECT id, active_status, DATE_FORMAT(date_of_exit, '%Y-%m-%d') AS exit_date FROM employees WHERE id IN (${chunk.map(() => "?").join(",")})`, chunk as never[]);
      for (const e of emp) status.set(String(e.id), { active_status: Number(e.active_status), exit_date: e.exit_date ?? null });
    }
    const rows = first.filter((r) => status.has(String(r.employee_id))).map((r) => ({ ...r, active_status: status.get(String(r.employee_id))!.active_status, exit_date: status.get(String(r.employee_id))!.exit_date })) as RowDataPacket[];
    const [recent] = await db.execute<RowDataPacket[]>(`SELECT employee_id FROM attrition_followup WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`);
    const seen = new Set<string>();
    const mine = rows.filter((r) => (!allowed || allowed.has(String(r.employee_id))) && !seen.has(String(r.employee_id)) && seen.add(String(r.employee_id)));
    const cutoff = addDays(today(), -30);
    const measured = mine.filter((r) => iso(r.first_at).slice(0, 10) <= cutoff);
    const stayed = (r: RowDataPacket) => !r.exit_date || String(r.exit_date) > addDays(iso(r.first_at).slice(0, 10), 30);
    const kinds = new Map<string, { n: number; ok: number }>();
    let ok = 0, baseSum = 0, baseN = 0;
    for (const r of measured) {
      const s = stayed(r); if (s) ok++;
      const k = kinds.get(String(r.kind)) ?? kinds.set(String(r.kind), { n: 0, ok: 0 }).get(String(r.kind))!; k.n++; if (s) k.ok++;
      if (model && r.tier_at_action) { const rate = probabilityFor(model, r.tier_at_action) ?? model.baseRatePct / 100; baseSum += 1 - rate; baseN++; }
    }
    return {
      ...empty, actioned: measured.length, stillActive: ok,
      stillActivePct: measured.length ? Math.round((ok / measured.length) * 1000) / 10 : null,
      baselinePct: baseN ? Math.round((baseSum / baseN) * 1000) / 10 : null,
      byKind: [...kinds.entries()].map(([kind, v]) => ({ kind, n: v.n, stillActivePct: v.n ? Math.round((v.ok / v.n) * 1000) / 10 : null })),
      logged30: recent.filter((r) => !allowed || allowed.has(String(r.employee_id))).length,
    };
  } catch (err) { console.error("[attrition-hub] follow-up effect unavailable:", err instanceof Error ? err.message : err); return empty; }
}
