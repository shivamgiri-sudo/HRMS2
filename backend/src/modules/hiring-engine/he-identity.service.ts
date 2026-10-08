/**
 * Identity keeping: the number is the person (he_lead.mobile10); extra numbers and emails are recorded in
 * he_lead_identity (UNIQUE kind+value). If one already belongs to a different lead it is NOT merged: a clash row
 * is written for HR review.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { normaliseEmail } from "../../shared/email-domains.js";
import { normalizeMobile10 } from "./he-phone.js";

export type IdentityKind = "mobile" | "email" | "aadhaar_hash" | "pan_hash";

export interface IdentityInput {
  mobile?: string | null;
  altMobiles?: Array<string | null | undefined>;
  email?: string | null;
  /** SHA-256 hashes already stored on the ATS candidate (never raw numbers). */
  aadhaarHash?: string | null;
  panHash?: string | null;
  source?: string | null;
}

export interface IdentityResult {
  recorded: number;
  clashes: number;
}

async function recordOne(leadId: string, kind: IdentityKind, value: string, isPrimary: boolean, source: string | null): Promise<"new" | "same" | "clash"> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT lead_id FROM he_lead_identity WHERE kind = ? AND value = ? LIMIT 1", [kind, value]);
  const owner = rows[0]?.lead_id as string | undefined;
  if (!owner) {
    // INSERT IGNORE: a concurrent writer winning the race is re-read below as 'same' or 'clash'.
    await db.execute("INSERT IGNORE INTO he_lead_identity (lead_id, kind, value, is_primary, source) VALUES (?,?,?,?,?)", [leadId, kind, value, isPrimary ? 1 : 0, source]);
    const [again] = await db.execute<RowDataPacket[]>("SELECT lead_id FROM he_lead_identity WHERE kind = ? AND value = ? LIMIT 1", [kind, value]);
    if (again[0]?.lead_id === leadId) return "new";
    return recordClash(kind, value, leadId, again[0]?.lead_id as string);
  }
  if (owner === leadId) return "same";
  return recordClash(kind, value, leadId, owner);
}

async function recordClash(kind: IdentityKind, value: string, a: string, b: string): Promise<"clash"> {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  await db.execute("INSERT IGNORE INTO he_identity_clash (kind, value, lead_id_a, lead_id_b) VALUES (?,?,?,?)", [kind, value, lo, hi]);
  return "clash";
}

export async function recordIdentities(leadId: string, input: IdentityInput): Promise<IdentityResult> {
  const out: IdentityResult = { recorded: 0, clashes: 0 };
  const tally = (r: "new" | "same" | "clash") => { if (r === "new") out.recorded++; if (r === "clash") out.clashes++; };
  const primary = normalizeMobile10(input.mobile ?? "");
  if (primary) tally(await recordOne(leadId, "mobile", primary, true, input.source ?? null));
  for (const alt of input.altMobiles ?? []) {
    const m = normalizeMobile10(alt ?? "");
    if (m && m !== primary) tally(await recordOne(leadId, "mobile", m, false, input.source ?? null));
  }
  const email = normaliseEmail(input.email ?? "");
  if (email) tally(await recordOne(leadId, "email", email, true, input.source ?? null));
  for (const [kind, v] of [["aadhaar_hash", input.aadhaarHash], ["pan_hash", input.panHash]] as const) {
    const h = String(v ?? "").trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(h)) tally(await recordOne(leadId, kind, h, false, input.source ?? null));
  }
  return out;
}

/** Existing lead that owns this email (secondary identity lookup used before creating a new person). */
export async function findLeadIdByEmail(email: string | null | undefined): Promise<string | null> {
  const e = normaliseEmail(email ?? "");
  if (!e) return null;
  const [rows] = await db.execute<RowDataPacket[]>("SELECT lead_id FROM he_lead_identity WHERE kind = 'email' AND value = ? LIMIT 1", [e]);
  return (rows[0]?.lead_id as string | undefined) ?? null;
}

export async function listOpenClashes(limit = 100): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id, c.kind, c.value, c.created_at, a.mobile10 AS mobile_a, a.full_name AS name_a, b.mobile10 AS mobile_b, b.full_name AS name_b
       FROM he_identity_clash c JOIN he_lead a ON a.id = c.lead_id_a JOIN he_lead b ON b.id = c.lead_id_b
      WHERE c.status = 'open' ORDER BY c.id DESC LIMIT ${Math.max(1, Math.min(500, Math.floor(limit)))}`);
  return rows;
}

export async function resolveClash(id: number, status: "same_person" | "different" | "ignored", userId: string | null): Promise<void> {
  await db.execute("UPDATE he_identity_clash SET status = ?, resolved_by = ?, resolved_at = NOW() WHERE id = ? AND status = 'open'", [status, userId, id]);
}
