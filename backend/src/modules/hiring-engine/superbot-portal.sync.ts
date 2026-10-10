/**
 * Hands each live calling file to the portal and brings the call results back (the owner's "upload every 2 hours, download, map who was
 * contacted and what they said"). Upload is idempotent per batch (a batch is built once per slot); the results pull is idempotent per
 * portal call id (recordVoiceResult keeps one row per provider call id). A failure never blocks or re-opens a batch: it is logged and
 * left in the batch summary. The password stays in the server env.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { applyCallResults } from "./he-call-results.service.js";
import { matchForRef } from "./he-call-ref.service.js";
import { botConfig, bulkImport, listCalls, type BotCall } from "./superbot-portal.client.js";

export interface PortalUpload { attempted: boolean; ok: boolean; total: number; message: string }

/** `rows` are the first seven calling-file columns per person: phone, name, role, interview_date, interview_time, branch_address, reference_id. */
export async function uploadCallFile(batchId: string, rows: string[][]): Promise<PortalUpload> {
  const c = botConfig();
  if (!c || c.uploadMode !== "live") return { attempted: false, ok: false, total: rows.length, message: "portal upload is off" };
  const clean = rows.filter((r) => /^\d{10}$/.test(String(r[0] ?? "")));
  const r = await bulkImport(c, clean).catch((e: unknown) => ({ ok: false, status: 0, total: clean.length, message: String((e as Error).message).slice(0, 120) }));
  logger.info({ batchId, total: clean.length, ok: r.ok, status: r.status }, "[superbot] calling file upload");
  try {
    await db.execute("UPDATE qualified_followup_call_batch SET summary = JSON_SET(COALESCE(summary, JSON_OBJECT()), '$.portal', CAST(? AS JSON)) WHERE id = ?",
      [JSON.stringify({ ok: r.ok, total: clean.length, message: r.message, at: new Date().toISOString() }), batchId]);
  } catch { /* the upload result is only a note */ }
  return { attempted: true, ok: r.ok, total: clean.length, message: r.message };
}

const FOLLOWUP_REF = /^QF-([0-9A-F]{8})$/i;

/** The portal prints the reference with a space after the dash ("HRMS- 296"); ours has none. */
export const normaliseRef = (reference: string): string => String(reference ?? "").replace(/\s+/g, "");

async function mobileOf(reference: string): Promise<string | null> {
  const ref = normaliseRef(reference);
  if (!ref) return null;
  if (FOLLOWUP_REF.test(ref)) {
    const prefix = FOLLOWUP_REF.exec(ref)![1].toLowerCase();
    const [r] = await db.execute<RowDataPacket[]>("SELECT mobile10 FROM qualified_followup WHERE id LIKE ? LIMIT 1", [`${prefix}-%`]);
    return r[0] ? String(r[0].mobile10) : null;
  }
  const matchId = await matchForRef(ref);
  if (!matchId) return null;
  const [r] = await db.execute<RowDataPacket[]>("SELECT l.mobile10 FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE m.id = ? LIMIT 1", [matchId]);
  return r[0] ? String(r[0].mobile10) : null;
}

/** The portal's list row as one row of the calling tool's own report (the shape the call-results import already understands). */
export function botCallToReportRow(c: BotCall, mobile10: string): Record<string, string> {
  return {
    "Phone Number": mobile10, "Unique Call Id": c.callId, "Call Dial Time": c.processedAtIst ?? "", Disposition: c.disposition,
    Outcome: c.status.toLowerCase() === "failed" ? "" : c.disposition ? "disposed" : "abandoned", Status: c.status, "Reference ID": normaliseRef(c.reference),
    "No Of Attempt": String(c.noOfCalls || ""), "Walkin Interview Attendance": "-",
  };
}

export interface PullSummary { listed: number; considered: number; unresolved: number; applied: number; duplicates: number; rejected: number }

/** Reads the campaign's call list and records every finished call of the last `days` days through the call-results import. */
export async function pullPortalResults(days = 3): Promise<PullSummary | null> {
  const c = botConfig();
  if (!c) return null;
  const out: PullSummary = { listed: 0, considered: 0, unresolved: 0, applied: 0, duplicates: 0, rejected: 0 };
  const l = await listCalls(c);
  if (!l.ok) return null;
  out.listed = l.calls.length;
  const since = new Date(Date.now() + 5.5 * 3600_000 - days * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
  const rows: Array<Record<string, unknown>> = [];
  for (const call of l.calls) {
    const st = call.status.toLowerCase();
    if (st !== "answered" && st !== "failed") continue; // still queued / in process / awaited
    if (!call.processedAtIst || call.processedAtIst < since || !call.callId) continue;
    out.considered++;
    const mobile = await mobileOf(call.reference).catch(() => null);
    if (!mobile) { out.unresolved++; continue; }
    rows.push(botCallToReportRow(call, mobile));
  }
  for (let i = 0; i < rows.length; i += 500) {
    const r = await applyCallResults(rows.slice(i, i + 500), { userId: null, source: "superbot_portal" }).catch(() => null);
    if (r) { out.applied += r.applied; out.duplicates += r.duplicates; out.rejected += r.rejected; }
  }
  logger.info({ ...out }, "[superbot] results pull");
  return out;
}
