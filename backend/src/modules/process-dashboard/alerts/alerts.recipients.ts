/**
 * Process Dashboard alerts -- recipient resolution, always re-checked against the process scope.
 * A recipient spec (roles / team-leader names / employee ids) is only a request: a person receives anything ONLY if they are an active
 * employee with a login whose own role scope can read this process's dashboard (isProcessReadable), evaluated now, not when the rule was saved.
 * E-mail goes only to an official company-domain address (same allowlist the notification gateway enforces); everyone else is in-app only.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { isOfficialDomain } from "../../../shared/email-domains.js";
import { isProcessReadable } from "../pd.config.service.js";
import { PdError } from "../pd.source.js";
import { MAX_RECIPIENTS, recipientsEmpty, type RecipientSpec } from "./alerts.types.js";

export interface Person { employeeId: string; userId: string; name: string; email: string | null }
const MAX_PEOPLE = 100;
const ph = (n: number): string => Array(n).fill("?").join(",");

const COLS = `e.id AS employee_id, e.user_id, COALESCE(NULLIF(TRIM(e.full_name),''), e.employee_code) AS name, e.official_email, e.office_email`;
export const officialEmailOf = (r: Record<string, unknown>): string | null => {
  for (const c of [r.official_email, r.office_email]) { const v = typeof c === "string" ? c.trim() : ""; if (v && isOfficialDomain(v)) return v; }
  return null;
};

/** Candidate people named by the spec (before the scope check). */
async function candidates(spec: RecipientSpec): Promise<RowDataPacket[]> {
  const out: RowDataPacket[] = [];
  if (spec.roles.length) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT ${COLS} FROM employees e JOIN user_roles ur ON ur.user_id = e.user_id AND ur.active_status = 1 AND ur.role_key IN (${ph(spec.roles.length)})
        WHERE e.active_status = 1 AND e.user_id IS NOT NULL LIMIT ${MAX_PEOPLE * 3}`, spec.roles);
    out.push(...rows);
  }
  if (spec.employeeIds.length) {
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${COLS} FROM employees e WHERE e.active_status = 1 AND e.id IN (${ph(spec.employeeIds.length)}) LIMIT ${MAX_RECIPIENTS}`, spec.employeeIds);
    out.push(...rows);
  }
  if (spec.tls.length) {
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${COLS} FROM employees e WHERE e.active_status = 1 AND e.user_id IS NOT NULL AND e.full_name IN (${ph(spec.tls.length)}) LIMIT ${MAX_RECIPIENTS}`, spec.tls);
    out.push(...rows);
  }
  return out;
}

export async function resolvePeople(processId: string, spec: RecipientSpec): Promise<{ people: Person[]; dropped: number }> {
  if (recipientsEmpty(spec)) return { people: [], dropped: 0 };
  const rows = await candidates(spec);
  const seen = new Set<string>(); const readable = new Map<string, boolean>(); const people: Person[] = []; let dropped = 0;
  for (const r of rows) {
    const empId = String(r.employee_id); if (seen.has(empId)) continue; seen.add(empId);
    const uid = r.user_id ? String(r.user_id) : null;
    if (!uid) { dropped++; continue; }
    let ok = readable.get(uid);
    if (ok === undefined) { ok = await isProcessReadable(uid, processId).catch(() => false); readable.set(uid, ok); }
    if (!ok) { dropped++; continue; }
    people.push({ employeeId: empId, userId: uid, name: String(r.name ?? ""), email: officialEmailOf(r) });
    if (people.length >= MAX_PEOPLE) break;
  }
  return { people, dropped };
}

/** Save-time guard: every explicitly named person must be inside the process scope (roles / TLs resolve per send and are filtered then). */
export async function assertNamedRecipientsInScope(processId: string, spec: RecipientSpec): Promise<void> {
  if (!spec.employeeIds.length) return;
  const { people } = await resolvePeople(processId, { roles: [], tls: [], employeeIds: spec.employeeIds });
  const ok = new Set(people.map((p) => p.employeeId));
  const out = spec.employeeIds.filter((id) => !ok.has(id));
  if (out.length) throw new PdError(400, "RECIPIENT_OUT_OF_SCOPE", `${out.length} recipient(s) are not active employees who can view this process's dashboard`);
}

/** People the picker may offer: active employees with a login who can read this process. Bounded; searched by name/code. */
export async function searchRecipientCandidates(processId: string, q: string): Promise<Array<{ employeeId: string; name: string; hasEmail: boolean }>> {
  const needle = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`).slice(0, 60)}%`;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${COLS} FROM employees e JOIN user_roles ur ON ur.user_id = e.user_id AND ur.active_status = 1
      WHERE e.active_status = 1 AND e.user_id IS NOT NULL AND (e.full_name LIKE ? OR e.employee_code LIKE ?) GROUP BY e.id LIMIT 40`, [needle, needle]);
  const out: Array<{ employeeId: string; name: string; hasEmail: boolean }> = []; const cache = new Map<string, boolean>();
  for (const r of rows) {
    const uid = String(r.user_id); let ok = cache.get(uid);
    if (ok === undefined) { ok = await isProcessReadable(uid, processId).catch(() => false); cache.set(uid, ok); }
    if (ok) out.push({ employeeId: String(r.employee_id), name: String(r.name ?? ""), hasEmail: officialEmailOf(r) !== null });
    if (out.length >= 15) break;
  }
  return out;
}
